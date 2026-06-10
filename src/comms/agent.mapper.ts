import { AgentBus } from './agent.bus';
import { Logger } from '../utils';

interface AgentState {
  capabilities: string[];
  isBusy: boolean;
  lastHeartbeat: number;
}

export class AgentMapper {
  private agentRegistry: Map<string, AgentState> = new Map();
  // Map of taskId -> { task, assignedAgent }
  private activeTasks: Map<string, any> = new Map();
  // Queue for unassigned tasks
  private taskQueue: any[] = [];
  
  private monitorInterval?: NodeJS.Timeout;

  constructor(private bus: AgentBus) {
    // Listen for task completion
    this.bus.subscribe('task_status_update', (payload) => {
      if (payload.status === 'COMPLETED' || payload.status === 'FAILED') {
        const agent = this.agentRegistry.get(payload.agentId);
        if (agent) agent.isBusy = false;
        this.activeTasks.delete(payload.taskId);
        
        // Attempt to drain queue
        this.processQueue();
      }
    });

    // Listen for heartbeats
    this.bus.subscribe('agent_heartbeat', (payload) => {
      const agent = this.agentRegistry.get(payload.agentId);
      if (agent) {
        agent.lastHeartbeat = payload.timestamp;
      }
    });
  }

  startMonitor(checkInterval: number = 5000, maxSilence: number = 15000) {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    Logger.info('[Mapper] Starting Kubernetes-style Agent Monitor...');
    this.monitorInterval = setInterval(() => {
      const now = Date.now();
      for (const [agentId, state] of this.agentRegistry.entries()) {
        if (now - state.lastHeartbeat > maxSilence) {
          Logger.error(`[Mapper] 💀 FATAL: Agent ${agentId} missed heartbeats. Evicting DEAD agent.`);
          this.agentRegistry.delete(agentId);
          this.recycleOrphanTasks(agentId);
        }
      }
    }, checkInterval);
  }

  stopMonitor() {
    if (this.monitorInterval) clearInterval(this.monitorInterval);
  }

  private recycleOrphanTasks(deadAgentId: string) {
    let orphansFound = 0;
    for (const [taskId, taskRecord] of this.activeTasks.entries()) {
      if (taskRecord.assignedAgent === deadAgentId) {
        Logger.warn(`[Mapper] Recycling orphaned task ${taskId} from dead agent ${deadAgentId}`);
        this.activeTasks.delete(taskId);
        // Put back at the front of the queue
        this.taskQueue.unshift(taskRecord.task);
        orphansFound++;
      }
    }
    
    if (orphansFound > 0) {
      this.processQueue();
    }
  }

  registerAgent(agentId: string, capabilities: string[]) {
    this.agentRegistry.set(agentId, { 
      capabilities, 
      isBusy: false, 
      lastHeartbeat: Date.now() 
    });
    Logger.info(`[Mapper] Registered Agent ${agentId} with capabilities: ${capabilities.join(', ')}`);
    this.processQueue();
  }

  assignTask(task: any) {
    if (this.activeTasks.has(task.id)) {
      Logger.warn(`[Mapper] Task ${task.id} is already actively assigned.`);
      return;
    }
    
    // Capacity boundary to prevent unbounded memory growth (COMM-002)
    if (this.taskQueue.length >= 1000) {
      Logger.error(`[Mapper] Task Queue Overflow! Dropping task ${task.id}.`);
      return;
    }
    
    this.taskQueue.push(task);
    this.processQueue();
  }

  private processQueue() {
    if (this.taskQueue.length === 0) return;

    // Fix processQueue reordering bug (COMM-003) by processing in-place
    const unassignedTasks = [];
    
    for (const task of this.taskQueue) {
      let selectedAgentId: string | null = null;
      for (const [agentId, state] of this.agentRegistry.entries()) {
        if (!state.isBusy && state.capabilities.includes(task.type)) {
          selectedAgentId = agentId;
          state.isBusy = true;
          break;
        }
      }

      if (selectedAgentId) {
        this.activeTasks.set(task.id, { task, assignedAgent: selectedAgentId });
        Logger.info(`[Mapper] Assigning Task ${task.id} to Agent ${selectedAgentId}`);
        this.bus.publish('new_task_assigned', {
          ...task,
          assignedAgent: selectedAgentId
        });
      } else {
        unassignedTasks.push(task);
      }
    }
    
    // Replace task queue with only the ones that couldn't be assigned
    this.taskQueue = unassignedTasks;
  }
}

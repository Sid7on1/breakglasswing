import { AgentBus } from './agent.bus';
import { Logger } from '../utils';

export class Subscriber {
  constructor(private bus: AgentBus, private agentId: string) {}

  listenForTasks(onTaskReceived: (task: any) => void) {
    this.bus.subscribe('new_task_assigned', (payload) => {
      // Check if task is mapped to this specific agent
      if (payload.assignedAgent === this.agentId) {
        Logger.info(`[Agent ${this.agentId}] Received direct task assignment: ${payload.id}`);
        onTaskReceived(payload);
      }
    });
  }
}

import { AgentBus } from './agent.bus';

export class Broadcaster {
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(private bus: AgentBus, private agentId: string) {}

  startHeartbeat(intervalMs: number = 5000) {
    this.heartbeatInterval = setInterval(() => {
      this.bus.publish('agent_heartbeat', {
        agentId: this.agentId,
        timestamp: Date.now()
      });
    }, intervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }

  emitStatus(taskId: string, status: 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED') {
    this.bus.publish('task_status_update', {
      agentId: this.agentId,
      taskId,
      status,
      timestamp: Date.now()
    });
  }

  emitError(errorDetails: string) {
    this.bus.publish('agent_error', {
      agentId: this.agentId,
      errorDetails,
      timestamp: Date.now()
    });
  }
}

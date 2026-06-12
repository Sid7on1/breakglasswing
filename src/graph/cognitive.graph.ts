import { GraphStore } from './graph.store';
import { Logger } from '../utils';

export class CognitiveGraph {
  constructor(private store: GraphStore) {}

  public registerGoal(goalId: string, description: string) {
    this.store.addNode({
      id: goalId,
      name: `Goal: ${description.substring(0, 20)}...`,
      type: 'GOAL',
      filePath: ''
    });
    Logger.info(`[CognitiveGraph] Registered Goal: ${goalId}`);
  }

  public registerTask(goalId: string, taskId: string, description: string) {
    this.store.addNode({
      id: taskId,
      name: `Task: ${description.substring(0, 20)}...`,
      type: 'TASK',
      filePath: ''
    });
    
    this.store.addEdge({
      sourceId: goalId,
      targetId: taskId,
      type: 'SPAWNS'
    });
    Logger.info(`[CognitiveGraph] Registered Task ${taskId} under Goal ${goalId}`);
  }

  public registerCapabilityRequirement(taskId: string, capabilityName: string) {
    const capId = `cap:${capabilityName}`;
    if (!this.store.getNode(capId)) {
      this.store.addNode({
        id: capId,
        name: capabilityName,
        type: 'CAPABILITY',
        filePath: ''
      });
    }

    this.store.addEdge({
      sourceId: taskId,
      targetId: capId,
      type: 'REQUIRES'
    });
    Logger.info(`[CognitiveGraph] Task ${taskId} REQUIRES Capability ${capabilityName}`);
  }

  public getMissingCapabilities(): string[] {
    // In a real system, the agent compares the required capabilities with what is available in genome/components.json
    // For now, we return any capability that has a REQUIRES edge but no SATISFIES edge from a local component
    const missing: string[] = [];
    for (const node of this.store.getGraph().nodes.values()) {
      if (node.type === 'CAPABILITY') {
        const satisfiers = this.store.getEdgesTo(node.id).filter(e => e.type === 'SATISFIES');
        if (satisfiers.length === 0) {
          missing.push(node.name);
        }
      }
    }
    return missing;
  }
}

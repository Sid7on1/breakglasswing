import { Logger } from '../utils';
import { ImpactEngine } from '../graph/impact.engine';
import { IGraphStore } from '../graph/models';

export class GraphExecutor {
  private impactEngine: ImpactEngine;

  constructor(store: IGraphStore) {
    this.impactEngine = new ImpactEngine(store);
  }

  execute(taskId: string, payload: any) {
    Logger.info(`[GraphExecutor] Executing Graph Query for Task ${taskId}`);
    
    try {
      const { queryType, nodeId, maxDepth } = payload;
      
      if (!queryType || !nodeId) {
        throw new Error("Missing 'queryType' or 'nodeId' in payload.");
      }

      switch (queryType) {
        case 'SHOW_WIRES':
        case 'FORWARD_DEPENDENCIES': {
          const deps = this.impactEngine.getForwardDependencies(nodeId, maxDepth);
          Logger.info(`[GraphExecutor] Forward dependencies for ${nodeId}: ${deps.map(d => d.id).join(', ')}`);
          break;
        }
        case 'REVERSE_DEPENDENCIES': {
          const deps = this.impactEngine.getReverseDependencies(nodeId, maxDepth);
          Logger.info(`[GraphExecutor] Reverse dependencies for ${nodeId}: ${deps.map(d => d.id).join(', ')}`);
          break;
        }
        case 'BLAST_RADIUS': {
          const radius = this.impactEngine.calculateBlastRadius(nodeId);
          Logger.info(`[GraphExecutor] Blast Radius for ${nodeId}:`);
          Logger.info(`  - Impacted Files: ${radius.impactedFiles}`);
          Logger.info(`  - Impacted Functions: ${radius.impactedFunctions}`);
          Logger.info(`  - Impacted Classes: ${radius.impactedClasses}`);
          Logger.info(`  - Highest Risk Score: ${radius.highestRiskScore}`);
          break;
        }
        case 'SHOW_ALL_PATHS': {
          const { endNodeId } = payload;
          if (!endNodeId) throw new Error("Missing 'endNodeId' for SHOW_ALL_PATHS.");
          const paths = this.impactEngine.getAllPaths(nodeId, endNodeId, maxDepth || 5);
          Logger.info(`[GraphExecutor] Found ${paths.length} paths between ${nodeId} and ${endNodeId}`);
          for (const path of paths) {
            Logger.info(`  -> ${path.map(p => p.id).join(' -> ')}`);
          }
          break;
        }
        case 'SHOW_DATA_FLOW': {
          const nodes = this.impactEngine.getDataFlow(nodeId);
          Logger.info(`[GraphExecutor] Data Flow for variable ${nodeId}: used by ${nodes.length} nodes`);
          for (const n of nodes) {
            Logger.info(`  -> [${n.type}] ${n.name} (${n.id})`);
          }
          break;
        }
        default:
          throw new Error(`Unknown graph queryType: ${queryType}`);
      }
    } catch (e: any) {
      Logger.error(`[GraphExecutor] Graph Query Failed: ${e.message}`);
    }
  }
}

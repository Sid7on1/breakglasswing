import { GraphStore } from './graph/graph.store';
import { ImpactEngine } from './graph/impact.engine';
import * as path from 'path';
import { Logger } from './utils';

async function main() {
  Logger.info('--- Initializing Impact Engine Test ---');
  
  const projectRoot = process.cwd();
  const storePath = path.join(projectRoot, '.breakglass_graph', 'playground.json');
  
  const store = new GraphStore(storePath);
  await store.loadFromDisk();

  if (store.getGraph().nodes.size === 0) {
    Logger.error('[Test] Graph is empty. Run test.graph.ts first.');
    return;
  }

  const impactEngine = new ImpactEngine(store);

  // Pick a node that has high connectivity, e.g. the EventBus or Logger
  const targetNodeId = 'class:src/core/event.bus.ts:EventBus';

  Logger.info(`\n[Test] Executing SHOW WIRES (Forward Dependencies) for: ${targetNodeId}`);
  const fwdDeps = impactEngine.getForwardDependencies(targetNodeId, 2);
  for (const dep of fwdDeps) {
    Logger.info(`  -> [${dep.type}] ${dep.name}`);
  }

  Logger.info(`\n[Test] Executing SHOW WIRES (Reverse Dependencies) for: ${targetNodeId}`);
  const revDeps = impactEngine.getReverseDependencies(targetNodeId, 2);
  for (const dep of revDeps) {
    Logger.info(`  <- [${dep.type}] ${dep.name}`);
  }

  Logger.info(`\n[Test] Calculating Blast Radius for modifying: ${targetNodeId}`);
  const radius = impactEngine.calculateBlastRadius(targetNodeId);
  Logger.info(`  - Impacted Files: ${radius.impactedFiles}`);
  Logger.info(`  - Impacted Functions: ${radius.impactedFunctions}`);
  Logger.info(`  - Impacted Classes: ${radius.impactedClasses}`);
  Logger.info(`  - Total Downstream Nodes: ${radius.totalImpactedNodes}`);

  Logger.info('\n--- Impact Engine Test Complete ---');
}

main().catch(console.error);

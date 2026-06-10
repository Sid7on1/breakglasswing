import { StaticAnalyzer } from './graph/static.analyzer';
import { GraphStore } from './graph/graph.store';
import { SemanticAugmenter } from './graph/semantic.augmenter';
import { LlmAdapter } from './core/llm.adapter';
import { ApiKeyManager } from './credits/api.key.manager';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();
import { Logger } from './utils';

async function main() {
  Logger.info('--- Initializing Static AST Parsing Test ---');
  
  const projectRoot = process.cwd(); // Run from breakglasswing root
  const storePath = path.join(projectRoot, '.breakglass_graph', 'playground.json');
  
  const store = new GraphStore(storePath);
  await store.loadFromDisk();

  const analyzer = new StaticAnalyzer(projectRoot, store);
  analyzer.analyzeProject();
  await store.saveToDisk();

  Logger.info('\n--- Testing Semantic Augmentation (3 Nodes) ---');
  const apiKeyManager = new ApiKeyManager();
  const llmAdapter = new LlmAdapter(apiKeyManager);
  
  // Mock for testing
  llmAdapter.generateSemanticMetadata = async (nodeId, name, type) => {
    Logger.info(`[Mock] Generating metadata for ${name}`);
    return {
      purpose: `This ${type.toLowerCase()} handles ${name} logic.`,
      criticality: 'MEDIUM',
      riskScore: Math.floor(Math.random() * 100)
    };
  };

  const augmenter = new SemanticAugmenter(store, llmAdapter, projectRoot);
  // We'll just augment 3 nodes to prove the pipeline works
  await augmenter.augmentGraph(3);

  Logger.info(`\n[Test] Printing sample of extracted nodes with semantics...`);
  let count = 0;
  for (const node of store.getGraph().nodes.values()) {
    if (count++ > 10) break;
    Logger.info(`- [${node.type}] ${node.name}`);
    if (node.purpose) {
      Logger.info(`    Purpose: ${node.purpose}`);
      Logger.info(`    Risk: ${node.riskScore} (${node.criticality})`);
    }
  }

  Logger.info('\n--- Graph Parsing Test Complete ---');
}

main().catch(console.error);

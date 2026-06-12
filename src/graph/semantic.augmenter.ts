import { GraphStore } from './graph.store';
import { LlmAdapter } from '../core/llm.adapter';
import { Logger } from '../utils';
import * as fs from 'fs/promises';
import * as path from 'path';

export class SemanticAugmenter {
  public enabled: boolean = true;

  constructor(private graphStore: GraphStore, private llmAdapter: LlmAdapter, private projectRoot: string) {}

  public setProjectRoot(newRoot: string) {
    this.projectRoot = newRoot;
  }

  public async augmentGraph(limit?: number): Promise<void> {
    if (!this.enabled) {
      Logger.info(`[SemanticAugmenter] Skipped — disabled by config.`);
      return;
    }
    const graph = this.graphStore.getGraph();
    let augmentedCount = 0;

    Logger.info(`[SemanticAugmenter] Starting semantic augmentation of nodes...`);

    for (const [id, node] of graph.nodes.entries()) {
      if (limit && augmentedCount >= limit) {
        break;
      }

      // Skip nodes that already have metadata
      if (node.purpose && node.criticality && node.riskScore !== undefined) {
        continue;
      }

      // Only augment Files, Classes, and Functions for now
      if (!['FILE', 'CLASS', 'FUNCTION'].includes(node.type)) {
        continue;
      }

      let codeSnippet = '';
      try {
        if (node.filePath) {
          const fullPath = path.join(this.projectRoot, node.filePath);
          const fullContent = await fs.readFile(fullPath, 'utf8');
          
          if (node.type === 'FILE') {
            // Send only the first 30 lines of a file to avoid massive token usage
            codeSnippet = fullContent.split('\n').slice(0, 30).join('\n') + '\n// ... (truncated)';
          } else {
            // Ideally we extract the exact AST node text, but for MVP we send the file slice
            codeSnippet = fullContent.split('\n').slice(0, 50).join('\n') + '\n// ... (truncated)';
          }
        }
      } catch (e) {
        Logger.warn(`[SemanticAugmenter] Could not read file for node ${node.id}`);
        continue;
      }

      Logger.info(`[SemanticAugmenter] Augmenting: ${node.id}`);
      
      const metadata = await this.llmAdapter.generateSemanticMetadata(node.id, node.name, node.type, codeSnippet);
      
      if (metadata) {
        node.purpose = metadata.purpose;
        node.criticality = metadata.criticality;
        node.riskScore = metadata.riskScore;
        augmentedCount++;
        
        // Checkpoint save every 10 nodes to avoid losing work on crash
        if (augmentedCount % 10 === 0) {
          await this.graphStore.saveToDisk();
        }
      }
    }

    if (augmentedCount > 0) {
      await this.graphStore.saveToDisk();
    }
    
    Logger.info(`[SemanticAugmenter] Semantic augmentation complete. Augmented ${augmentedCount} nodes.`);
  }
}

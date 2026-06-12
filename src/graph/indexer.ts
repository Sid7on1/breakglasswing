import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { StaticAnalyzer } from './static.analyzer';
import { SemanticAugmenter } from './semantic.augmenter';
import { GraphStore } from './graph.store';
import { Logger } from '../utils';

export class CodebaseIndexer {
  public enabled: boolean = true;
  public excludePatterns: string[] = [];

  constructor(
    private projectRoot: string,
    private graphStore: GraphStore,
    private analyzer: StaticAnalyzer,
    private augmenter: SemanticAugmenter
  ) {}

  public setProjectRoot(newRoot: string) {
    this.projectRoot = newRoot;
    this.analyzer.setProjectRoot(newRoot);
    this.augmenter.setProjectRoot(newRoot);
  }

  public async autoIndex(force: boolean = false): Promise<void> {
    if (!this.enabled) {
      Logger.info(`[CodebaseIndexer] Skipped — disabled by config.`);
      return;
    }
    const graphPath = path.join(this.projectRoot, '.breakglass/graph', 'playground.json');
    
    // Check if the graph already exists and has nodes
    let needsIndexing = true;
    if (fs.existsSync(graphPath)) {
      try {
        const stats = fs.statSync(graphPath);
        if (stats.size > 100) { // arbitrary small size to check if it's empty
          needsIndexing = false;
        }
      } catch { /* stat failed — treat as needing indexing */ }
    }

    if (!force && !needsIndexing) {
      return; // Already indexed
    }

    if (force) {
      this.graphStore.clear(); // Clear existing graph if forced
    }

    console.log(`Indexing codebase (AST)... this may take a moment.`);
    Logger.info(`[CodebaseIndexer] Triggering autonomous indexing for ${this.projectRoot}`);

    // 1. Physical Indexing — never let an unreadable/invalid tsconfig kill the boot
    try {
      this.analyzer.analyzeProject();
      await this.graphStore.saveToDisk();
    } catch (e: any) {
      Logger.warn(`[CodebaseIndexer] Indexing skipped: ${e.message}`);
      return;
    }

    const nodeCount = this.graphStore.getGraph().nodes.size;
    console.log(`Codebase index complete: ${nodeCount} nodes extracted.`);

    // 2. Interactive LLM Prompt
    if (process.stdout.isTTY) {
      await this.promptForSemanticIngestion(nodeCount);
    } else {
      Logger.info(`[CodebaseIndexer] Non-interactive terminal detected. Skipping Semantic Ingestion prompt.`);
    }
  }

  private promptForSemanticIngestion(nodeCount: number): Promise<void> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      console.log(`\nShould I also run **Semantic Ingestion** to add LLM meta-data (purpose, risk scores) to these nodes?`);
      console.log(`(Warning: This will make ~${nodeCount} API calls using your configured LLM keys)`);
      
      rl.question(`Run Semantic Ingestion? [Y/n] `, async (answer) => {
        rl.close();
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes' || answer === '') {
          console.log(`\n🚀 Starting Semantic Ingestion... I'll let you know when I'm done.`);
          await this.augmenter.augmentGraph();
          console.log(`\n🧠 Semantic Ingestion complete! The graph now has Mythos-level intelligence.`);
        } else {
          console.log(`\nSkipping Semantic Ingestion. You can run it manually later.`);
        }
        resolve();
      });
    });
  }

  public async buildAstIndex(): Promise<number> {
    Logger.info(`[CodebaseIndexer] Manually triggering AST indexing for ${this.projectRoot}`);
    this.graphStore.clear();
    this.analyzer.analyzeProject();
    await this.graphStore.saveToDisk();
    return this.graphStore.getGraph().nodes.size;
  }

  public async buildSemanticIndex(): Promise<void> {
    Logger.info(`[CodebaseIndexer] Manually triggering Semantic Ingestion for ${this.projectRoot}`);
    await this.augmenter.augmentGraph();
    await this.graphStore.saveToDisk();
  }
}

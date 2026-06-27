import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { StaticAnalyzer } from './static.analyzer';
import { TreeSitterAnalyzer } from './treesitter.analyzer';
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

  /**
   * Multi-language AST pass: index non-TS/JS files (Python, …) via tree-sitter into the same
   * graph. Additive and best-effort — runs after the TS analyzer and never throws upward, so
   * a repo with no tsconfig still gets a graph from its other languages.
   */
  private async runTreeSitterPass(): Promise<void> {
    try {
      const tsa = new TreeSitterAnalyzer(this.projectRoot, this.graphStore, this.excludePatterns);
      await tsa.analyzeProject();
    } catch (e: any) {
      Logger.warn(`[CodebaseIndexer] tree-sitter pass skipped: ${e.message}`);
    }
  }

  /**
   * @param interactive  Only true for a standalone (non-TUI) CLI invocation. MUST be false when
   *   called from inside the Ink TUI: Ink owns process.stdin in raw mode, and opening a second
   *   readline interface here makes two consumers fight over the same raw TTY — a stdin busy-loop
   *   that pins a CPU core and freezes the UI (the "Mac frying an egg while idle" bug). In the TUI
   *   we AST-index silently and leave semantic ingestion as an explicit opt-in (/graph ingest).
   */
  public async autoIndex(force: boolean = false, interactive: boolean = false): Promise<void> {
    if (!this.enabled) {
      Logger.info(`[CodebaseIndexer] Skipped — disabled by config.`);
      return;
    }
    const graphPath = path.join(this.projectRoot, '.breakglass/graph', 'playground.json');
    
    // Check if the graph already exists and actually has nodes. Byte size is a bad proxy — an
    // empty-but-structured `{"nodes":[],"edges":[]}` can clear a size threshold yet have 0 nodes,
    // so we count the nodes instead.
    let needsIndexing = true;
    if (fs.existsSync(graphPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
        const nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : Object.keys(parsed.nodes || {}).length;
        if (nodeCount > 0) needsIndexing = false;
      } catch { /* unreadable / corrupt — treat as needing indexing */ }
    }

    if (!force && !needsIndexing) {
      return; // Already indexed
    }

    if (force) {
      this.graphStore.clear(); // Clear existing graph if forced
    }

    Logger.info(`[CodebaseIndexer] Indexing codebase (AST) for ${this.projectRoot}…`);

    // 1. Physical Indexing — never let an unreadable/invalid tsconfig kill the boot. The TS
    // pass and the tree-sitter pass are independent: a failure in one must not skip the other.
    try {
      this.analyzer.analyzeProject();
    } catch (e: any) {
      Logger.warn(`[CodebaseIndexer] TS AST pass skipped: ${e.message}`);
    }
    await this.runTreeSitterPass();
    await this.graphStore.saveToDisk();

    const nodeCount = this.graphStore.getGraph().nodes.size;
    if (nodeCount === 0) {
      Logger.warn(`[CodebaseIndexer] No indexable source found in ${this.projectRoot}.`);
      return;
    }
    Logger.info(`[CodebaseIndexer] Codebase index complete: ${nodeCount} nodes extracted.`);

    // 2. Semantic ingestion prompt — ONLY for a standalone CLI run. Never under the Ink TUI:
    // readline + Ink both reading the raw TTY deadlock-spin on stdin (100% CPU, frozen UI).
    if (interactive && process.stdout.isTTY) {
      await this.promptForSemanticIngestion(nodeCount);
    } else {
      Logger.info(`[CodebaseIndexer] AST index ready (${nodeCount} nodes). Run semantic ingestion explicitly with /index-ai when you want LLM metadata.`);
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
    try {
      this.analyzer.analyzeProject();
    } catch (e: any) {
      Logger.warn(`[CodebaseIndexer] TS AST pass skipped: ${e.message}`);
    }
    await this.runTreeSitterPass();
    await this.graphStore.saveToDisk();
    return this.graphStore.getGraph().nodes.size;
  }

  public async buildSemanticIndex(): Promise<void> {
    Logger.info(`[CodebaseIndexer] Manually triggering Semantic Ingestion for ${this.projectRoot}`);
    await this.augmenter.augmentGraph();
    await this.graphStore.saveToDisk();
  }
}

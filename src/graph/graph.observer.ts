import { Logger, debounce } from '../utils';
import { IEventBus } from '../core/interfaces';
import { StaticAnalyzer } from './static.analyzer';
import { GraphStore } from './graph.store';
import { ImpactEngine } from './impact.engine';
import { SemanticAugmenter } from './semantic.augmenter';
import * as path from 'path';

export class GraphObserver {
  private analyzer: StaticAnalyzer;
  private impactEngine: ImpactEngine;

  private debouncedHandlers: Map<string, (path: string) => void> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private eventBus: IEventBus, 
    private store: GraphStore,
    private projectRoot: string,
    private semanticAugmenter: SemanticAugmenter
  ) {
    this.analyzer = new StaticAnalyzer(this.projectRoot, this.store);
    this.impactEngine = new ImpactEngine(this.store);
    
    this.cleanupInterval = setInterval(() => {
      this.debouncedHandlers.clear();
    }, 60000);
    this.cleanupInterval.unref();
  }

  public start() {
    Logger.info(`[GraphObserver] Starting autonomous file observer...`);
    
    this.eventBus.on('FILE_WRITE', (payload: { filePath: string }) => {
      if (!this.debouncedHandlers.has(payload.filePath)) {
        if (this.debouncedHandlers.size >= 1000) {
          const firstKey = this.debouncedHandlers.keys().next().value;
          if (firstKey) this.debouncedHandlers.delete(firstKey);
        }
        this.debouncedHandlers.set(
          payload.filePath, 
          debounce((path: string) => this.handleFileChange(path), 500) // 500ms debounce
        );
      }
      this.debouncedHandlers.get(payload.filePath)!(payload.filePath);
    });
  }

  private async handleFileChange(absolutePath: string) {
    Logger.info(`[GraphObserver] Detected FILE_WRITE on: ${absolutePath}`);
    const relPath = path.relative(this.projectRoot, absolutePath);
    const fileNodeId = `file:${relPath}`;

    // 1. Recalculate AST for just this file
    Logger.info(`[GraphObserver] Re-parsing AST for ${fileNodeId}...`);
    try {
      this.analyzer.analyzeSingleFile(absolutePath);
      await this.store.saveToDisk();
      
      // Augment the single file node semantics (limit to 5 API calls per save)
      await this.semanticAugmenter.augmentGraph(5);
      
      this.impactEngine.clearCache();

      // 2. Blast Radius Calculation
      Logger.info(`[GraphObserver] Calculating Blast Radius for ${fileNodeId}...`);
      const report = this.impactEngine.calculateBlastRadius(fileNodeId);
      
      Logger.info(`[GraphObserver] Downstream Impact Warning: ${report.totalImpactedNodes} nodes affected.`);
      
      if (report.totalImpactedNodes > 0) {
        // 3. Schedule autonomous verification
        Logger.info(`[GraphObserver] Emitting VERIFY_DOWNSTREAM task...`);
        this.eventBus.emit('TASK_QUEUED', {
          id: `verify-impact-${Date.now()}`,
          category: 'trigger',
          data: {
            action: 'VERIFY_BLAST_RADIUS',
            targetNode: fileNodeId,
            impactedFiles: report.impactedFiles
          }
        });
      }

    } catch (e: any) {
      Logger.error(`[GraphObserver] Failed to process file change: ${e.message}`);
    }
  }
}

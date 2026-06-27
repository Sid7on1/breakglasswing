export * from './types';
export * from './decomposer';
export * from './classifier';
export * from './mapper';

import { TaskDecomposer } from './decomposer';
import { TaskClassifier } from './classifier';
import { TaskMapper } from './mapper';
import { MappedTask } from './types';
import { LlmAdapter } from '../core/llm.adapter';
import { ApiKeyManager } from '../credits/api.key.manager';
import { IEventBus } from '../core/interfaces';

/**
 * The Task Pipeline processes raw user prompts through
 * decomposition, classification, and mapping to produce executable tasks.
 */
export class TaskPipeline {
  private decomposer: TaskDecomposer;
  private classifier: TaskClassifier;
  private mapper: TaskMapper;


  constructor(private eventBus: IEventBus, private llmAdapter: LlmAdapter) {
    this.decomposer = new TaskDecomposer(this.llmAdapter);
    this.classifier = new TaskClassifier(this.llmAdapter);
    this.mapper = new TaskMapper();
  }

  /**
   * Runs the full pipeline on a prompt.
   */
  async process(prompt: string): Promise<MappedTask[]> {
    console.log(`[TaskPipeline] Starting process for prompt...`);
    
    // 1. Decompose
    this.eventBus.emit('PIPELINE_UPDATE', { stage: 'Decomposer' });
    const subTasks = await this.decomposer.decompose(prompt);
    
    // 2. Classify
    this.eventBus.emit('PIPELINE_UPDATE', { stage: 'Classifier' });
    const classifiedTasks = await Promise.all(
      subTasks.map(task => this.classifier.classify(task))
    );
    
    // 3. Map
    this.eventBus.emit('PIPELINE_UPDATE', { stage: 'Mapper' });
    const mappedTasks = classifiedTasks.map(task => this.mapper.map(task));
    
    console.log(`[TaskPipeline] Finished processing. Generated ${mappedTasks.length} tasks.\n`);
    this.eventBus.emit('PIPELINE_UPDATE', { stage: 'Execution' });
    return mappedTasks;
  }
}

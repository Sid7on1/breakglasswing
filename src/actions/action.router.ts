import { CronExecutor } from './executor.cron';
import { WebhookExecutor } from './executor.webhook';
import { TriggerExecutor } from './executor.trigger';
import { GraphExecutor } from './executor.graph';
import { Logger } from '../utils';
import { IEventBus } from '../core/interfaces';
import { IGraphStore } from '../graph/models';

export interface ActionTask {
  id: string;
  category: 'cron' | 'webhook' | 'trigger' | 'graph';
  payload: any;
  metadata?: any;
}

export class ActionRouter {
  public cronEngine: CronExecutor;
  public webhookEngine = new WebhookExecutor();
  public triggerEngine: TriggerExecutor;
  public graphEngine: GraphExecutor;

  constructor(private eventBus: IEventBus, private graphStore: IGraphStore) {
    this.cronEngine = new CronExecutor(this.eventBus);
    this.triggerEngine = new TriggerExecutor(this.eventBus);
    this.graphEngine = new GraphExecutor(this.graphStore);
  }

  route(task: ActionTask) {
    Logger.info(`\n[ActionRouter] Routing Task ${task.id} (Category: ${task.category.toUpperCase()})`);
    
    switch (task.category) {
      case 'cron':
        const schedule = task.metadata?.schedule || '* * * * *';
        this.cronEngine.start(task.id, task.payload, schedule);
        break;
      case 'webhook':
        this.webhookEngine.listen(task.id, task.payload);
        break;
      case 'trigger':
        this.triggerEngine.execute(task.id, task.payload);
        break;
      case 'graph':
        this.graphEngine.execute(task.id, task.payload);
        break;
      default:
        Logger.error(`[ActionRouter] Unknown category: ${task.category}`);
    }
  }
  
  shutdown() {
    this.cronEngine.stop();
    this.webhookEngine.stop();
  }
}

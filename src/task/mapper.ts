import { ClassifiedTask, MappedTask, MappedTaskSchema } from './types';
import { Logger } from '../utils';
import * as crypto from 'crypto';

export class TaskMapper {
  map(task: ClassifiedTask): MappedTask {
    Logger.info(`[Mapper] Mapping task ${task.id} to robust execution schema...`);
    
    const mappedTask: MappedTask = {
      ...task,
      status: 'pending',
      createdAt: Date.now(),
      uuid: crypto.randomUUID()
    };

    // Strictly enforce that the final pipeline object is structurally perfect
    MappedTaskSchema.parse(mappedTask);

    return mappedTask;
  }
}

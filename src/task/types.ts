import { z } from 'zod';

export const TaskTypeEnum = z.enum(['trigger', 'cron', 'webhook', 'cli', 'agent']);
export type TaskType = z.infer<typeof TaskTypeEnum>;

export const SubTaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  dependencies: z.array(z.string()),
});
export type SubTask = z.infer<typeof SubTaskSchema>;

export const SubTaskArraySchema = z.array(SubTaskSchema);

export const ClassifiedTaskSchema = SubTaskSchema.extend({
  type: TaskTypeEnum,
  metadata: z.record(z.string(), z.any()),
});
export type ClassifiedTask = z.infer<typeof ClassifiedTaskSchema>;

export const MappedTaskSchema = ClassifiedTaskSchema.extend({
  assignedTo: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
  createdAt: z.number(),
  // New strict UUID mapping
  uuid: z.string().uuid()
});
export type MappedTask = z.infer<typeof MappedTaskSchema>;

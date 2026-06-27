import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { cliEvents } from '../../cli/events';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const STATUS_ICON: Record<TodoItem['status'], string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
};

// The most recent todo list the agent wrote this session. The agent loop reads it to decide whether
// to keep going (persistence) when the model tries to stop with items still open.
let lastTodos: TodoItem[] = [];
export function getActiveTodos(): TodoItem[] { return lastTodos; }
export function clearActiveTodos(): void { lastTodos = []; }

export function renderTodoList(todos: TodoItem[]): string {
  if (todos.length === 0) return 'Todo list is empty.';
  const done = todos.filter(t => t.status === 'completed').length;
  const lines = todos.map(t => `${STATUS_ICON[t.status]} ${t.content}`);
  return `Tasks (${done}/${todos.length} done):\n${lines.join('\n')}`;
}

export const createTodoWriteTool = (governor: IGovernor) => buildTool({
  name: 'TodoWriteTool',
  description: `Maintains a structured task checklist for the current session. Use it for any multi-step work (3+ steps) so the user can see progress at a glance.

# Instructions
- Pass the FULL list every time — this replaces the previous list, it does not append.
- Keep exactly ONE task \`in_progress\` at a time.
- Mark a task \`completed\` IMMEDIATELY after finishing it; don't batch completions.
- Statuses: \`pending\`, \`in_progress\`, \`completed\`.`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The complete, updated todo list.',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Imperative description of the task.' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  execute: async (args: { todos: TodoItem[] }) => {
    const todos = (args.todos || []).filter(
      (t): t is TodoItem =>
        !!t && typeof t.content === 'string' && t.content.trim().length > 0 &&
        (t.status === 'pending' || t.status === 'in_progress' || t.status === 'completed'),
    );

    lastTodos = todos; // remember for the loop's persistence check
    // Push to the UI: full list into app state, compact progress into the status bar.
    cliEvents.emit('todo_update', todos);
    const done = todos.filter(t => t.status === 'completed').length;
    const current = todos.find(t => t.status === 'in_progress');
    if (todos.length > 0) {
      cliEvents.emit('status', `Tasks: ${done}/${todos.length} done${current ? ` · now: ${current.content.slice(0, 50)}` : ''}`);
    }

    return renderTodoList(todos);
  },
}, governor);

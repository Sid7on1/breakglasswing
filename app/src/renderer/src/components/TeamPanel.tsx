import React, { useState } from 'react';
import { CircleCheck, CircleX, Loader, ChevronRight, ChevronDown, Circle, CircleDashed } from 'lucide-react';
import { cn } from '../lib/cn';
import type { SubAgentClaim } from '../protocol';

/**
 * Parallel work for the CURRENT task.
 *
 * Extracted from the old right-dock "Agent team" destination. `04_FRONTEND_PLAN.md` removes it as a
 * peer navigation destination; the work still exists, so it becomes an evidence tab that appears
 * only while the task actually has specialists — and the `/swarm` and `/beast` launchers move out
 * of the panel entirely, because "internal names like general/explore/sketch/code/beast … do not
 * belong in the default UI".
 */
export function TeamPanel({
  subagents, todos,
}: {
  subagents: SubAgentClaim[];
  todos: { content?: string; status?: string }[];
}): React.ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  const running = subagents.filter((agent) => agent.status === 'running').length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 rounded-xl border border-line bg-raise px-3 py-2.5">
        <div className="text-[13px] font-semibold text-ink">
          {running > 0
            ? `${running} specialist${running === 1 ? '' : 's'} working`
            : 'All specialists have finished'}
        </div>
        <div className="mt-0.5 text-[11px] text-dim">
          {subagents.filter((agent) => agent.status === 'done').length} finished ·{' '}
          {subagents.filter((agent) => agent.status === 'failed').length} failed
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        {subagents.map((agent) => {
          const open = expanded === agent.taskId;
          return (
            <div key={agent.taskId} className="mb-2 rounded-lg border border-line bg-raise">
              <button
                onClick={() => setExpanded(open ? null : agent.taskId)}
                aria-expanded={open}
                className="flex w-full cursor-pointer items-center gap-2 p-2.5 text-left"
              >
                {agent.status === 'running'
                  ? <Loader size={13} className="shrink-0 animate-spin text-amber" />
                  : agent.status === 'done'
                    ? <CircleCheck size={13} className="shrink-0 text-moss" />
                    : <CircleX size={13} className="shrink-0 text-rust" />}
                <span className="text-[12px] font-medium text-ink">{agent.agentType}</span>
                <span className="ml-auto font-mono text-[10.5px] text-faint tabular-nums">{agent.toolCalls} actions</span>
                {open ? <ChevronDown size={12} className="shrink-0 text-faint" /> : <ChevronRight size={12} className="shrink-0 text-faint" />}
              </button>
              <div className="px-2.5 pb-2.5">
                <div className={cn('text-[11.5px] text-dim', !open && 'truncate')} title={agent.prompt}>{agent.prompt}</div>
                {agent.scope !== '(unscoped)' ? (
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{agent.scope}</div>
                ) : null}
                {open && (agent.result || agent.error) ? (
                  <pre className={cn(
                    'mt-1.5 max-h-48 overflow-y-auto rounded-md bg-well p-2 font-mono text-[10.5px] whitespace-pre-wrap',
                    agent.error ? 'text-rust' : 'text-dim',
                  )}>
                    {agent.error || agent.result}
                  </pre>
                ) : null}
                {!open && agent.error ? <div className="mt-1 truncate text-[11px] text-rust">{agent.error}</div> : null}
              </div>
            </div>
          );
        })}

        {todos.length > 0 && (
          <section className="mt-1">
            <div className="mb-1.5 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">Plan</div>
            {todos.map((todo, index) => (
              <div key={index} className="flex items-start gap-2 py-0.5">
                {todo.status === 'completed'
                  ? <CircleCheck size={13} className="mt-0.5 shrink-0 text-moss" />
                  : todo.status === 'in_progress'
                    ? <CircleDashed size={13} className="mt-0.5 shrink-0 text-ember" />
                    : <Circle size={13} className="mt-0.5 shrink-0 text-faint" />}
                <span className={cn(
                  'text-[11.5px]',
                  todo.status === 'completed' ? 'text-faint line-through' : todo.status === 'in_progress' ? 'text-ink' : 'text-dim',
                )}>
                  {todo.content}
                </span>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

import React from 'react';
import { MessageEntry } from '../protocol';

/**
 * Renderers for the engine's three dashboard message kinds (contract mirrored from
 * tui/dashboard.go and Ink's Dashboards.tsx):
 *   HelpDashboard      {sections: [{title, color, commands: [{cmd, desc}]}]}
 *   StatsDashboard     {title, items: [{label, value}]}
 *   DataTableDashboard {title, headers: string[], rows: string[][]}
 */
export function Dashboard({ msg }: { msg: MessageEntry }): React.ReactElement | null {
  const p = msg.payload ?? {};
  switch (msg.uiComponent) {
    case 'HelpDashboard':
      return (
        <Panel title="Commands">
          {(p.sections ?? []).map((sec: { title?: string; commands?: { cmd: string; desc: string }[] }, i: number) => (
            <div key={i} className="mb-2 last:mb-0">
              <div className="mb-1 text-[10.5px] font-medium tracking-[0.08em] text-ember uppercase">{sec.title}</div>
              {(sec.commands ?? []).map((c, j) => (
                <div key={j} className="flex gap-3 py-0.5 text-xs">
                  <code className="w-32 shrink-0 font-mono text-ink">{c.cmd}</code>
                  <span className="text-dim">{c.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </Panel>
      );
    case 'StatsDashboard':
      return (
        <Panel title={p.title}>
          {(p.items ?? []).map((it: { label: string; value: string }, i: number) => (
            <div key={i} className="flex gap-3 py-0.5 text-xs">
              <span className="w-44 shrink-0 text-faint">{it.label}</span>
              <span className="min-w-0 text-ink tabular-nums">{it.value}</span>
            </div>
          ))}
        </Panel>
      );
    case 'DataTableDashboard':
      return (
        <Panel title={p.title}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              {Array.isArray(p.headers) && p.headers.length > 0 && (
                <thead>
                  <tr className="border-b border-line">
                    {p.headers.map((h: string, i: number) => (
                      <th key={i} className="px-2 py-1 text-left font-medium whitespace-nowrap text-dim">{h}</th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {(p.rows ?? []).map((row: string[], i: number) => (
                  <tr key={i} className="border-b border-line/40 last:border-0">
                    {(row ?? []).map((cell, j) => (
                      <td key={j} className="px-2 py-1 align-top tabular-nums">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      );
    default:
      return null;
  }
}

function Panel({ title, children }: { title?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-[10px] border border-line bg-raise p-3">
      {title ? <div className="mb-2 text-[13px] font-semibold">{title}</div> : null}
      {children}
    </div>
  );
}

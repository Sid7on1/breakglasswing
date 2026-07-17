import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Code2, FileSearch, MessageSquare, Sparkles, WandSparkles } from 'lucide-react';
import type { SessionMetaRecord } from '../global';
import { BrandMark } from './BrandMark';

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const seconds = Math.round((Date.now() - t) / 1000);
  if (seconds < 90) return 'now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

const STARTERS = [
  { icon: <Code2 size={15} />, title: 'Build a feature', prompt: 'Help me build a new feature in this project. Start by understanding the codebase and asking what outcome I want.' },
  { icon: <FileSearch size={15} />, title: 'Understand the code', prompt: 'Give me a concise tour of this codebase: its architecture, important entry points, and the best place to start.' },
  { icon: <WandSparkles size={15} />, title: 'Improve the app', prompt: 'Review this project for the highest-impact product and engineering improvements, then propose a focused plan.' },
];

function projectName(project: string): string {
  return project.split('/').filter(Boolean).pop() || 'this project';
}

export function HomeView({
  project, sessionsTick, onBrowseSessions, onResume,
}: {
  project: string;
  sessionsTick: number;
  onBrowseSessions: () => void;
  onResume: (id: string) => void;
}): React.ReactElement {
  const [meta, setMeta] = useState<SessionMetaRecord[]>([]);

  useEffect(() => {
    void window.bimax.sessionsMeta().then(setMeta).catch(() => setMeta([]));
  }, [project, sessionsTick]);

  const recent = useMemo(
    () => meta.filter((m) => m.messageCount > 0 && m.title && m.title !== '(no messages yet)').slice(0, 4),
    [meta],
  );

  const start = (prompt: string): void => {
    window.dispatchEvent(new CustomEvent('bimax:compose-insert', { detail: prompt }));
  };

  return (
    <main className="home-canvas min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col justify-center px-7 py-12">
        <section className="anim-fade-up">
          <div className="mb-6 flex items-center gap-3">
            <BrandMark className="size-10" />
            <div>
              <div className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">{projectName(project)}</div>
              <h1 className="font-display mt-0.5 text-[34px] font-semibold tracking-[-0.04em] text-ink">What do you want to make?</h1>
            </div>
          </div>
          <p className="max-w-[560px] text-[14px] leading-relaxed text-dim">
            Describe an outcome. Bimax can explore the code, make changes, run checks, and show you exactly what changed.
          </p>

          <div className="mt-7 grid gap-2.5 md:grid-cols-3">
            {STARTERS.map((item, index) => (
              <button
                key={item.title}
                onClick={() => start(item.prompt)}
                className="anim-fade-up group flex min-h-[112px] cursor-pointer flex-col rounded-2xl border border-line/80 bg-raise/55 p-4 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-ember/35 hover:bg-raise focus-visible:outline-2 focus-visible:outline-ember"
                style={{ animationDelay: `${60 + index * 45}ms` }}
              >
                <span className="flex size-8 items-center justify-center rounded-xl bg-hover text-dim transition-colors group-hover:bg-ember/12 group-hover:text-ember">{item.icon}</span>
                <span className="mt-auto flex items-center gap-2 pt-4 text-[12.5px] font-medium text-ink">
                  {item.title}<ArrowUpRight size={13} className="ml-auto text-faint transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ember" />
                </span>
              </button>
            ))}
          </div>
        </section>

        {recent.length > 0 && (
          <section className="anim-fade-up mt-10" style={{ animationDelay: '180ms' }}>
            <div className="mb-2.5 flex items-center">
              <span className="flex items-center gap-1.5 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase"><Sparkles size={12} /> Pick up where you left off</span>
              <button onClick={onBrowseSessions} className="ml-auto cursor-pointer rounded-lg px-2 py-1 text-[11px] text-faint hover:bg-hover hover:text-ink">View all</button>
            </div>
            <div className="overflow-hidden rounded-2xl border border-line/80 bg-raise/35">
              {recent.map((task, index) => (
                <button
                  key={task.id}
                  onClick={() => onResume(task.id)}
                  className="group flex w-full cursor-pointer items-center gap-3 border-b border-line/60 px-4 py-3 text-left last:border-b-0 hover:bg-hover/65"
                >
                  <MessageSquare size={14} className="shrink-0 text-faint group-hover:text-ember" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-dim group-hover:text-ink">{task.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-faint">{relTime(task.startedAt)}</span>
                  <ArrowUpRight size={13} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Asterisk, ArrowRight } from 'lucide-react';
import { cn } from '../lib/cn';
import type { SessionMetaRecord } from '../global';

/**
 * Home — the empty-transcript dashboard: greeting, usage stats over the project's session
 * history (sessions-meta.jsonl via the main process), and an ember contribution heatmap.
 * Everything is computed locally; zero engine round-trips.
 */

type Range = 'all' | '30d' | '7d';

const DAY = 86400e3;
// The Lord of the Rings ≈ 550k words ≈ 730k tokens — the classic yardstick.
const LOTR_TOKENS = 730_000;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function HomeView({
  project, sessionsTick, onBrowseSessions,
}: {
  project: string;
  sessionsTick: number; // bump to refetch (e.g. on ui_snapshot session changes)
  onBrowseSessions: () => void;
}): React.ReactElement {
  const [meta, setMeta] = useState<SessionMetaRecord[]>([]);
  const [range, setRange] = useState<Range>('all');

  useEffect(() => {
    void window.bimax.sessionsMeta().then(setMeta).catch(() => setMeta([]));
  }, [project, sessionsTick]);

  const user = useMemo(() => {
    const m = project.match(/\/Users\/([^/]+)\//);
    const raw = m?.[1] ?? '';
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
  }, [project]);

  const stats = useMemo(() => {
    const cutoff = range === 'all' ? 0 : Date.now() - (range === '30d' ? 30 : 7) * DAY;
    const rows = meta.filter((m) => Date.parse(m.startedAt) >= cutoff);
    const messages = rows.reduce((n, m) => n + m.messageCount, 0);
    const tokens = rows.reduce((n, m) => n + m.tokenEstimate, 0);

    const days = new Set<string>();
    const hourCounts = new Array(24).fill(0);
    for (const m of rows) {
      const d = new Date(m.startedAt);
      if (!Number.isFinite(d.getTime())) continue;
      days.add(dayKey(d));
      hourCounts[d.getHours()] += m.messageCount || 1;
    }

    // Streaks over ALL history (a streak is a streak regardless of the stats range).
    const allDays = new Set(meta.map((m) => dayKey(new Date(m.startedAt))));
    let current = 0;
    for (let i = 0; ; i++) {
      const d = new Date(Date.now() - i * DAY);
      if (allDays.has(dayKey(d))) current++;
      else if (i === 0) continue; // today can still be blank without breaking the streak
      else break;
    }
    let longest = 0;
    if (allDays.size > 0) {
      const times = [...allDays].map((k) => {
        const [y, mo, da] = k.split('-').map(Number);
        return new Date(y, mo, da).getTime();
      }).sort((a, b) => a - b);
      let run = 1;
      for (let i = 1; i < times.length; i++) {
        run = times[i] - times[i - 1] === DAY ? run + 1 : 1;
        longest = Math.max(longest, run);
      }
      longest = Math.max(longest, 1);
    }

    const peakHour = hourCounts.some((c) => c > 0) ? hourCounts.indexOf(Math.max(...hourCounts)) : -1;
    return { sessions: rows.length, messages, tokens, activeDays: days.size, current, longest, peakHour };
  }, [meta, range]);

  // Heatmap: last 20 weeks, columns = weeks, rows = Mon..Sun; intensity by messages/day.
  const heatmap = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const m of meta) {
      const k = dayKey(new Date(m.startedAt));
      perDay.set(k, (perDay.get(k) ?? 0) + (m.messageCount || 1));
    }
    const weeks = 20;
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endDow = (end.getDay() + 6) % 7; // Mon = 0
    const cells: { key: string; level: number }[][] = [];
    const max = Math.max(1, ...perDay.values());
    for (let w = weeks - 1; w >= 0; w--) {
      const col: { key: string; level: number }[] = [];
      for (let dow = 0; dow < 7; dow++) {
        const t = end.getTime() - (endDow - dow) * DAY - w * 7 * DAY;
        if (t > end.getTime()) { col.push({ key: `f${w}-${dow}`, level: -1 }); continue; }
        const k = dayKey(new Date(t));
        const v = perDay.get(k) ?? 0;
        const level = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
        col.push({ key: k, level });
      }
      cells.push(col);
    }
    return cells;
  }, [meta]);

  const lotr = stats.tokens > LOTR_TOKENS / 4
    ? `You've used ~${Math.max(1, Math.round(stats.tokens / LOTR_TOKENS))}× more tokens than The Lord of the Rings.`
    : stats.tokens > 0
      ? `You're ${Math.round((stats.tokens / LOTR_TOKENS) * 100)}% of the way through The Lord of the Rings, in tokens.`
      : '';

  const fmt = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString());

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-6 pt-14 pb-8">
        <div className="anim-fade-up flex items-center gap-3">
          <Asterisk size={30} className="animate-spin-slow text-ember" />
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">
            What's next{user ? `, ${user}` : ''}?
          </h1>
        </div>

        {meta.length > 0 && (
          <div className="anim-fade-up mt-8 rounded-2xl border border-line bg-raise/60 p-5" style={{ animationDelay: '80ms' }}>
            <div className="mb-4 flex items-center">
              <span className="rounded-lg bg-hover px-2.5 py-1 text-xs font-medium text-ink">Overview</span>
              <div className="ml-auto flex gap-0.5 rounded-lg border border-line p-0.5">
                {(['all', '30d', '7d'] as Range[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={cn(
                      'cursor-pointer rounded-md px-2.5 py-1 text-[11.5px] transition-colors',
                      range === r ? 'bg-hover text-ink' : 'text-faint hover:text-ink',
                    )}
                  >
                    {r === 'all' ? 'All' : r}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <HomeTile label="Sessions" value={fmt(stats.sessions)} i={0} />
              <HomeTile label="Messages" value={fmt(stats.messages)} i={1} />
              <HomeTile label="Total tokens" value={fmt(stats.tokens)} i={2} />
              <HomeTile label="Active days" value={String(stats.activeDays)} i={3} />
              <HomeTile label="Current streak" value={`${stats.current}d`} i={4} />
              <HomeTile label="Longest streak" value={`${stats.longest}d`} i={5} />
              <HomeTile label="Peak hour" value={stats.peakHour < 0 ? '—' : `${((stats.peakHour + 11) % 12) + 1} ${stats.peakHour < 12 ? 'AM' : 'PM'}`} i={6} />
              <HomeTile label="Avg msgs / session" value={stats.sessions ? String(Math.round(stats.messages / stats.sessions)) : '—'} i={7} />
            </div>

            {/* Contribution heatmap — ember scale, never neon */}
            <div className="mt-5 flex gap-[3px] overflow-hidden">
              {heatmap.map((col, i) => (
                <div key={i} className="flex flex-col gap-[3px]">
                  {col.map((c) => (
                    <div
                      key={c.key}
                      title={c.level >= 0 ? c.key : undefined}
                      className={cn(
                        'size-[13px] rounded-[3px]',
                        c.level === -1 && 'opacity-0',
                        c.level === 0 && 'bg-hover',
                        c.level === 1 && 'bg-ember/25',
                        c.level === 2 && 'bg-ember/45',
                        c.level === 3 && 'bg-ember/70',
                        c.level === 4 && 'bg-ember',
                      )}
                    />
                  ))}
                </div>
              ))}
            </div>
            {lotr && <div className="mt-3 text-xs text-faint">{lotr}</div>}
          </div>
        )}

        <button
          onClick={onBrowseSessions}
          className="anim-fade-up mt-6 flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-raise/60 px-4 py-3 text-[13px] text-dim transition-all hover:border-ember/40 hover:text-ink"
          style={{ animationDelay: '160ms' }}
        >
          Browse past sessions
          <ArrowRight size={14} className="text-ember" />
        </button>
      </div>
    </div>
  );
}

function HomeTile({ label, value, i }: { label: string; value: string; i: number }): React.ReactElement {
  return (
    <div
      className="anim-fade-up rounded-xl border border-line bg-bg/60 px-3.5 py-3 transition-colors hover:border-ember/30"
      style={{ animationDelay: `${100 + i * 40}ms` }}
    >
      <div className="text-[11px] text-faint">{label}</div>
      <div className="mt-0.5 text-[17px] font-semibold text-ink tabular-nums">{value}</div>
    </div>
  );
}

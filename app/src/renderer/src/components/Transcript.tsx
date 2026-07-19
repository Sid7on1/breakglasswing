import React, { useMemo, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import {
  Loader, CircleCheck, CircleX, ChevronRight, ChevronDown, Pencil, SearchCode, ArrowDown,
} from 'lucide-react';
import { TranscriptItem } from '../useEngine';
import { MessageEntry, ToolCallEntry } from '../protocol';
import { Markdown } from '../markdown';
import { Dashboard } from './Dashboards';
import { cn } from '../lib/cn';

/**
 * Transcript v2 — virtualized scrollback (day-long sessions stay smooth), consecutive tool
 * calls folded into activity chips ("Edited 3 files · 5 edits"), dashboards, menus, and a
 * "Thought for Ns" expander holding the turn's actual reasoning text.
 */

type Row =
  | { kind: 'msg'; key: string; item: Extract<TranscriptItem, { kind: 'msg' }> }
  | { kind: 'tool'; key: string; call: ToolCallEntry }
  | { kind: 'group'; key: string; kindOf: 'edit' | 'explore'; calls: ToolCallEntry[] };

const MUTATING = /edit|write|patch/i;
const READONLY = /read|grep|glob|search|graph|list|^ls$|find|related|map|impact/i;

function classify(name: string): 'edit' | 'explore' | null {
  if (MUTATING.test(name)) return 'edit';
  if (READONLY.test(name)) return 'explore';
  return null;
}

/** Fold consecutive same-category tool calls (per agent) into groups of ≥2. */
function buildRows(items: TranscriptItem[]): Row[] {
  const rows: Row[] = [];
  let run: { kindOf: 'edit' | 'explore'; parent: string; calls: ToolCallEntry[] } | null = null;

  const flush = (): void => {
    if (!run) return;
    if (run.calls.length >= 2) {
      rows.push({ kind: 'group', key: `g-${run.calls[0].id}`, kindOf: run.kindOf, calls: run.calls });
    } else {
      run.calls.forEach((c) => rows.push({ kind: 'tool', key: `t-${c.id}`, call: c }));
    }
    run = null;
  };

  for (const it of items) {
    if (it.kind === 'tool') {
      const cat = classify(it.call.toolName);
      const parent = it.call.parentId || '';
      if (cat && run && run.kindOf === cat && run.parent === parent) {
        run.calls.push(it.call);
        continue;
      }
      flush();
      if (cat) {
        run = { kindOf: cat, parent, calls: [it.call] };
      } else {
        rows.push({ kind: 'tool', key: `t-${it.call.id}`, call: it.call });
      }
    } else {
      flush();
      rows.push({ kind: 'msg', key: it.msg.id, item: it });
    }
  }
  flush();
  return rows;
}

function fileOf(input: string): string | null {
  const m = (input || '').match(/[\w@~./\\-]+\.[A-Za-z]\w{0,5}/);
  return m ? m[0] : null;
}

export function Transcript({
  items, streaming, thinking, onMenuSelect,
}: {
  items: TranscriptItem[];
  streaming: string;
  thinking: string;
  onMenuSelect: (id: string, value: string) => void;
}): React.ReactElement {
  const rows = useMemo(() => buildRows(items), [items]);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);

  if (items.length === 0 && !streaming) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 select-none">
        <div className="text-[38px] font-bold tracking-tight text-ember/90">bi<span className="text-ink/80">max</span></div>
        <div className="text-dim">
          Ask anything about this project — or type{' '}
          <code className="font-mono text-ember">/</code> for commands.
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <Virtuoso
        ref={virtuosoRef}
        data={rows}
        computeItemKey={(_, row) => row.key}
        followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={48}
        initialTopMostItemIndex={Math.max(rows.length - 1, 0)}
        className="h-full"
        itemContent={(_, row) => <RowView row={row} onMenuSelect={onMenuSelect} />}
        components={{
          Header: () => <div className="h-4" />,
          Footer: () => (
            <div className="px-6 pb-3">
              {thinking && (
                <div className="mx-auto mb-3.5 max-w-[860px] truncate text-xs text-faint italic">
                  <span className="mr-1.5 inline-block size-1.5 animate-soft-blink rounded-full bg-ember" />
                  thinking… <span className="opacity-70">{thinking.slice(-200)}</span>
                </div>
              )}
              {streaming && (
                <div className="mx-auto max-w-[860px]">
                  <RoleLabel role="assistant" />
                  <Markdown text={streaming} />
                  <span className="animate-soft-blink text-ember">▋</span>
                </div>
              )}
            </div>
          ),
        }}
      />
      {!atBottom && (
        <button
          onClick={() => virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' })}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-raise px-3 py-1 text-xs text-dim shadow-lg hover:text-ink"
        >
          <ArrowDown size={12} />
          Jump to latest
        </button>
      )}
    </div>
  );
}

function RowView({ row, onMenuSelect }: { row: Row; onMenuSelect: (id: string, value: string) => void }): React.ReactElement {
  return (
    <div className="px-6">
      {row.kind === 'msg' && <Message item={row.item} onMenuSelect={onMenuSelect} />}
      {row.kind === 'tool' && <ToolCard call={row.call} />}
      {row.kind === 'group' && <ActivityGroup kindOf={row.kindOf} calls={row.calls} />}
    </div>
  );
}

function RoleLabel({ role }: { role: MessageEntry['role'] }): React.ReactElement {
  return (
    <div
      className={cn(
        'mb-1 text-[11px] tracking-[0.08em] uppercase',
        role === 'assistant' ? 'text-ember' : role === 'user' ? 'text-dim' : 'text-faint',
      )}
    >
      {role === 'assistant' ? 'bimax' : role}
    </div>
  );
}

function Message({
  item, onMenuSelect,
}: {
  item: Extract<TranscriptItem, { kind: 'msg' }>;
  onMenuSelect: (id: string, value: string) => void;
}): React.ReactElement {
  const { msg, menuChosen, thought } = item;
  if (msg.uiComponent === 'menu' && msg.payload) {
    return <MenuCard msg={msg} chosen={menuChosen} onSelect={onMenuSelect} />;
  }
  if (msg.uiComponent && msg.uiComponent.endsWith('Dashboard')) {
    return (
      <div className="mx-auto mb-[18px] max-w-[860px]">
        <Dashboard msg={msg} />
      </div>
    );
  }
  const systemTint =
    msg.level === 'error' ? 'text-rust' : msg.level === 'warn' ? 'text-amber' : msg.level === 'success' ? 'text-moss' : 'text-dim';
  return (
    <div className="mx-auto mb-[18px] max-w-[860px]">
      <RoleLabel role={msg.role} />
      {msg.thoughtMs ? <ThoughtLine ms={msg.thoughtMs} text={thought} /> : null}
      <div
        className={cn(
          msg.role === 'user' && 'rounded-[10px] border border-line bg-raise px-3.5 py-2.5',
          msg.role === 'system' && cn('text-[12.5px]', systemTint),
        )}
      >
        <Markdown text={msg.content} />
      </div>
    </div>
  );
}

function ThoughtLine({ ms, text }: { ms: number; text?: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1">
      <button
        onClick={() => text && setOpen((v) => !v)}
        className={cn('flex items-center gap-1 text-xs text-faint italic', text && 'cursor-pointer hover:text-dim')}
      >
        {text ? (open ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : null}
        Thought for {(ms / 1000).toFixed(1)}s
      </button>
      {open && text ? (
        <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-line bg-well px-3 py-2 text-xs whitespace-pre-wrap text-dim">
          {text}
        </div>
      ) : null}
    </div>
  );
}

/** "Edited 3 files · 5 edits" / "Explored 7 files" chip folding a run of tool calls. */
function ActivityGroup({ kindOf, calls }: { kindOf: 'edit' | 'explore'; calls: ToolCallEntry[] }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const files = new Set<string>();
  calls.forEach((c) => { const f = fileOf(c.input); if (f) files.add(f); });
  const running = calls.some((c) => c.status === 'running');
  const failed = calls.some((c) => c.status === 'error');
  const nested = !!calls[0].parentId;

  const label = kindOf === 'edit'
    ? `Edited ${files.size || calls.length} file${(files.size || calls.length) === 1 ? '' : 's'} · ${calls.length} edit${calls.length === 1 ? '' : 's'}`
    : `Explored ${files.size || calls.length} ${files.size ? 'file' : 'location'}${(files.size || calls.length) === 1 ? '' : 's'}`;

  return (
    <div className={cn('mx-auto mb-2 max-w-[860px]', nested && 'pl-[22px]')}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-raise py-1 pr-3 pl-2.5 text-[12px] text-dim hover:bg-hover"
      >
        {running
          ? <Loader size={12} className="animate-spin text-amber" />
          : failed
            ? <CircleX size={12} className="text-rust" />
            : kindOf === 'edit' ? <Pencil size={12} className="text-moss" /> : <SearchCode size={12} className="text-dim" />}
        <span>{label}</span>
        {open ? <ChevronDown size={12} className="text-faint" /> : <ChevronRight size={12} className="text-faint" />}
      </button>
      {open && (
        <div className="mt-1.5 border-l border-line pl-3">
          {calls.map((c) => <ToolCard key={c.id} call={c} inGroup />)}
        </div>
      )}
    </div>
  );
}

function MenuCard({
  msg, chosen, onSelect,
}: {
  msg: MessageEntry;
  chosen?: string;
  onSelect: (id: string, value: string) => void;
}): React.ReactElement {
  const { title, options } = msg.payload as { title: string; options: { label: string; value: string; desc?: string }[] };
  return (
    <div className="mx-auto mb-[18px] max-w-[860px] rounded-[10px] border border-line bg-raise p-3">
      <div className="mb-2.5 font-semibold">{title}</div>
      {(options || []).map((o, i) => (
        <button
          key={i}
          disabled={chosen !== undefined}
          onClick={() => onSelect(msg.id, o.value)}
          className={cn(
            'mb-1.5 flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-line px-3 py-2 text-left',
            'enabled:hover:border-ember enabled:hover:bg-ember/15',
            chosen !== undefined && 'cursor-default opacity-45',
            chosen === o.value && 'border-ember opacity-100',
          )}
        >
          <span className="font-medium">{o.label}</span>
          {o.desc ? <span className="text-xs text-dim">{o.desc}</span> : null}
        </button>
      ))}
    </div>
  );
}

function ToolCard({ call, inGroup }: { call: ToolCallEntry; inGroup?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const screenshot = computerScreenshot(call);
  const icon =
    call.status === 'running' ? <Loader size={13} className="animate-spin text-amber" />
    : call.status === 'success' ? <CircleCheck size={13} className="text-moss" />
    : <CircleX size={13} className="text-rust" />;
  const secs = call.endTime
    ? Math.max(0, (new Date(call.endTime).getTime() - new Date(call.startTime).getTime()) / 1000)
    : null;
  return (
    <div className={cn('mb-2', !inGroup && 'mx-auto max-w-[860px]', !inGroup && call.parentId && 'pl-[22px]')}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-line bg-raise px-3 py-1.5 text-left text-[12.5px] text-dim hover:bg-hover"
      >
        <span className="shrink-0">{icon}</span>
        <span className="font-mono text-ink">{call.toolName}</span>
        {call.agentLabel ? (
          <span className="rounded border border-ember/15 bg-ember/15 px-1.5 text-[10.5px] text-ember">
            {call.agentLabel}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-faint">{truncate(call.input, 120)}</span>
        {secs !== null && secs >= 0.1 ? (
          <span className="shrink-0 text-[10.5px] text-faint tabular-nums">{secs < 10 ? secs.toFixed(1) : Math.round(secs)}s</span>
        ) : null}
      </button>
      {screenshot ? (
        <img
          src={localImageUrl(screenshot)}
          alt="Latest computer screen"
          className="mt-1 max-h-[360px] w-auto max-w-full border border-line object-contain"
        />
      ) : null}
      {open && (
        <pre className="-mt-1 max-h-[280px] overflow-auto rounded-b-lg border border-t-0 border-line bg-well px-3 py-2.5 font-mono text-xs leading-normal whitespace-pre-wrap text-dim">
          {call.input ? `» ${call.input}\n\n` : ''}
          {call.output || (call.status === 'running' ? 'running…' : '(no output)')}
        </pre>
      )}
    </div>
  );
}

function computerScreenshot(call: ToolCallEntry): string {
  if (call.toolName !== 'ComputerTool' || call.status !== 'success' || !call.output) return '';
  try {
    const parsed = JSON.parse(call.output);
    return typeof parsed?.screenshot === 'string' ? parsed.screenshot : '';
  } catch {
    return '';
  }
}

function localImageUrl(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  return `file://${normalized.startsWith('/') ? '' : '/'}${encodeURI(normalized)}`;
}

function truncate(s: string, n: number): string {
  const one = (s || '').replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

import React, { useEffect, useState } from 'react';
import {
  GitBranch, GitCompareArrows, ArrowLeft, RefreshCw, ChevronDown, Check, Plus,
  ArrowUp, ArrowDown, History, Camera, Undo2, Star, Dot,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { DiffView } from './DiffView';
import { Dropdown, DropdownItem } from './ui/dropdown';
import type { GitStatusResult, GitCommitEntry } from '../global';
import type { UiSnapshotCheckpoint } from '../protocol';

function relTs(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * Review panel — Electron-native git READS (status/diff/branches/log via the main process);
 * WRITES (commit, branch switch) route through the engine's /git command so the ledger and
 * attribution pipeline observe them. Narrow-pane layout: file list ⇄ full-pane diff.
 */
export function ReviewPanel({
  status, refresh, onCommand, checkpoints,
}: {
  status: GitStatusResult | null;
  refresh: () => void;
  onCommand: (cmd: string) => void;
  checkpoints?: UiSnapshotCheckpoint[];
}): React.ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [message, setMessage] = useState('');
  const [log, setLog] = useState<GitCommitEntry[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranch, setNewBranch] = useState<string | null>(null); // null = not editing
  const [rewindArm, setRewindArm] = useState<string | null>(null); // checkpoint id awaiting confirm

  useEffect(() => {
    void window.bimax.git.log(8).then(setLog).catch(() => setLog([]));
    void window.bimax.git.branches().then((b) => setBranches(b.all)).catch(() => setBranches([]));
  }, [status?.branch, status?.files.length]);

  // Selected file's diff — refetched whenever the poller sees new state, so it tracks live edits.
  useEffect(() => {
    if (!selected) return;
    const file = status?.files.find((f) => f.path === selected);
    if (!file) { setSelected(null); return; }
    void window.bimax.git.diff(file.path, file.status === '?').then(setDiff).catch(() => setDiff(''));
  }, [selected, status]);

  if (!status) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center select-none">
        <span className="text-faint"><GitCompareArrows size={22} /></span>
        <div className="font-semibold text-ink">Review</div>
        <div className="text-xs leading-relaxed text-dim">This project is not a git repository.</div>
      </div>
    );
  }

  if (selected) {
    const file = status.files.find((f) => f.path === selected);
    return (
      <div className="flex h-full flex-col">
        <div className="mb-2 flex shrink-0 items-center gap-2">
          <button
            onClick={() => setSelected(null)}
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-hover hover:text-ink"
            title="Back to changes"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="min-w-0 truncate font-mono text-xs text-ink" title={selected}>{selected}</span>
          {file && (
            <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums">
              <span className="text-moss">+{file.insertions}</span>{' '}
              <span className="text-rust">−{file.deletions}</span>
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DiffView diff={diff} />
        </div>
      </div>
    );
  }

  const dirty = status.files.length;

  return (
    <div className="flex h-full flex-col">
      {/* Branch row */}
      <div className="mb-3 flex shrink-0 items-center gap-1.5">
        <Dropdown
          direction="down"
          trigger={() => (
            <span
              className="flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-raise px-2 py-1 text-xs text-ink hover:bg-hover"
              title="Switch branch"
            >
              <GitBranch size={12} className="shrink-0 text-ember" />
              <span className="truncate">{status.branch || '(detached)'}</span>
              <ChevronDown size={11} className="shrink-0 text-faint" />
            </span>
          )}
        >
          {(close) => (
            <>
              {branches.map((b) => (
                <DropdownItem
                  key={b}
                  icon={b === status.branch ? <Check size={12} /> : <GitBranch size={12} />}
                  selected={b === status.branch}
                  label={b}
                  onClick={() => {
                    if (b !== status.branch) { onCommand(`/git checkout ${b}`); setTimeout(refresh, 900); }
                    close();
                  }}
                />
              ))}
              <DropdownItem
                icon={<Plus size={12} />}
                label="New branch…"
                onClick={() => { setNewBranch(''); close(); }}
              />
            </>
          )}
        </Dropdown>
        {(status.ahead > 0 || status.behind > 0) && (
          <span className="flex items-center gap-0.5 text-[10.5px] text-faint tabular-nums">
            {status.ahead > 0 && <><ArrowUp size={10} />{status.ahead}</>}
            {status.behind > 0 && <><ArrowDown size={10} />{status.behind}</>}
          </span>
        )}
        <button
          onClick={refresh}
          className="ml-auto flex size-6 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-hover hover:text-ink"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {newBranch !== null && (
        <form
          className="mb-3 flex shrink-0 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newBranch.trim().replace(/\s+/g, '-');
            if (name) { onCommand(`/git checkout ${name}`); setTimeout(refresh, 900); }
            setNewBranch(null);
          }}
        >
          <input
            autoFocus
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setNewBranch(null); }}
            placeholder="new-branch-name"
            className="min-w-0 flex-1 rounded-md border border-line bg-well px-2 py-1 font-mono text-xs text-ink outline-none placeholder:text-faint focus:border-ember/55"
          />
          <button type="submit" className="cursor-pointer rounded-md border border-line bg-raise px-2 py-1 text-xs text-ink hover:bg-hover">
            Create
          </button>
        </form>
      )}

      {/* Changed files */}
      <div className="mb-1.5 shrink-0 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">
        Changes{dirty ? ` · ${dirty}` : ''}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {dirty === 0 ? (
          <div className="py-2 text-xs text-faint">Working tree clean.</div>
        ) : (
          status.files.map((f) => (
            <button
              key={f.path}
              onClick={() => setSelected(f.path)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-hover"
              title={f.path}
            >
              <span
                className={cn(
                  'w-3 shrink-0 text-center font-mono text-[11px] font-semibold',
                  f.status === '?' || f.status === 'A' ? 'text-moss' : f.status === 'D' ? 'text-rust' : 'text-amber',
                )}
              >
                {f.status === '?' ? 'U' : f.status}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-dim">{f.path}</span>
              {(f.insertions > 0 || f.deletions > 0) && (
                <span className="shrink-0 font-mono text-[10px] tabular-nums">
                  <span className="text-moss">+{f.insertions}</span>{' '}
                  <span className="text-rust">−{f.deletions}</span>
                </span>
              )}
            </button>
          ))
        )}

        {/* Time Machine — checkpoints from ui_snapshot (protocol v2; section hidden on v1 engines).
            Rewind is destructive → two-step inline confirm, red, per the UX guardrails. */}
        {checkpoints && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-1 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">
              <Camera size={11} /> History
              <button
                onClick={() => onCommand('/checkpoint from Review panel')}
                title="Snapshot the working tree now (/checkpoint)"
                className="ml-auto flex cursor-pointer items-center gap-1 rounded-md border border-line bg-raise px-1.5 py-0.5 text-[10.5px] font-normal tracking-normal text-dim normal-case hover:bg-hover hover:text-ink"
              >
                <Camera size={10} className="text-ember" /> Checkpoint now
              </button>
            </div>
            {checkpoints.length === 0 ? (
              <div className="py-1 text-xs text-faint">No checkpoints yet.</div>
            ) : (
              checkpoints.map((c) => (
                <div key={c.id} className="group flex items-center gap-1.5 py-0.5 text-xs">
                  {c.auto
                    ? <Dot size={13} className="shrink-0 text-faint" />
                    : <Star size={11} className="shrink-0 text-amber" />}
                  <span className="min-w-0 truncate text-dim" title={`${c.id} — ${c.label}`}>{c.label}</span>
                  <span className="ml-auto shrink-0 text-[10px] whitespace-nowrap text-faint tabular-nums">{relTs(c.ts)}</span>
                  {rewindArm === c.id ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => { onCommand(`/rewind ${c.id}`); setRewindArm(null); setTimeout(refresh, 900); }}
                        className="cursor-pointer rounded-md bg-rust px-1.5 py-0.5 text-[10.5px] font-medium text-bg hover:bg-rust/85"
                      >
                        Rewind
                      </button>
                      <button
                        onClick={() => setRewindArm(null)}
                        className="cursor-pointer rounded-md border border-line px-1.5 py-0.5 text-[10.5px] text-dim hover:bg-hover"
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setRewindArm(c.id)}
                      title={`Restore working tree to ${c.id} (a safety checkpoint is taken first)`}
                      className="shrink-0 cursor-pointer rounded-md p-0.5 text-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-rust"
                    >
                      <Undo2 size={12} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Recent commits */}
        {log.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-1 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">
              <History size={11} /> Recent commits
            </div>
            {log.map((c) => (
              <div key={c.hash} className="flex items-baseline gap-2 py-0.5 text-xs" title={c.subject}>
                <span className="shrink-0 font-mono text-[10.5px] text-ember/80">{c.hash}</span>
                <span className="min-w-0 truncate text-dim">{c.subject}</span>
                <span className="ml-auto shrink-0 text-[10px] whitespace-nowrap text-faint">{c.when}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Commit box — routes through the engine (/git commit) for ledger visibility. */}
      <form
        className="mt-2 shrink-0 border-t border-line pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          const msg = message.trim();
          if (!msg || dirty === 0) return;
          onCommand(`/git commit ${msg}`);
          setMessage('');
          setTimeout(refresh, 900);
        }}
      >
        <textarea
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLElement).closest('form')?.requestSubmit();
          }}
          placeholder={dirty ? 'Commit message…' : 'Nothing to commit'}
          disabled={dirty === 0}
          className="w-full resize-none rounded-md border border-line bg-well px-2 py-1.5 text-xs text-ink outline-none placeholder:text-faint focus:border-ember/55 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={dirty === 0 || !message.trim()}
          className="mt-1.5 w-full cursor-pointer rounded-md bg-ember/90 py-1.5 text-xs font-medium text-bg hover:bg-ember disabled:cursor-default disabled:opacity-40"
        >
          Commit {dirty > 0 ? `${dirty} file${dirty === 1 ? '' : 's'}` : ''}
        </button>
      </form>
    </div>
  );
}

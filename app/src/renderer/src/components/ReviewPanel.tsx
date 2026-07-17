import React, { useEffect, useState } from 'react';
import {
  GitBranch, GitCompareArrows, ArrowLeft, RefreshCw, ChevronDown, Check, Plus,
  ArrowUp, ArrowDown, History, Camera, Undo2, Star, Dot, Clock3, CircleCheck,
  CircleX, Wrench, ListChecks, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { DiffView } from './DiffView';
import { Dropdown, DropdownItem } from './ui/dropdown';
import type { GitStatusResult, GitCommitEntry } from '../global';
import type { ReviewSnapshot, ReviewStateName, UiSnapshotCheckpoint } from '../protocol';

function relTs(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const STATE_LABEL: Record<ReviewStateName, string> = {
  idle: 'No task changes',
  planning: 'Planning',
  awaiting_approval: 'Awaiting approval',
  applying: 'Applying changes',
  unverified: 'Needs verification',
  verification_failed: 'Verification failed',
  verified: 'Verified',
  checkpointed: 'Verified & checkpointed',
};

function ReviewStateIcon({ state }: { state: ReviewStateName }): React.ReactElement {
  if (state === 'awaiting_approval') return <Clock3 size={14} className="text-amber" />;
  if (state === 'verification_failed') return <CircleX size={14} className="text-rust" />;
  if (state === 'verified' || state === 'checkpointed') return <CircleCheck size={14} className="text-moss" />;
  if (state === 'planning') return <ListChecks size={14} className="text-ember" />;
  return <Wrench size={14} className="text-dim" />;
}

function TaskReviewSummary({ review }: { review: ReviewSnapshot }): React.ReactElement {
  const pending = review.approvals.filter((a) => !a.resolution);
  const recentApprovals = review.approvals.slice(-3).reverse();
  const recentVerification = review.verifications.slice(-3).reverse();
  const latestCheckpointAttempt = review.checkpoints[review.checkpoints.length - 1];
  const completedTodos = review.todos.filter((t) => t.status === 'completed').length;

  return (
    <section className="mb-3 shrink-0 rounded-lg border border-line bg-raise/70 p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5"><ReviewStateIcon state={review.state} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{STATE_LABEL[review.state]}</span>
            {pending.length > 0 && <span className="rounded-full bg-amber/12 px-1.5 py-0.5 text-[9.5px] font-medium text-amber">{pending.length} pending</span>}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-dim">{review.nextAction}</p>
        </div>
      </div>

      {review.interrupted && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber/25 bg-amber/8 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          A previous approval was interrupted. It was closed safely and was not treated as consent.
        </div>
      )}

      {review.todos.length > 0 && (
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-2 text-[10.5px] text-faint">
          <ListChecks size={11} />
          <span>Plan</span>
          <span className="ml-auto tabular-nums">{completedTodos}/{review.todos.length} complete</span>
        </div>
      )}

      {recentApprovals.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="mb-1 text-[9.5px] font-medium tracking-[0.08em] text-faint uppercase">Approvals</div>
          {recentApprovals.map((approval) => (
            <div key={`${approval.id}-${approval.requestedAt}`} className="flex items-start gap-1.5 py-0.5 text-[10.5px]">
              {!approval.resolution ? <Clock3 size={10} className="mt-0.5 shrink-0 text-amber" />
                : approval.resolution.approved ? <CircleCheck size={10} className="mt-0.5 shrink-0 text-moss" />
                  : <CircleX size={10} className="mt-0.5 shrink-0 text-rust" />}
              <span className="min-w-0 flex-1 truncate text-dim" title={approval.question}>{approval.question}</span>
              <span className="shrink-0 capitalize text-faint">{approval.kind}</span>
            </div>
          ))}
        </div>
      )}

      {recentVerification.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="mb-1 text-[9.5px] font-medium tracking-[0.08em] text-faint uppercase">Verification</div>
          {recentVerification.map((verification) => (
            <div key={`${verification.at}-${verification.command}`} className="flex items-center gap-1.5 py-0.5 text-[10.5px]">
              {verification.ok ? <CircleCheck size={10} className="shrink-0 text-moss" /> : <CircleX size={10} className="shrink-0 text-rust" />}
              <span className="min-w-0 flex-1 truncate font-mono text-dim" title={verification.command}>{verification.command}</span>
              <span className="shrink-0 text-faint">
                {verification.repoWide ? 'repo-wide' : `${verification.coveredFiles.length} file${verification.coveredFiles.length === 1 ? '' : 's'}`}
              </span>
              <span className="shrink-0 text-faint">{relTs(verification.at)}</span>
            </div>
          ))}
        </div>
      )}

      {latestCheckpointAttempt && !latestCheckpointAttempt.ok && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-line pt-2 text-[10.5px] text-rust">
          <CircleX size={10} /> Checkpoint failed: {latestCheckpointAttempt.label}
        </div>
      )}
    </section>
  );
}

/**
 * Review panel — Electron-native git READS (status/diff/branches/log via the main process);
 * WRITES (commit, branch switch) route through the engine's /git command so the ledger and
 * attribution pipeline observe them. Narrow-pane layout: file list ⇄ full-pane diff.
 */
export function ReviewPanel({
  status, review, refresh, onCommand, checkpoints,
}: {
  status: GitStatusResult | null;
  review: ReviewSnapshot | null;
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
  const [otherOpen, setOtherOpen] = useState(false);

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
  const attributedPaths = new Set((review?.changes ?? []).map((change) => change.file).filter((file) => file && file !== '(unattributed)'));
  const taskFiles = review ? status.files.filter((file) => attributedPaths.has(file.path)) : status.files;
  const otherFiles = review ? status.files.filter((file) => !attributedPaths.has(file.path)) : [];
  const canCheckpoint = review?.state === 'verified';

  const fileButton = (f: GitStatusResult['files'][number]) => (
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
  );

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

      {review && <TaskReviewSummary review={review} />}

      {/* Files attributed to this thread are primary. Pre-existing/manual changes stay visible but
          separate, so the task never claims ownership of the whole dirty working tree. */}
      <div className="mb-1.5 shrink-0 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">
        {review ? 'Task changes' : 'Changes'}{taskFiles.length ? ` · ${taskFiles.length}` : ''}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {taskFiles.length === 0 ? (
          <div className="py-2 text-xs text-faint">
            {dirty === 0 ? 'Working tree clean.' : review ? 'No current working-tree files are attributed to this task.' : 'Working tree clean.'}
          </div>
        ) : (
          taskFiles.map(fileButton)
        )}

        {otherFiles.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <button
              onClick={() => setOtherOpen((open) => !open)}
              className="flex w-full cursor-pointer items-center gap-1.5 py-1 text-[10.5px] font-medium tracking-[0.06em] text-faint uppercase hover:text-dim"
            >
              {otherOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              Other workspace changes · {otherFiles.length}
            </button>
            {otherOpen && (
              <div className="mt-1 rounded-md border border-line/70 bg-well/45 p-1">
                <div className="px-1.5 py-1 text-[10px] leading-relaxed text-faint">
                  These files were already changed or were edited outside this task.
                </div>
                {otherFiles.map(fileButton)}
              </div>
            )}
          </div>
        )}

        {/* Time Machine — checkpoints from ui_snapshot (protocol v2; section hidden on v1 engines).
            Rewind is destructive → two-step inline confirm, red, per the UX guardrails. */}
        {checkpoints && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-1 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">
              <Camera size={11} /> History
              <button
                onClick={() => { if (canCheckpoint) onCommand('/checkpoint verified task'); }}
                disabled={!canCheckpoint}
                title={canCheckpoint ? 'Snapshot the verified working tree now' : 'Verify this task after its latest edit before checkpointing'}
                className="ml-auto flex cursor-pointer items-center gap-1 rounded-md border border-line bg-raise px-1.5 py-0.5 text-[10.5px] font-normal tracking-normal text-dim normal-case hover:bg-hover hover:text-ink disabled:cursor-default disabled:opacity-35 disabled:hover:bg-raise disabled:hover:text-dim"
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
        {otherFiles.length > 0 && (
          <div className="mt-1 text-[10px] leading-relaxed text-amber/85">
            Repository commit includes all {dirty} dirty files — {otherFiles.length} {otherFiles.length === 1 ? 'is' : 'are'} outside this task.
          </div>
        )}
        <button
          type="submit"
          disabled={dirty === 0 || !message.trim()}
          className="mt-1.5 w-full cursor-pointer rounded-md bg-ember/90 py-1.5 text-xs font-medium text-bg hover:bg-ember disabled:cursor-default disabled:opacity-40"
        >
          {otherFiles.length > 0 ? 'Commit entire working tree' : `Commit ${dirty > 0 ? `${dirty} file${dirty === 1 ? '' : 's'}` : ''}`}
        </button>
      </form>
    </div>
  );
}

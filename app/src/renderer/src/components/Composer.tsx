import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp, Square, FunctionSquare, FileText, Compass, Shield, Cpu,
  ChevronUp, Sparkles, Pencil, Search, Hammer, Flame, Paperclip, Gauge,
} from 'lucide-react';
import { CompletionItem, ControlsMsg, UiSnapshot } from '../protocol';
import { cn } from '../lib/cn';
import { Button } from './ui/button';
import { Dropdown, DropdownItem } from './ui/dropdown';
import type { SupervisorStatus } from '../global';

/**
 * Composer v2 — the control strip under the input holds the agent-mode selector, the
 * permission preset selector, and the model/tier selector; attach inserts @paths; the ring on
 * the right is live context usage. Engine state that isn't broadcast yet (governor on/off,
 * diff-approval) is tracked optimistically from the user's own picks — honest until the
 * ui_snapshot extension lands in P5.
 */

const AGENT_MODES = [
  { id: 'general', label: 'Balanced', icon: <Sparkles size={13} />, desc: 'Understand, decide, and build' },
  { id: 'explore', label: 'Research', icon: <Search size={13} />, desc: 'Study the project without changing it' },
  { id: 'sketch', label: 'Plan', icon: <Pencil size={13} />, desc: 'Design the approach before editing' },
  { id: 'code', label: 'Build', icon: <Hammer size={13} />, desc: 'Focus on implementation and verification' },
  { id: 'beast', label: 'Agent team', icon: <Flame size={13} />, desc: 'Coordinate parallel work on a larger goal' },
];

const PERMISSION_PRESETS = [
  { id: 'ask', label: 'Ask before changes', desc: 'Every edit shows a diff for approval' },
  { id: 'auto', label: 'Work automatically', desc: 'Apply safe edits and ask for risky actions' },
  { id: 'plan', label: 'Plan only', desc: 'Read-only — research and propose, no writes' },
  { id: 'full', label: 'Unrestricted', desc: 'Continue without approval gates' },
];

const TIERS = [
  { id: 'auto', label: 'Auto tier', desc: 'Router picks lite/heavy per turn' },
  { id: 'lite', label: 'Lite tier', desc: 'Fast + cheap, pinned' },
  { id: 'heavy', label: 'Heavy tier', desc: 'Strongest model, pinned' },
];

export function Composer({
  busy, mode, tier, snapshot, streamedChars, completions,
  onSubmit, onInterrupt, onControls, onCommand, onQuery, onClearCompletions, runtime,
}: {
  busy: boolean;
  mode: string;
  tier: string;
  snapshot: UiSnapshot | null;
  streamedChars: number;
  completions: CompletionItem[];
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  onControls: (controls: Omit<ControlsMsg, 't'>) => void;
  onCommand: (cmd: string) => void;
  onQuery: (text: string) => void;
  onClearCompletions: () => void;
  runtime: SupervisorStatus | null;
}): React.ReactElement {
  const [text, setText] = useState('');
  const [queued, setQueued] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [permission, setPermission] = useState('auto');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const historyRef = useRef<string[]>([]);
  const histIdxRef = useRef(-1);

  const visibleCompletions = completions.filter((item) => item.kind !== 'command');
  const showDropdown = visibleCompletions.length > 0 && text.trim().length > 0;
  const modeId = (mode || '').toLowerCase() === 'plan' ? 'general' : (mode || '').toLowerCase() || 'general';
  const activeMode = AGENT_MODES.find((m) => m.id === modeId) ?? AGENT_MODES[0];
  const readOnlyMode = ['PLAN', 'EXPLORE', 'SKETCH'].includes((mode || '').toUpperCase());
  const activePermission = readOnlyMode
    ? PERMISSION_PRESETS[2]
    : PERMISSION_PRESETS.find((p) => p.id === permission) ?? PERMISSION_PRESETS[1];

  const ctxPct = snapshot && snapshot.contextWindow > 0
    ? Math.min(100, Math.round(((snapshot.tokensBaseline + streamedChars / 4) / snapshot.contextWindow) * 100))
    : null;
  const available = runtime?.phase === 'ready' || runtime?.phase === 'degraded';

  // Let the first instruction feel instant even while a newly opened project finishes loading.
  // The user never has to wait for or understand the background runtime lifecycle.
  useEffect(() => {
    if (!available || !queued) return;
    onSubmit(queued);
    setQueued(null);
  }, [available, queued, onSubmit]);

  useEffect(() => { setSel(0); }, [completions]);

  // Files panel "@" button (and anything else in the shell) can inject text into the composer.
  useEffect(() => {
    const h = (e: Event): void => {
      const detail = String((e as CustomEvent).detail ?? '');
      if (!detail) return;
      setText((t) => (t ? `${t.replace(/\s+$/, '')} ${detail}` : detail));
      taRef.current?.focus();
    };
    window.addEventListener('bimax:compose-insert', h);
    return () => window.removeEventListener('bimax:compose-insert', h);
  }, []);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [text]);

  const change = (v: string): void => {
    setText(v);
    histIdxRef.current = -1;
    clearTimeout(debounceRef.current);
    if (v.includes('@')) {
      debounceRef.current = setTimeout(() => onQuery(v), 120);
    } else if (completions.length) {
      onClearCompletions();
    }
  };

  const submit = (): void => {
    if (!text.trim() || busy || queued) return;
    historyRef.current.push(text);
    histIdxRef.current = -1;
    if (!available) {
      setQueued(text);
      setText('');
      return;
    }
    onSubmit(text);
    setText('');
  };

  const accept = (item: CompletionItem): void => {
    if (item.disabled) return;
    const at = text.lastIndexOf('@');
    setText(at === -1 ? item.value : text.slice(0, at) + item.value);
    onClearCompletions();
    taRef.current?.focus();
  };

  const attach = (): void => {
    void window.bimax.pickFiles().then((paths) => {
      if (!paths.length) return;
      const refs = paths.map((p) => `@${p}`).join(' ');
      setText((t) => (t ? `${t.replace(/\s+$/, '')} ${refs} ` : `${refs} `));
      taRef.current?.focus();
    });
  };

  const keyDown = (e: React.KeyboardEvent): void => {
    if (showDropdown) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, visibleCompletions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.metaKey)) {
        e.preventDefault();
        accept(visibleCompletions[sel]);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); onClearCompletions(); return; }
    }
    // ↑/↓ recall past prompts when the input is empty or already navigating history.
    const hist = historyRef.current;
    if (e.key === 'ArrowUp' && hist.length && (text === '' || histIdxRef.current !== -1)) {
      e.preventDefault();
      histIdxRef.current = histIdxRef.current === -1 ? hist.length - 1 : Math.max(0, histIdxRef.current - 1);
      setText(hist[histIdxRef.current]);
      return;
    }
    if (e.key === 'ArrowDown' && histIdxRef.current !== -1) {
      e.preventDefault();
      histIdxRef.current = histIdxRef.current >= hist.length - 1 ? -1 : histIdxRef.current + 1;
      setText(histIdxRef.current === -1 ? '' : hist[histIdxRef.current]);
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || (!e.shiftKey && !showDropdown))) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape' && busy) {
      e.preventDefault();
      onInterrupt();
    }
  };

  return (
    <div className="relative shrink-0 px-6 pt-2 pb-3">
      {showDropdown && (
        <div className="absolute bottom-full left-1/2 z-20 mb-1 w-[min(860px,calc(100%-48px))] -translate-x-1/2 overflow-hidden rounded-[10px] border border-line bg-raise shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
          {visibleCompletions.slice(0, 8).map((c, i) => (
            <button
              key={c.value + i}
              onMouseEnter={() => setSel(i)}
              onClick={() => accept(c)}
              className={cn(
                'flex w-full cursor-pointer items-baseline gap-2.5 px-3 py-[7px] text-left text-[12.5px]',
                i === sel && 'bg-ember/15',
                c.disabled && 'opacity-40',
              )}
            >
              <span className="w-4 shrink-0 text-ember">
                {c.kind === 'symbol' ? <FunctionSquare size={13} /> : <FileText size={13} />}
              </span>
              <span className="font-mono">{c.label}</span>
              <span className="truncate text-faint">{c.disabled ? c.disabledReason || c.desc : c.desc}</span>
            </button>
          ))}
        </div>
      )}

      <div className="launch-console mx-auto max-w-[920px] overflow-hidden rounded-[22px] border border-line bg-raise shadow-[0_18px_50px_rgba(30,35,70,0.14)] transition-[border-color,box-shadow] focus-within:border-ember/45 focus-within:shadow-[0_20px_56px_rgba(78,69,199,0.16)]">
        <div className="flex items-end gap-3 px-5 pt-4 pb-3">
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder={busy ? 'Add direction while Bimax works…' : queued ? 'Your task will start in a moment…' : 'Describe what you want to build or change…'}
            onChange={(e) => change(e.target.value)}
            onKeyDown={keyDown}
            className="max-h-[220px] min-h-12 flex-1 resize-none border-none bg-transparent font-display text-[15px] leading-relaxed outline-none placeholder:text-faint"
          />
        </div>

        <div className="no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto px-3 pb-3">
          <button
            type="button"
            title="Attach files as @references"
            onClick={attach}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-xl text-dim hover:bg-hover hover:text-ink"
          >
            <Paperclip size={15} />
          </button>

          <Dropdown trigger={(open) => <ComposerPill open={open} icon={<Compass size={13} />} label={activeMode.label} />}>
            {(close) => (
              <>
                {AGENT_MODES.map((m) => (
                  <DropdownItem key={m.id} icon={m.icon} selected={m.id === activeMode.id} label={m.label} desc={m.desc} onClick={() => { onControls({ mode: m.id as ControlsMsg['mode'] }); close(); }} />
                ))}
              </>
            )}
          </Dropdown>

          <Dropdown trigger={(open) => <ComposerPill open={open} icon={<Shield size={13} />} label={activePermission.label} />}>
            {(close) => (
              <>
                {PERMISSION_PRESETS.map((p) => (
                  <DropdownItem key={p.id} selected={p.id === activePermission.id} label={p.label} desc={p.desc} onClick={() => { onControls({ autonomy: p.id as ControlsMsg['autonomy'] }); setPermission(p.id); close(); }} />
                ))}
              </>
            )}
          </Dropdown>

          <Dropdown
            trigger={(open) => <ComposerPill open={open} icon={<Cpu size={13} />} label={shortModel(snapshot?.models.coding)} mono />}
          >
            {(close) => (
              <>
                <div className="px-2.5 pt-1.5 pb-1 text-[9.5px] font-semibold tracking-[0.1em] text-faint uppercase">Model quality</div>
                {TIERS.map((t) => (
                  <DropdownItem key={t.id} selected={(tier || 'auto') === t.id} label={t.label} desc={t.desc} onClick={() => { onControls({ tier: t.id as ControlsMsg['tier'] }); close(); }} />
                ))}
                <div className="my-1 border-t border-line" />
                <DropdownItem label="Change model…" desc="Choose a different coding model" onClick={() => { onCommand('/model'); close(); }} />
              </>
            )}
          </Dropdown>

          <span className="flex-1" />
          {ctxPct !== null && <ContextMeter pct={ctxPct} window={snapshot!.contextWindow} />}
          {queued && (
            <span className="hidden items-center gap-1.5 text-[10px] text-dim sm:flex">
              <span className="signal-beacon size-1.5 rounded-full bg-amber" /> Starting your task…
            </span>
          )}

          {busy ? (
            <Button variant="destructive" size="icon" className="ml-1 size-9 rounded-xl" title="Stop (Esc)" onClick={onInterrupt}>
              <Square size={13} fill="currentColor" />
            </Button>
          ) : (
            <Button variant="accent" size="icon" className="ml-1 size-9 rounded-xl shadow-[0_6px_16px_rgba(90,46,29,0.24)]" title="Send (Enter)" disabled={!text.trim() || !!queued} onClick={submit}>
              <ArrowUp size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ComposerPill({ open, icon, label, mono = false }: { open: boolean; icon: React.ReactNode; label: string; mono?: boolean }): React.ReactElement {
  return (
    <span
      className={cn(
        'flex max-w-[170px] items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[10.5px] transition-colors',
        open ? 'bg-ember/12 text-ember' : 'text-dim hover:bg-hover hover:text-ink',
      )}
    >
      <span className={open ? 'text-ember' : 'text-faint'}>{icon}</span>
      <span className={cn('truncate', mono && 'font-mono text-[9.5px]')}>{label}</span>
      <ChevronUp size={9} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
    </span>
  );
}

function ContextMeter({ pct, window: win }: { pct: number; window: number }): React.ReactElement {
  const tint = pct >= 85 ? 'text-rust' : pct >= 60 ? 'text-amber' : 'text-moss';
  return (
    <span
      className="flex items-center gap-1.5"
      title={`Context ~${pct}% of ${win.toLocaleString()} tokens`}
    >
      <Gauge size={12} className={tint} />
      <span className="h-1 w-12 overflow-hidden rounded-full bg-line"><span className={cn('block h-full rounded-full bg-current', tint)} style={{ width: `${pct}%` }} /></span>
      <span className="font-mono text-[9px] text-faint tabular-nums">{pct}%</span>
    </span>
  );
}

function shortModel(id?: string): string {
  if (!id) return 'model';
  const tail = id.split('/').pop() || id;
  return tail.length > 22 ? tail.slice(0, 21) + '…' : tail;
}

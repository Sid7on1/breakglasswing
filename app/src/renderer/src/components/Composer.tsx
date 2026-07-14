import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp, Square, SlashSquare, FunctionSquare, FileText, Plus, Compass, Shield, Cpu,
  ChevronUp, Sparkles, Pencil, Search, Hammer, Flame,
} from 'lucide-react';
import { CompletionItem, UiSnapshot } from '../protocol';
import { cn } from '../lib/cn';
import { Button } from './ui/button';
import { Dropdown, DropdownItem } from './ui/dropdown';

/**
 * Composer v2 — the control strip under the input holds the agent-mode selector, the
 * permission preset selector, and the model/tier selector; attach inserts @paths; the ring on
 * the right is live context usage. Engine state that isn't broadcast yet (governor on/off,
 * diff-approval) is tracked optimistically from the user's own picks — honest until the
 * ui_snapshot extension lands in P5.
 */

const AGENT_MODES = [
  { id: 'general', label: 'General', icon: <Sparkles size={13} />, desc: 'Balanced default' },
  { id: 'explore', label: 'Explore', icon: <Search size={13} />, desc: 'Read-only research' },
  { id: 'sketch', label: 'Sketch', icon: <Pencil size={13} />, desc: 'Architect: blueprints before code' },
  { id: 'code', label: 'Code', icon: <Hammer size={13} />, desc: 'Heads-down implementation' },
  { id: 'beast', label: 'Beast', icon: <Flame size={13} />, desc: 'Swarm → heal → self-critic pipeline' },
];

const PERMISSION_PRESETS = [
  { id: 'ask', label: 'Ask before changes', desc: 'Every edit shows a diff for approval', cmds: ['/governor on', '/diff-approval on'] },
  { id: 'auto', label: 'Approve for me', desc: 'Governor vetoes destructive actions; edits apply', cmds: ['/governor on', '/diff-approval off'] },
  { id: 'plan', label: 'Plan only', desc: 'Read-only — research and propose, no writes', cmds: ['/plan on'] },
  { id: 'full', label: 'Full auto', desc: 'Governor off — no approval gates at all', cmds: ['/plan off', '/governor off', '/diff-approval off'] },
];

const TIERS = [
  { id: 'auto', label: 'Auto tier', desc: 'Router picks lite/heavy per turn' },
  { id: 'lite', label: 'Lite tier', desc: 'Fast + cheap, pinned' },
  { id: 'heavy', label: 'Heavy tier', desc: 'Strongest model, pinned' },
];

export function Composer({
  busy, mode, tier, snapshot, streamedChars, completions,
  onSubmit, onInterrupt, onCommand, onQuery, onClearCompletions,
}: {
  busy: boolean;
  mode: string;
  tier: string;
  snapshot: UiSnapshot | null;
  streamedChars: number;
  completions: CompletionItem[];
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  onCommand: (cmd: string) => void;
  onQuery: (text: string) => void;
  onClearCompletions: () => void;
}): React.ReactElement {
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  const [permission, setPermission] = useState('auto');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const historyRef = useRef<string[]>([]);
  const histIdxRef = useRef(-1);

  const showDropdown = completions.length > 0 && text.trim().length > 0;
  const modeId = (mode || '').toLowerCase() === 'plan' ? 'general' : (mode || '').toLowerCase() || 'general';
  const activeMode = AGENT_MODES.find((m) => m.id === modeId) ?? AGENT_MODES[0];
  const activePermission = (mode || '').toUpperCase() === 'PLAN'
    ? PERMISSION_PRESETS[2]
    : PERMISSION_PRESETS.find((p) => p.id === permission) ?? PERMISSION_PRESETS[1];

  const ctxPct = snapshot && snapshot.contextWindow > 0
    ? Math.min(100, Math.round(((snapshot.tokensBaseline + streamedChars / 4) / snapshot.contextWindow) * 100))
    : null;

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
    if (v.startsWith('/') || v.includes('@')) {
      debounceRef.current = setTimeout(() => onQuery(v), 120);
    } else if (completions.length) {
      onClearCompletions();
    }
  };

  const submit = (): void => {
    if (!text.trim()) return;
    historyRef.current.push(text);
    histIdxRef.current = -1;
    onSubmit(text);
    setText('');
  };

  const accept = (item: CompletionItem): void => {
    if (item.disabled) return;
    if (text.startsWith('/')) setText(item.value + ' ');
    else {
      const at = text.lastIndexOf('@');
      setText(at === -1 ? item.value : text.slice(0, at) + item.value);
    }
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
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, completions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.metaKey)) {
        e.preventDefault();
        accept(completions[sel]);
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
    <div className="relative shrink-0 px-6 pt-2.5 pb-3">
      {showDropdown && (
        <div className="absolute bottom-full left-1/2 z-20 mb-1 w-[min(860px,calc(100%-48px))] -translate-x-1/2 overflow-hidden rounded-[10px] border border-line bg-raise shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
          {completions.slice(0, 8).map((c, i) => (
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
                {c.kind === 'command' ? <SlashSquare size={13} /> : c.kind === 'symbol' ? <FunctionSquare size={13} /> : <FileText size={13} />}
              </span>
              <span className="font-mono">{c.label}</span>
              <span className="truncate text-faint">{c.disabled ? c.disabledReason || c.desc : c.desc}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mx-auto max-w-[860px] rounded-xl border border-line bg-raise focus-within:border-ember/55">
        <div className="flex items-end gap-2.5 px-3 pt-2.5">
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder={busy ? 'Esc to interrupt — or queue another instruction…' : 'Message Bimax — / for commands, @ for files & symbols'}
            onChange={(e) => change(e.target.value)}
            onKeyDown={keyDown}
            className="max-h-[200px] flex-1 resize-none border-none bg-transparent leading-relaxed outline-none placeholder:text-faint"
          />
        </div>

        <div className="flex items-center gap-1 px-2 py-1.5">
          <button
            type="button"
            title="Attach files (@path)"
            onClick={attach}
            className="flex size-6.5 cursor-pointer items-center justify-center rounded-md text-dim hover:bg-hover hover:text-ink"
          >
            <Plus size={15} />
          </button>

          <Dropdown
            trigger={(open) => (
              <ControlPill open={open} icon={<Compass size={12} />} label={activeMode.label} />
            )}
          >
            {(close) => (
              <>
                {AGENT_MODES.map((m) => (
                  <DropdownItem
                    key={m.id}
                    icon={m.icon}
                    selected={m.id === activeMode.id}
                    label={m.label}
                    desc={m.desc}
                    onClick={() => { onCommand(`/mode ${m.id}`); close(); }}
                  />
                ))}
                <div className="px-2.5 pt-1 pb-0.5 text-[10px] text-faint">Shift+Tab cycles modes</div>
              </>
            )}
          </Dropdown>

          <Dropdown
            trigger={(open) => (
              <ControlPill open={open} icon={<Shield size={12} />} label={activePermission.label} />
            )}
          >
            {(close) => (
              <>
                {PERMISSION_PRESETS.map((p) => (
                  <DropdownItem
                    key={p.id}
                    selected={p.id === activePermission.id}
                    label={p.label}
                    desc={p.desc}
                    onClick={() => {
                      p.cmds.forEach(onCommand);
                      setPermission(p.id);
                      close();
                    }}
                  />
                ))}
              </>
            )}
          </Dropdown>

          <span className="flex-1" />

          <Dropdown
            align="right"
            trigger={(open) => (
              <ControlPill
                open={open}
                icon={<Cpu size={12} />}
                label={shortModel(snapshot?.models.coding) + (tier ? ` · ${tier}` : '')}
              />
            )}
          >
            {(close) => (
              <>
                {TIERS.map((t) => (
                  <DropdownItem
                    key={t.id}
                    selected={(tier || 'auto') === t.id}
                    label={t.label}
                    desc={t.desc}
                    onClick={() => { onCommand(`/tier ${t.id}`); close(); }}
                  />
                ))}
                <div className="my-1 border-t border-line" />
                <DropdownItem
                  label="Change model…"
                  desc="Opens the model picker in the transcript"
                  onClick={() => { onCommand('/model'); close(); }}
                />
                <DropdownItem
                  label="API keys…"
                  desc="Provider keys + pool health"
                  onClick={() => { onCommand('/keys'); close(); }}
                />
              </>
            )}
          </Dropdown>

          {ctxPct !== null && <ContextRing pct={ctxPct} window={snapshot!.contextWindow} />}

          {busy ? (
            <Button variant="destructive" size="icon" title="Interrupt (Esc)" onClick={onInterrupt}>
              <Square size={13} fill="currentColor" />
            </Button>
          ) : (
            <Button variant="accent" size="icon" title="Send (Enter)" disabled={!text.trim()} onClick={submit}>
              <ArrowUp size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlPill({ open, icon, label }: { open: boolean; icon: React.ReactNode; label: string }): React.ReactElement {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] whitespace-nowrap',
        open ? 'bg-hover text-ink' : 'text-dim hover:bg-hover hover:text-ink',
      )}
    >
      {icon}
      {label}
      <ChevronUp size={11} className={cn('text-faint transition-transform', open && 'rotate-180')} />
    </span>
  );
}

function ContextRing({ pct, window: win }: { pct: number; window: number }): React.ReactElement {
  const r = 7;
  const c = 2 * Math.PI * r;
  const tint = pct >= 85 ? 'text-rust' : pct >= 60 ? 'text-amber' : 'text-moss';
  return (
    <span
      className="mx-1 flex items-center gap-1"
      title={`Context ~${pct}% of ${win.toLocaleString()} tokens`}
    >
      <svg width={18} height={18} viewBox="0 0 18 18" className={tint}>
        <circle cx={9} cy={9} r={r} fill="none" stroke="var(--color-line)" strokeWidth={2.5} />
        <circle
          cx={9} cy={9} r={r} fill="none" stroke="currentColor" strokeWidth={2.5}
          strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round" transform="rotate(-90 9 9)"
        />
      </svg>
      <span className="text-[10.5px] text-faint tabular-nums">{pct}%</span>
    </span>
  );
}

function shortModel(id?: string): string {
  if (!id) return 'model';
  const tail = id.split('/').pop() || id;
  return tail.length > 22 ? tail.slice(0, 21) + '…' : tail;
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Settings2, Cpu, Bot, Shield, Activity, Search, X, ChevronDown,
  Gauge, CircleDollarSign, Stethoscope, ScrollText,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { cn } from '../lib/cn';
import type { EngineConfig } from '../protocol';

/**
 * Settings v2 — a real settings surface (Claude-desktop style): left nav + search, pages of
 * live controls that read/write the engine config over the silent protocol-v3 round-trip
 * (configGet/configSet). Nothing prints into the transcript. Only the Diagnostics entries
 * still open engine dashboards in chat, and they say so.
 */

type Control =
  | { kind: 'toggle' }
  | { kind: 'select'; options: { value: string; label: string }[] }
  | { kind: 'number'; min?: number; max?: number; step?: number; placeholder?: string }
  | { kind: 'text'; placeholder?: string };

interface Item {
  key: keyof EngineConfig;
  label: string;
  desc: string;
  control: Control;
}

type PageId = 'general' | 'models' | 'autonomy' | 'safety';

const PAGES: { id: PageId; label: string; icon: React.ReactNode; items: Item[] }[] = [
  {
    id: 'general',
    label: 'General',
    icon: <Settings2 size={15} />,
    items: [
      { key: 'notificationBell', label: 'Notification bell', desc: 'Play a sound when a turn finishes while the window is in the background.', control: { kind: 'toggle' } },
      { key: 'autoIndex', label: 'Auto-index projects', desc: 'Build the codebase map graph automatically when a new project opens, unlocking symbol-level navigation.', control: { kind: 'toggle' } },
      { key: 'verbose', label: 'Verbose logging', desc: 'Log extra engine detail — useful when debugging, noisy otherwise.', control: { kind: 'toggle' } },
      { key: 'reducedMotion', label: 'Reduce motion', desc: 'Calm, static UI: disables entrance animations, shimmer, and spinners across the app and TUI.', control: { kind: 'toggle' } },
      { key: 'showMapPanel', label: 'Codebase map panel (TUI)', desc: 'Pin the map overview panel above the input in the terminal UI.', control: { kind: 'toggle' } },
      { key: 'showTokenMeter', label: 'Token meter (TUI)', desc: 'Live "tokens that will be sent" estimate near the terminal input.', control: { kind: 'toggle' } },
    ],
  },
  {
    id: 'models',
    label: 'Models',
    icon: <Cpu size={15} />,
    items: [
      { key: 'model', label: 'Coding model', desc: 'Drives the main agent loop. Any OpenAI-compatible model id.', control: { kind: 'text', placeholder: 'provider/model-id' } },
      { key: 'liteModel', label: 'Lite model', desc: 'Cheap auxiliary calls: summaries, self-critic, ask-user.', control: { kind: 'text', placeholder: 'provider/model-id' } },
      { key: 'subagentModel', label: 'Sub-agent model', desc: 'Model sub-agents run on. Empty = inherit the coding model.', control: { kind: 'text', placeholder: 'inherit coding model' } },
      { key: 'fallbackModel', label: 'Fallback model', desc: 'When the active model keeps failing mid-run, switch here once instead of dying. Empty = off.', control: { kind: 'text', placeholder: 'off' } },
      {
        key: 'reasoningEffort', label: 'Reasoning effort', desc: 'Thinking budget for reasoning-capable models. Off sends no effort hint.',
        control: { kind: 'select', options: [{ value: '', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] },
      },
      {
        key: 'contextMode', label: 'Tool context', desc: 'Smart sends only the working set of tool schemas (rare tools load on demand). Full sends everything, every turn.',
        control: { kind: 'select', options: [{ value: 'smart', label: 'Smart (deferred)' }, { value: 'full', label: 'Full (all tools)' }] },
      },
      { key: 'contextWindowTokens', label: 'Context window', desc: "Your model's real window in tokens; drives proactive compaction. 0 = safe default (128k).", control: { kind: 'number', min: 0, step: 1000, placeholder: '0 (auto)' } },
      { key: 'temperature', label: 'Temperature', desc: 'Sampling temperature for the main loop.', control: { kind: 'number', min: 0, max: 2, step: 0.1 } },
      { key: 'topP', label: 'Top-p', desc: 'Nucleus sampling cap — clips the low-probability tail behind dropped tool args.', control: { kind: 'number', min: 0, max: 1, step: 0.05 } },
      { key: 'maxTokens', label: 'Max output tokens', desc: 'Per-response output budget.', control: { kind: 'number', min: 256, step: 256 } },
      { key: 'parallelToolCalls', label: 'Parallel tool calls', desc: 'Let the model batch multiple tool calls per turn. Disable for backends that reject multi-tool turns.', control: { kind: 'toggle' } },
    ],
  },
  {
    id: 'autonomy',
    label: 'Autonomy',
    icon: <Bot size={15} />,
    items: [
      { key: 'maxToolIterations', label: 'Max tool iterations', desc: 'Per-turn budget for autonomous tool loops. Higher = deeper multi-file work without babysitting.', control: { kind: 'number', min: 1, max: 500, step: 5 } },
      { key: 'maxSubAgents', label: 'Max sub-agents', desc: 'Ceiling for concurrent swarm/speculate/heal agents.', control: { kind: 'number', min: 1, max: 20, step: 1 } },
      { key: 'selfCritic', label: 'Self-critic pass', desc: 'A lite-model review of each result before it reaches you.', control: { kind: 'toggle' } },
      { key: 'adversarialVerify', label: 'Adversarial verify', desc: 'Full-model red-team pass after self-critic. Slower, catches sneaky mistakes.', control: { kind: 'toggle' } },
      { key: 'autoVerify', label: 'Auto-verify edits', desc: 'Typecheck after each edit and feed errors straight back into the loop.', control: { kind: 'toggle' } },
      { key: 'gitAutoCommit', label: 'Git auto-commit', desc: 'Commit after every successful agent edit (Aider-style). The ledger records each one.', control: { kind: 'toggle' } },
    ],
  },
  {
    id: 'safety',
    label: 'Permissions',
    icon: <Shield size={15} />,
    items: [
      { key: 'diffApproval', label: 'Diff approval', desc: 'Every mutating edit surfaces its diff and waits for your approval.', control: { kind: 'toggle' } },
      { key: 'blastGate', label: 'Blast-radius gate', desc: 'Confirm edits touching HIGH/CRITICAL symbols in the codebase graph.', control: { kind: 'toggle' } },
      { key: 'sandboxBash', label: 'Sandboxed bash', desc: 'Run shell commands under macOS sandbox-exec.', control: { kind: 'toggle' } },
    ],
  },
];

const DIAGNOSTICS: { label: string; icon: React.ReactNode; cmd: string }[] = [
  { label: 'Trace', icon: <Activity size={14} />, cmd: '/trace' },
  { label: 'Performance', icon: <Gauge size={14} />, cmd: '/perf' },
  { label: 'Cost', icon: <CircleDollarSign size={14} />, cmd: '/cost' },
  { label: 'Diagnostics', icon: <Stethoscope size={14} />, cmd: '/diagnostics' },
  { label: 'Changelog', icon: <ScrollText size={14} />, cmd: '/changelog' },
];

export function SettingsDialog({
  open, onClose, onCommand, configGet, configSet,
}: {
  open: boolean;
  onClose: () => void;
  onCommand: (cmd: string) => void;
  configGet: () => Promise<EngineConfig>;
  configSet: (patch: EngineConfig) => Promise<EngineConfig>;
}): React.ReactElement {
  const [page, setPage] = useState<PageId>('general');
  const [search, setSearch] = useState('');
  const [cfg, setCfg] = useState<EngineConfig | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const debounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!open) return;
    setCfg(null);
    setUnsupported(false);
    void configGet().then((c) => {
      if (Object.keys(c).length === 0) setUnsupported(true);
      setCfg(c);
    });
  }, [open, configGet]);

  const apply = (key: keyof EngineConfig, value: unknown, debounceMs = 0): void => {
    setCfg((c) => ({ ...(c ?? {}), [key]: value }) as EngineConfig);
    const timers = debounceRef.current;
    const prev = timers.get(key as string);
    if (prev) clearTimeout(prev);
    const fire = (): void => {
      timers.delete(key as string);
      void configSet({ [key]: value } as EngineConfig).then((canonical) => {
        // Adopt the engine's canonical view unless another edit is mid-debounce.
        if (timers.size === 0 && Object.keys(canonical).length > 0) setCfg(canonical);
      });
    };
    if (debounceMs > 0) timers.set(key as string, setTimeout(fire, debounceMs));
    else fire();
  };

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return PAGES.find((p) => p.id === page)?.items ?? [];
    return PAGES.flatMap((p) => p.items).filter(
      (i) => i.label.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q),
    );
  }, [q, page]);
  const heading = q ? `Search — ${visible.length} match${visible.length === 1 ? '' : 'es'}` : PAGES.find((p) => p.id === page)?.label;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="flex h-[min(680px,85vh)] w-[min(960px,calc(100vw-64px))] max-w-none flex-row gap-0 overflow-hidden p-0">
        {/* Left nav */}
        <div className="flex w-[220px] shrink-0 flex-col border-r border-line bg-bg/60 p-3">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-well px-2.5 py-1.5">
            <Search size={13} className="shrink-0 text-faint" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search settings"
              className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-faint"
            />
            {search && (
              <button onClick={() => setSearch('')} className="cursor-pointer text-faint hover:text-ink"><X size={12} /></button>
            )}
          </div>
          <div className="mb-1 px-2 text-[10px] font-medium tracking-[0.08em] text-faint uppercase">Settings</div>
          {PAGES.map((p) => (
            <button
              key={p.id}
              onClick={() => { setPage(p.id); setSearch(''); }}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                !q && page === p.id ? 'bg-hover text-ink' : 'text-dim hover:bg-hover/60 hover:text-ink',
              )}
            >
              <span className={cn('shrink-0', !q && page === p.id ? 'text-ember' : 'text-faint')}>{p.icon}</span>
              {p.label}
            </button>
          ))}
          <div className="mt-4 mb-1 px-2 text-[10px] font-medium tracking-[0.08em] text-faint uppercase">Diagnostics</div>
          {DIAGNOSTICS.map((d) => (
            <button
              key={d.cmd}
              onClick={() => { onCommand(d.cmd); onClose(); }}
              title={`${d.cmd} — opens in chat`}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-dim transition-colors hover:bg-hover/60 hover:text-ink"
            >
              <span className="shrink-0 text-faint">{d.icon}</span>
              {d.label}
              <span className="ml-auto text-[9.5px] text-faint">chat</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-1">
            <DialogTitle className="text-[15px] font-semibold text-ink">{heading}</DialogTitle>
            <button
              onClick={onClose}
              title="Close"
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {unsupported && (
              <div className="anim-fade-up mt-3 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">
                This engine predates settings sync (protocol v3). Rebuild it with <code className="font-mono">npm run build</code>, then restart.
              </div>
            )}
            {!cfg && !unsupported ? (
              <div className="mt-6 space-y-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-lg bg-raise" style={{ animationDelay: `${i * 120}ms` }} />
                ))}
              </div>
            ) : (
              <div className="mt-2">
                {visible.map((item, i) => (
                  <SettingRow key={item.key} item={item} cfg={cfg ?? {}} onApply={apply} index={i} disabled={unsupported} />
                ))}
                {q && visible.length === 0 && (
                  <div className="mt-8 text-center text-xs text-faint">No settings match “{search}”.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingRow({
  item, cfg, onApply, index, disabled,
}: {
  item: Item;
  cfg: EngineConfig;
  onApply: (key: keyof EngineConfig, value: unknown, debounceMs?: number) => void;
  index: number;
  disabled: boolean;
}): React.ReactElement {
  const value = cfg[item.key];
  return (
    <div
      className="anim-fade-up flex items-start justify-between gap-6 border-b border-line/60 py-4 last:border-b-0"
      style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
    >
      <div className="min-w-0">
        <div className="text-[13.5px] text-ink">{item.label}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-dim">{item.desc}</div>
      </div>
      <div className={cn('shrink-0 pt-0.5', disabled && 'pointer-events-none opacity-40')}>
        {item.control.kind === 'toggle' && (
          <Toggle checked={!!value} onChange={(v) => onApply(item.key, v)} label={item.label} />
        )}
        {item.control.kind === 'select' && (
          <div className="relative">
            <select
              value={String(value ?? item.control.options[0].value)}
              onChange={(e) => onApply(item.key, e.target.value)}
              aria-label={item.label}
              className="w-44 cursor-pointer appearance-none rounded-lg border border-line bg-well py-1.5 pr-8 pl-3 text-xs text-ink outline-none transition-colors hover:bg-hover focus:border-ember/55"
            >
              {item.control.options.map((o) => (
                <option key={o.value} value={o.value} className="bg-raise">{o.label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-faint" />
          </div>
        )}
        {item.control.kind === 'number' && (
          <input
            type="number"
            value={value === undefined ? '' : Number(value)}
            min={item.control.min}
            max={item.control.max}
            step={item.control.step}
            placeholder={item.control.placeholder}
            aria-label={item.label}
            onChange={(e) => onApply(item.key, e.target.value === '' ? 0 : Number(e.target.value), 600)}
            className="w-32 rounded-lg border border-line bg-well px-3 py-1.5 text-right font-mono text-xs text-ink outline-none transition-colors focus:border-ember/55 tabular-nums"
          />
        )}
        {item.control.kind === 'text' && (
          <input
            type="text"
            value={String(value ?? '')}
            placeholder={item.control.placeholder}
            aria-label={item.label}
            onChange={(e) => onApply(item.key, e.target.value, 700)}
            className="w-64 rounded-lg border border-line bg-well px-3 py-1.5 font-mono text-xs text-ink outline-none transition-colors focus:border-ember/55 placeholder:text-faint"
          />
        )}
      </div>
    </div>
  );
}

/** Ember switch — the app's version of the Claude toggle: track fades, knob slides 16px. */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): React.ReactElement {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-10.5 cursor-pointer rounded-full transition-colors duration-200',
        checked ? 'bg-ember' : 'bg-line hover:bg-hover',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-5 rounded-full bg-ink shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-transform duration-200 ease-out',
          checked && 'translate-x-[18px]',
        )}
      />
    </button>
  );
}

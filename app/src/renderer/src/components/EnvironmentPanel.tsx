import React, { useMemo, useState } from 'react';
import {
  Box, Check, ChevronDown, CircleAlert, Command, Database, Package, RefreshCw, ShieldCheck,
} from 'lucide-react';
import type { Phase9View } from '../usePhase9';
import { cn } from '../lib/cn';

const CATEGORY = {
  runtime: { label: 'Runtimes', icon: <Command size={13} /> },
  'package-manager': { label: 'Package managers', icon: <Package size={13} /> },
  sdk: { label: 'SDKs', icon: <Box size={13} /> },
  service: { label: 'Local services', icon: <Database size={13} /> },
  ml: { label: 'Local AI', icon: <Database size={13} /> },
} as const;

export function EnvironmentPanel({ view }: { view: Phase9View }): React.ReactElement {
  const snapshot = view.environment;
  const [showMissing, setShowMissing] = useState(false);
  const ready = snapshot?.tools.filter((tool) => tool.state === 'ready').length ?? 0;
  const visible = useMemo(
    () => snapshot?.tools.filter((tool) => showMissing || tool.state !== 'missing') ?? [],
    [snapshot, showMissing],
  );

  if (!snapshot) {
    return (
      <div className="inspector-empty">
        <RefreshCw size={17} className={cn('text-faint', view.refreshing && 'animate-spin')} />
        <div>Reading the project environment…</div>
        <span>No install or project script runs during discovery.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="inspector-hero">
        <div className="flex items-start gap-3">
          <div className="inspector-hero-icon"><Command size={16} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[13.5px] font-semibold text-ink">{snapshot.projectName}</h3>
              <span className="status-chip status-chip--ok">Live inventory</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">
              {ready} tools resolved · {snapshot.declarations.length} project declarations. Bimax has not changed the environment.
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {snapshot.declarations.map((declaration) => (
            <span key={declaration.file} className="evidence-pill" title={declaration.ecosystem}>
              {declaration.file}
            </span>
          ))}
          {snapshot.declarations.length === 0 && <span className="text-[10.5px] text-faint">No supported manifests at the project root.</span>}
        </div>
      </section>

      {(Object.keys(CATEGORY) as Array<keyof typeof CATEGORY>).map((category) => {
        const tools = visible.filter((tool) => tool.category === category);
        if (!tools.length) return null;
        const meta = CATEGORY[category];
        return (
          <section key={category} className="inspector-section">
            <div className="inspector-section-title">{meta.icon}<span>{meta.label}</span></div>
            <div className="divide-y divide-line/60">
              {tools.map((tool) => (
                <div key={tool.id} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                  <span className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full',
                    tool.state === 'ready' ? 'bg-moss/12 text-moss' : 'bg-amber/10 text-amber',
                  )}>
                    {tool.state === 'ready' ? <Check size={11} /> : <CircleAlert size={11} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11.5px] font-medium text-ink">{tool.label}</span>
                      {tool.version && <span className="font-mono text-[9.5px] text-faint">{tool.version}</span>}
                    </div>
                    <div className="truncate text-[9.5px] text-faint" title={tool.executable ?? tool.note}>
                      {tool.executable ?? tool.note}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <button
        onClick={() => setShowMissing((value) => !value)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-line bg-raise px-3 py-2 text-[11px] text-dim hover:border-ink/20 hover:text-ink"
      >
        <span>{showMissing ? 'Hide' : 'Show'} tools that are not installed</span>
        <ChevronDown size={13} className={cn('transition-transform', showMissing && 'rotate-180')} />
      </button>

      <div className="flex items-start gap-2 rounded-xl border border-moss/18 bg-moss/5 px-3 py-2.5 text-[10.5px] leading-relaxed text-dim">
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-moss" />
        <span>Read-only discovery used fixed version probes. It did not source shell profiles, inspect environment variables, or execute project scripts.</span>
      </div>
    </div>
  );
}

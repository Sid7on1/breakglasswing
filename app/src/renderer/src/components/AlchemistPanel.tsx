import React from 'react';
import {
  Beaker, Check, CircleAlert, Cpu, FlaskConical, Gauge, LockKeyhole, PackageCheck, Sparkles,
} from 'lucide-react';
import type { Phase9View } from '../usePhase9';
import { cn } from '../lib/cn';

const WORKFLOW_ICON = {
  inspect: <Sparkles size={13} />,
  quantize: <Gauge size={13} />,
  'fine-tune': <FlaskConical size={13} />,
  compare: <Beaker size={13} />,
  export: <PackageCheck size={13} />,
} as const;

export function AlchemistPanel({ view }: { view: Phase9View }): React.ReactElement {
  const snapshot = view.alchemist;
  if (!snapshot) {
    return (
      <div className="inspector-empty">
        <FlaskConical size={18} className="text-faint" />
        <div>Inspecting local model backends…</div>
        <span>Training and conversion stay disabled until an isolated worker is available.</span>
      </div>
    );
  }

  const ready = snapshot.backends.filter((backend) => backend.state === 'ready').length;
  return (
    <div className="space-y-3">
      <section className="inspector-hero alchemist-hero">
        <div className="flex items-start gap-3">
          <div className="inspector-hero-icon"><FlaskConical size={16} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[13.5px] font-semibold text-ink">ML Alchemist</h3>
              <span className={cn('status-chip', snapshot.state === 'ready' ? 'status-chip--ok' : 'status-chip--warn')}>
                {snapshot.state === 'ready' ? 'Ready' : snapshot.state === 'partial' ? 'Partial' : 'Setup needed'}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">
              {ready}/{snapshot.backends.length} local backends available. Every transform competes against a measured baseline before export.
            </p>
          </div>
        </div>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title"><Cpu size={13} /><span>Backends</span></div>
        <div className="space-y-1.5">
          {snapshot.backends.map((backend) => (
            <div key={backend.id} className="rounded-lg border border-line/70 bg-well px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full',
                  backend.state === 'ready' ? 'bg-moss/12 text-moss' : 'bg-amber/10 text-amber',
                )}>
                  {backend.state === 'ready' ? <Check size={11} /> : <CircleAlert size={11} />}
                </span>
                <span className="min-w-0 flex-1 text-[11.5px] font-medium text-ink">{backend.label}</span>
                <span className="font-mono text-[9.5px] text-faint">{backend.version ?? 'not found'}</span>
              </div>
              <p className="mt-1 pl-7 text-[9.5px] leading-relaxed text-faint">{backend.role}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title"><Beaker size={13} /><span>Experiment pipeline</span></div>
        <ol className="space-y-1">
          {snapshot.workflows.map((workflow, index) => (
            <li key={workflow.id} className={cn('workflow-row', !workflow.available && 'opacity-45')}>
              <span className="workflow-index">{index + 1}</span>
              <span className="text-faint">{WORKFLOW_ICON[workflow.id]}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-ink">{workflow.label}</div>
                <div className="text-[9.5px] leading-relaxed text-faint">{workflow.detail}</div>
              </div>
              <span className={cn('status-dot', workflow.available && 'status-dot--ready')} />
            </li>
          ))}
        </ol>
      </section>

      <div className="flex items-start gap-2 rounded-xl border border-line bg-well px-3 py-2.5 text-[10.5px] leading-relaxed text-dim">
        <LockKeyhole size={13} className="mt-0.5 shrink-0 text-faint" />
        <span>{snapshot.boundary}</span>
      </div>
    </div>
  );
}

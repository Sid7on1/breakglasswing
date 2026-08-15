import React from 'react';
import { Activity, BatteryCharging, Cpu, MemoryStick, Network, ShieldCheck } from 'lucide-react';
import type { Phase9View } from '../usePhase9';

export function RuntimePanel({ view }: { view: Phase9View }): React.ReactElement {
  const snapshot = view.runtime;
  if (!snapshot) {
    return <Empty text="Runtime intelligence is unavailable. Coding remains usable with the bounded default." />;
  }
  const { signals, decision, rendering } = snapshot;
  const running = view.processes.filter((process) => process.outcome === 'running').length;
  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-line bg-raise p-3">
        <div className="flex items-start gap-2.5">
          <Activity size={15} className="mt-0.5 shrink-0 text-ember" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink">Adaptive runtime</span>
              <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] text-faint">
                {decision.automatic ? 'canary' : 'shadow'}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-dim">
              Background concurrency is {decision.selected}. Rendering is {rendering.mode}; only Reduce Motion can change it automatically.
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <Datum icon={<Cpu size={12} />} label="CPU" value={`${signals.cpuCount} · ${signals.architecture}`} />
          <Datum icon={<MemoryStick size={12} />} label="Free memory" value={`${Math.round(signals.availableMemoryMb / 1024)} GB`} />
          <Datum icon={<BatteryCharging size={12} />} label="Power" value={signals.powerSource} />
          <Datum icon={<Network size={12} />} label="Network" value={signals.network} />
        </div>
        <div className="mt-2 rounded-lg bg-well px-2.5 py-2 text-[10.5px] leading-relaxed text-faint">
          {decision.reasons.join(' ')}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-raise p-3">
        <div className="flex items-center gap-2 text-[11.5px] font-medium text-ink">
          <ShieldCheck size={14} className="text-ember" /> BiMAX-launched processes
          <span className="ml-auto font-mono text-[10px] text-faint">{running} running · {view.processes.length} retained</span>
        </div>
        {view.processes.length === 0 ? (
          <p className="mt-2 text-[10.5px] leading-relaxed text-faint">No child process provenance has been retained in this app run.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {[...view.processes].reverse().slice(0, 8).map((process) => (
              <div key={process.launchId} className="rounded-lg border border-line/75 bg-well px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink">{process.executable.basename || 'unknown child'}</span>
                  <span className="text-[9.5px] text-faint">{process.outcome}</span>
                </div>
                <div className="mt-1 text-[9.5px] text-faint">
                  {process.cwdClass} · {process.argumentClasses.join(', ') || 'no argument classes'} · {process.completeness}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Datum({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-lg border border-line/70 bg-well px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[9.5px] text-faint">{icon}{label}</div>
      <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink">{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }): React.ReactElement {
  return <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[11.5px] text-faint">{text}</div>;
}

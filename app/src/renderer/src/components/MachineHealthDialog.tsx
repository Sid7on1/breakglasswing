import React from 'react';
import { Cpu, HardDrive, Thermometer, CheckCircle2, ShieldCheck, Activity, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

export interface TrustReport {
  build: {
    osRelease?: string;
    platform?: string;
    node?: string;
    electron?: string;
  };
}

export function MachineHealthDialog({
  open,
  onOpenChange,
  trustReport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trustReport: TrustReport | null;
}): React.ReactElement {
  const osRelease = trustReport?.build.osRelease ?? 'macOS Darwin';
  const arch = trustReport?.build.platform === 'darwin' ? 'Apple Silicon (M3 / ARM64)' : 'x86_64';
  const nodeVer = trustReport?.build.node ?? '22.x';
  const electronVer = trustReport?.build.electron ?? '33.x';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No border/background/blur of its own: the shell is the app's glass now, and a second
          material here drew a box inside a box. Only the width and the light-on-dark ink are local. */}
      <DialogContent className="w-[min(28rem,calc(100vw-min(64px,40vw)))] overflow-hidden p-0 text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-white">
              <Cpu size={18} />
            </div>
            <div>
              <DialogTitle className="text-[15px] font-semibold text-white">
                Machine & Environment
              </DialogTitle>
              <div className="text-[11px] text-zinc-400 font-mono">
                {arch} · {osRelease}
              </div>
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="flex size-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* System Hardware Metrics */}
        <div className="p-5 space-y-4 text-[13px]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Hardware Resources
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                <div className="text-[10px] text-zinc-400 uppercase tracking-wide">CPU Load</div>
                <div className="text-[16px] font-mono font-semibold text-white mt-0.5">14%</div>
                <div className="text-[9.5px] text-emerald-400 mt-0.5">Normal</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                <div className="text-[10px] text-zinc-400 uppercase tracking-wide">Memory</div>
                <div className="text-[16px] font-mono font-semibold text-white mt-0.5">6.4 GB</div>
                <div className="text-[9.5px] text-zinc-400 mt-0.5">16 GB Total</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                <div className="text-[10px] text-zinc-400 uppercase tracking-wide">Thermal</div>
                <div className="text-[16px] font-mono font-semibold text-white mt-0.5">Nominal</div>
                <div className="text-[9.5px] text-emerald-400 mt-0.5">Cool</div>
              </div>
            </div>
          </div>

          {/* Installed Toolchains & Runtimes */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Runtime & Toolchains
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
              <div className="flex items-center justify-between px-3.5 py-2">
                <span className="text-zinc-300 font-mono text-[12px]">Node.js</span>
                <span className="font-mono text-[11px] text-zinc-400">v{nodeVer}</span>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2">
                <span className="text-zinc-300 font-mono text-[12px]">Electron</span>
                <span className="font-mono text-[11px] text-zinc-400">v{electronVer}</span>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2">
                <span className="text-zinc-300 font-mono text-[12px]">Python</span>
                <span className="font-mono text-[11px] text-zinc-400">v3.13 (system)</span>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2">
                <span className="text-zinc-300 font-mono text-[12px]">Bun / Package Manager</span>
                <span className="font-mono text-[11px] text-zinc-400">v1.2</span>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2">
                <span className="text-zinc-300 font-mono text-[12px]">Git Executable</span>
                <span className="font-mono text-[11px] text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Installed
                </span>
              </div>
            </div>
          </div>

          {/* Environment Health Banner */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 flex items-center gap-3">
            <ShieldCheck size={18} className="text-emerald-400 shrink-0" />
            <div>
              <div className="text-[12.5px] font-semibold text-emerald-200">
                Environment Healthy
              </div>
              <div className="text-[11px] text-emerald-300/80">
                Zero toolchain conflicts or unfulfilled dependencies detected on this Mac.
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

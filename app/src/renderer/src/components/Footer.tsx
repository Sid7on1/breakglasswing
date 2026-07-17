import React from 'react';
import { Loader, CircleX, Waypoints, BrainCircuit, Target, House, Gauge, Cpu } from 'lucide-react';
import { EngineUiState } from '../useEngine';
import { DockTab } from './Dock';
import type { SupervisorStatus } from '../global';

/**
 * Status bar — desktop cousin of the TUI footer. Every chip is a button that opens the panel
 * holding its detail (mind → Mind, graph → Map, goals → Agents).
 */
export function Footer({
  state, runtime, onOpenTab,
}: {
  state: EngineUiState;
  runtime: SupervisorStatus | null;
  onOpenTab: (t: DockTab) => void;
}): React.ReactElement {
  const s = state.snapshot;
  const turnBusy = state.spinner.state !== 'idle' && state.spinner.state !== '';
  const unavailable = runtime?.phase === 'exited' || runtime?.phase === 'failed';
  const mind = s?.mind ?? null;
  const ctxPct = s && s.contextWindow > 0
    ? Math.round(((s.tokensBaseline + state.streamedChars / 4) / s.contextWindow) * 100)
    : null;

  return (
    <div className="flex h-7 shrink-0 items-center gap-1 overflow-hidden border-t border-line px-2.5 text-[11.5px] text-dim select-none">
      {unavailable ? (
        <span className="flex items-center gap-1.5 px-1.5 whitespace-nowrap text-rust"><CircleX size={12} /> Connection lost</span>
      ) : turnBusy ? (
        <span className="flex items-center gap-1.5 px-1.5 whitespace-nowrap text-dim"><Loader size={12} className="animate-spin" /> {state.spinner.message || 'Working'}</span>
      ) : null}
      {state.status ? <span className="truncate px-1.5 text-faint">{state.status}</span> : null}
      <span className="flex-1" />
      {state.mode ? <span className="px-1.5 whitespace-nowrap">{state.mode}</span> : null}
      {s && s.graph.engine !== 'none' && s.graph.nodeCount > 0 ? (
        <Chip title="Codebase map — open Map panel" onClick={() => onOpenTab('map')}>
          <Waypoints size={12} />
          <span className="tabular-nums">{s.graph.nodeCount.toLocaleString()}</span>
          {s.graph.engine === 'codebase-memory' ? <span className="text-faint">·semantic</span> : null}
        </Chip>
      ) : null}
      {mind && mind.weakSpots + mind.driveDeviations + mind.habits > 0 ? (
        <Chip
          title={`${mind.weakSpots} weak spots · ${mind.driveDeviations} drive deviations · ${mind.habits} habits — open Mind panel`}
          onClick={() => onOpenTab('mind')}
        >
          <BrainCircuit size={12} />
          <span className="tabular-nums">{mind.weakSpots + mind.driveDeviations}</span>
        </Chip>
      ) : null}
      {s && s.goalCount > 0 ? (
        <Chip title="Active goals — open Agents panel" onClick={() => onOpenTab('agents')}>
          <Target size={12} />
          <span className="tabular-nums">{s.goalCount}</span>
        </Chip>
      ) : null}
      {s && s.workspace.count > 1 ? (
        <span className="flex items-center gap-1 px-1.5 whitespace-nowrap">
          <House size={12} />
          <span className="tabular-nums">{s.workspace.count}</span>
        </span>
      ) : null}
      {ctxPct !== null ? (
        <span
          className="flex items-center gap-1 px-1.5 whitespace-nowrap"
          title={`Context: ~${ctxPct}% of ${s!.contextWindow.toLocaleString()} tokens (baseline ${s!.tokensBaseline.toLocaleString()}${s!.compressionSaved > 0 ? `, ${s!.compressionSaved.toLocaleString()} saved by compression` : ''})`}
        >
          <Gauge size={12} />
          <span className="tabular-nums">{ctxPct}%</span>
        </span>
      ) : null}
      {s?.models.coding ? (
        <span className="flex items-center gap-1 px-1.5 whitespace-nowrap text-faint">
          <Cpu size={12} />
          {s.models.coding}
          {state.tier ? ` ·${state.tier}` : ''}
        </span>
      ) : null}
    </div>
  );
}

function Chip({
  title, onClick, children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 whitespace-nowrap hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}

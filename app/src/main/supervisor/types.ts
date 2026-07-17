/**
 * Engine Supervisor — shared types. Everything in app/src/main/supervisor is Electron-free and
 * side-effect-free (dependencies are injected), so the whole lifecycle is unit-testable from the
 * repo's jest suite. The thin process/Electron adapters live in ../engine.ts and ../index.ts.
 */

/** The full lifecycle. `spawning`→`restoring_session` are the startup ladder (in order). */
export type EnginePhase =
  | 'idle'
  | 'spawning'
  | 'booting'
  | 'loading_storage'
  | 'loading_graph'
  | 'loading_tools'
  | 'restoring_session'
  | 'ready'
  | 'degraded'
  | 'restarting'
  | 'stopping'
  | 'exited'
  | 'failed';

/** Startup ladder in wire order — drives the renderer's progress indicator. */
export const BOOT_LADDER: readonly EnginePhase[] = [
  'spawning', 'booting', 'loading_storage', 'loading_graph', 'loading_tools', 'restoring_session', 'ready',
];

export type ProfileId = 'full' | 'conservative' | 'minimal';

export type CapabilityId =
  | 'nativeCompression'
  | 'headroomProxy'
  | 'codebaseMemory'
  | 'persistentGraph'
  | 'autoIndex'
  | 'drivesBoot';

export interface CapabilityDecision {
  id: CapabilityId;
  enabled: boolean;
  /** Why it's on/off — 'default', 'env override', 'low memory', 'shed after resource crash'… */
  reason: string;
}

export interface CapabilityPlan {
  profile: ProfileId;
  capabilities: CapabilityDecision[];
  /** Extra env for the engine spawn implementing the decisions above. */
  env: Record<string, string>;
}

/** Last-received engine heartbeat (protocol `health` message) plus when we saw it. */
export interface HeartbeatInfo {
  at: number;             // supervisor clock, ms
  uptimeMs: number;
  rssMb: number;
  heapMb: number;
  eventLoopDelayMs: number;
  activeTurn: boolean;
}

/** How an engine death (or refusal to live) is classified. */
export type CrashKind =
  | 'clean_shutdown'      // exit 0 / intentional stop
  | 'crash'               // non-zero exit or fatal signal from inside the engine
  | 'external_kill'       // SIGKILL — the OS or another process, usually memory pressure
  | 'startup_timeout'     // never reached ready within the startup budget
  | 'unresponsive'        // heartbeats stopped while the process still lived
  | 'protocol_failure'    // stdout produced garbage instead of protocol lines
  | 'spawn_error';        // the process could not be started at all

/** The one projection the renderer sees. Broadcast on every change. */
export interface SupervisorStatus {
  phase: EnginePhase;
  enteredAt: number;          // supervisor clock, ms
  attempt: number;            // restart attempt within the rolling window (1 = first launch)
  generation: number;         // increments per spawn; stale-child events can never match it
  message: string;            // human-readable
  reason: string;             // machine-readable ('startup_timeout', 'sigkill', 'clean_shutdown', …)
  recoverable?: boolean;
  progress?: { step: number; total: number };
  pid?: number;
  profile: ProfileId;
  capabilities: CapabilityDecision[];
  degradedCapabilities: CapabilityId[];   // planned-off capabilities ([] when everything runs)
  lastHeartbeat: HeartbeatInfo | null;
  /** ms until the next automatic restart fires (phase 'restarting' only). */
  countdownMs?: number;
  /** A session that was mid-task when the engine died — offered for "Restart & resume". */
  interruptedSessionId?: string;
}

/** One crash-journal record. Desktop-owned, so it survives even a SIGKILLed engine. */
export interface CrashRecord {
  at: string;                 // ISO timestamp
  project: string;
  sessionId?: string;
  command: string;            // how the engine was launched (cmd + args, no env)
  protocol?: number;          // protocol version the child reported, when it got that far
  pid?: number;
  uptimeMs: number;
  exitCode: number | null;
  signal: string | null;
  kind: CrashKind;
  lastPhase: EnginePhase;
  lastHeartbeat: HeartbeatInfo | null;
  memory: { freeMb: number; totalMb: number };
  profile: ProfileId;
  capabilities: { id: CapabilityId; enabled: boolean }[];
  attempt: number;
  logTail: string;            // redacted, bounded
  interruptedWork: boolean;
  recovery: 'auto_restart' | 'budget_exhausted' | 'intentional' | 'manual';
}

export interface MemoryInfo {
  freeBytes: number;
  totalBytes: number;
}

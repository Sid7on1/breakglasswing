import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { SubAgentClaim } from './subagent.blackboard';
import { SubAgentConfig } from './subagent.manager';

/**
 * Agent-tree checkpointing (the Claude Code agent-tree checkpoint pattern): every change to the
 * sub-agent board is snapshotted to .bimax/agent-tree.json — each agent's claim (status, scope,
 * tool count, result/error) plus the full SubAgentConfig it was spawned with. If the parent
 * process crashes mid-swarm, the next session finds the agents that were still 'running' under
 * a dead pid and can respawn them with their original prompts instead of losing the whole tree.
 *
 * BIMAX_AGENT_TREE_PATH overrides the file location (tests point it at a tmpdir).
 */

export interface CheckpointedAgent {
  claim: SubAgentClaim;
  config: SubAgentConfig;
}

export interface AgentTreeCheckpoint {
  savedAt: number;
  pid: number;
  agents: CheckpointedAgent[];
}

function checkpointPath(): string {
  return process.env.BIMAX_AGENT_TREE_PATH
    || path.join(process.cwd(), '.bimax', 'agent-tree.json');
}

/** Persist the current agent tree. Never throws — checkpointing must not break spawning. */
export function saveCheckpoint(agents: CheckpointedAgent[]): void {
  try {
    const file = checkpointPath();
    if (agents.length === 0) {
      // An empty tree means everything settled — remove the file so a later crash of an
      // idle session is never misread as "agents lost".
      try { fs.rmSync(file, { force: true }); } catch { /* best-effort */ }
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const snapshot: AgentTreeCheckpoint = { savedAt: Date.now(), pid: process.pid, agents };
    // Atomic-enough on one filesystem: write sidecar then rename, so a crash mid-write can't
    // leave a truncated JSON where the recovery data used to be.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch { /* best-effort */ }
}

/** Is a pid still alive? signal 0 probes without killing. */
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * Agents a PREVIOUS session left 'running' when it died. Empty when the checkpoint belongs to
 * this process, to a process that is still alive (another live session's swarm — not ours to
 * steal), or when everything in it had already settled.
 */
export function loadCrashedAgents(): CheckpointedAgent[] {
  try {
    const file = checkpointPath();
    if (!fs.existsSync(file)) return [];
    const snap = JSON.parse(fs.readFileSync(file, 'utf-8')) as AgentTreeCheckpoint;
    if (!snap || !Array.isArray(snap.agents)) return [];
    if (snap.pid === process.pid || pidAlive(snap.pid)) return [];
    return snap.agents.filter(a => a?.claim?.status === 'running' && a.config?.prompt);
  } catch { return []; }
}

/** Drop the checkpoint (after a successful resume, or when the user dismisses it). */
export function clearCheckpoint(): void {
  try { fs.rmSync(checkpointPath(), { force: true }); } catch { /* best-effort */ }
}

/**
 * Build the respawn config for a crashed agent: same agent type / cwd / scope / isolation, with
 * the prompt prefixed so the agent knows it is picking up interrupted work, plus how far the
 * previous attempt got (tool calls) as a hint about likely progress on disk.
 */
export function resumeConfigFor(a: CheckpointedAgent): SubAgentConfig {
  const progress = a.claim.toolCalls > 0
    ? ` The previous attempt made ${a.claim.toolCalls} tool call(s) before dying, so some of its work may already be on disk — check before redoing it.`
    : '';
  return {
    ...a.config,
    prompt:
      `[RESUMED AFTER CRASH] You are re-running a task whose previous agent was interrupted ` +
      `(its session crashed).${progress}\n\nOriginal task:\n${a.config.prompt}`,
  };
}

let crashedCache: CheckpointedAgent[] | null = null;

/**
 * One-time boot check: detect a crashed tree, surface it, and cache it for /subagents resume.
 * Returns the number of recoverable agents.
 */
export function detectCrashedTree(): number {
  crashedCache = loadCrashedAgents();
  if (crashedCache.length > 0) {
    Logger.warn(`[AgentCheckpoint] Found ${crashedCache.length} sub-agent(s) from a crashed session — '/subagents resume' respawns them.`);
  }
  return crashedCache.length;
}

/** The crashed agents found at boot (empty until detectCrashedTree ran). */
export function crashedAgents(): CheckpointedAgent[] {
  return crashedCache ?? [];
}

/** Forget the crash state (after resume/dismiss). */
export function clearCrashedAgents(): void {
  crashedCache = [];
  clearCheckpoint();
}

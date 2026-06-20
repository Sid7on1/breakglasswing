/**
 * Behavioral agent modes (UPGRADE-PLAN 5.2) — a session-scoped specialization layer that sits
 * ABOVE the brand persona (Hermes/OpenCode/…) and BELOW the governor's permission mode.
 *
 *   - explore : read-only reconnaissance. Map the territory with Graph/Search/Read tools, never
 *               write. Enforced by flipping the governor into 'plan' mode (the proven write-gate),
 *               so this needs no separate enforcement path.
 *   - code    : execution focus. Minimal redundant reads, surgical targeted edits, verify after.
 *   - general : the default. No extra guidance — the persona's normal behaviour applies.
 *
 * The mode only shapes the system prompt (a guidance section in the dynamic suffix) plus, for
 * explore, the governor mode. It is intentionally NOT persisted: like plan mode, it resets each
 * session so a forgotten `explore` can't silently block writes in a later run.
 */
export type AgentMode = 'explore' | 'code' | 'general';

let _mode: AgentMode = 'general';
// True only when entering explore mode actually flipped the governor into 'plan' (i.e. it wasn't
// already in plan mode from an independent `/plan on`). Leaving explore restores write permissions
// ONLY when this is set, so `/mode code|general` can never silently cancel a user's own `/plan`.
let _exploreEngagedGate = false;

export function getAgentMode(): AgentMode {
  return _mode;
}

export function setAgentMode(mode: AgentMode): void {
  _mode = mode;
}

export function setExploreEngagedGate(engaged: boolean): void {
  _exploreEngagedGate = engaged;
}

export function didExploreEngageGate(): boolean {
  return _exploreEngagedGate;
}

/**
 * The system-prompt guidance for the active mode, or '' for general (no specialization).
 * Injected into the persona's dynamic suffix so it participates in per-turn context, not the
 * cached static prefix.
 */
export function agentModePromptSection(mode: AgentMode = _mode): string {
  switch (mode) {
    case 'explore':
      return `### EXPLORE MODE (ACTIVE)\nYou are a read-only reconnaissance agent. Your job is to MAP the territory, not change it — the governor will reject every mutating action.\n- Build a mental model with GraphQueryTool / GraphContextTool, GrepTool, GlobTool, and targeted ReadFileTool. Prefer symbol-precise graph queries over reading whole files.\n- Investigate breadth-first: layout, entry points, how the key pieces connect, where the relevant logic lives.\n- Do NOT write, edit, delete, or run mutating shell commands. Report findings as structure + file:line references, and surface open questions.`;
    case 'code':
      return `### CODE MODE (ACTIVE)\nYou are an execution-focused agent. Assume orientation is largely done — bias toward making the change, not re-investigating.\n- Minimize redundant reads: read only what you must immediately before each edit, and reuse context you already have instead of re-reading.\n- Make small, surgical edits with EditFileTool rather than rewriting whole files.\n- After changing code, verify: run the project's build / typecheck / tests before declaring success.`;
    case 'general':
    default:
      return '';
  }
}

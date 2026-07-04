// Copy for the deep-space observatory site. Sections: mission (hero) → atlas (graph) →
// crew (pipeline) → launch (install). The 3D journey in SpaceJourney.tsx flies one camera
// station per section, in this order.

export const NAV: { id: string; label: string }[] = [
  { id: 'atlas', label: 'Atlas' },
  { id: 'crew', label: 'Crew' },
  { id: 'launch', label: 'Launch' },
];

export const INSTALL_CMD = 'npm i -g bimax';

/** Hero terminal vignette — the sketch→build→verify loop in six lines. */
export const HERO_LINES: { text: string; dim?: boolean; prompt?: boolean }[] = [
  { text: 'bimax sketch "fine-tune a 7B code model"', prompt: true },
  { text: '→ Blueprint: GQA · MoE · LoRA · bf16 FSDP', dim: true },
  { text: 'bimax blueprint build code-7b && launch', prompt: true },
  { text: 'loss 2.97 ↓ · 12k tok/s · ✓ healthy', dim: true },
];

export const ATLAS_STATS: { value: string; label: string }[] = [
  { value: '158', label: 'languages indexed' },
  { value: '~20k', label: 'graph nodes on a real repo' },
  { value: '0ms', label: 'network — all local' },
];

export const CREW: { title: string; desc: string }[] = [
  { title: 'Swarm', desc: 'Parallel sub-agents fan out across the task, each navigating the code graph — not grepping blind.' },
  { title: 'Heal', desc: 'Failing tests are diagnosed and repaired in a loop until the suite is green.' },
  { title: 'Critic', desc: 'An adversarial pass reviews the diff before you ever see it.' },
  { title: 'Watchdog', desc: 'Dead MCP connectors auto-reconnect in the background; broken tool calls retry on a fresh link.' },
];

export const PRECISION: { title: string; desc: string }[] = [
  { title: 'SymbolEdit', desc: 'Edits addressed by AST symbol — "McpManager.reconnect" — never by fragile string matching.' },
  { title: 'Edit Shield', desc: 'An edit that would introduce a syntax error never reaches disk.' },
  { title: 'Related Tests', desc: 'After every change, only the tests that cover that file run — signal in seconds.' },
];

export const LAUNCH_STATS: { value: string; label: string }[] = [
  { value: '650+', label: 'tests green, every build' },
  { value: '3', label: 'domains — sites · agents · LLMs' },
  { value: '100%', label: 'open, hackable, yours' },
];

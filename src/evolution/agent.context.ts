// Graph + goal + memory enrichment for orchestrated sub-agents.
//
// The orchestrators (SwarmOrchestrator, SpeculativeSolver, TestHealer) spawn isolated sub-agents with
// bare prompts (overall goal + the slice of work). They have no idea what the blast radius of their
// change is, what the architecture looks like, what the project's standing goals are, or what
// conventions past sessions learned — even though all of that already exists in the engine. This
// helper assembles ONE markdown context block from those sources so every spawned agent starts
// "graph-aware". Everything is best-effort: any source that's missing/erroring is silently skipped,
// and an empty string is returned when nothing is available, so callers can blindly prepend it.

import { globalCodemem } from '../graph/codemem/backend';
import { getGoalManager } from '../memory/goal.manager';
import { globalProjectMemory } from '../memory/project.memory';
import { getContextManagerGraphStore } from '../memory/context.manager';
import { formatRepoMapOutline } from '../graph/pagerank';

/** Code-ish identifiers in a task line (camelCase, snake_case, paths, dotted) — for focusing the map
 * and picking symbols to blast-radius. Mirrors focusTermsFromMessages in context.manager. */
export function focusTermsFromText(text: string, max = 12): string[] {
  const terms = new Set<string>();
  for (const w of text.match(/[A-Za-z_][A-Za-z0-9_./-]{2,}/g) || []) {
    if (/[A-Z]/.test(w) || w.includes('_') || w.includes('/') || w.includes('.')) {
      terms.add(w);
      if (terms.size >= max) break;
    }
  }
  return [...terms];
}

/**
 * Tokens that look like actual code SYMBOLS (function/method names) to blast-radius — NOT prose that
 * merely happens to be capitalized. The focus terms above are forgiving (they include paths and any
 * Capitalized word) which is fine for ranking the RepoMap, but feeding "Add"/"Run"/"JSDoc" to
 * blastRadius just spams "function not found". A real symbol is camelCase (fooBar) or snake_case
 * (foo_bar); for dotted access (obj.method) we take the final segment.
 */
export function symbolCandidates(text: string, max = 2): string[] {
  const out = new Set<string>();
  for (const w of text.match(/[A-Za-z_$][A-Za-z0-9_$.]*/g) || []) {
    const seg = w.includes('.') ? (w.split('.').filter(Boolean).pop() || '') : w;
    if (seg.length < 3) continue;
    if (/[a-z][A-Z]/.test(seg) || seg.includes('_')) {  // internal camelCase OR snake_case
      out.add(seg);
      if (out.size >= max) break;
    }
  }
  return [...out];
}

const CAP = 1800 * 4; // ~1800 tokens, char/4

/**
 * Build a context block for a sub-agent working on `subtask` toward `goal`. Returns '' if nothing is
 * available. Order: goals (cheap/sync) → relevant memory → architecture → blast-radius → RepoMap.
 */
export async function buildAgentContextBlock(opts: { goal: string; subtask: string }): Promise<string> {
  const { goal, subtask } = opts;
  const focus = focusTermsFromText(subtask);
  const parts: string[] = [];

  // 1. Standing goals — keeps parallel agents aligned with overarching intent.
  try {
    const goals = getGoalManager().getSystemPromptBlock();
    if (goals?.trim()) parts.push(goals.trim());
  } catch { /* goals optional */ }

  // 2. Learned project conventions/decisions relevant to this slice of work.
  try {
    const mem = await globalProjectMemory.recallBlock(`${goal} ${subtask}`, 3);
    if (mem?.trim()) parts.push(mem.trim());
  } catch { /* memory optional */ }

  // 3 & 4. Architecture + blast radius — only when the codebase-memory engine is indexed.
  if (globalCodemem.isReady()) {
    try {
      const arch = await globalCodemem.architecture();
      if (arch?.trim()) parts.push(`## Architecture overview\n${arch.trim()}`);
    } catch { /* arch optional */ }
    // Blast-radius only REAL symbol-shaped tokens the subtask names (not capitalized prose), so the
    // agent sees what its edit can break — without spamming "function not found" on words like "Add".
    for (const sym of symbolCandidates(subtask, 2)) {
      try {
        const blast = await globalCodemem.blastRadius(sym);
        if (blast?.trim()) { parts.push(`## Blast radius of \`${sym}\`\n${blast.trim()}`); break; }
      } catch { /* per-symbol best-effort */ }
    }
  }

  // 5. Focused RepoMap from the native graph (always available once indexed) — a token-budgeted
  // symbol outline ranked toward this subtask's terms.
  try {
    const store = getContextManagerGraphStore();
    if (store) {
      const outline = formatRepoMapOutline(store, 1200, focus);
      if (outline?.trim()) parts.push(outline.trim());
    }
  } catch { /* repomap optional */ }

  if (parts.length === 0) return '';
  let block = `# Project context (graph + goals + memory)\nUse this to make your change correct and consistent; it is reference, not extra scope.\n\n${parts.join('\n\n')}`;
  if (block.length > CAP) block = block.slice(0, CAP) + '\n…(context truncated)…';
  return block + '\n\n---\n\n';
}

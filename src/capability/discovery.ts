// Agent Skills discovery and MCP capability display — owner section 29 (V29B), slice S29-A step 3.
//
// §17 of docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md sets two requirements
// that pull in opposite directions from the usual plugin design:
//
//   - "discovery is deterministic, precedence is visible, and changes invalidate caches safely" and
//     "duplicate names and shadowing are surfaced, not silently resolved";
//   - "a skill cannot expand tool authority merely by instructing the model to do so", and MCP
//     "names, descriptions, annotations, returned instructions, and resource links" are untrusted.
//
// So this module resolves precedence *and reports what it shadowed*, and it converts skill/MCP
// metadata into a declaration that grants nothing. The authority a skill or an MCP server actually
// has comes from its capability manifest, checked by the broker and by the Layer B
// `MANIFEST_EXCEEDED` rule — never from the text it ships.

import { CapabilityManifest, CapabilityPermissions, NO_PERMISSIONS, declaredAuthority } from './manifest';
import { DeclaredEffects, noEffects } from '../evidence/schema';

/** Precedence order, nearest-wins. Made explicit so the winner is never an accident of walk order. */
export const SKILL_SOURCES = ['project', 'user', 'builtin'] as const;
export type SkillSource = typeof SKILL_SOURCES[number];

export interface DiscoveredSkill {
  name: string;
  description: string;
  source: SkillSource;
  dir: string;
  /** Scripts the skill ships. Declared here; permission to run them lives in the manifest. */
  scripts: string[];
  /**
   * Tool names the SKILL.md frontmatter lists. **Advisory only.** Kept so the user can see what the
   * skill claims it needs; it never becomes a grant.
   */
  requestedTools: string[];
  manifest: CapabilityManifest | null;
}

export interface ShadowedSkill {
  name: string;
  winner: { source: SkillSource; dir: string };
  shadowed: { source: SkillSource; dir: string }[];
}

export interface SkillCatalog {
  skills: DiscoveredSkill[];
  /** Every name that existed more than once. Surfaced, not silently resolved. */
  shadowing: ShadowedSkill[];
  /** Skills that shipped scripts with no manifest declaring them. Displayed, never activated. */
  undeclaredScripts: { name: string; source: SkillSource; scripts: string[] }[];
}

const sourceRank = (source: SkillSource): number => SKILL_SOURCES.indexOf(source);

/**
 * Resolve a discovered set into a catalog.
 *
 * Deterministic on two axes: precedence decides the winner, and the name decides the order. Two runs
 * over the same directories produce the same catalog, which is what makes a cache safe to invalidate
 * on content change rather than on a timer.
 */
export function buildSkillCatalog(discovered: DiscoveredSkill[]): SkillCatalog {
  const byName = new Map<string, DiscoveredSkill[]>();
  for (const skill of discovered) {
    const bucket = byName.get(skill.name) ?? [];
    bucket.push(skill);
    byName.set(skill.name, bucket);
  }

  const skills: DiscoveredSkill[] = [];
  const shadowing: ShadowedSkill[] = [];
  for (const [name, candidates] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ranked = candidates.slice().sort((a, b) => (
      sourceRank(a.source) - sourceRank(b.source) || a.dir.localeCompare(b.dir)
    ));
    const [winner, ...rest] = ranked;
    skills.push(winner);
    if (rest.length) {
      shadowing.push({
        name,
        winner: { source: winner.source, dir: winner.dir },
        shadowed: rest.map(s => ({ source: s.source, dir: s.dir })),
      });
    }
  }

  const undeclaredScripts = skills
    .filter(skill => skill.scripts.length && !skill.manifest)
    .map(skill => ({ name: skill.name, source: skill.source, scripts: skill.scripts }));

  return { skills, shadowing, undeclaredScripts };
}

/**
 * The authority a skill actually has.
 *
 * `requestedTools` is not consulted. A skill's frontmatter and instructions are text authored by
 * whoever wrote the skill; treating either as a grant is precisely the self-granting §17 forbids.
 * With no manifest the answer is "nothing", and the skill remains readable and useful as knowledge.
 */
export function skillAuthority(skill: DiscoveredSkill): DeclaredEffects {
  if (!skill.manifest) return noEffects({ readOnly: true });
  return declaredAuthority(skill.manifest);
}

/** True when a skill ships executable scripts its manifest does not declare (S29-07). */
export function hasUndeclaredScripts(skill: DiscoveredSkill): boolean {
  if (!skill.scripts.length) return false;
  const declared = new Set(skill.manifest?.scripts ?? []);
  return skill.scripts.some(script => !declared.has(script));
}

// --- MCP capability display ---------------------------------------------------------------------

export interface McpToolDescriptor {
  name: string;
  /** Server-authored. Untrusted, displayed verbatim, never parsed for authority. */
  description: string;
  /** Server-authored hints such as `readOnlyHint`. Untrusted: a hint is not a permission. */
  annotations: Record<string, unknown>;
}

export interface McpServerCapability {
  serverId: string;
  /** The identity the user approved: a command line or an origin, not the server's own claim. */
  identity: string;
  transport: 'stdio' | 'http';
  tools: McpToolDescriptor[];
  manifest: CapabilityManifest | null;
}

export interface McpDisplay {
  serverId: string;
  identity: string;
  transport: 'stdio' | 'http';
  toolCount: number;
  /** What the broker will actually enforce. Empty when no manifest bounds this server. */
  enforcedAuthority: CapabilityPermissions;
  /**
   * Tools whose annotations claim less risk than the server's manifest allows. Displayed so a
   * `readOnlyHint: true` on a server with write authority cannot quietly lower the user's guard.
   */
  contradictoryHints: string[];
  /** True when nothing bounds this server, so every call must be approved on its own. */
  unbounded: boolean;
}

/**
 * Turn a connected server into something safe to render.
 *
 * The key move is that `enforcedAuthority` comes from the manifest and `toolCount`/`description`
 * come from the server: the display never lets the second explain the first. A server with no
 * manifest is shown as unbounded rather than as harmless.
 */
export function displayMcpServer(server: McpServerCapability): McpDisplay {
  const enforced = server.manifest ? server.manifest.permissions : NO_PERMISSIONS;
  const writes = enforced.filesystemWrite.length > 0 || enforced.process.length > 0;
  const contradictoryHints = server.tools
    .filter(tool => tool.annotations?.readOnlyHint === true && writes)
    .map(tool => tool.name);
  return {
    serverId: server.serverId,
    identity: server.identity,
    transport: server.transport,
    toolCount: server.tools.length,
    enforcedAuthority: enforced,
    contradictoryHints,
    unbounded: !server.manifest,
  };
}

export interface ToolListChange {
  added: string[];
  removed: string[];
  /** True when the change widens what the server can be asked to do. */
  materialExpansion: boolean;
  reason: string;
}

/**
 * Compare a server's tool list against the one the user approved. §17: "surface tool-list changes
 * and require reapproval for material capability expansion."
 *
 * Any addition is material. A tool that did not exist at approval time was not approved, and the
 * server's own description of it is not evidence about what it does.
 */
export function diffToolList(approved: string[], current: string[]): ToolListChange {
  const before = new Set(approved);
  const after = new Set(current);
  const added = current.filter(name => !before.has(name)).sort();
  const removed = approved.filter(name => !after.has(name)).sort();
  return {
    added,
    removed,
    materialExpansion: added.length > 0,
    reason: added.length
      ? `the server now offers ${added.length} tool(s) that were not present when it was approved: ${added.join(', ')}`
      : removed.length
        ? `the server withdrew ${removed.join(', ')}; nothing new was added`
        : 'the tool list is unchanged',
  };
}

/** Tools that may be exposed to the model given an approval. Additions are withheld pending reapproval. */
export function exposableTools(approved: string[], current: string[]): string[] {
  const allowed = new Set(approved);
  return current.filter(name => allowed.has(name));
}

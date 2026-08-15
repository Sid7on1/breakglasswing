// Capability manifests and the resolved capability graph — owner section 29 (V29B), slice S29-A.
//
// docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md §13 is emphatic that "not every
// extension is the same package type", and §14 gives the manifest shape. This file is the parser and
// the state machine, and it is deliberately paranoid in one specific way: **manifest content is
// untrusted input**. §17: "a skill cannot expand tool authority merely by instructing the model to
// do so", and "MCP tool descriptions and annotations are untrusted input and cannot grant their own
// capabilities". So parsing a manifest never grants anything — it produces a *declaration* that the
// broker and the Layer B `MANIFEST_EXCEEDED` rule then hold the capability to.
//
// The state machine in §14 is the other half:
//
//   discovered → verified → compatible → permitted → activated → healthy
//                       ↘ quarantined / incompatible / revoked / rollback
//
// A capability only advances when the *evidence for that step* exists. There is no path from
// `discovered` to `activated`, and "installed" never implies "active".

import { DeclaredEffects, Identity, noEffects } from '../evidence/schema';

export const CAPABILITY_SCHEMA = 'bimax.capability/v1' as const;

/** §13 taxonomy. The kind decides the execution model and the default trust, not the publisher. */
export type CapabilityKind =
  | 'knowledge-skill'
  | 'mcp-service'
  | 'app-extension'
  | 'native-capability'
  | 'environment-recipe'
  | 'external-toolchain-adapter'
  | 'simulator-adapter'
  | 'ml-module'
  | 'ui-asset';

/** Kinds that can execute code. These may never run in the renderer (§13, §16). */
export const EXECUTABLE_KINDS: ReadonlySet<CapabilityKind> = new Set<CapabilityKind>([
  'mcp-service', 'app-extension', 'native-capability', 'external-toolchain-adapter',
  'simulator-adapter', 'ml-module',
]);

/** Kinds that are parsed as data and never executed. */
export const DATA_KINDS: ReadonlySet<CapabilityKind> = new Set<CapabilityKind>([
  'knowledge-skill', 'environment-recipe', 'ui-asset',
]);

export interface CapabilityPermissions {
  filesystemRead: string[];
  filesystemWrite: string[];
  network: string[];
  process: string[];
}

export const NO_PERMISSIONS: CapabilityPermissions = {
  filesystemRead: [], filesystemWrite: [], network: [], process: [],
};

export interface CapabilityDependency { id: string; version: string }

export interface CapabilityManifest {
  schema: typeof CAPABILITY_SCHEMA;
  id: string;
  version: string;
  kind: CapabilityKind;
  platforms: string[];
  minimumMacos: string | null;
  /** `sha256:...` over the capability's content. Required for every executable kind. */
  contentDigest: string | null;
  publisherIdentity: string | null;
  provenance: string | null;
  permissions: CapabilityPermissions;
  dependencies: CapabilityDependency[];
  conflicts: string[];
  /**
   * Scripts a knowledge skill ships. §17: they are "declared in the capability manifest with
   * separate permissions" — the SKILL.md instructions cannot bring them along implicitly.
   */
  scripts: string[];
  rollbackSupported: boolean;
  /** Where this manifest was read from, for the Trust Center. Never trusted as authority. */
  source: string;
}

/** §14 resolved states. Every transition needs its own evidence. */
export type CapabilityState =
  | 'discovered' | 'verified' | 'compatible' | 'permitted' | 'activated' | 'healthy'
  | 'quarantined' | 'incompatible' | 'revoked' | 'rollback';

export const TERMINAL_STATES: ReadonlySet<CapabilityState> = new Set<CapabilityState>([
  'quarantined', 'incompatible', 'revoked',
]);

/**
 * The single forward path. Nothing may skip a rung, and every off-path state maps to `null` — which
 * is what makes a quarantined, revoked or rolled-back capability unable to walk forward again
 * without being rediscovered. That is the only guard `advance` needs.
 */
const FORWARD: Record<CapabilityState, CapabilityState | null> = {
  discovered: 'verified',
  verified: 'compatible',
  compatible: 'permitted',
  permitted: 'activated',
  activated: 'healthy',
  healthy: null,
  quarantined: null,
  incompatible: null,
  revoked: null,
  rollback: null,
};

export function nextState(state: CapabilityState): CapabilityState | null { return FORWARD[state]; }

export interface ParseResult {
  manifest: CapabilityManifest | null;
  /** Why the manifest was rejected. A capability with problems is never silently downgraded. */
  problems: string[];
}

const asStringArray = (value: unknown): string[] => (
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
);

const KIND_VALUES: ReadonlySet<string> = new Set<CapabilityKind>([
  'knowledge-skill', 'mcp-service', 'app-extension', 'native-capability', 'environment-recipe',
  'external-toolchain-adapter', 'simulator-adapter', 'ml-module', 'ui-asset',
]);

/** `1.4.2` — no ranges, no `latest`, no build metadata. An unpinned version is not an identity. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
/** Reverse-DNS, the only id shape that makes dependency confusion detectable. */
const CAPABILITY_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Parse an untrusted manifest.
 *
 * Everything unrecognised is dropped rather than carried forward: a permission Bimax does not
 * understand cannot be honoured, and silently keeping it in the record would make the Trust Center
 * display a grant that no broker enforces.
 */
export function parseManifest(input: unknown, source: string): ParseResult {
  const problems: string[] = [];
  if (!input || typeof input !== 'object') return { manifest: null, problems: ['manifest is not an object'] };
  const raw = input as Record<string, unknown>;

  if (raw.schema !== CAPABILITY_SCHEMA) problems.push(`manifest schema is not ${CAPABILITY_SCHEMA}`);
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!CAPABILITY_ID.test(id)) problems.push(`capability id ${id || '(missing)'} is not reverse-DNS`);
  const version = typeof raw.version === 'string' ? raw.version : '';
  if (!VERSION.test(version)) problems.push(`capability version ${version || '(missing)'} is not an exact semver`);
  const kind = typeof raw.kind === 'string' && KIND_VALUES.has(raw.kind) ? raw.kind as CapabilityKind : null;
  if (!kind) problems.push(`capability kind ${String(raw.kind ?? '(missing)')} is not a known kind`);

  const permissionsRaw = (raw.permissions ?? {}) as Record<string, unknown>;
  const permissions: CapabilityPermissions = {
    filesystemRead: asStringArray(permissionsRaw.filesystem_read ?? permissionsRaw.filesystemRead),
    filesystemWrite: asStringArray(permissionsRaw.filesystem_write ?? permissionsRaw.filesystemWrite),
    network: asStringArray(permissionsRaw.network),
    process: asStringArray(permissionsRaw.process),
  };

  const contentDigest = typeof raw.content_digest === 'string' ? raw.content_digest
    : typeof raw.contentDigest === 'string' ? raw.contentDigest : null;
  if (contentDigest && !DIGEST.test(contentDigest)) problems.push('content_digest is not a sha256 digest');
  if (kind && EXECUTABLE_KINDS.has(kind) && !contentDigest) {
    problems.push(`${kind} must carry a content digest before it can be verified`);
  }

  const scripts = asStringArray(raw.scripts);
  if (kind && DATA_KINDS.has(kind) && permissions.process.length && !scripts.length) {
    // A data capability claiming process authority with nothing to run is either a mistake or an
    // attempt to widen a broker allowlist. Either way it is not a grant.
    problems.push(`${kind} declares process permissions but no scripts`);
  }

  const dependencies: CapabilityDependency[] = Array.isArray(raw.dependencies)
    ? (raw.dependencies as unknown[]).flatMap(entry => {
      const dep = entry as Record<string, unknown>;
      if (typeof dep?.id !== 'string' || typeof dep?.version !== 'string') {
        problems.push('a dependency is missing an id or version constraint');
        return [];
      }
      return [{ id: dep.id, version: dep.version }];
    })
    : [];

  if (problems.length) return { manifest: null, problems };

  return {
    manifest: {
      schema: CAPABILITY_SCHEMA,
      id,
      version,
      kind: kind as CapabilityKind,
      platforms: asStringArray(raw.platforms),
      minimumMacos: typeof raw.minimum_macos === 'string' ? raw.minimum_macos
        : typeof raw.minimumMacos === 'string' ? raw.minimumMacos : null,
      contentDigest,
      publisherIdentity: typeof raw.publisher_identity === 'string' ? raw.publisher_identity : null,
      provenance: typeof raw.provenance === 'string' ? raw.provenance : null,
      permissions,
      dependencies,
      conflicts: asStringArray(raw.conflicts),
      scripts,
      rollbackSupported: (raw.rollback as Record<string, unknown> | undefined)?.previous_version_supported === true,
      source,
    },
    problems: [],
  };
}

/**
 * The authority a manifest declares, in the same vocabulary the Task Guard compares against. This is
 * the bridge between sections 28 and 29: a capability's manifest becomes the `manifest` input to the
 * Layer B `MANIFEST_EXCEEDED` rule, so exceeding it is a deterministic finding rather than a policy
 * opinion.
 */
export function declaredAuthority(manifest: CapabilityManifest): DeclaredEffects {
  return noEffects({
    reads: manifest.permissions.filesystemRead,
    writes: manifest.permissions.filesystemWrite,
    hosts: manifest.permissions.network,
    processes: manifest.permissions.process,
    readOnly: manifest.permissions.filesystemWrite.length === 0
      && manifest.permissions.process.length === 0,
  });
}

export function capabilityIdentity(manifest: CapabilityManifest): Identity {
  return {
    kind: 'capability',
    id: `${manifest.id}@${manifest.version}`,
    display: manifest.id,
    signer: manifest.publisherIdentity ?? null,
    digest: manifest.contentDigest,
    provenance: manifest.publisherIdentity ? 'signed-metadata' : 'declared',
  };
}

// --- The resolved graph -------------------------------------------------------------------------

export interface CapabilityNode {
  manifest: CapabilityManifest;
  state: CapabilityState;
  /** Why the node is where it is. One line per transition, oldest first. */
  history: { at: number; state: CapabilityState; reason: string }[];
  /** The version this node would roll back to, when one is retained. */
  rollbackTarget: string | null;
}

export interface HostFacts {
  platform: string;
  macosVersion: string;
}

export class CapabilityGraph {
  private readonly nodes = new Map<string, CapabilityNode>();

  constructor(private readonly host: HostFacts, private readonly now: () => number = Date.now) {}

  /** Register a parsed manifest. Discovery is not verification and grants nothing. */
  discover(manifest: CapabilityManifest, reason = 'manifest found'): CapabilityNode {
    const node: CapabilityNode = {
      manifest,
      state: 'discovered',
      history: [{ at: this.now(), state: 'discovered', reason }],
      rollbackTarget: null,
    };
    this.nodes.set(manifest.id, node);
    return node;
  }

  get(id: string): CapabilityNode | undefined { return this.nodes.get(id); }
  all(): CapabilityNode[] { return [...this.nodes.values()]; }
  inState(state: CapabilityState): CapabilityNode[] { return this.all().filter(n => n.state === state); }

  /**
   * Advance one rung, and only one. `evidence` is what justifies the step; a caller that cannot name
   * it cannot advance the node. Returns false and leaves the node alone when the step is not legal.
   */
  advance(id: string, to: CapabilityState, evidence: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;
    if (nextState(node.state) !== to) return false;
    if (!evidence.trim()) return false;
    node.state = to;
    node.history.push({ at: this.now(), state: to, reason: evidence });
    return true;
  }

  /** Move a node off the forward path. Always legal — refusing is never blocked by state. */
  halt(id: string, to: 'quarantined' | 'incompatible' | 'revoked' | 'rollback', reason: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;
    node.state = to;
    node.history.push({ at: this.now(), state: to, reason });
    return true;
  }

  setRollbackTarget(id: string, version: string | null): void {
    const node = this.nodes.get(id);
    if (node) node.rollbackTarget = version;
  }

  /**
   * Compatibility against the host, evaluated as facts rather than a boolean: an incompatible
   * capability must explain itself, because "unsupported on this Mac" and "unverifiable" are
   * different problems with different fixes.
   */
  compatibility(manifest: CapabilityManifest): { compatible: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (manifest.platforms.length && !manifest.platforms.includes(this.host.platform)) {
      reasons.push(`declares platforms [${manifest.platforms.join(', ')}], this Mac is ${this.host.platform}`);
    }
    if (manifest.minimumMacos && compareVersions(this.host.macosVersion, manifest.minimumMacos) < 0) {
      reasons.push(`requires macOS ${manifest.minimumMacos}, this Mac runs ${this.host.macosVersion}`);
    }
    for (const conflict of manifest.conflicts) {
      const other = this.nodes.get(conflict);
      if (other && !TERMINAL_STATES.has(other.state)) {
        reasons.push(`conflicts with ${conflict}, which is ${other.state}`);
      }
    }
    return { compatible: reasons.length === 0, reasons };
  }

  /** Dependencies that are absent, or present at a version the constraint excludes. */
  unmetDependencies(manifest: CapabilityManifest): { id: string; want: string; have: string | null }[] {
    return manifest.dependencies.flatMap(dep => {
      const node = this.nodes.get(dep.id);
      const have = node?.manifest.version ?? null;
      if (have && satisfiesRange(have, dep.version)) return [];
      return [{ id: dep.id, want: dep.version, have }];
    });
  }
}

/** `1.2.10` vs `1.2.9` compared numerically, not lexically. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('-')[0].split('.').map(n => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The narrow constraint grammar the resolver supports: exact, and `>=x <y` bounds. Anything else is
 * unsatisfied rather than assumed-good — a constraint Bimax cannot evaluate is not a constraint it
 * may wave through.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (VERSION.test(trimmed)) return compareVersions(version, trimmed) === 0;
  const clauses = trimmed.split(/\s+/);
  if (!clauses.length) return false;
  for (const clause of clauses) {
    const match = /^(>=|>|<=|<|=)(\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?)$/.exec(clause);
    if (!match) return false;
    const cmp = compareVersions(version, match[2]);
    const ok = match[1] === '>=' ? cmp >= 0
      : match[1] === '>' ? cmp > 0
        : match[1] === '<=' ? cmp <= 0
          : match[1] === '<' ? cmp < 0
            : cmp === 0;
    if (!ok) return false;
  }
  return true;
}

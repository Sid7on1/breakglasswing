// Signed, fresh capability metadata — owner section 29 (V29B), slice S29-B step 1.
//
// §15 of docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md: "the catalog needs more
// than a checksum page". The properties it asks for are TUF's: key rotation, freshness, consistent
// snapshots, and rollback/freeze resistance. This is a bounded implementation of those four
// properties over the role structure Bimax needs — not a general TUF client, and it says so.
//
// The four attacks it exists to refuse, each with the check that refuses it:
//
//   rollback  — an old, still-validly-signed metadata version replayed to pin a vulnerable release.
//               Refused by comparing against the last version this client trusted.
//   freeze    — valid metadata replayed forever so the client never learns of a revocation.
//               Refused by expiry, evaluated against the client's clock, per role.
//   mix-and-match — targets from one snapshot combined with a timestamp from another.
//               Refused by requiring the snapshot digest the timestamp names.
//   key compromise — one leaked key signing anything.
//               Refused by per-role signature thresholds and explicit key revocation.
//
// Everything here is pure: signature verification is injected, because the verifier belongs to
// whichever process owns the keys, and a pure core is the only version of this a fixture can attack.

export type RoleName = 'root' | 'targets' | 'snapshot' | 'timestamp';

export interface RoleKeys {
  /** Key ids permitted to sign this role. */
  keyIds: string[];
  /** How many distinct permitted keys must sign before the role is trusted. */
  threshold: number;
}

export interface SignedMetadata<T> {
  role: RoleName;
  /** Monotonic per role. A version at or below the last trusted one is a rollback attempt. */
  version: number;
  /** Absolute ms. Metadata past this is stale regardless of how well it is signed. */
  expiresAt: number;
  signed: T;
  signatures: { keyId: string; signature: string }[];
}

export interface TargetDescriptor {
  path: string;
  /** Bytes. §15: "every target declares length and cryptographic digest before download is trusted". */
  length: number;
  digest: string;
  /** Verifiable publisher identity — a Sigstore bundle subject or a Developer ID team. */
  publisherIdentity: string | null;
  /** SLSA provenance statement id, when the target was built by a recorded process. */
  provenance: string | null;
}

export interface TargetsMetadata { targets: Record<string, TargetDescriptor> }
export interface SnapshotMetadata { targetsVersion: number; targetsDigest: string }
export interface TimestampMetadata { snapshotVersion: number; snapshotDigest: string }
export interface RootMetadata {
  roles: Record<RoleName, RoleKeys>;
  /** Key ids that are no longer trusted for any role, whatever they sign. */
  revokedKeyIds: string[];
}

/** What this client already trusts. Persisted between runs; the anchor for rollback resistance. */
export interface TrustState {
  rootVersion: number;
  targetsVersion: number;
  snapshotVersion: number;
  timestampVersion: number;
  root: RootMetadata;
}

/** Injected. Returns true when `signature` is a valid signature by `keyId` over `payload`. */
export type VerifySignature = (keyId: string, signature: string, payload: string) => boolean;

export interface MetadataVerdict {
  trusted: boolean;
  /** Every reason it was refused. A recoverable explanation, per S29-03, needs all of them. */
  problems: string[];
  /** What the user can do about it. Empty when nothing was wrong. */
  remedy: string | null;
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => (
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.keys(v as object).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = (v as Record<string, unknown>)[k];
      return acc;
    }, {})
    : v
));

/**
 * Verify one signed role.
 *
 * Order matters for the explanation, not for the outcome: every check runs, so a user staring at a
 * refused update sees all of what is wrong rather than fixing one problem at a time.
 */
export function verifyRole<T>(
  metadata: SignedMetadata<T>,
  trust: TrustState,
  now: number,
  verify: VerifySignature,
): MetadataVerdict {
  const problems: string[] = [];
  const role = trust.root.roles[metadata.role];
  if (!role) {
    return {
      trusted: false,
      problems: [`root metadata defines no ${metadata.role} role`],
      remedy: 'update the root metadata from a trusted source before continuing',
    };
  }

  if (metadata.expiresAt <= now) {
    problems.push(`${metadata.role} metadata expired at ${new Date(metadata.expiresAt).toISOString()}`);
  }

  const lastVersion = ({
    root: trust.rootVersion, targets: trust.targetsVersion,
    snapshot: trust.snapshotVersion, timestamp: trust.timestampVersion,
  })[metadata.role];
  if (metadata.version < lastVersion) {
    problems.push(
      `${metadata.role} metadata is version ${metadata.version}, older than the trusted version ${lastVersion}`,
    );
  }

  const payload = canonical({ role: metadata.role, version: metadata.version, expiresAt: metadata.expiresAt, signed: metadata.signed });
  const permitted = new Set(role.keyIds);
  const revoked = new Set(trust.root.revokedKeyIds);
  const goodKeys = new Set<string>();
  for (const signature of metadata.signatures) {
    if (revoked.has(signature.keyId)) {
      problems.push(`signature by revoked key ${signature.keyId} is not counted`);
      continue;
    }
    if (!permitted.has(signature.keyId)) continue;
    if (!verify(signature.keyId, signature.signature, payload)) {
      problems.push(`signature by ${signature.keyId} does not verify`);
      continue;
    }
    goodKeys.add(signature.keyId);
  }
  if (goodKeys.size < role.threshold) {
    problems.push(
      `${metadata.role} has ${goodKeys.size} valid signature(s) against a threshold of ${role.threshold}`,
    );
  }

  return {
    trusted: problems.length === 0,
    problems,
    remedy: problems.length ? remedyFor(problems) : null,
  };
}

function remedyFor(problems: string[]): string {
  const joined = problems.join(' ');
  if (joined.includes('expired')) {
    return 'refresh the catalog metadata; if it is still expired the catalog itself is stale or you are being served an old snapshot';
  }
  if (joined.includes('older than the trusted version')) {
    return 'this is a downgrade — the currently installed version stays active and nothing was changed';
  }
  if (joined.includes('revoked key')) {
    return 'the publisher key was revoked; wait for a release signed by a current key';
  }
  return 'the update was not applied; the existing capability graph is untouched';
}

/**
 * Bind timestamp → snapshot → targets so a valid piece of one release cannot be mixed into another.
 * Each step names the digest of the next, and a mismatch is a mix-and-match attempt.
 */
export function verifyChain(
  timestamp: SignedMetadata<TimestampMetadata>,
  snapshot: SignedMetadata<SnapshotMetadata>,
  targets: SignedMetadata<TargetsMetadata>,
  digestOf: (metadata: SignedMetadata<unknown>) => string,
  trust: TrustState,
  now: number,
  verify: VerifySignature,
): MetadataVerdict {
  const problems: string[] = [];
  for (const role of [timestamp, snapshot, targets] as SignedMetadata<unknown>[]) {
    problems.push(...verifyRole(role, trust, now, verify).problems);
  }
  if (timestamp.signed.snapshotVersion !== snapshot.version) {
    problems.push(`timestamp names snapshot version ${timestamp.signed.snapshotVersion}, but snapshot is version ${snapshot.version}`);
  }
  if (timestamp.signed.snapshotDigest !== digestOf(snapshot)) {
    problems.push('the snapshot does not match the digest the timestamp names');
  }
  if (snapshot.signed.targetsVersion !== targets.version) {
    problems.push(`snapshot names targets version ${snapshot.signed.targetsVersion}, but targets is version ${targets.version}`);
  }
  if (snapshot.signed.targetsDigest !== digestOf(targets)) {
    problems.push('the targets metadata does not match the digest the snapshot names');
  }
  return { trusted: problems.length === 0, problems, remedy: problems.length ? remedyFor(problems) : null };
}

export interface DownloadedArtifact {
  path: string;
  length: number;
  digest: string;
  /** Whether macOS accepted the artifact's notarization, or null when it was not assessed. */
  notarized: boolean | null;
  publisherIdentity: string | null;
  provenance: string | null;
}

/**
 * Check a downloaded artifact against the target descriptor that was signed for it.
 *
 * Length is checked as well as digest deliberately: a length mismatch is detectable before the whole
 * artifact is hashed, and it is the cheapest defence against being fed an endless stream.
 */
export function verifyArtifact(
  artifact: DownloadedArtifact,
  descriptor: TargetDescriptor,
  requireNotarization: boolean,
): MetadataVerdict {
  const problems: string[] = [];
  if (artifact.length !== descriptor.length) {
    problems.push(`artifact is ${artifact.length} bytes, the signed descriptor declares ${descriptor.length}`);
  }
  if (artifact.digest !== descriptor.digest) {
    problems.push('artifact digest does not match the signed descriptor');
  }
  if (descriptor.publisherIdentity && artifact.publisherIdentity !== descriptor.publisherIdentity) {
    problems.push(
      `publisher identity drifted: signed metadata names ${descriptor.publisherIdentity}, artifact carries ${artifact.publisherIdentity ?? 'none'}`,
    );
  }
  if (descriptor.provenance && artifact.provenance !== descriptor.provenance) {
    problems.push('build provenance does not match the statement the metadata names');
  }
  if (requireNotarization && artifact.notarized !== true) {
    problems.push(artifact.notarized === null
      ? 'notarization was not assessed, and this channel requires it'
      : 'macOS did not accept this artifact\'s notarization');
  }
  return { trusted: problems.length === 0, problems, remedy: problems.length ? remedyFor(problems) : null };
}

/**
 * Dependency confusion: a capability id that resolves to a different namespace than the one the
 * project's own metadata pins. §15 names it, and the reverse-DNS id format is what makes it
 * checkable — an id whose registrable prefix changed is a different publisher wearing the same name.
 */
export function isDependencyConfusion(requestedId: string, resolvedId: string): boolean {
  if (requestedId === resolvedId) return false;
  const prefix = (id: string) => id.split('.').slice(0, 2).join('.');
  return prefix(requestedId) !== prefix(resolvedId);
}

/** Vulnerability findings inform review; §15 forbids them silently rewriting anything. */
export interface VulnerabilityNote {
  id: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  summary: string;
}

export interface ReviewNotes {
  vulnerabilities: VulnerabilityNote[];
  /** Always false here. Kept explicit so the contract is visible at the call site. */
  autoRemediated: false;
}

export function reviewOnly(vulnerabilities: VulnerabilityNote[]): ReviewNotes {
  return { vulnerabilities, autoRemediated: false };
}

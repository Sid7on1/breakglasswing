// Phase 8 slice 5 — trusted package transactions (V29B, S29-B).
//
// Journeys from docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md §26:
//   S29-03 expired / downgraded metadata → activation refused with a recoverable explanation
//   S29-04 archive traversal / bomb → bounded staging rejects it; no escaped write
//   S29-17 failure with dirty state → rollback restores the exact prior capability graph
// plus the §15 rejection list: revoked keys, mix-and-match, identity drift, dependency confusion,
// undeclared executables and overprivilege.

import { CAPABILITY_SCHEMA, CapabilityGraph, CapabilityManifest, parseManifest } from '../capability/manifest';
import {
  SignedMetadata, SnapshotMetadata, TargetsMetadata, TimestampMetadata, TrustState,
  isDependencyConfusion, reviewOnly, verifyArtifact, verifyChain, verifyRole,
} from '../capability/metadata';
import { ArchiveEntry, inspectArchive } from '../capability/staging';
import { CapabilityTransaction, permissionDelta, widensAuthority } from '../capability/transaction';

const PROJECT = '/Users/dev/work/app';
const STAGING = '/Users/dev/Library/Application Support/Bimax/staging/org.example.tool';
const NOW = 1_700_000_000_000;

const manifestFor = (over: Record<string, unknown> = {}): CapabilityManifest => {
  const { manifest, problems } = parseManifest({
    schema: CAPABILITY_SCHEMA,
    id: 'org.example.tool',
    version: '2.0.0',
    kind: 'mcp-service',
    platforms: ['macos-arm64'],
    minimum_macos: '13.0',
    content_digest: `sha256:${'b'.repeat(64)}`,
    publisher_identity: 'Example Inc.',
    provenance: 'slsa:build/1',
    permissions: { filesystem_read: [PROJECT], network: ['api.example.com'] },
    dependencies: [],
    conflicts: [],
    scripts: ['bin/tool'],
    rollback: { previous_version_supported: true },
    ...over,
  }, 'catalog');
  if (!manifest) throw new Error(`fixture manifest invalid: ${problems.join('; ')}`);
  return manifest;
};

const trust = (over: Partial<TrustState> = {}): TrustState => ({
  rootVersion: 1, targetsVersion: 4, snapshotVersion: 4, timestampVersion: 4,
  root: {
    roles: {
      root: { keyIds: ['root-1'], threshold: 1 },
      targets: { keyIds: ['targets-1', 'targets-2'], threshold: 2 },
      snapshot: { keyIds: ['snapshot-1'], threshold: 1 },
      timestamp: { keyIds: ['timestamp-1'], threshold: 1 },
    },
    revokedKeyIds: [],
  },
  ...over,
});

/** Signatures are "valid" when the id is not the literal string `forged`. */
const verify = (keyId: string, signature: string) => signature === `by:${keyId}`;

const signed = <T>(role: SignedMetadata<T>['role'], version: number, expiresAt: number, body: T, keyIds: string[]): SignedMetadata<T> => ({
  role, version, expiresAt, signed: body,
  signatures: keyIds.map(keyId => ({ keyId, signature: `by:${keyId}` })),
});

// --- metadata -----------------------------------------------------------------------------------

describe('S29-03 — expired or downgraded metadata is refused with a recoverable explanation', () => {
  const targets = (over: Partial<SignedMetadata<TargetsMetadata>> = {}) => ({
    ...signed<TargetsMetadata>('targets', 5, NOW + 86_400_000, { targets: {} }, ['targets-1', 'targets-2']),
    ...over,
  });

  it('accepts fresh metadata that meets its threshold', () => {
    expect(verifyRole(targets(), trust(), NOW, verify).trusted).toBe(true);
  });

  it('refuses expired metadata and tells the user what to do', () => {
    const verdict = verifyRole(targets({ expiresAt: NOW - 1 }), trust(), NOW, verify);
    expect(verdict.trusted).toBe(false);
    expect(verdict.problems.join()).toMatch(/expired at/);
    expect(verdict.remedy).toMatch(/refresh the catalog metadata/);
  });

  it('refuses a downgrade and says the installed version stays put', () => {
    const verdict = verifyRole(targets({ version: 3 }), trust(), NOW, verify);
    expect(verdict.problems.join()).toMatch(/older than the trusted version 4/);
    expect(verdict.remedy).toMatch(/downgrade/);
  });

  it('refuses metadata under its signature threshold', () => {
    const verdict = verifyRole(
      signed<TargetsMetadata>('targets', 5, NOW + 1000, { targets: {} }, ['targets-1']),
      trust(), NOW, verify,
    );
    expect(verdict.problems.join()).toMatch(/1 valid signature\(s\) against a threshold of 2/);
  });

  it('does not count a revoked key toward the threshold', () => {
    const verdict = verifyRole(
      targets(), trust({ root: { ...trust().root, revokedKeyIds: ['targets-2'] } }), NOW, verify,
    );
    expect(verdict.trusted).toBe(false);
    expect(verdict.problems.join()).toMatch(/revoked key targets-2/);
    expect(verdict.remedy).toMatch(/publisher key was revoked/);
  });

  it('does not count a signature that fails to verify', () => {
    const forged = targets();
    forged.signatures = [{ keyId: 'targets-1', signature: 'by:targets-1' }, { keyId: 'targets-2', signature: 'forged' }];
    expect(verifyRole(forged, trust(), NOW, verify).problems.join()).toMatch(/targets-2 does not verify/);
  });

  it('reports every problem at once, not one at a time', () => {
    const verdict = verifyRole(targets({ version: 3, expiresAt: NOW - 1 }), trust(), NOW, verify);
    expect(verdict.problems).toHaveLength(2);
  });
});

describe('the timestamp → snapshot → targets chain refuses mix-and-match', () => {
  const digestOf = (metadata: SignedMetadata<unknown>) => `sha256:${metadata.role}-${metadata.version}`;
  const targets = signed<TargetsMetadata>('targets', 5, NOW + 1000, { targets: {} }, ['targets-1', 'targets-2']);
  const snapshot = signed<SnapshotMetadata>('snapshot', 5, NOW + 1000, { targetsVersion: 5, targetsDigest: digestOf(targets) }, ['snapshot-1']);
  const timestamp = signed<TimestampMetadata>('timestamp', 5, NOW + 1000, { snapshotVersion: 5, snapshotDigest: digestOf(snapshot) }, ['timestamp-1']);

  it('accepts a consistent chain', () => {
    expect(verifyChain(timestamp, snapshot, targets, digestOf, trust(), NOW, verify).trusted).toBe(true);
  });

  it('refuses targets from a different snapshot', () => {
    const otherTargets = signed<TargetsMetadata>('targets', 6, NOW + 1000, { targets: {} }, ['targets-1', 'targets-2']);
    const verdict = verifyChain(timestamp, snapshot, otherTargets, digestOf, trust(), NOW, verify);
    expect(verdict.trusted).toBe(false);
    expect(verdict.problems.join()).toMatch(/snapshot names targets version 5, but targets is version 6/);
  });

  it('refuses a snapshot the timestamp does not name', () => {
    const otherSnapshot = signed<SnapshotMetadata>('snapshot', 6, NOW + 1000, { targetsVersion: 5, targetsDigest: digestOf(targets) }, ['snapshot-1']);
    const problems = verifyChain(timestamp, otherSnapshot, targets, digestOf, trust(), NOW, verify).problems.join();
    expect(problems).toMatch(/timestamp names snapshot version 5, but snapshot is version 6/);
    expect(problems).toMatch(/does not match the digest the timestamp names/);
  });

  it('refuses targets the snapshot does not name, even when the timestamp link holds', () => {
    const otherSnapshot = signed<SnapshotMetadata>('snapshot', 5, NOW + 1000, { targetsVersion: 5, targetsDigest: 'sha256:different' }, ['snapshot-1']);
    const problems = verifyChain(timestamp, otherSnapshot, targets, digestOf, trust(), NOW, verify).problems.join();
    expect(problems).toMatch(/targets metadata does not match the digest the snapshot names/);
  });
});

describe('artifact verification checks length, digest, identity, provenance and notarization', () => {
  const descriptor = {
    path: 'tool-2.0.0.tar.gz', length: 1024, digest: `sha256:${'b'.repeat(64)}`,
    publisherIdentity: 'Example Inc.', provenance: 'slsa:build/1',
  };
  const artifact = (over: Record<string, unknown> = {}) => ({
    path: 'tool-2.0.0.tar.gz', length: 1024, digest: `sha256:${'b'.repeat(64)}`,
    notarized: true, publisherIdentity: 'Example Inc.', provenance: 'slsa:build/1', ...over,
  });

  it('accepts a matching artifact', () => {
    expect(verifyArtifact(artifact(), descriptor, true).trusted).toBe(true);
  });

  it.each([
    ['a length mismatch', { length: 4096 }, /1024/],
    ['a digest mismatch', { digest: `sha256:${'c'.repeat(64)}` }, /digest does not match/],
    ['publisher identity drift', { publisherIdentity: 'Someone Else' }, /identity drifted/],
    ['provenance drift', { provenance: 'slsa:build/2' }, /provenance does not match/],
    ['a failed notarization', { notarized: false }, /did not accept/],
    ['an unassessed notarization', { notarized: null }, /was not assessed/],
  ])('refuses %s', (_label, override, expected) => {
    const verdict = verifyArtifact(artifact(override), descriptor, true);
    expect(verdict.trusted).toBe(false);
    expect(verdict.problems.join()).toMatch(expected);
  });

  it('does not require notarization on a channel that does not ask for it', () => {
    expect(verifyArtifact(artifact({ notarized: null }), descriptor, false).trusted).toBe(true);
  });

  it('spots a namespace swap but not an ordinary version bump', () => {
    expect(isDependencyConfusion('org.example.tool', 'org.evil.tool')).toBe(true);
    expect(isDependencyConfusion('org.example.tool', 'org.example.tool')).toBe(false);
    expect(isDependencyConfusion('org.example.tool', 'org.example.tool-beta')).toBe(false);
  });

  it('keeps vulnerability findings review-only', () => {
    const notes = reviewOnly([{ id: 'OSV-2026-1', severity: 'high', summary: 'prototype pollution' }]);
    expect(notes.autoRemediated).toBe(false);
    expect(notes.vulnerabilities).toHaveLength(1);
  });
});

// --- S29-04 -------------------------------------------------------------------------------------

describe('S29-04 — bounded staging rejects a hostile archive before anything is written', () => {
  const entry = (over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
    path: 'bin/tool', size: 1024, compressedSize: 512, type: 'file', executable: true, ...over,
  });

  it('accepts an ordinary archive whose executables the manifest declares', () => {
    const verdict = inspectArchive([entry(), entry({ path: 'README.md', executable: false })], STAGING, ['bin/tool']);
    expect(verdict.accepted).toBe(true);
    expect(verdict.plan).toHaveLength(2);
    expect(verdict.totalBytes).toBe(2048);
  });

  it.each([
    ['path traversal', { path: '../../../.ssh/authorized_keys', executable: false }, 'traversal'],
    ['an absolute path', { path: '/Library/LaunchAgents/x.plist', executable: false }, 'absolute-path'],
    ['a deep traversal disguised by a valid prefix', { path: 'bin/../../../../etc/x', executable: false }, 'traversal'],
    ['an oversized entry', { path: 'big.bin', size: 999_999_999, executable: false }, 'entry-too-large'],
    ['a compression bomb', { path: 'bomb.bin', size: 100_000_000, compressedSize: 1_000, executable: false }, 'compression-bomb'],
    ['an undeclared executable', { path: 'bin/other', executable: true }, 'undeclared-executable'],
  ])('rejects %s and writes nothing', (_label, override, rule) => {
    const verdict = inspectArchive([entry(override)], STAGING, ['bin/tool']);
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejections.map(r => r.rule)).toContain(rule);
    expect(verdict.plan).toEqual([]);
  });

  it('rejects a symlink that escapes via its own directory', () => {
    const verdict = inspectArchive(
      [entry({ path: 'nested/deep/link', type: 'symlink', linkTarget: '../../../../../.ssh/id_rsa', executable: false })],
      STAGING, ['bin/tool'],
    );
    expect(verdict.rejections[0].rule).toBe('symlink-escape');
    // Resolved relative to the link's own directory, which is what makes this case subtle: five
    // levels up from `<staging>/nested/deep` lands outside the staging root.
    expect(verdict.rejections[0].detail)
      .toBe('symlink would point at /Users/dev/Library/Application Support/.ssh/id_rsa, outside the staging root');
  });

  it('allows a symlink that stays inside the staging root', () => {
    const verdict = inspectArchive(
      [entry({ path: 'nested/link', type: 'symlink', linkTarget: '../bin/tool', executable: false })],
      STAGING, ['bin/tool'],
    );
    expect(verdict.accepted).toBe(true);
  });

  it('refuses an archive that expands past the total budget', () => {
    const many = Array.from({ length: 8 }, (_unused, i) => entry({
      path: `part-${i}.bin`, size: 100 * 1024 * 1024, compressedSize: 100 * 1024 * 1024, executable: false,
    }));
    const verdict = inspectArchive(many, STAGING, []);
    expect(verdict.rejections.map(r => r.rule)).toContain('archive-too-large');
    expect(verdict.plan).toEqual([]);
  });

  it('refuses an archive with too many entries', () => {
    const verdict = inspectArchive(
      Array.from({ length: 3 }, (_u, i) => entry({ path: `f-${i}`, executable: false })),
      STAGING, [], { maxTotalBytes: 1e9, maxEntryBytes: 1e9, maxEntries: 2, maxCompressionRatio: 200, maxPathDepth: 32 },
    );
    expect(verdict.rejections[0].rule).toBe('too-many-entries');
  });
});

// --- the transaction ----------------------------------------------------------------------------

describe('the installation transaction cannot be entered halfway', () => {
  const graph = () => new CapabilityGraph({ platform: 'macos-arm64', macosVersion: '14.5' }, () => NOW);
  const good = { trusted: true, problems: [], remedy: null };

  it('refuses to stage before metadata was accepted', () => {
    const tx = new CapabilityTransaction(graph(), manifestFor());
    expect(tx.stage([], STAGING).ok).toBe(false);
    expect(tx.stage([], STAGING).problems.join()).toMatch(/out of order/);
  });

  it('refuses to activate without a health check', () => {
    const tx = new CapabilityTransaction(graph(), manifestFor());
    expect(tx.activate().ok).toBe(false);
  });

  it('walks the whole order and commits', () => {
    const g = graph();
    const tx = new CapabilityTransaction(g, manifestFor());
    expect(tx.acceptMetadata(good).ok).toBe(true);
    expect(tx.resolve('org.example.tool').ok).toBe(true);
    const preview = tx.buildPreview(2048, reviewOnly([]));
    expect(tx.approve(preview).ok).toBe(true);
    expect(tx.verifyArtifact(good).ok).toBe(true);
    expect(tx.stage([{ path: 'bin/tool', size: 1024, compressedSize: 512, type: 'file', executable: true }], STAGING).ok).toBe(true);
    expect(tx.register().ok).toBe(true);
    expect(tx.healthCheck(true, 'entrypoint responded').ok).toBe(true);
    expect(tx.activate().ok).toBe(true);
    expect(tx.currentStep).toBe('committed');
    expect(g.get('org.example.tool')?.state).toBe('healthy');
  });

  it('refuses an approval that does not match the preview it would install', () => {
    const tx = new CapabilityTransaction(graph(), manifestFor());
    tx.acceptMetadata(good);
    tx.resolve('org.example.tool');
    const preview = tx.buildPreview(2048, reviewOnly([]));
    const tampered = { ...preview, diskBytes: 1 };
    const result = tx.approve(tampered);
    expect(result.ok).toBe(false);
    expect(result.problems.join()).toMatch(/does not match what this transaction would install/);
    expect(tx.currentStep).toBe('refused');
  });

  it('refuses a dependency-confused resolution', () => {
    const tx = new CapabilityTransaction(graph(), manifestFor());
    tx.acceptMetadata(good);
    const result = tx.resolve('org.trusted.tool');
    expect(result.ok).toBe(false);
    expect(result.problems.join()).toMatch(/a different namespace/);
  });

  it('refuses an incompatible capability with the reason, not a bare no', () => {
    const g = new CapabilityGraph({ platform: 'macos-x64', macosVersion: '12.0' }, () => NOW);
    const tx = new CapabilityTransaction(g, manifestFor());
    tx.acceptMetadata(good);
    const result = tx.resolve('org.example.tool');
    expect(result.problems.join()).toMatch(/this Mac is macos-x64/);
    expect(result.remedy).toMatch(/resolve the listed constraints/);
  });

  it('leaves the graph untouched when metadata is refused', () => {
    const g = graph();
    const tx = new CapabilityTransaction(g, manifestFor());
    tx.acceptMetadata({ trusted: false, problems: ['expired'], remedy: 'refresh' });
    expect(g.all()).toEqual([]);
    expect(tx.currentStep).toBe('refused');
  });
});

// --- S29-17 -------------------------------------------------------------------------------------

describe('S29-17 — a failed install restores the exact prior capability graph', () => {
  const installed = () => {
    const g = new CapabilityGraph({ platform: 'macos-arm64', macosVersion: '14.5' }, () => NOW);
    const v1 = manifestFor({ version: '1.0.0', permissions: { filesystem_read: [PROJECT] } });
    g.discover(v1);
    g.advance(v1.id, 'verified', 'v1 verified');
    g.advance(v1.id, 'compatible', 'v1 compatible');
    g.advance(v1.id, 'permitted', 'v1 approved');
    g.advance(v1.id, 'activated', 'v1 health check passed');
    g.advance(v1.id, 'healthy', 'v1 reachable');
    return g;
  };

  const runTo = (g: CapabilityGraph, manifest = manifestFor()) => {
    const good = { trusted: true, problems: [], remedy: null };
    const tx = new CapabilityTransaction(g, manifest, { now: () => NOW });
    tx.acceptMetadata(good);
    tx.resolve(manifest.id);
    tx.approve(tx.buildPreview(2048, reviewOnly([])));
    tx.verifyArtifact(good);
    tx.stage([{ path: 'bin/tool', size: 1024, compressedSize: 512, type: 'file', executable: true }], STAGING);
    tx.register();
    return tx;
  };

  it('restores the previous version, state and history when the health check fails', () => {
    const g = installed();
    const before = JSON.parse(JSON.stringify(g.get('org.example.tool')));
    const tx = runTo(g);
    expect(g.get('org.example.tool')?.manifest.version).toBe('2.0.0'); // staged, not yet active

    const result = tx.healthCheck(false, 'the entrypoint did not respond');
    expect(result.ok).toBe(false);

    const after = g.get('org.example.tool')!;
    expect(after.manifest.version).toBe('1.0.0');
    expect(after.state).toBe(before.state);
    expect(after.manifest.permissions).toEqual(before.manifest.permissions);
    // The prior history survives byte-for-byte, with the rollback appended rather than replacing it.
    expect(after.history.slice(0, before.history.length)).toEqual(before.history);
    expect(after.history[after.history.length - 1].reason).toMatch(/rolled back/);
  });

  it('never leaves a half-installed capability reachable when there was no prior version', () => {
    const g = new CapabilityGraph({ platform: 'macos-arm64', macosVersion: '14.5' }, () => NOW);
    const tx = runTo(g);
    tx.healthCheck(false, 'crashed on start');
    const node = g.get('org.example.tool')!;
    expect(node.state).toBe('rollback');
    expect(g.advance('org.example.tool', 'verified', 'try again')).toBe(false);
  });

  it('preserves the rollback target on a successful upgrade', () => {
    const g = installed();
    const tx = runTo(g);
    tx.healthCheck(true, 'ok');
    tx.activate();
    expect(g.get('org.example.tool')?.rollbackTarget).toBe('1.0.0');
    expect(g.get('org.example.tool')?.state).toBe('healthy');
  });

  it('refuses the staged archive without disturbing the installed version', () => {
    const g = installed();
    const before = JSON.parse(JSON.stringify(g.get('org.example.tool')));
    const good = { trusted: true, problems: [], remedy: null };
    const tx = new CapabilityTransaction(g, manifestFor());
    tx.acceptMetadata(good);
    tx.resolve('org.example.tool');
    tx.approve(tx.buildPreview(2048, reviewOnly([])));
    tx.verifyArtifact(good);
    const result = tx.stage([{ path: '../../../evil', size: 10, type: 'file' }], STAGING);
    expect(result.ok).toBe(false);
    expect(result.remedy).toMatch(/nothing was written outside the staging root/);
    expect(g.get('org.example.tool')).toEqual(before);
  });
});

describe('an upgrade cannot widen authority inside a version bump', () => {
  it('reports only the permissions the new version adds', () => {
    const from = manifestFor({ version: '1.0.0', permissions: { filesystem_read: [PROJECT] } });
    const to = manifestFor({ version: '2.0.0', permissions: { filesystem_read: [PROJECT], network: ['api.example.com'], process: ['curl'] } });
    const delta = permissionDelta(from, to);
    expect(delta.reads).toEqual([]);
    expect(delta.hosts).toEqual(['api.example.com']);
    expect(delta.processes).toEqual(['curl']);
    expect(widensAuthority(delta)).toBe(true);
  });

  it('reports nothing new for an upgrade that asks for nothing new', () => {
    const same = { filesystem_read: [PROJECT], network: ['api.example.com'] };
    const delta = permissionDelta(manifestFor({ version: '1.0.0', permissions: same }), manifestFor({ version: '2.0.0', permissions: same }));
    expect(widensAuthority(delta)).toBe(false);
  });

  it('treats a first install as asking for everything it declares', () => {
    expect(widensAuthority(permissionDelta(null, manifestFor()))).toBe(true);
  });
});

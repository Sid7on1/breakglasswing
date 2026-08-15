// Phase 8 completion — causal receipts for every Bimax-owned subsystem, not just engine tools.
//
// The Phase 8 roadmap bullet is "make Bimax-owned engine, MCP, package, browser, Computer Use and
// environment operations emit causal receipts". Engine tools go through the tool factory and are
// graded in evidence.task.guard.test.ts. This file grades the rest: real MCP tool names, capability
// and environment operations, and manifest-bounded MCP calls (S29-05 at the guard layer, matching
// the broker's refusal at the execution layer).

import { TaskGuard, installTaskGuard } from '../evidence/task.guard';
import { RULE_IDS, noEffects, validate } from '../evidence/schema';
import { mapToolCall, mcpArgumentEffects } from '../evidence/operation.map';
import { declaredAuthority, parseManifest, CAPABILITY_SCHEMA } from '../capability/manifest';
import { buildTool } from '../tools/tool.factory';
import { IGovernor } from '../core/interfaces';

const HOME = '/Users/dev';
const PROJECT = '/Users/dev/work/app';
const permissive: IGovernor = { approveTaskExecution: async () => {} } as IGovernor;

const guardFor = () => new TaskGuard('run the unit tests', PROJECT, {
  home: HOME, now: (() => { let t = 1_000; return () => (t += 10); })(),
});

afterEach(() => installTaskGuard(null));

describe('a real MCP tool name lands on the causal timeline', () => {
  it('maps mcp__<server>__<tool> to the mcp subsystem', () => {
    const mapped = mapToolCall('mcp__files__read_file', { path: `${PROJECT}/src/a.ts` }, PROJECT);
    expect(mapped.subsystem).toBe('mcp');
    expect(mapped.operation).toBe('mcp:files/read_file');
    expect(mapped.staticReading).toContain('only its receipt is evidence');
  });

  it('handles a server name containing underscores', () => {
    expect(mapToolCall('mcp__open_computer_use__click', {}, PROJECT).operation)
      .toBe('mcp:open_computer_use/click');
  });

  it('reads paths and hosts out of the model-supplied arguments, nested', () => {
    const effects = mcpArgumentEffects({
      target: { file: `${PROJECT}/src/a.ts` }, endpoint: 'https://api.example.com/v1', note: 'not a path',
    }, PROJECT);
    expect(effects.reads).toEqual([`${PROJECT}/src/a.ts`]);
    expect(effects.hosts).toEqual(['api.example.com']);
  });

  it('does not invent a path out of an ordinary string', () => {
    expect(mcpArgumentEffects({ query: 'read_file', name: 'a.ts' }, PROJECT).reads).toEqual([]);
  });

  it('records an MCP call through the tool factory as an mcp operation with a receipt', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    const tool = buildTool({
      name: 'mcp__files__read_file', description: '', schema: {}, execute: async () => 'contents',
    }, permissive);

    await tool.execute({ path: `${PROJECT}/src/a.ts` }, { cwd: PROJECT });

    const operation = guard.ledger.ofKind('OperationIntent')[0];
    expect(operation.subsystem).toBe('mcp');
    expect(operation.operation).toBe('mcp:files/read_file');
    expect(guard.ledger.ofKind('ActionReceipt')).toHaveLength(1);
    for (const entry of guard.timeline()) expect(validate(entry).ok).toBe(true);
  });

  it('blocks an MCP call whose arguments reach a credential store', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    let ran = false;
    const tool = buildTool({
      name: 'mcp__files__read_file', description: '', schema: {},
      execute: async () => { ran = true; return 'contents'; },
    }, permissive);

    await tool.execute({ path: `${HOME}/.ssh/id_ed25519` }, { cwd: PROJECT });

    expect(ran).toBe(false);
    expect(guard.findings().map(f => f.ruleId)).toContain(RULE_IDS.CREDENTIAL_READ);
  });
});

describe('a capability manifest bounds its MCP server at the guard layer too (S29-05)', () => {
  const manifest = parseManifest({
    schema: CAPABILITY_SCHEMA, id: 'org.example.files', version: '1.0.0', kind: 'mcp-service',
    platforms: ['macos-arm64'], content_digest: `sha256:${'f'.repeat(64)}`,
    publisher_identity: 'Example Inc.',
    permissions: { filesystem_read: [`${PROJECT}/src`], network: ['api.example.com'] },
    dependencies: [], conflicts: [], scripts: [], rollback: { previous_version_supported: true },
  }, 'catalog').manifest!;

  it('raises MANIFEST_EXCEEDED for a read outside the manifest', () => {
    const guard = guardFor();
    guard.registerCapabilityAuthority('mcp:files/', declaredAuthority(manifest));
    const verdict = guard.review('mcp__files__read_file', { path: `${PROJECT}/secrets/prod.env` }, PROJECT);
    expect(verdict.decision.findings.map(f => f.ruleId)).toContain(RULE_IDS.MANIFEST_EXCEEDED);
    expect(verdict.refuse).toBe(true);
  });

  it('stays silent for a read the manifest declares', () => {
    const guard = guardFor();
    guard.registerCapabilityAuthority('mcp:files/', declaredAuthority(manifest));
    const verdict = guard.review('mcp__files__read_file', { path: `${PROJECT}/src/a.ts` }, PROJECT);
    expect(verdict.decision.findings).toEqual([]);
  });

  it('does not apply one server\'s manifest to another server', () => {
    const guard = guardFor();
    guard.registerCapabilityAuthority('mcp:files/', declaredAuthority(manifest));
    const verdict = guard.review('mcp__other__read_file', { path: `${PROJECT}/secrets/prod.env` }, PROJECT);
    expect(verdict.decision.findings.map(f => f.ruleId)).not.toContain(RULE_IDS.MANIFEST_EXCEEDED);
  });

  it('prefers the most specific registered authority', () => {
    const guard = guardFor();
    guard.registerCapabilityAuthority('mcp:', noEffects({ reads: ['/'] }));
    guard.registerCapabilityAuthority('mcp:files/', declaredAuthority(manifest));
    expect(guard.authorityFor('mcp:files/read_file')?.reads).toEqual([`${PROJECT}/src`]);
    expect(guard.authorityFor('mcp:other/read_file')?.reads).toEqual(['/']);
    expect(guard.authorityFor('Bash(npm test)')).toBeNull();
  });
});

describe('capability and environment operations emit the same records as tool calls', () => {
  it('records a capability install as a capability operation', () => {
    const guard = guardFor();
    const verdict = guard.reviewSubsystem(
      'capability', 'capability:install(org.example.tool@2.0.0)',
      noEffects({ writes: [`${PROJECT}/.bimax/capabilities/org.example.tool`] }),
      { actor: { kind: 'capability', id: 'org.example.tool@2.0.0', provenance: 'signed-metadata' } },
    );
    expect(verdict.operation.subsystem).toBe('capability');
    expect(verdict.operation.actor.provenance).toBe('signed-metadata');
    expect(verdict.decision.factors.identityTrust).toBe('signed');
    expect(validate(verdict.decision).ok).toBe(true);
  });

  it('records a read-only environment inventory as an environment operation with no findings', () => {
    const guard = guardFor();
    const verdict = guard.reviewSubsystem(
      'environment', 'environment:inventory',
      noEffects({ reads: [`${PROJECT}/package.json`, '/opt/homebrew/bin/node'], readOnly: true }),
    );
    expect(verdict.operation.subsystem).toBe('environment');
    expect(verdict.decision.findings).toEqual([]);
    expect(verdict.refuse).toBe(false);
  });

  it('refuses a Computer Use operation that reaches a credential store, whatever the task approved', () => {
    const guard = new TaskGuard('open my notes', PROJECT, {
      home: HOME,
      boundary: { readRoots: [HOME], allowCredentialAccess: true },
    });
    const verdict = guard.reviewSubsystem(
      'computer-use', 'mac.read(Keychain Access)',
      noEffects({ reads: [`${HOME}/Library/Keychains/login.keychain-db`] }),
    );
    expect(verdict.decision.disposition).toBe('block');
    expect(verdict.decision.findings[0].violated).toContain('with or without approval');
  });

  it('carries taint from an untrusted source onto the operation', () => {
    const guard = guardFor();
    const verdict = guard.reviewSubsystem(
      'browser', 'Browser(navigate)', noEffects({ hosts: ['docs.example'], readOnly: true }),
      { taint: ['web:docs.example'] },
    );
    expect(verdict.operation.taint).toEqual(['web:docs.example']);
  });

  it('nests a subsystem operation under the tool call that triggered it', () => {
    const guard = guardFor();
    const parent = guard.review('BashTool', { command: 'npm install' }, PROJECT);
    const restore = guard.enter(parent.operation.id);
    const child = guard.reviewSubsystem('package', 'postinstall(analytics-sdk@2.1.0)', noEffects());
    restore();
    expect(guard.ledger.causalPath(child.operation.id).map(o => o.subsystem))
      .toEqual(['package', 'engine-tool']);
  });
});

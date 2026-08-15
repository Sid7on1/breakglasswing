// Phase 8 slice 2 — causal receipts across Bimax-owned operations (S28-A steps 2 and 4).
//
// The unit above this one (evidence.boundary.test.ts) grades the rules. This one grades the wiring:
// that a real tool call through `buildTool` produces an admissible causal record, that the guard
// refuses only the Bimax-owned operation, and — the part that is easy to get wrong — that an engine
// with no guard installed behaves exactly as it did before Phase 8.

import { buildTool } from '../tools/tool.factory';
import { IGovernor } from '../core/interfaces';
import { TaskGuard, TaskGuardOptions, installTaskGuard } from '../evidence/task.guard';
import { RULE_IDS, emptyBoundary, noEffects, validate } from '../evidence/schema';
import { hostTokens, mapToolCall, pathTokens, processTokens } from '../evidence/operation.map';

const HOME = '/Users/dev';
const PROJECT = '/Users/dev/work/app';

const permissive: IGovernor = { approveTaskExecution: async () => {} } as IGovernor;

const guardFor = (over: TaskGuardOptions = {}) => new TaskGuard(
  'run the unit tests', PROJECT,
  { home: HOME, now: (() => { let t = 1_000; return () => (t += 10); })(), ...over },
);

afterEach(() => installTaskGuard(null));

describe('tool-call mapping declares only what it can honestly claim', () => {
  it('extracts path-shaped tokens and never bare words', () => {
    expect(pathTokens('grep -r id_rsa .', PROJECT)).toEqual([]);
    expect(pathTokens('cat ~/.ssh/id_rsa', PROJECT)).toEqual([`${process.env.HOME}/.ssh/id_rsa`]);
  });

  it('reads hosts from URLs only', () => {
    expect(hostTokens('curl https://registry.npmjs.org/pkg -o out')).toEqual(['registry.npmjs.org']);
    expect(hostTokens('echo registry.npmjs.org')).toEqual([]);
  });

  it('names the executables a pipeline launches, skipping env assignments', () => {
    expect(processTokens('FOO=1 npm test | tee out.log')).toEqual(['tee']);
    expect(processTokens('csrutil disable')).toEqual(['csrutil']);
  });

  it('marks a shell command as a static reading, and a file write as observed', () => {
    expect(mapToolCall('BashTool', { command: 'npm test' }, PROJECT).staticReading)
      .toMatch(/read from its text, not observed/);
    expect(mapToolCall('WriteFileTool', { path: 'src/a.ts' }, PROJECT).staticReading).toBeNull();
  });

  it('records a shell command\'s paths as reads, never as invented writes', () => {
    const mapped = mapToolCall('BashTool', { command: `rm -rf ${PROJECT}/dist` }, PROJECT);
    expect(mapped.effects.writes).toEqual([]);
    expect(mapped.effects.deletes).toEqual([]);
    expect(mapped.effects.reads).toEqual([`${PROJECT}/dist`]);
  });

  it('detects a dependency install without claiming to know its targets', () => {
    const mapped = mapToolCall('BashTool', { command: 'npm install left-pad' }, PROJECT);
    expect(mapped.effects.installsDependencies).toBe(true);
    expect(mapped.effects.readOnly).toBe(false);
  });
});

describe('a guarded tool call produces one admissible causal record', () => {
  it('records intent, observation, decision and receipt for an ordinary write', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    const tool = buildTool({
      name: 'WriteFileTool', description: 'write', schema: {},
      execute: async () => 'wrote',
    }, permissive);

    await tool.execute({ path: `${PROJECT}/src/index.ts` }, { cwd: PROJECT });

    const kinds = guard.timeline().map(r => r.kind);
    expect(kinds).toEqual(['TaskIntent', 'OperationIntent', 'Observation', 'Decision', 'ActionReceipt']);
    for (const entry of guard.timeline()) expect(validate(entry).ok).toBe(true);
    expect(guard.findings()).toEqual([]);
  });

  it('binds the receipt to the operation and the operation to the task', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    const tool = buildTool({ name: 'WriteFileTool', description: '', schema: {}, execute: async () => 'ok' }, permissive);
    await tool.execute({ path: `${PROJECT}/src/index.ts` }, { cwd: PROJECT });

    const operation = guard.ledger.ofKind('OperationIntent')[0];
    const receipt = guard.ledger.ofKind('ActionReceipt')[0];
    expect(operation.taskIntentId).toBe(guard.task.id);
    expect(receipt.operationIntentId).toBe(operation.id);
    expect(receipt.outcome).toBe('applied');
    expect(receipt.after.length).toBeGreaterThan(0);
  });

  it('nests a tool called during another tool under it in the causal path', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    const inner = buildTool({ name: 'ReadFileTool', description: '', schema: {}, execute: async () => 'read' }, permissive);
    const outer = buildTool({
      name: 'BashTool', description: '', schema: {},
      execute: async () => { await inner.execute({ path: `${PROJECT}/src/a.ts` }, { cwd: PROJECT }); return 'done'; },
    }, permissive);

    await outer.execute({ command: 'npm test' }, { cwd: PROJECT });

    const operations = guard.ledger.ofKind('OperationIntent');
    const read = operations.find(o => o.operation.startsWith('ReadFileTool'))!;
    expect(guard.ledger.causalPath(read.id).map(o => o.subsystem)).toEqual(['engine-tool', 'engine-tool']);
    expect(guard.ledger.causalPath(read.id)).toHaveLength(2);
    expect(guard.ledger.causalPath(read.id)[1].operation).toContain('Bash(npm test)');
  });
});

describe('the guard refuses the Bimax-owned operation and nothing else (S28-A exit)', () => {
  it('blocks a shell command that reaches for an SSH private key', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    let ran = false;
    const tool = buildTool({
      name: 'BashTool', description: '', schema: {},
      execute: async () => { ran = true; return 'output'; },
    }, permissive);

    const result = await tool.execute({ command: `cat ${HOME}/.ssh/id_ed25519` }, { cwd: PROJECT });

    expect(ran).toBe(false);
    expect(String(result)).toContain('blocked before running');
    expect(String(result)).toContain(RULE_IDS.CREDENTIAL_READ);
    expect(guard.findings().map(f => f.ruleId)).toContain(RULE_IDS.CREDENTIAL_READ);
  });

  it('records that the refusal rested on a declaration, not a measurement', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    const tool = buildTool({ name: 'BashTool', description: '', schema: {}, execute: async () => 'x' }, permissive);
    await tool.execute({ command: `cat ${HOME}/.ssh/id_ed25519` }, { cwd: PROJECT });
    const decision = guard.ledger.ofKind('Decision')[0];
    expect(decision.evidenceBasis).toBe('declared');
    expect(decision.disposition).toBe('block');
    // A declaration is enough to refuse and never enough to repair.
    expect(decision.factors.observationCompleteness.complete).toBe(true);
  });

  it('raises no evidence-gap finding for an ordinary shell command', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    const tool = buildTool({ name: 'BashTool', description: '', schema: {}, execute: async () => 'x' }, permissive);
    await tool.execute({ command: 'npm run lint' }, { cwd: PROJECT });
    expect(guard.findings().map(f => f.ruleId)).not.toContain(RULE_IDS.EVIDENCE_GAP);
    expect(guard.ledger.ofKind('Decision')[0].disposition).toBe('observe');
  });

  it('blocks a command that would change macOS security state', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    let ran = false;
    const tool = buildTool({
      name: 'BashTool', description: '', schema: {},
      execute: async () => { ran = true; return 'x'; },
    }, permissive);
    await tool.execute({ command: 'csrutil disable' }, { cwd: PROJECT });
    expect(ran).toBe(false);
    expect(guard.findings().map(f => f.ruleId)).toContain(RULE_IDS.SECURITY_SETTING_MUTATION);
  });

  it('lets an ordinary test run through untouched', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    let ran = false;
    const tool = buildTool({
      name: 'BashTool', description: '', schema: {},
      execute: async () => { ran = true; return 'all tests passed'; },
    }, permissive);
    const result = await tool.execute({ command: 'npm test' }, { cwd: PROJECT });
    expect(ran).toBe(true);
    expect(result).toBe('all tests passed');
    expect(guard.findings()).toEqual([]);
  });

  it('does not add a second prompt for a merely out-of-boundary write', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    let ran = false;
    const tool = buildTool({
      name: 'WriteFileTool', description: '', schema: {},
      execute: async () => { ran = true; return 'ok'; },
    }, permissive);
    await tool.execute({ path: `${HOME}/Documents/notes.md` }, { cwd: PROJECT });
    // The Governor above owns that decision; the guard records the finding without a second veto.
    expect(ran).toBe(true);
    expect(guard.findings().map(f => f.ruleId)).toContain(RULE_IDS.WRITE_OUTSIDE_BOUNDARY);
  });

  it('records a failed receipt when the tool throws, instead of losing the operation', async () => {
    const guard = guardFor();
    installTaskGuard(guard);
    const tool = buildTool({
      name: 'WriteFileTool', description: '', schema: {},
      execute: async () => { throw new Error('disk full'); },
    }, permissive);
    await expect(tool.execute({ path: `${PROJECT}/src/a.ts` }, { cwd: PROJECT })).rejects.toThrow('disk full');
    const receipt = guard.ledger.ofKind('ActionReceipt')[0];
    expect(receipt.outcome).toBe('failed');
    expect(receipt.reason).toBe('disk full');
  });
});

describe('no guard installed means no behaviour change', () => {
  it('runs the tool and records nothing', async () => {
    installTaskGuard(null);
    let ran = false;
    const tool = buildTool({
      name: 'BashTool', description: '', schema: {},
      execute: async () => { ran = true; return 'output'; },
    }, permissive);
    const result = await tool.execute({ command: `cat ${HOME}/.ssh/id_ed25519` }, { cwd: PROJECT });
    expect(ran).toBe(true);
    expect(result).toBe('output');
  });
});

describe('verification cannot be talked into a positive verdict', () => {
  it('returns unknown when the postcondition rests on a static reading', () => {
    const guard = guardFor();
    const verdict = guard.review('BashTool', { command: 'npm run build' }, PROJECT);
    const result = guard.observe(verdict.operation.id, 'bash', 'applied', verdict.operation.declared, 'done')!;
    const evidence = guard.ledger.ofKind('Observation').filter(o => o.operationIntentId === verdict.operation.id);
    const verification = guard.verify(result.receipt.id, 'the bundle exists', true, evidence);
    expect(verification.basis).toBe('declared');
    expect(verification.satisfied).toBeNull();
    expect(verification.reason).toContain('describe intent rather than an end state');
    expect(validate(verification).ok).toBe(true);
  });

  it('keeps a negative verdict negative even on a declaration', () => {
    const guard = guardFor();
    const verdict = guard.review('BashTool', { command: 'npm run build' }, PROJECT);
    const result = guard.observe(verdict.operation.id, 'bash', 'applied', verdict.operation.declared, 'done')!;
    const evidence = guard.ledger.ofKind('Observation').filter(o => o.operationIntentId === verdict.operation.id);
    expect(guard.verify(result.receipt.id, 'the bundle exists', false, evidence).satisfied).toBe(false);
  });

  it('returns unknown when no observation backs the postcondition at all', () => {
    const guard = guardFor();
    const verdict = guard.review('WriteFileTool', { path: `${PROJECT}/a.ts` }, PROJECT);
    const result = guard.observe(verdict.operation.id, 'write', 'applied', verdict.operation.declared, 'done')!;
    const verification = guard.verify(result.receipt.id, 'the file exists', true, []);
    expect(verification.satisfied).toBeNull();
  });

  it('accepts a positive verdict on fresh, complete evidence', () => {
    const guard = guardFor();
    const verdict = guard.review('WriteFileTool', { path: `${PROJECT}/a.ts` }, PROJECT);
    const result = guard.observe(verdict.operation.id, 'write', 'applied', verdict.operation.declared, 'done')!;
    const evidence = guard.ledger.ofKind('Observation').filter(o => o.operationIntentId === verdict.operation.id);
    expect(evidence.every(o => o.completeness.complete)).toBe(true);
    expect(guard.verify(result.receipt.id, 'the file exists', true, evidence).satisfied).toBe(true);
  });
});

describe('the receipt stage catches what the proposal could not see', () => {
  it('blocks when a declared read-only operation reports mutations', () => {
    const guard = guardFor();
    const verdict = guard.review('ReadFileTool', { path: `${PROJECT}/a.ts` }, PROJECT);
    const result = guard.observe(
      verdict.operation.id, 'read', 'applied',
      noEffects({ writes: [`${PROJECT}/a.ts`] }), 'it wrote',
    )!;
    expect(result.decision?.findings.map(f => f.ruleId)).toContain(RULE_IDS.RECEIPT_CONTRADICTS_INTENT);
    expect(result.decision?.disposition).toBe('block');
  });

  it('does not double-report when the receipt matches the proposal', () => {
    const guard = guardFor();
    const verdict = guard.review('WriteFileTool', { path: `${PROJECT}/a.ts` }, PROJECT);
    const result = guard.observe(verdict.operation.id, 'write', 'applied', verdict.operation.declared, 'done')!;
    expect(result.decision).toBeNull();
    expect(guard.ledger.ofKind('Decision')).toHaveLength(1);
  });

  it('treats a host as known once the task has reached it', () => {
    const guard = new TaskGuard('fetch docs', PROJECT, {
      home: HOME,
      boundary: { readRoots: [PROJECT], writeRoots: [PROJECT], allowNetwork: true, allowedHosts: ['docs.example'] },
    });
    const first = guard.review('WebFetchTool', { url: 'https://cdn.example/page' }, PROJECT);
    expect(first.decision.findings.map(f => f.ruleId)).toContain(RULE_IDS.UNDECLARED_HOST);
    guard.observe(first.operation.id, 'fetch', 'applied', first.operation.declared, 'done');
    const second = guard.review('WebFetchTool', { url: 'https://cdn.example/other' }, PROJECT);
    expect(second.decision.findings).toEqual([]);
  });
});

describe('the task boundary is what the session approved', () => {
  it('defaults to the project root for reads and writes', () => {
    const guard = guardFor();
    expect(guard.task.boundary.writeRoots).toEqual([PROJECT]);
    expect(guard.task.boundary.allowInstall).toBe(false);
    expect(guard.task.boundary.allowCredentialAccess).toBe(false);
  });

  it('cannot be constructed with security-setting permission', () => {
    expect(emptyBoundary({ readRoots: ['/x'] }).allowSecuritySettings).toBe(false);
  });
});

describe('the verdict flag says what the caller must not proceed through', () => {
  it('refuses a hard-floor block', () => {
    const guard = guardFor();
    expect(guard.review('BashTool', { command: `cat ${HOME}/.ssh/id_ed25519` }, PROJECT).refuse).toBe(true);
  });

  it('refuses an out-of-boundary write, which needs an approval the task does not carry', () => {
    const guard = guardFor();
    const verdict = guard.review('WriteFileTool', { path: `${HOME}/Documents/notes.md` }, PROJECT);
    expect(verdict.decision.disposition).toBe('require-approval');
    expect(verdict.refuse).toBe(true);
  });

  it('does not refuse an advisory finding', () => {
    const guard = new TaskGuard('fetch docs', PROJECT, {
      home: HOME,
      boundary: { readRoots: [PROJECT], writeRoots: [PROJECT], allowNetwork: true, allowedHosts: ['docs.example'] },
    });
    const verdict = guard.review('WebFetchTool', { url: 'https://cdn.example/page' }, PROJECT);
    expect(verdict.decision.disposition).toBe('explain');
    expect(verdict.refuse).toBe(false);
  });

  it('does not refuse an ordinary in-boundary write', () => {
    const guard = guardFor();
    expect(guard.review('WriteFileTool', { path: `${PROJECT}/src/a.ts` }, PROJECT).refuse).toBe(false);
  });
});

import {
  FailureMemory, actionFingerprint, operationClass, DEFAULT_BUDGETS,
} from '../core/failure.memory';

// §5 mandate coverage — the FP/FN matrix:
//   TRUE POSITIVES:  same action + same failure repeated past its class budget → exhausted
//   FALSE-POSITIVE guards: changed error resets; different target = different fingerprint;
//                          success clears; new user turn clears; transient classes get patience
//   FALSE-NEGATIVE guards: timestamp/port churn in the target cannot dodge the fingerprint

describe('actionFingerprint', () => {
  test('same action → same fingerprint; different target → different fingerprint', () => {
    const a = actionFingerprint({ tool: 'ReadTool', target: '/src/a.ts' });
    const b = actionFingerprint({ tool: 'ReadTool', target: '/src/a.ts' });
    const c = actionFingerprint({ tool: 'ReadTool', target: '/src/b.ts' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test('numeric churn (timestamps, ports, PIDs ≥4 digits) cannot dodge the fingerprint', () => {
    const a = actionFingerprint({ tool: 'BashTool', target: 'curl localhost:8901/v1?ts=1721000000' });
    const b = actionFingerprint({ tool: 'BashTool', target: 'curl localhost:8902/v1?ts=1721999999' });
    expect(a).toBe(b); // FN guard — retrying with a fresh timestamp is still the same action
  });

  test('extracts the target from args JSON when no explicit target given', () => {
    const a = actionFingerprint({ tool: 'BashTool', args: JSON.stringify({ command: 'npm test' }) });
    const b = actionFingerprint({ tool: 'BashTool', target: 'npm test' });
    expect(a).toBe(b);
  });

  test('small numbers (exit codes, http/2) are NOT normalized away', () => {
    const a = actionFingerprint({ tool: 'BashTool', target: 'git push origin v1' });
    const b = actionFingerprint({ tool: 'BashTool', target: 'git push origin v2' });
    expect(a).not.toBe(b);
  });
});

describe('operationClass', () => {
  test('classifies by tool and shell command shape', () => {
    expect(operationClass('BashTool', 'npm install left-pad')).toBe('install');
    expect(operationClass('BashTool', 'npm run build')).toBe('build');
    expect(operationClass('BashTool', 'npx jest src/x.test.ts')).toBe('test');
    expect(operationClass('BashTool', 'ls -la')).toBe('shell');
    expect(operationClass('WebFetchTool')).toBe('network');
    expect(operationClass('mcp__github__get_pr')).toBe('network');
    expect(operationClass('ReadTool')).toBe('file');
    expect(operationClass('SomethingNew')).toBe('generic');
  });
});

describe('FailureMemory', () => {
  let mem: FailureMemory;
  beforeEach(() => { mem = new FailureMemory(); });

  const fileAction = { tool: 'ReadTool', target: '/missing.txt' };
  const enoent = { ok: false, errorClass: 'ENOENT' };

  test('TP: same action + same failure exhausts at the class budget', () => {
    const budget = DEFAULT_BUDGETS.file; // 2
    let verdict = mem.report(fileAction, enoent);
    expect(verdict.exhausted).toBe(false);
    verdict = mem.report(fileAction, enoent);
    expect(verdict.repeatCount).toBe(budget);
    expect(verdict.exhausted).toBe(true);
    expect(verdict.note).toContain('failed 2 times');
  });

  test('FP guard: a CHANGED failure resets the counter (the world moved)', () => {
    mem.report(fileAction, enoent);
    const changed = mem.report(fileAction, { ok: false, errorClass: 'EACCES' });
    expect(changed.repeatCount).toBe(1); // different error — retrying was legitimate
    expect(changed.exhausted).toBe(false);
  });

  test('FP guard: different result content resets the counter even with same errorClass', () => {
    mem.report(fileAction, { ok: false, errorClass: 'ERR', resultSample: 'missing symbol foo' });
    const v = mem.report(fileAction, { ok: false, errorClass: 'ERR', resultSample: 'missing symbol bar' });
    expect(v.repeatCount).toBe(1);
  });

  test('FP guard: success wipes the slate for that action', () => {
    mem.report(fileAction, enoent);
    mem.report(fileAction, { ok: true });
    expect(mem.countFor(fileAction)).toBe(0);
    expect(mem.report(fileAction, enoent).repeatCount).toBe(1);
  });

  test('FP guard: similar action on a DIFFERENT target has its own budget', () => {
    mem.report(fileAction, enoent);
    const other = mem.report({ tool: 'ReadTool', target: '/other.txt' }, enoent);
    expect(other.repeatCount).toBe(1); // separate fingerprint, separate count
  });

  test('FP guard: a new user turn resets all counters (user-requested repetition)', () => {
    mem.report(fileAction, enoent);
    mem.report(fileAction, enoent);
    mem.newUserTurn();
    const v = mem.report(fileAction, enoent);
    expect(v.repeatCount).toBe(1);
    expect(v.exhausted).toBe(false);
  });

  test('transient error classes earn extra patience (+2)', () => {
    const net = { tool: 'WebFetchTool', target: 'https://api.example.com' };
    const to = { ok: false, errorClass: 'ETIMEDOUT' };
    const base = DEFAULT_BUDGETS.network; // 4
    let v = { exhausted: false, repeatCount: 0, budget: 0 } as any;
    for (let i = 0; i < base + 1; i++) v = mem.report(net, to);
    expect(v.exhausted).toBe(false); // base budget alone would have tripped by now
    expect(v.budget).toBe(base + 2);
    v = mem.report(net, to);
    expect(v.exhausted).toBe(true);
  });

  test('transient detection also reads the result sample when errorClass is silent', () => {
    const net = { tool: 'WebFetchTool', target: 'https://x.test' };
    const v = mem.report(net, { ok: false, resultSample: 'HTTP 429 rate limit exceeded' });
    expect(v.budget).toBe(DEFAULT_BUDGETS.network + 2);
  });

  test('deterministic build failures trip fast (budget 2)', () => {
    const build = { tool: 'BashTool', target: 'npm run build', args: JSON.stringify({ command: 'npm run build' }) };
    mem.report(build, { ok: false, exitCode: 2, resultSample: 'TS2322 type error' });
    const v = mem.report(build, { ok: false, exitCode: 2, resultSample: 'TS2322 type error' });
    expect(v.exhausted).toBe(true);
    expect(v.note).toContain('build');
  });

  test('setBudget overrides a class budget', () => {
    mem.setBudget('file', 5);
    for (let i = 0; i < 4; i++) expect(mem.report(fileAction, enoent).exhausted).toBe(false);
    expect(mem.report(fileAction, enoent).exhausted).toBe(true);
  });

  test('alternating failures across two targets never falsely exhaust either', () => {
    const a = { tool: 'BashTool', target: 'cmd-a' };
    const b = { tool: 'BashTool', target: 'cmd-b' };
    for (let i = 0; i < 2; i++) {
      expect(mem.report(a, { ok: false, errorClass: 'E1' }).exhausted).toBe(false);
      expect(mem.report(b, { ok: false, errorClass: 'E2' }).exhausted).toBe(false);
      mem.report(a, { ok: true });
      mem.report(b, { ok: true });
    }
  });
});

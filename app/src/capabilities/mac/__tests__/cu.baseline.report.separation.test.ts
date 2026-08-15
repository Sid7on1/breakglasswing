/**
 * Phase 2, item 6 — native and compatibility baselines are reported separately and never combined.
 *
 * `07_MIGRATION_ROADMAP.md` Phase 2: "Run native and compatibility baselines separately; never
 * combine their numbers."
 * `08_ACCEPTANCE_GATES.md`, Desktop computer-use gate: "native arbitrary-task evaluation is
 * reported separately from the narrow exact-state benchmark".
 * `06_HEAD_TO_HEAD_EVALS.md` / gates for every product change: "claims name product, backend,
 * model, build, run count, discarded count, and raw artifact."
 *
 * The failure this guards is a reporting failure, not a runtime one: one pass rate that describes
 * no single system. It is the same class of error the existing model-change disqualifier catches.
 */
import fs from 'node:fs';
import path from 'node:path';

import { buildReport, backendOf, UNATTRIBUTED_BACKEND } from '../../../../scripts/computer-use/benchmark-cu-baseline';

const META = { model: 'm', commit: 'abc1234', macos: '25.5.0', arch: 'arm64', startedAt: '2026-08-09T00:00:00.000Z' };

type M = Parameters<typeof buildReport>[0][number];

/** A valid, attributed measurement. Fields the report reads are all present. */
function run(over: Partial<M> = {}): M {
  return {
    task: 'form-textfield',
    taskClass: 'form',
    passed: true,
    detail: 'ok',
    turns: 5,
    toolCalls: 4,
    toolCallsByName: { ComputerTool: 4 },
    promptTokens: 1000,
    wallClockMs: 10_000,
    model: 'm',
    backend: 'compatibility',
    ...over,
  } as M;
}

/** Three passing runs of one class on one backend — the minimum a frozen baseline needs. */
function healthySuite(backend: string, taskClass: M['taskClass'] = 'form'): M[] {
  return [0, 1, 2].map((i) => run({ backend, taskClass, task: `${taskClass}-${i}` }));
}

const markdown = (measurements: M[]): string => buildReport(measurements, META).markdown;

describe('rows are separated by executor', () => {
  test('two backends never share a row, even for the same task class', () => {
    const md = markdown([...healthySuite('native'), ...healthySuite('compatibility')]);
    expect(md).toMatch(/\|\s*native\s*\|\s*form\s*\|\s*3\s*\|/);
    expect(md).toMatch(/\|\s*compatibility\s*\|\s*form\s*\|\s*3\s*\|/);
    // The combined count must appear nowhere.
    expect(md).not.toMatch(/\|\s*form\s*\|\s*6\s*\|/);
  });

  test('the backend is a column, so a quoted row always names its executor', () => {
    const md = markdown(healthySuite('native'));
    expect(md).toContain('| backend | task class |');
    expect(md).toMatch(/\|\s*native\s*\|/);
  });

  test('pass rates are per backend, not pooled', () => {
    const md = markdown([
      ...[0, 1, 2].map((i) => run({ backend: 'native', task: `n${i}`, passed: true })),
      ...[0, 1, 2].map((i) => run({ backend: 'compatibility', task: `c${i}`, passed: false })),
    ]);
    expect(md).toMatch(/native\s*\|\s*form\s*\|\s*3\s*\|\s*3\/3/);
    expect(md).toMatch(/compatibility\s*\|\s*form\s*\|\s*3\s*\|\s*0\/3/);
    // A pooled 3/6 would be the dishonest number.
    expect(md).not.toContain('3/6');
  });
});

describe('a mixed-executor suite is never a frozen baseline', () => {
  test('mixing native and compatibility disqualifies the suite and says why', () => {
    const md = markdown([...healthySuite('native'), ...healthySuite('compatibility')]);
    expect(md).toContain('PROVISIONAL');
    expect(md).toMatch(/mixed 2 executors/);
    expect(md).not.toMatch(/^> Frozen baseline/m);
  });

  test('a single-executor healthy suite still qualifies, and names the executor it is for', () => {
    const md = markdown(healthySuite('native'));
    expect(md).not.toContain('PROVISIONAL');
    expect(md).toContain('Frozen baseline');
    expect(md).toContain('native');
    // It must not read as a baseline for the product in general.
    expect(md).toMatch(/executor only|for this executor/i);
  });
});

describe('an unattributed run is never folded into an attributed one', () => {
  test('a measurement with no backend becomes its own group', () => {
    const md = markdown([...healthySuite('compatibility'), run({ backend: undefined, task: 'form-checkbox' })]);
    expect(md).toMatch(new RegExp(`\\|\\s*${UNATTRIBUTED_BACKEND}\\s*\\|\\s*form\\s*\\|\\s*1\\s*\\|`));
    // The compatibility row keeps its own three runs — the unknown one did not join it.
    expect(md).toMatch(/compatibility\s*\|\s*form\s*\|\s*3\s*\|/);
  });

  test('an unattributed run disqualifies the suite and names the task', () => {
    const md = markdown([...healthySuite('compatibility'), run({ backend: undefined, task: 'form-checkbox' })]);
    expect(md).toContain('PROVISIONAL');
    expect(md).toMatch(/recorded no backend/);
    expect(md).toContain('form-checkbox');
  });

  test('blank and whitespace-only backends count as unattributed, not as a distinct executor', () => {
    expect(backendOf(run({ backend: '' }))).toBe(UNATTRIBUTED_BACKEND);
    expect(backendOf(run({ backend: '   ' }))).toBe(UNATTRIBUTED_BACKEND);
    expect(backendOf(run({ backend: undefined }))).toBe(UNATTRIBUTED_BACKEND);
    expect(backendOf(run({ backend: 'native' }))).toBe('native');
  });
});

describe('the existing guarantees still hold', () => {
  test('a model change still disqualifies', () => {
    const md = markdown([...healthySuite('native'), run({ backend: 'native', model: 'other', task: 'x' })]);
    expect(md).toContain('PROVISIONAL');
    expect(md).toMatch(/work model changed/);
  });

  test('discarded runs are still excluded from the medians and reported', () => {
    const md = markdown([
      ...healthySuite('native'),
      run({ backend: 'native', task: 'dead', invalid: 'provider outage', turns: 0 }) as M,
    ]);
    expect(md).toMatch(/DISCARDED, not measured/);
    // The invalid run must not inflate the run count of the native form row.
    expect(md).toMatch(/native\s*\|\s*form\s*\|\s*3\s*\|/);
  });

  test('a thin class still disqualifies', () => {
    const md = markdown([run({ backend: 'native' })]);
    expect(md).toContain('PROVISIONAL');
    expect(md).toMatch(/fewer than 3 valid runs/);
  });
});

describe('the real frozen v1.1.0 record', () => {
  const file = path.resolve(__dirname, '..', '..', 'benchmarks', 'cu-baseline', 'frozen-v1.1.0.json');

  test('is correctly refused as a frozen baseline, because it contains an unattributed run', () => {
    // Evidence, not a hypothetical: this record has 14 `compatibility` measurements and one with no
    // backend at all (`form-checkbox`). Before this change the report merged it into the
    // compatibility form class — printing `form 2/6` — and still declared "Frozen baseline".
    if (!fs.existsSync(file)) return;
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as { measurements: M[]; meta: Record<string, string> };
    const md = buildReport(record.measurements, record.meta).markdown;

    expect(md).toContain('PROVISIONAL');
    expect(md).toMatch(/recorded no backend/);
    expect(md).toContain('form-checkbox');
    // The compatibility numbers survive, attributed and unpooled.
    expect(md).toMatch(/compatibility\s*\|\s*form\s*\|\s*5\s*\|\s*2\/5/);
    expect(md).toMatch(new RegExp(`${UNATTRIBUTED_BACKEND}\\s*\\|\\s*form\\s*\\|\\s*1\\s*\\|\\s*0\\/1`));
    // The old pooled figure must not reappear.
    expect(md).not.toContain('2/6');
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarnessTuner, __setHarnessTuner } from '../mind/harness.tuner';
import { EventLedger, __setEventLedger, getEventLedger } from '../mind/event.ledger';

/**
 * Harness self-tuner: recurring failure signatures in the event ledger become steering patches;
 * patches that measurably don't help are auto-retired.
 *
 * This suite pins BIMAX_HARNESS_LAB=0 (the legacy immediate-activation escape hatch): it tests
 * the MINING mechanics — thresholds, dedupe, live effectiveness accounting — independent of the
 * counterfactual gate. The staged/lab lifecycle is covered in harness.lab.test.ts.
 */
describe('HarnessTuner', () => {
  let dir: string;
  let tuner: HarnessTuner;

  beforeEach(() => {
    process.env.BIMAX_HARNESS_LAB = '0';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-tuner-'));
    __setEventLedger(new EventLedger(dir));
    tuner = new HarnessTuner(dir);
    __setHarnessTuner(tuner);
  });

  afterEach(() => {
    delete process.env.BIMAX_HARNESS_LAB;
    __setEventLedger(null);
    __setHarnessTuner(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const fail = (tool: string, errorClass: string) =>
    getEventLedger().append('tool_outcome', { tool, status: 'error', errorClass, isError: true });
  const ok = (tool: string) =>
    getEventLedger().append('tool_outcome', { tool, status: 'ok', isError: false });

  it('creates a patch once a failure signature recurs enough', () => {
    for (let i = 0; i < 4; i++) fail('EditFileTool', 'no_match');
    ok('EditFileTool');

    const r = tuner.mine();
    expect(r.created).toBe(1);
    const patches = tuner.all();
    expect(patches).toHaveLength(1);
    expect(patches[0].tool).toBe('EditFileTool');
    expect(patches[0].errorClass).toBe('no_match');
    expect(patches[0].status).toBe('active');
    expect(patches[0].baselineRate).toBeCloseTo(0.8); // 4 failures / 5 calls

    const block = tuner.getPromptBlock();
    expect(block).toContain('HARNESS PATCHES');
    expect(block).toContain('EditFileTool');
  });

  it('ignores signatures below the evidence threshold', () => {
    fail('BashTool', 'timeout');
    fail('BashTool', 'timeout');
    ok('BashTool');
    expect(tuner.mine().created).toBe(0);
    expect(tuner.getPromptBlock()).toBe('');
  });

  it('does not duplicate a patch for the same signature', () => {
    for (let i = 0; i < 5; i++) fail('BashTool', 'timeout');
    expect(tuner.mine().created).toBe(1);
    for (let i = 0; i < 3; i++) fail('BashTool', 'timeout');
    expect(tuner.mine().created).toBe(0);
    expect(tuner.all().filter(p => p.status === 'active')).toHaveLength(1);
  });

  it('auto-retires a patch whose failure rate never improved', () => {
    for (let i = 0; i < 4; i++) fail('EditFileTool', 'no_match');
    tuner.mine();
    // Backdate the patch so post-patch events count against it.
    const p = tuner.all()[0];
    (p as any).createdAt = Date.now() - 60_000;
    (p as any).activatedAt = Date.now() - 60_000;

    // 10 post-patch samples, all failures — no improvement over the (80%+) baseline.
    for (let i = 0; i < 10; i++) fail('EditFileTool', 'no_match');
    const r = tuner.mine();
    expect(r.retired).toBe(1);
    expect(tuner.all()[0].status).toBe('retired');
    expect(tuner.getPromptBlock()).toBe(''); // retired patches never spend prompt tokens
  });

  it('keeps a patch that IS helping (failure rate dropped)', () => {
    for (let i = 0; i < 4; i++) fail('EditFileTool', 'no_match');
    tuner.mine();
    const p = tuner.all()[0];
    (p as any).createdAt = Date.now() - 60_000;
    (p as any).activatedAt = Date.now() - 60_000;

    // 12 post-patch samples, only 1 failure — clearly better than the ~100% baseline window.
    for (let i = 0; i < 11; i++) ok('EditFileTool');
    fail('EditFileTool', 'no_match');
    const r = tuner.mine();
    expect(r.retired).toBe(0);
    expect(tuner.all().find(x => x.tool === 'EditFileTool')!.status).toBe('active');
  });

  it('persists patches across instances', () => {
    for (let i = 0; i < 4; i++) fail('BashTool', 'timeout');
    tuner.mine();
    const fresh = new HarnessTuner(dir);
    expect(fresh.all()).toHaveLength(1);
    expect(fresh.getPromptBlock()).toContain('BashTool');
  });

  it('manual retire drops the patch from the prompt', () => {
    for (let i = 0; i < 4; i++) fail('BashTool', 'timeout');
    tuner.mine();
    const id = tuner.all()[0].id;
    expect(tuner.retire(id)).toBe(true);
    expect(tuner.getPromptBlock()).toBe('');
    expect(tuner.retire(id)).toBe(false); // already retired
  });

  describe('counterfactual gate default (BIMAX_HARNESS_LAB unset)', () => {
    it('mines patches as STAGED — no live prompt injection before a lab verdict', () => {
      delete process.env.BIMAX_HARNESS_LAB;
      for (let i = 0; i < 4; i++) fail('EditFileTool', 'no_match');
      const r = tuner.mine();
      expect(r.created).toBe(1);
      const p = tuner.all()[0];
      expect(p.status).toBe('staged');
      expect(p.stagedAt).toBeDefined();
      expect(tuner.getPromptBlock()).toBe(''); // staged patches spend zero prompt tokens
    });

    it('re-enabling legacy mode promotes previously staged patches on the next pass', () => {
      delete process.env.BIMAX_HARNESS_LAB;
      for (let i = 0; i < 4; i++) fail('EditFileTool', 'no_match');
      tuner.mine();
      expect(tuner.all()[0].status).toBe('staged');

      process.env.BIMAX_HARNESS_LAB = '0';
      tuner.mine();
      const p = tuner.all()[0];
      expect(p.status).toBe('active');
      expect(p.activatedBy).toBe('legacy');
      expect(tuner.getPromptBlock()).toContain('EditFileTool');
    });
  });
});

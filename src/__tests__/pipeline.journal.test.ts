import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PipelineJournal, foldRuns, incompleteRuns } from '../core/pipeline.journal';
import { EventLedger } from '../mind/event.ledger';

describe('durable pipelines (v2 §3.10) — journaled, crash-resumable state machines', () => {
  let dir: string;
  let ledger: EventLedger;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-journal-'));
    ledger = new EventLedger(dir);
  });
  afterEach(() => {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a completed run journals every transition and closes', async () => {
    const j = PipelineJournal.open('beast', 'add-auth', ledger);
    expect(j.resumed).toBe(false);
    const a = await j.step('swarm', async () => ({ branch: 'swarm/x', ok: 3 }));
    expect(a).toEqual({ branch: 'swarm/x', ok: 3 });
    await j.step('heal', async () => ({ healed: true }));
    j.finish(true);

    const run = foldRuns(ledger, 'beast')['add-auth'];
    expect(run.finished).toBe(true);
    expect(run.failed).toBe(false);
    expect(run.steps['swarm']).toMatchObject({ done: true, resumable: true, result: { branch: 'swarm/x', ok: 3 } });
    expect(incompleteRuns('beast', ledger)).toHaveLength(0);
  });

  it('CRASH RECOVERY: a re-opened run serves completed steps from the journal and re-runs the rest', async () => {
    // Run 1 "crashes" after swarm (never calls finish).
    const j1 = PipelineJournal.open('beast', 'add-auth', ledger);
    let swarmExecutions = 0;
    await j1.step('swarm', async () => { swarmExecutions++; return { branch: 'swarm/x' }; });
    await expect(j1.step('heal', async () => { throw new Error('worker died'); })).rejects.toThrow('worker died');

    expect(incompleteRuns('beast', ledger)).toHaveLength(1);

    // Run 2 with the same key RESUMES: swarm's recorded result comes back without executing.
    const j2 = PipelineJournal.open('beast', 'add-auth', ledger);
    expect(j2.resumed).toBe(true);
    expect(j2.run).toBe('add-auth');
    const swarmed = await j2.step('swarm', async () => { swarmExecutions++; return { branch: 'NEVER' }; });
    expect(swarmed).toEqual({ branch: 'swarm/x' });
    expect(swarmExecutions).toBe(1); // the step did NOT re-execute
    const heal = await j2.step('heal', async () => ({ healed: true })); // failed step re-runs
    expect(heal).toEqual({ healed: true });
    j2.finish(true);
    expect(incompleteRuns('beast', ledger)).toHaveLength(0);
  });

  it('a finished run does NOT resume — the same goal starts a fresh numbered run', async () => {
    const j1 = PipelineJournal.open('beast', 'add-auth', ledger);
    await j1.step('swarm', async () => 1);
    j1.finish(true);
    const j2 = PipelineJournal.open('beast', 'add-auth', ledger);
    expect(j2.resumed).toBe(false);
    expect(j2.run).toBe('add-auth@2');
  });

  it('oversized/unserializable results are recorded done but NOT resumable — the step re-runs honestly', async () => {
    const j1 = PipelineJournal.open('p', 'k', ledger);
    let runs = 0;
    await j1.step('big', async () => { runs++; return { blob: 'x'.repeat(20_000) }; });
    // crash…
    const j2 = PipelineJournal.open('p', 'k', ledger);
    await j2.step('big', async () => { runs++; return { blob: 'fresh' }; });
    expect(runs).toBe(2);
  });

  it('step failures are journaled with their error for the /pipelines view', async () => {
    const j = PipelineJournal.open('p', 'k', ledger);
    await j.step('a', async () => 'ok');
    await expect(j.step('b', async () => { throw new Error('disk full'); })).rejects.toThrow();
    const run = foldRuns(ledger, 'p')['k'];
    expect(run.steps['b'].failed).toBe('disk full');
    expect(run.lastStep).toBe('b');
  });
});

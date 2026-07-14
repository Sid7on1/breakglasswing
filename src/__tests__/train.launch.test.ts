import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { BlueprintEngine } from '../blueprints/blueprint.engine';
import { BlueprintCompiler } from '../blueprints/blueprint.compiler';
import { TrainLauncher } from '../training/train.launcher';
import { TrainMonitor } from '../training/train.monitor';

// End-to-end for the LLM "Build → launch → monitor" path. Uses the dependency-free --smoke run so it
// needs nothing but a python3 interpreter; skipped cleanly if none is present.
function hasPython(): boolean {
  try { execSync('python3 --version', { stdio: 'ignore' }); return true; } catch { return false; }
}
const maybe = hasPython() ? describe : describe.skip;

describe('BlueprintCompiler (LLM, real HF fields)', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmx-llm-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('emits HF-style config + runnable train.py, honoring attention/FFN choices', () => {
    const eng = new BlueprintEngine(root);
    const bp = eng.create('train a small code model from scratch', 'llm');
    eng.select(bp.slug, 'arch', 'small');
    eng.select(bp.slug, 'attention', 'gqa');
    eng.select(bp.slug, 'ffn', 'moe');
    eng.override(bp.slug, 'attention', 'keep MLA KV-cache from the MLA option');
    const compiler = new BlueprintCompiler(root);
    const res = compiler.compile(eng.load(bp.slug)!);

    const names = res.files.map(f => f.path).sort();
    expect(names).toEqual(['README.md', 'eval.py', 'requirements.txt', 'train.py', 'train_config.yaml'].sort());

    const cfg = res.files.find(f => f.path === 'train_config.yaml')!.content;
    expect(cfg).toMatch(/num_hidden_layers: 16/);
    expect(cfg).toMatch(/num_attention_heads: 12/);
    expect(cfg).toMatch(/num_key_value_heads: 3/);     // GQA = heads/4
    expect(cfg).toMatch(/hidden_size: 1536/);
    expect(cfg).toMatch(/model_type: mixtral/);        // MoE ⇒ mixtral config
    expect(cfg).toMatch(/num_local_experts: 8/);
    expect(cfg).toMatch(/lr_scheduler_type: cosine/);  // TrainingArguments field
    expect(cfg).toMatch(/honor verbatim|keep MLA KV-cache/i); // override preserved
  });

  it('maps MQA to a single KV head', () => {
    const eng = new BlueprintEngine(root);
    const bp = eng.create('mqa model', 'llm');
    eng.select(bp.slug, 'arch', 'medium');
    eng.select(bp.slug, 'attention', 'mqa');
    const res = new BlueprintCompiler(root).compile(eng.load(bp.slug)!);
    const cfg = res.files.find(f => f.path === 'train_config.yaml')!.content;
    expect(cfg).toMatch(/num_key_value_heads: 1/);
  });
});

maybe('TrainLauncher (smoke launch → metrics → monitor)', () => {
  let root: string;
  let active: Array<{ launcher: TrainLauncher; run: string }>;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmx-launch-'));
    active = [];
  });
  afterEach(async () => {
    for (const item of active) item.launcher.stop(item.run);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && active.some(item => {
      const status = item.launcher.status(item.run);
      return !('error' in status) && status.running;
    })) await new Promise(resolve => setTimeout(resolve, 50));
    // macOS may briefly retain a directory entry while the child closes its log descriptor.
    for (let attempt = 0; attempt < 10; attempt++) {
      try { fs.rmSync(root, { recursive: true, force: true }); break; }
      catch (error: any) {
        if (attempt === 9 || !['ENOTEMPTY', 'EBUSY'].includes(error?.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  });

  it('launches the scaffold and writes metrics the monitor reads as healthy', async () => {
    const eng = new BlueprintEngine(root);
    const bp = eng.create('tiny model', 'llm');
    eng.select(bp.slug, 'arch', 'small');
    new BlueprintCompiler(root).compile(eng.load(bp.slug)!);

    const launcher = new TrainLauncher(root);
    const dir = path.join('.bimax', 'builds', bp.slug);
    const r = launcher.launch(bp.slug, dir, { smoke: true });
    expect('error' in r ? r.error : r.pid).toBeTruthy();
    if (!('error' in r)) active.push({ launcher, run: bp.slug });

    const metrics = path.join(root, dir, 'metrics.jsonl');
    const readiness = await launcher.waitUntilReady(bp.slug, { timeoutMs: 30_000, minMetricsLines: 5 });
    expect('error' in readiness ? readiness.error : readiness.reason).toBeTruthy();
    expect(!('error' in readiness) && readiness.ready).toBe(true);

    const mon = new TrainMonitor(root);
    mon.watch(bp.slug, metrics);
    const status = await mon.status(bp.slug);
    expect('error' in status ? status.error : status.points).toBeGreaterThan(0);
    if (!('error' in status)) {
      expect(typeof status.latest?.loss).toBe('number');
      expect(status.lossTrend).toBe('down');
    }
  }, 35000);

  it('reports a clean error when train.py is missing', () => {
    const launcher = new TrainLauncher(root);
    const r = launcher.launch('nope', '.bimax/builds/nope', { smoke: true });
    expect('error' in r && /train\.py/.test(r.error)).toBe(true);
  });

  it('rejects unsafe run names and does not treat stale metrics as current readiness', async () => {
    const launcher = new TrainLauncher(root);
    const unsafe = launcher.launch('../escape', '.bimax/builds/nope', { smoke: true });
    expect('error' in unsafe && /Run names/.test(unsafe.error)).toBe(true);

    const eng = new BlueprintEngine(root);
    const bp = eng.create('stale metric model', 'llm');
    eng.select(bp.slug, 'arch', 'small');
    new BlueprintCompiler(root).compile(eng.load(bp.slug)!);
    const dir = path.join('.bimax', 'builds', bp.slug);
    const metrics = path.join(root, dir, 'metrics.jsonl');
    fs.writeFileSync(metrics, '{"step":999,"loss":0.01}\n', 'utf8');

    const launched = launcher.launch(bp.slug, dir, { smoke: true });
    expect('error' in launched ? launched.error : launched.pid).toBeTruthy();
    if (!('error' in launched)) active.push({ launcher, run: bp.slug });
    const ready = await launcher.waitUntilReady(bp.slug, { timeoutMs: 30_000, minMetricsLines: 5 });
    expect(!('error' in ready) && ready.ready).toBe(true);
    if (!('error' in ready)) expect(ready.status.metricsLines).toBeGreaterThanOrEqual(6);
  }, 35_000);

  it('runs eval.py --smoke and writes perplexity to eval_results.json', async () => {
    const eng = new BlueprintEngine(root);
    const bp = eng.create('tiny eval model', 'llm');
    eng.select(bp.slug, 'arch', 'small');
    new BlueprintCompiler(root).compile(eng.load(bp.slug)!);
    const dir = path.join('.bimax', 'builds', bp.slug);
    const launcher = new TrainLauncher(root);

    // Train smoke first so metrics.jsonl exists, then eval derives perplexity from it.
    const trained = launcher.launch(bp.slug, dir, { smoke: true });
    if (!('error' in trained)) active.push({ launcher, run: bp.slug });
    const metrics = path.join(root, dir, 'metrics.jsonl');
    const trainReady = await launcher.waitUntilReady(bp.slug, { timeoutMs: 30_000, minMetricsLines: 5 });
    expect(!('error' in trainReady) && trainReady.ready).toBe(true);

    const ev = launcher.launch(`${bp.slug}-eval`, dir, { smoke: true, script: 'eval.py' });
    expect('error' in ev ? ev.error : ev.script).toBe('eval.py');
    if (!('error' in ev)) active.push({ launcher, run: `${bp.slug}-eval` });
    const resultsPath = path.join(root, dir, 'eval_results.json');
    const evalReady = await launcher.waitUntilReady(`${bp.slug}-eval`, { timeoutMs: 30_000 });
    expect(!('error' in evalReady) && evalReady.ready).toBe(true);
    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    expect(typeof results.perplexity).toBe('number');
    expect(results.perplexity).toBeGreaterThan(1);

    const st = launcher.status(`${bp.slug}-eval`);
    expect('error' in st ? st.error : st.results?.perplexity).toBeGreaterThan(1);
  }, 65000);
});

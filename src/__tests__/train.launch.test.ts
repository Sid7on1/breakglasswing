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
    expect(names).toEqual(['README.md', 'requirements.txt', 'train.py', 'train_config.yaml'].sort());

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
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmx-launch-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const waitFor = async (fn: () => boolean, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 100)); }
    return fn();
  };

  it('launches the scaffold and writes metrics the monitor reads as healthy', async () => {
    const eng = new BlueprintEngine(root);
    const bp = eng.create('tiny model', 'llm');
    eng.select(bp.slug, 'arch', 'small');
    new BlueprintCompiler(root).compile(eng.load(bp.slug)!);

    const launcher = new TrainLauncher(root);
    const dir = path.join('.bimax', 'builds', bp.slug);
    const r = launcher.launch(bp.slug, dir, { smoke: true });
    expect('error' in r ? r.error : r.pid).toBeTruthy();

    const metrics = path.join(root, dir, 'metrics.jsonl');
    const ok = await waitFor(() => fs.existsSync(metrics) && fs.readFileSync(metrics, 'utf8').split('\n').filter(Boolean).length >= 5);
    expect(ok).toBe(true);

    const mon = new TrainMonitor(root);
    mon.watch(bp.slug, metrics);
    const status = await mon.status(bp.slug);
    expect('error' in status ? status.error : status.points).toBeGreaterThan(0);
    if (!('error' in status)) {
      expect(typeof status.latest?.loss).toBe('number');
      expect(status.lossTrend).toBe('down');
    }
  }, 15000);

  it('reports a clean error when train.py is missing', () => {
    const launcher = new TrainLauncher(root);
    const r = launcher.launch('nope', '.bimax/builds/nope', { smoke: true });
    expect('error' in r && /train\.py/.test(r.error)).toBe(true);
  });
});

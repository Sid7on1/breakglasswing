import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Blueprint, BlueprintLevel } from './blueprint.engine';

// The Build stage: compile a finished Blueprint (selections + per-level overrides) into REAL,
// concrete artifacts on disk under .bimax/builds/<slug>/ — not just a text brief. Each domain emits
// what the executor (beast mode / the user) then runs:
//   - llm:     a training config (YAML) + a runnable scaffold that writes the JSONL metrics
//              TrainMonitorTool tails, so the Verify stage is wired from the start.
//   - website: a package.json with the right deps + a step-by-step build plan.
//   - agent:   a recipe + persona the agent self-service tools wire up.
// Per-level overrides are emitted verbatim next to the choice they customize, so nothing is lost.

export interface EmittedFile { path: string; content: string }
export interface CompileResult { domain: string; outDir: string; files: EmittedFile[]; notes: string[] }

function sel(bp: Blueprint, levelId: string): string {
  const l = bp.levels.find(x => x.id === levelId);
  if (!l) return '';
  const o = l.options.find(x => x.id === l.selected);
  return o ? o.id : l.selected;
}
function selTitle(bp: Blueprint, levelId: string): string {
  const l = bp.levels.find(x => x.id === levelId);
  if (!l) return '';
  const o = l.options.find(x => x.id === l.selected);
  return o ? o.title : (l.selected || '—');
}
function overridesBlock(bp: Blueprint): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of bp.levels) if (l.override) out[l.id] = l.override;
  return out;
}

// Arch presets → concrete HF-style dims. intermediate_size follows the SwiGLU 8/3·hidden convention
// rounded to a multiple of 256 (what LLaMA-family configs actually use).
const ARCH_PRESETS: Record<string, { params: string; hidden_size: number; num_hidden_layers: number; num_attention_heads: number; intermediate_size: number; max_position_embeddings: number }> = {
  small: { params: '~0.7B', hidden_size: 1536, num_hidden_layers: 16, num_attention_heads: 12, intermediate_size: 4096, max_position_embeddings: 4096 },
  medium: { params: '~7B', hidden_size: 4096, num_hidden_layers: 32, num_attention_heads: 32, intermediate_size: 11008, max_position_embeddings: 8192 },
  large: { params: '~30B', hidden_size: 6144, num_hidden_layers: 60, num_attention_heads: 48, intermediate_size: 16384, max_position_embeddings: 8192 },
};
const ARCH_CUSTOM = { params: 'set me', hidden_size: 1024, num_hidden_layers: 12, num_attention_heads: 16, intermediate_size: 2752, max_position_embeddings: 4096 };

// num_key_value_heads (GQA grouping) from the attention choice.
function kvHeads(attn: string, nHeads: number): number {
  switch (attn) {
    case 'mha': return nHeads;
    case 'mqa': return 1;
    case 'mla': return Math.max(1, Math.round(nHeads / 8));
    case 'gqa': case 'swa': case 'flash3': default: return Math.max(1, Math.round(nHeads / 4));
  }
}
const HIDDEN_ACT: Record<string, string> = { 'rmsnorm-swiglu': 'silu', 'layernorm-gelu': 'gelu', geglu: 'gelu_new' };
const HF_OPTIM: Record<string, string> = { 'adamw-cosine': 'adamw_torch', lion: 'adamw_torch', muon: 'adamw_torch' };
const HF_LR: Record<string, number> = { 'adamw-cosine': 3e-4, lion: 1e-4, muon: 2e-3 };
const DATASET: Record<string, string> = { web: 'HuggingFaceFW/fineweb', code: 'bigcode/the-stack-dedup', mix: 'HuggingFaceFW/fineweb' };
const REPORT_TO: Record<string, string[]> = { tensorboard: ['tensorboard'], wandb: ['wandb'], jsonl: [] };

function compileLlm(bp: Blueprint): EmittedFile[] {
  const archId = sel(bp, 'arch');
  const arch = ARCH_PRESETS[archId] || ARCH_CUSTOM;
  const attn = sel(bp, 'attention');
  const ffn = sel(bp, 'ffn');
  const norm = sel(bp, 'norm');
  const pos = sel(bp, 'positional');
  const hparams = sel(bp, 'hparams');
  const infra = sel(bp, 'infra');
  const ft = sel(bp, 'finetune');
  const notes: string[] = [];

  // model_type: which HF config class this maps to. MoE ⇒ mixtral; otherwise llama.
  const moe = ffn === 'moe' || ffn === 'shared-moe' || ffn === 'hybrid';
  const model_type = moe ? 'mixtral' : 'llama';

  const model: any = {
    model_type,
    vocab_size: sel(bp, 'tokenizer') === 'tiktoken' ? 100352 : 32000,
    hidden_size: arch.hidden_size,
    intermediate_size: arch.intermediate_size,
    num_hidden_layers: arch.num_hidden_layers,
    num_attention_heads: arch.num_attention_heads,
    num_key_value_heads: kvHeads(attn, typeof arch.num_attention_heads === 'number' ? arch.num_attention_heads : 16),
    max_position_embeddings: arch.max_position_embeddings,
    hidden_act: HIDDEN_ACT[norm] || 'silu',
    rms_norm_eps: 1e-5,
    tie_word_embeddings: true,
    attn_implementation: attn === 'flash3' ? 'flash_attention_2' : 'sdpa',
  };
  // Positional encoding → real HF knobs.
  if (pos === 'rope') { model.rope_theta = 10000.0; model.rope_scaling = null; }
  else if (pos === 'alibi') notes.push('ALiBi: HF LLaMA/Mixtral have no ALiBi — use a BLOOM/MPT-style config or a custom attention bias.');
  else if (pos === 'learned') { model.rope_theta = undefined; notes.push('Learned absolute positions: switch model_type to gpt2/gpt_neox (LLaMA configs are RoPE-only).'); }
  else if (pos === 'sinusoidal') notes.push('Sinusoidal positions: not native to LLaMA configs — use gpt2 or a custom embedding.');
  else if (pos === 'nope') notes.push('NoPE: drop positional encoding in a custom attention module; no HF flag for it.');
  // MoE → Mixtral expert fields.
  if (moe) { model.num_local_experts = 8; model.num_experts_per_tok = 2; }
  if (ffn === 'shared-moe') notes.push('Shared-expert MoE (DeepSeek-V2): Mixtral config has no shared expert — add one in a custom modeling file.');
  if (ffn === 'hybrid') notes.push('Dense+MoE hybrid: set dense early layers / MoE late layers in a custom config (no single HF flag).');
  if (attn === 'mla') notes.push('MLA (KV-compression): not in HF LLaMA — use a DeepSeek-V2 modeling file; num_key_value_heads here approximates the cache footprint.');
  if (attn === 'swa') { model.sliding_window = 4096; }
  if (hparams === 'lion') notes.push('Lion optimizer: not native to HF TrainingArguments.optim — install lion-pytorch and pass a custom optimizer to Trainer.');
  if (hparams === 'muon') notes.push('Muon optimizer: pass a custom optimizer to Trainer (not a built-in optim string).');
  if (infra === 'fp8') notes.push('fp8: enable via TransformerEngine / accelerate fp8 plugin; bf16 left on as the safe default.');

  const ctx = typeof arch.max_position_embeddings === 'number' ? arch.max_position_embeddings : 4096;
  const training: any = {
    output_dir: './out',
    overwrite_output_dir: true,
    per_device_train_batch_size: 8,
    gradient_accumulation_steps: 4,
    learning_rate: HF_LR[hparams] ?? 3e-4,
    lr_scheduler_type: 'cosine',
    warmup_ratio: 0.03,
    weight_decay: 0.1,
    adam_beta1: 0.9,
    adam_beta2: 0.95,
    max_grad_norm: 1.0,
    num_train_epochs: 1,
    max_steps: 1000,
    optim: HF_OPTIM[hparams] || 'adamw_torch',
    bf16: true,
    gradient_checkpointing: true,
    logging_steps: 10,
    save_steps: 500,
    report_to: REPORT_TO[sel(bp, 'monitoring')] ?? [],
  };

  const finetune: any = { method: sel(bp, 'finetune') };
  if (ft === 'lora' || ft === 'qlora') {
    finetune.peft = { r: 16, lora_alpha: 32, lora_dropout: 0.05, target_modules: ['q_proj', 'k_proj', 'v_proj', 'o_proj'], task_type: 'CAUSAL_LM' };
    if (ft === 'qlora') finetune.load_in_4bit = true;
  } else if (ft === 'dpo' || ft === 'grpo' || ft === 'sft') {
    notes.push(`${selTitle(bp, 'finetune')}: run with TRL (trl) — ${ft.toUpperCase()}Trainer — on top of the pretrained checkpoint.`);
  }

  const config: any = {
    goal: bp.goal,
    model,
    training,
    data: {
      dataset: DATASET[sel(bp, 'datasets')] || 'HuggingFaceFW/fineweb',
      dataset_config: null,
      text_column: 'text',
      max_seq_length: ctx,
      objective: selTitle(bp, 'objective'),
      streaming: true,
    },
    tokenizer: { type: selTitle(bp, 'tokenizer'), name_or_path: 'gpt2', special_tokens: selTitle(bp, 'vocab') },
    eval: { suite: selTitle(bp, 'evaltests') },
    finetune,
    infra: { strategy: selTitle(bp, 'infra') },
    monitoring: { backend: selTitle(bp, 'monitoring'), metrics_path: 'metrics.jsonl' },
    _bimax_notes: notes,
    overrides: overridesBlock(bp),
  };

  const header = `# Generated by Bimax from Blueprint "${bp.slug}". Real HF (transformers/Trainer) field names.\n` +
    `# Launch:  TrainLaunchTool launch run="${bp.slug}" dir="${`.bimax/builds/${bp.slug}`}"  (add smoke:true for a dep-free dry run)\n` +
    `# Monitor: TrainMonitorTool watch run="${bp.slug}" source="metrics.jsonl" then status\n`;

  return [
    { path: 'train_config.yaml', content: header + yaml.dump(config, { lineWidth: 100, noRefs: true, skipInvalid: true }) },
    { path: 'train.py', content: TRAIN_PY(bp.slug) },
    { path: 'eval.py', content: EVAL_PY(bp.slug, sel(bp, 'evaltests') || 'perplexity') },
    { path: 'requirements.txt', content: 'torch\ntransformers>=4.44\ndatasets\naccelerate\npeft\nlm-eval>=0.4\nPyYAML\n' },
    { path: 'README.md', content: README(bp) },
  ];
}

// A runnable eval harness for the LLM Verify stage. Real path computes held-out perplexity from the
// trained checkpoint (./out) and, when the Blueprint's Eval level chose a benchmark suite, shells out
// to lm-eval-harness (MMLU/HellaSwag/etc). --smoke is dependency-free: it derives perplexity from the
// last training loss in metrics.jsonl (ppl = exp(loss)) so eval is verifiable without a checkpoint.
// Both write eval_results.json, which TrainLaunchTool status surfaces.
function EVAL_PY(slug: string, suite: string): string {
  return `#!/usr/bin/env python3
"""Eval harness generated by Bimax from Blueprint "${slug}" (suite: ${suite}).

Usage:
  python3 eval.py            # real eval of the trained checkpoint in ./out
  python3 eval.py --smoke    # dependency-free: derive perplexity from metrics.jsonl

Writes eval_results.json (e.g. {"perplexity": .., "eval_loss": .., "suite": ".."}).
"""
import argparse, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "eval_results.json")
METRICS = os.path.join(HERE, "metrics.jsonl")
SUITE = ${JSON.stringify(suite)}


def write(d):
    with open(RESULTS, "w") as f:
        json.dump(d, f, indent=2)
    print("eval_results.json ->", json.dumps(d), flush=True)


def last_loss():
    try:
        with open(METRICS) as f:
            rows = [json.loads(l) for l in f if l.strip()]
        losses = [r["loss"] for r in rows if isinstance(r.get("loss"), (int, float))]
        return losses[-1] if losses else None
    except Exception:
        return None


def smoke():
    """No deps, no checkpoint: perplexity from the last training loss."""
    loss = last_loss()
    if loss is None:
        return write({"suite": SUITE, "note": "no metrics.jsonl — run train.py --smoke first", "perplexity": None})
    write({"suite": SUITE, "eval_loss": round(loss, 4), "perplexity": round(math.exp(loss), 3), "source": "metrics.jsonl"})


def load_config():
    try:
        import yaml
        with open(os.path.join(HERE, "train_config.yaml")) as f:
            return yaml.safe_load(f)
    except Exception:
        return {}


def real():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from datasets import load_dataset

    cfg = load_config()
    d = dict(cfg.get("data") or {})
    ckpt = (cfg.get("training") or {}).get("output_dir", "./out")

    # Benchmark suite -> defer to lm-eval-harness (the standard).
    if SUITE.lower().startswith("benchmark"):
        import subprocess
        tasks = os.environ.get("BIMAX_EVAL_TASKS", "hellaswag,arc_easy")
        out = os.path.join(HERE, "lm_eval_out")
        cmd = [sys.executable, "-m", "lm_eval", "--model", "hf",
               "--model_args", f"pretrained={ckpt}", "--tasks", tasks,
               "--output_path", out]
        print("running:", " ".join(cmd), flush=True)
        rc = subprocess.call(cmd)
        write({"suite": SUITE, "tasks": tasks, "lm_eval_rc": rc, "output_path": out})
        return

    # Perplexity on a held-out slice.
    tok = AutoTokenizer.from_pretrained(ckpt)
    model = AutoModelForCausalLM.from_pretrained(ckpt)
    model.eval()
    seq = int(d.get("max_seq_length", 1024))
    col = d.get("text_column", "text")
    ds = load_dataset(d.get("dataset", "wikitext"), d.get("dataset_config", "wikitext-2-raw-v1"),
                      split="test")
    nll, ntok = 0.0, 0
    with torch.no_grad():
        for ex in ds.select(range(min(200, len(ds)))):
            ids = tok(ex[col], return_tensors="pt", truncation=True, max_length=seq).input_ids
            if ids.shape[1] < 2:
                continue
            loss = model(ids, labels=ids).loss
            nll += loss.item() * (ids.shape[1] - 1)
            ntok += ids.shape[1] - 1
    ppl = math.exp(nll / ntok) if ntok else float("nan")
    write({"suite": SUITE, "perplexity": round(ppl, 3), "tokens": ntok, "checkpoint": ckpt})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()
    if args.smoke:
        return smoke()
    try:
        real()
    except ImportError as e:
        print(f"[error] missing deps ({e}). pip install -r requirements.txt, or: python3 eval.py --smoke", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
`;
}

// A genuinely runnable HF Trainer script. Two paths:
//   - real:   build an AutoConfig (llama/mixtral) from train_config.yaml → AutoModelForCausalLM.
//             from_config, stream the dataset, tokenize, and run transformers.Trainer. A callback
//             appends {step, loss, grad_norm, tokens_per_sec, lr} to metrics.jsonl every logging step.
//   - --smoke: a pure-Python, dependency-free, offline run (no torch/datasets/network) that writes the
//             SAME metrics.jsonl shape so launch → metrics → TrainMonitorTool is verifiable anywhere.
function TRAIN_PY(slug: string): string {
  return `#!/usr/bin/env python3
"""Training entrypoint generated by Bimax from Blueprint "${slug}".

Usage:
  python3 train.py            # real training (needs requirements.txt + a dataset)
  python3 train.py --smoke    # dependency-free dry run: proves launch + metrics + monitoring work

Both paths append one JSON object per logging step to metrics.jsonl, which TrainMonitorTool tails:
  {"step", "loss", "grad_norm", "tokens_per_sec", "lr", "t"}
"""
import argparse, json, math, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "train_config.yaml")
METRICS = os.path.join(HERE, "metrics.jsonl")


def log_step(step, loss, grad_norm, tokens_per_sec, lr):
    with open(METRICS, "a") as f:
        f.write(json.dumps({
            "step": int(step), "loss": float(loss), "grad_norm": float(grad_norm),
            "tokens_per_sec": float(tokens_per_sec), "lr": float(lr), "t": time.time(),
        }) + "\\n")


def load_config():
    try:
        import yaml  # PyYAML
        with open(CONFIG) as f:
            return yaml.safe_load(f)
    except Exception:
        return {}


def smoke_train(cfg):
    """Pure-Python, offline. No torch/transformers/network. Emits a realistic decaying loss curve
    so the launch -> metrics.jsonl -> TrainMonitorTool pipeline can be verified with zero deps."""
    steps = int(os.environ.get("BIMAX_SMOKE_STEPS", "30"))
    lr = float(((cfg.get("training") or {}).get("learning_rate")) or 3e-4)
    open(METRICS, "w").close()  # fresh run
    print(f"[smoke] dependency-free dry run, {steps} steps -> {METRICS}", flush=True)
    for step in range(1, steps + 1):
        loss = 1.5 + 5.0 / (1 + step * 0.15)          # smooth decay toward ~1.5
        grad = 0.8 + 0.4 * math.sin(step)              # small bounded grad-norm
        tps = 12000 + 500 * math.cos(step)             # steady throughput
        log_step(step, round(loss, 4), round(abs(grad), 3), round(tps, 1), lr)
        time.sleep(0.02)
    print("[smoke] done", flush=True)


def real_train(cfg):
    """Real training via HF transformers.Trainer built from train_config.yaml."""
    import torch
    from transformers import (AutoConfig, AutoModelForCausalLM, AutoTokenizer,
                              Trainer, TrainingArguments, TrainerCallback)
    from datasets import load_dataset

    m = dict(cfg.get("model") or {})
    t = dict(cfg.get("training") or {})
    d = dict(cfg.get("data") or {})
    tok_cfg = dict(cfg.get("tokenizer") or {})
    attn_impl = m.pop("attn_implementation", None)

    tokenizer = AutoTokenizer.from_pretrained(tok_cfg.get("name_or_path", "gpt2"))
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    m["vocab_size"] = len(tokenizer)

    config = AutoConfig.for_model(**{k: v for k, v in m.items() if v is not None})
    model = AutoModelForCausalLM.from_config(config, attn_implementation=attn_impl) if attn_impl \\
        else AutoModelForCausalLM.from_config(config)

    seq = int(d.get("max_seq_length", 1024))
    col = d.get("text_column", "text")
    ds = load_dataset(d["dataset"], d.get("dataset_config"), split="train",
                      streaming=bool(d.get("streaming", True)))

    def tok(batch):
        out = tokenizer(batch[col], truncation=True, max_length=seq, padding="max_length")
        out["labels"] = out["input_ids"].copy()
        return out

    ds = ds.map(tok, batched=True, remove_columns=[col])

    class JsonlMetrics(TrainerCallback):
        def __init__(self):
            self.t0 = time.time(); self.last_step = 0
            open(METRICS, "w").close()
        def on_log(self, args, state, control, logs=None, **kw):
            logs = logs or {}
            if "loss" not in logs:
                return
            now = time.time()
            dt = max(1e-6, now - self.t0)
            tps = (state.global_step - self.last_step) * args.per_device_train_batch_size * seq / dt
            log_step(state.global_step, logs.get("loss", 0.0), logs.get("grad_norm", 0.0),
                     tps, logs.get("learning_rate", 0.0))
            self.t0 = now; self.last_step = state.global_step

    targs = TrainingArguments(**{k: v for k, v in t.items() if v is not None})
    trainer = Trainer(model=model, args=targs, train_dataset=ds, callbacks=[JsonlMetrics()])
    trainer.train()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true", help="dependency-free offline dry run")
    args = ap.parse_args()
    cfg = load_config()
    if args.smoke:
        return smoke_train(cfg)
    try:
        real_train(cfg)
    except ImportError as e:
        print(f"[error] missing deps ({e}). Install: pip install -r requirements.txt", file=sys.stderr)
        print("        or run a dry run: python3 train.py --smoke", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
`;
}

function README(bp: Blueprint): string {
  return `# ${bp.goal}\n\nGenerated LLM training build (real HF config + runnable Trainer script).\n\n` +
    `## Files\n` +
    `- \`train_config.yaml\` — every Blueprint decision as **real HF field names** (\`model:\` = AutoConfig, ` +
    `\`training:\` = TrainingArguments). Non-HF-native choices are listed under \`_bimax_notes:\`; overrides under \`overrides:\`.\n` +
    `- \`train.py\` — runnable Trainer script. \`python3 train.py\` trains; \`python3 train.py --smoke\` is a dep-free dry run.\n` +
    `- \`eval.py\` — eval harness (perplexity, or lm-eval-harness benchmarks). \`--smoke\` derives ppl from metrics.jsonl. Writes \`eval_results.json\`.\n` +
    `- \`requirements.txt\` — torch / transformers / datasets / accelerate / peft / lm-eval / PyYAML.\n\n` +
    `## Launch & monitor (from Bimax)\n` +
    `- **Dry run (verify the pipeline):** \`TrainLaunchTool launch run="${bp.slug}" dir=".bimax/builds/${bp.slug}" smoke=true\`\n` +
    `- **Real run:** \`TrainLaunchTool launch run="${bp.slug}" dir=".bimax/builds/${bp.slug}"\`\n` +
    `- **Watch metrics:** \`TrainMonitorTool status run="${bp.slug}"\` (auto-wired on launch)\n` +
    `- **Eval:** \`TrainLaunchTool launch run="${bp.slug}-eval" dir=".bimax/builds/${bp.slug}" script="eval.py" smoke=true\` then \`status\` for eval_results.json\n` +
    `- **Stop:** \`TrainLaunchTool stop run="${bp.slug}"\`\n`;
}

const WEB_DEPS: Record<string, Record<string, string[]>> = {
  framework: {
    astro: ['astro'], nextjs: ['next', 'react', 'react-dom'], sveltekit: ['@sveltejs/kit', 'svelte'],
    'vite-react': ['vite', 'react', 'react-dom'], remix: ['@remix-run/node', '@remix-run/react', 'react', 'react-dom'],
  },
  styling: { tailwind: ['tailwindcss', 'postcss', 'autoprefixer'], unocss: ['unocss'], 'vanilla-extract': ['@vanilla-extract/css'], 'css-modules': [] },
  motion: { framer: ['framer-motion'], gsap: ['gsap'], css: [], none: [] },
  components: { shadcn: [], radix: ['@radix-ui/react-slot'], headless: ['@headlessui/react'], handrolled: [] },
  cms: { sanity: ['@sanity/client'], payload: ['payload'], markdown: [], none: [] },
};

function compileWebsite(bp: Blueprint): EmittedFile[] {
  const deps = new Set<string>();
  for (const level of Object.keys(WEB_DEPS)) for (const d of (WEB_DEPS[level][sel(bp, level)] || [])) deps.add(d);
  const pkg = {
    name: bp.slug,
    private: true,
    type: 'module',
    scripts: { dev: 'dev', build: 'build', preview: 'preview' },
    // Pinned at "latest" — beast/the user installs concrete versions. Reflects the Blueprint's stack.
    dependencies: Object.fromEntries([...deps].sort().map(d => [d, 'latest'])),
    _bimax: { framework: sel(bp, 'framework'), styling: sel(bp, 'styling'), deploy: sel(bp, 'deploy') },
  };
  const ov = overridesBlock(bp);
  const plan = [
    `# Build plan — ${bp.goal}`, ``,
    `Stack: **${selTitle(bp, 'framework')}** + ${selTitle(bp, 'styling')} · ${selTitle(bp, 'components')} · ${selTitle(bp, 'motion')} motion · ${selTitle(bp, 'cms')} content · deploy to ${selTitle(bp, 'deploy')}.`, ``,
    `## Steps`,
    `1. Scaffold ${selTitle(bp, 'framework')} (\`npm create\`), install \`package.json\` deps.`,
    `2. Wire ${selTitle(bp, 'styling')} and the ${selTitle(bp, 'components')} component layer.`,
    `3. Build pages for: **${selTitle(bp, 'purpose')}**.`,
    selTitle(bp, 'cms') !== 'None (hard-coded)' ? `4. Connect ${selTitle(bp, 'cms')} for editable content.` : `4. Hard-code content (no CMS).`,
    `5. Add ${selTitle(bp, 'motion')} where it helps; keep it accessible.`,
    `6. Deploy to ${selTitle(bp, 'deploy')}.`,
    `7. **Verify:** render + screenshot (Playwright MCP), self-critic on the visual, iterate.`, ``,
    Object.keys(ov).length ? `## Overrides (honor verbatim)\n${Object.entries(ov).map(([k, v]) => `- **${k}:** ${v}`).join('\n')}` : ``,
  ].join('\n');
  return [
    { path: 'package.json', content: JSON.stringify(pkg, null, 2) + '\n' },
    { path: 'BUILD_PLAN.md', content: plan },
  ];
}

function compileAgent(bp: Blueprint): EmittedFile[] {
  const ov = overridesBlock(bp);
  const recipe = {
    name: bp.slug,
    description: bp.goal,
    instructions: [
      `Act as a ${selTitle(bp, 'role')}.`,
      `Base model: ${selTitle(bp, 'model')}. Tools/MCP: ${selTitle(bp, 'tools')}. Memory: ${selTitle(bp, 'memory')}.`,
      `Orchestration: ${selTitle(bp, 'orchestration')}. Guardrails: ${selTitle(bp, 'guardrails')}. Triggers: ${selTitle(bp, 'triggers')}.`,
      `Eval: ${selTitle(bp, 'eval')}.`,
      ...Object.entries(ov).map(([k, v]) => `Override (${k}): ${v}`),
    ].join('\n'),
  };
  const wire = `# Wiring "${bp.slug}" (agent domain)\n\nBeast mode builds this with the self-service tools:\n- **Model:** ModelManageTool → ${selTitle(bp, 'model')}\n- **Tools/MCP:** McpManageTool.discover "${selTitle(bp, 'tools')}"\n- **Persona/skill:** SkillAuthorTool from recipe.yaml\n- **Orchestration:** ${selTitle(bp, 'orchestration')}${sel(bp, 'orchestration') === 'beast' ? ' → /beast' : ''}\n- **Guardrails:** governor mode = ${selTitle(bp, 'guardrails')}\n- **Smoke-run:** ${selTitle(bp, 'eval')}\n`;
  return [
    { path: 'recipe.yaml', content: yaml.dump(recipe, { lineWidth: 100, noRefs: true }) },
    { path: 'WIRING.md', content: wire },
  ];
}

export class BlueprintCompiler {
  constructor(private projectRoot: string) {}

  compile(bp: Blueprint): CompileResult {
    let files: EmittedFile[];
    switch (bp.domain) {
      case 'llm': files = compileLlm(bp); break;
      case 'website': files = compileWebsite(bp); break;
      case 'agent': files = compileAgent(bp); break;
      default: files = [{ path: 'BUILD_BRIEF.md', content: bp.goal }];
    }
    const outDir = path.join(this.projectRoot, '.bimax', 'builds', bp.slug);
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of files) {
      const p = path.join(outDir, f.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, f.content, 'utf8');
    }
    const notes: string[] = [];
    if (bp.domain === 'llm') {
      notes.push(`Dry-run the pipeline: TrainLaunchTool launch run="${bp.slug}" dir="${path.join('.bimax/builds', bp.slug)}" smoke=true (dep-free, writes metrics.jsonl).`);
      notes.push(`Real run: TrainLaunchTool launch run="${bp.slug}" dir="${path.join('.bimax/builds', bp.slug)}" — then TrainMonitorTool status run="${bp.slug}".`);
      notes.push(`Eval: TrainLaunchTool launch run="${bp.slug}-eval" dir="${path.join('.bimax/builds', bp.slug)}" script="eval.py" smoke=true — then status for eval_results.json (perplexity).`);
    }
    if (bp.domain === 'website') notes.push('Verify: render + screenshot via Playwright MCP, then self-critic on the visual.');
    return { domain: bp.domain, outDir: path.relative(this.projectRoot, outDir), files, notes };
  }
}

let _compiler: BlueprintCompiler | null = null;
export function getBlueprintCompiler(): BlueprintCompiler | null { return _compiler; }
export function setBlueprintCompiler(c: BlueprintCompiler): void { _compiler = c; }

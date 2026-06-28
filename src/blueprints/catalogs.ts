// Domain catalogs for the Blueprint builder (Sketch Mode → Blueprint → Build).
//
// A catalog is the *template* for a domain: an ordered list of decision Levels, each carrying a few
// curated Options (id + title + one-line note). It generalizes the MCP catalog pattern (src/mcp/
// catalog.ts) into a multi-level option tree. The BlueprintEngine instantiates a catalog into a
// concrete Blueprint the agent then fills in — selecting an option per level, adding free-text
// overrides, or importing a fresh option from the web.
//
// These are intentionally just DATA. Extending a domain = adding a level or an option here.

export type Domain = 'website' | 'agent' | 'llm';

export interface CatalogOption {
  id: string;
  title: string;
  /** One-line tradeoff/description shown next to the option. */
  note: string;
}

export interface CatalogLevel {
  id: string;
  title: string;
  /** Curated options. The agent can also "describe the others" or import from the web. */
  options: CatalogOption[];
  /** A sensible default selection id (optional — the agent/user can override). */
  default?: string;
}

export interface DomainCatalog {
  domain: Domain;
  title: string;
  description: string;
  /** How the Build stage compiles a finished Blueprint of this domain. */
  build: string;
  /** How the Verify stage proves it works. */
  verify: string;
  levels: CatalogLevel[];
}

const WEBSITE: DomainCatalog = {
  domain: 'website',
  title: 'Website Builder',
  description: 'A marketing/product/portfolio site or web app — from purpose to deploy.',
  build: 'Scaffold with /beast, then iterate. The selected framework/styling/CMS/deploy options drive the scaffold; per-level overrides are honored as explicit build instructions.',
  verify: 'Render the site and capture a screenshot (Playwright MCP) → self-critic on the *visual*, iterate until it matches intent.',
  levels: [
    { id: 'purpose', title: 'Purpose / content', options: [
      { id: 'marketing', title: 'Marketing / landing', note: 'Convert visitors — hero, features, CTA.' },
      { id: 'booking', title: 'Booking / lead-gen', note: 'Drive a direct action (book, call, sign up).' },
      { id: 'portfolio', title: 'Portfolio / personal', note: 'Showcase work; light, fast, image-heavy.' },
      { id: 'app', title: 'Web app', note: 'Interactive product with auth/state.' },
    ] },
    { id: 'framework', title: 'Framework', default: 'astro', options: [
      { id: 'astro', title: 'Astro', note: 'Fastest, content-first, ships almost no JS. Best default for sites.' },
      { id: 'nextjs', title: 'Next.js', note: 'React + SSR/RSC; room to grow into a custom app.' },
      { id: 'sveltekit', title: 'SvelteKit', note: 'Lean, fast, great DX; smaller ecosystem.' },
      { id: 'vite-react', title: 'Vite + React', note: 'SPA, no SSR — simplest for an app-only build.' },
      { id: 'remix', title: 'Remix', note: 'Web-standards data loading; strong forms/mutations.' },
    ] },
    { id: 'styling', title: 'Styling', default: 'tailwind', options: [
      { id: 'tailwind', title: 'Tailwind CSS', note: 'Utility-first, fast to build, huge ecosystem.' },
      { id: 'css-modules', title: 'CSS Modules', note: 'Scoped plain CSS; no utility learning curve.' },
      { id: 'vanilla-extract', title: 'vanilla-extract', note: 'Type-safe CSS-in-TS, zero runtime.' },
      { id: 'unocss', title: 'UnoCSS', note: 'On-demand atomic CSS; Tailwind-compatible, faster.' },
    ] },
    { id: 'motion', title: 'Motion', default: 'css', options: [
      { id: 'css', title: 'CSS transitions', note: 'Cheapest; enough for most sites.' },
      { id: 'framer', title: 'Framer Motion', note: 'Declarative React animation; rich gestures.' },
      { id: 'gsap', title: 'GSAP', note: 'Timeline-grade control for complex sequences.' },
      { id: 'none', title: 'None', note: 'Static — fastest, most accessible.' },
    ] },
    { id: 'components', title: 'Components / layout', default: 'shadcn', options: [
      { id: 'shadcn', title: 'shadcn/ui', note: 'Copy-in Radix + Tailwind components you own.' },
      { id: 'radix', title: 'Radix UI', note: 'Unstyled accessible primitives; bring your own CSS.' },
      { id: 'headless', title: 'Headless UI', note: 'Lightweight a11y primitives for Tailwind.' },
      { id: 'handrolled', title: 'Hand-rolled', note: 'Full control, more work; no dependency.' },
    ] },
    { id: 'cms', title: 'Content / CMS', default: 'markdown', options: [
      { id: 'none', title: 'None (hard-coded)', note: 'Simplest; devs edit content in code.' },
      { id: 'markdown', title: 'Markdown / MDX', note: 'Files in the repo; great for blogs/docs.' },
      { id: 'sanity', title: 'Sanity', note: 'Hosted headless CMS; non-devs edit in a studio.' },
      { id: 'payload', title: 'Payload', note: 'Self-hosted CMS + admin; owns your data.' },
    ] },
    { id: 'deploy', title: 'Deploy', default: 'vercel', options: [
      { id: 'vercel', title: 'Vercel', note: 'Zero-config for Next/Astro; previews per PR.' },
      { id: 'netlify', title: 'Netlify', note: 'Similar; strong forms/redirects.' },
      { id: 'cloudflare', title: 'Cloudflare Pages', note: 'Edge, cheap/free at scale, Workers nearby.' },
    ] },
  ],
};

const AGENT: DomainCatalog = {
  domain: 'agent',
  title: 'Agent Builder',
  description: 'A purpose-built AI agent — leans on Bimax\'s own self-service tools.',
  build: 'Author a persona/skill (SkillAuthorTool) + wire the base model (ModelManageTool) and tools/MCP (McpManageTool), optionally a recipe; smoke-run via /beast.',
  verify: 'Run a smoke goal end-to-end + any registered tests; confirm the agent uses its tools and stays in guardrails.',
  levels: [
    { id: 'role', title: 'Role / goal', options: [
      { id: 'assistant', title: 'Task assistant', note: 'General helper for a workflow.' },
      { id: 'researcher', title: 'Researcher', note: 'Web-search + synthesize + cite.' },
      { id: 'coder', title: 'Coding agent', note: 'Reads a repo, makes changes, verifies.' },
      { id: 'ops', title: 'Ops / monitor', note: 'Watches a system, alerts, acts on triggers.' },
    ] },
    { id: 'model', title: 'Base model / provider', default: 'claude-opus', options: [
      { id: 'claude-opus', title: 'Claude Opus 4.8', note: 'Strongest reasoning; default for hard agents.' },
      { id: 'claude-sonnet', title: 'Claude Sonnet 4.6', note: 'Fast + capable; great cost/quality balance.' },
      { id: 'claude-haiku', title: 'Claude Haiku 4.5', note: 'Cheapest/fastest; high-volume simple tasks.' },
      { id: 'local', title: 'Local / OSS', note: 'Self-hosted via the provider you configure.' },
    ] },
    { id: 'tools', title: 'Tools / MCP', options: [
      { id: 'discover', title: 'Discover by intent', note: 'McpManageTool.discover finds servers from a plain-language need.' },
      { id: 'web', title: 'Web (search + fetch)', note: 'Live information.' },
      { id: 'data', title: 'Data (Postgres/SQLite)', note: 'Query a database.' },
      { id: 'browser', title: 'Browser (Playwright)', note: 'Drive real web pages.' },
    ] },
    { id: 'memory', title: 'Memory', default: 'none', options: [
      { id: 'none', title: 'None', note: 'Stateless per task.' },
      { id: 'vector', title: 'Vector', note: 'Semantic recall over notes/docs.' },
      { id: 'graph', title: 'Graph / codemem', note: 'Structured code/entity memory.' },
    ] },
    { id: 'orchestration', title: 'Orchestration', default: 'single', options: [
      { id: 'single', title: 'Single agent', note: 'One loop; simplest.' },
      { id: 'swarm', title: 'Swarm', note: 'Parallel sub-agents in worktrees.' },
      { id: 'beast', title: '/beast pipeline', note: 'Swarm → heal → self-critic → checkpoint.' },
    ] },
    { id: 'guardrails', title: 'Persona / guardrails', default: 'interactive', options: [
      { id: 'interactive', title: 'Interactive', note: 'Confirms risky actions with the user.' },
      { id: 'plan', title: 'Read-only / plan', note: 'Never mutates — recon/advice only.' },
      { id: 'autonomous', title: 'Autonomous', note: 'Acts without prompts; use with trusted scope.' },
    ] },
    { id: 'triggers', title: 'Triggers', default: 'manual', options: [
      { id: 'manual', title: 'Manual', note: 'User-invoked.' },
      { id: 'cron', title: 'Cron / schedule', note: 'Runs on a recurring schedule.' },
      { id: 'watch', title: '/watch', note: 'Fires on a file/repo/system event.' },
    ] },
    { id: 'eval', title: 'Eval', options: [
      { id: 'smoke', title: 'Smoke goal', note: 'One representative end-to-end run.' },
      { id: 'tests', title: 'Test suite', note: 'Assertions over expected behavior.' },
    ] },
  ],
};

const LLM: DomainCatalog = {
  domain: 'llm',
  title: 'LLM Training Builder',
  description: 'Pre-train or fine-tune a language model — the deep, level-by-level architecture builder.',
  build: 'Emit a runnable training config (HF / nanotron / torchtitan-style) + a scaffold. Honor per-level overrides verbatim (e.g. "MoE at FFN but keep MLA\'s KV-cache from attention").',
  verify: 'Eval metrics — perplexity, loss curves, held-out probes — plus live monitoring via TrainMonitorTool (loss / grad-norm / throughput with alerts). NOT screenshots.',
  levels: [
    { id: 'tokenizer', title: 'Tokenizer', default: 'bbpe', options: [
      { id: 'bpe', title: 'BPE', note: 'Classic byte-pair encoding.' },
      { id: 'bbpe', title: 'Byte-level BPE', note: 'GPT-style; no OOV, robust to any bytes.' },
      { id: 'sentencepiece', title: 'SentencePiece (Unigram)', note: 'Language-agnostic, strong for multilingual.' },
      { id: 'wordpiece', title: 'WordPiece', note: 'BERT-style; subword likelihood splits.' },
      { id: 'tiktoken', title: 'tiktoken', note: 'Fast BPE impl; reuse OpenAI vocabs.' },
    ] },
    { id: 'vocab', title: 'Vocab / special tokens', options: [
      { id: 'std', title: 'Standard', note: 'BOS/EOS/PAD/UNK, ~32–128k vocab.' },
      { id: 'fim', title: '+ FIM', note: 'Fill-in-the-middle tokens for code.' },
      { id: 'reserved', title: '+ Reserved slots', note: 'Spare ids for later special tokens.' },
    ] },
    { id: 'positional', title: 'Embeddings + positional', default: 'rope', options: [
      { id: 'learned', title: 'Learned absolute', note: 'Simple; poor length extrapolation.' },
      { id: 'sinusoidal', title: 'Sinusoidal', note: 'Fixed; original Transformer.' },
      { id: 'rope', title: 'RoPE', note: 'Rotary; the modern default, extends with scaling.' },
      { id: 'alibi', title: 'ALiBi', note: 'Linear bias; cheap long-context extrapolation.' },
      { id: 'nope', title: 'NoPE', note: 'No positional encoding; works at depth, experimental.' },
    ] },
    { id: 'attention', title: 'Attention', default: 'gqa', options: [
      { id: 'mha', title: 'MHA', note: 'Full multi-head; most memory.' },
      { id: 'mqa', title: 'MQA', note: 'Single KV head; smallest cache, some quality loss.' },
      { id: 'gqa', title: 'GQA', note: 'Grouped KV; the standard quality/speed balance.' },
      { id: 'mla', title: 'MLA (KV-compression)', note: 'DeepSeek-style low-rank KV; big cache savings.' },
      { id: 'swa', title: 'Sliding-window', note: 'Local attention for long context (Mistral-style).' },
      { id: 'flash3', title: 'FlashAttention-3', note: 'Kernel, not a variant — pair with any of the above.' },
    ] },
    { id: 'ffn', title: 'FFN / experts', default: 'dense', options: [
      { id: 'dense', title: 'Dense', note: 'Standard MLP; simplest, predictable.' },
      { id: 'moe', title: 'MoE top-k', note: 'Sparse experts; more params, same FLOPs/token.' },
      { id: 'shared-moe', title: 'Shared-expert MoE', note: 'A shared expert + routed ones (DeepSeek-V2).' },
      { id: 'hybrid', title: 'Dense + MoE hybrid', note: 'Dense early layers, MoE later.' },
    ] },
    { id: 'norm', title: 'Norm + activation', default: 'rmsnorm-swiglu', options: [
      { id: 'rmsnorm-swiglu', title: 'RMSNorm + SwiGLU (pre-norm)', note: 'Modern default (LLaMA-style).' },
      { id: 'layernorm-gelu', title: 'LayerNorm + GELU', note: 'Classic GPT recipe.' },
      { id: 'geglu', title: 'RMSNorm + GeGLU', note: 'GeGLU variant of the gated FFN.' },
    ] },
    { id: 'arch', title: 'Architecture', options: [
      { id: 'small', title: '~0.5–1B', note: 'depth/width for a small dense model; ~2–4k ctx.' },
      { id: 'medium', title: '~7B', note: 'LLaMA-7B-class; 4–8k ctx.' },
      { id: 'large', title: '~30B+', note: 'Needs sharding; long ctx.' },
      { id: 'custom', title: 'Custom', note: 'Set depth × width × heads × params × ctx in the override.' },
    ] },
    { id: 'datasets', title: 'Datasets', options: [
      { id: 'web', title: 'Web (FineWeb/C4)', note: 'General pretraining corpus.' },
      { id: 'code', title: 'Code (The Stack)', note: 'Add coding ability.' },
      { id: 'mix', title: 'Custom mix', note: 'Set sources, ratios, dedup, filtering in the override.' },
    ] },
    { id: 'objective', title: 'Objective', default: 'causal', options: [
      { id: 'causal', title: 'Causal LM', note: 'Next-token; the default for generative models.' },
      { id: 'mlm', title: 'Masked LM', note: 'BERT-style; encoders.' },
      { id: 'fim', title: 'FIM', note: 'Fill-in-the-middle; code infilling.' },
      { id: 'mtp', title: 'Multi-token prediction', note: 'Predict several tokens (DeepSeek-V3).' },
    ] },
    { id: 'hparams', title: 'Hyperparameters', default: 'adamw-cosine', options: [
      { id: 'adamw-cosine', title: 'AdamW + cosine', note: 'Proven default; warmup → cosine decay.' },
      { id: 'lion', title: 'Lion', note: 'Cheaper memory; sign-based update.' },
      { id: 'muon', title: 'Muon', note: 'Newer; strong on matrix params, tune carefully.' },
    ] },
    { id: 'infra', title: 'Training infra', default: 'fsdp-bf16', options: [
      { id: 'fsdp-bf16', title: 'FSDP + bf16', note: 'PyTorch-native sharding; the common default.' },
      { id: 'deepspeed', title: 'DeepSpeed ZeRO', note: 'ZeRO-3 offload for tight memory.' },
      { id: 'megatron', title: 'Megatron', note: 'Tensor/pipeline parallel for big models.' },
      { id: 'fp8', title: '+ fp8', note: 'H100-class throughput; needs care.' },
    ] },
    { id: 'evaltests', title: 'Eval / tests', options: [
      { id: 'perplexity', title: 'Perplexity', note: 'Held-out loss/ppl.' },
      { id: 'benchmarks', title: 'Benchmark suite', note: 'MMLU/HellaSwag/etc via lm-eval-harness.' },
      { id: 'probes', title: 'Held-out probes', note: 'Task-specific behavioral checks.' },
    ] },
    { id: 'finetune', title: 'Fine-tuning', default: 'none', options: [
      { id: 'none', title: 'None (pretrain only)', note: 'Stop after base training.' },
      { id: 'lora', title: 'LoRA', note: 'Cheap adapters; freeze the base.' },
      { id: 'qlora', title: 'QLoRA', note: '4-bit base + LoRA; fits big models on one GPU.' },
      { id: 'sft', title: 'Full SFT', note: 'Tune all weights on instructions.' },
      { id: 'dpo', title: 'DPO', note: 'Preference alignment, no reward model.' },
      { id: 'grpo', title: 'RLHF / GRPO', note: 'RL from preferences/rewards.' },
    ] },
    { id: 'monitoring', title: 'Monitoring', default: 'tensorboard', options: [
      { id: 'tensorboard', title: 'TensorBoard', note: 'Local loss/grad-norm/throughput curves.' },
      { id: 'wandb', title: 'Weights & Biases', note: 'Hosted dashboards + alerts (TrainMonitorTool can poll it).' },
      { id: 'jsonl', title: 'JSONL metrics', note: 'Append metrics to a file TrainMonitorTool tails live.' },
    ] },
  ],
};

export const DOMAIN_CATALOGS: Record<Domain, DomainCatalog> = { website: WEBSITE, agent: AGENT, llm: LLM };

export function getCatalog(domain: string): DomainCatalog | undefined {
  return (DOMAIN_CATALOGS as Record<string, DomainCatalog>)[domain.toLowerCase()];
}

/** Infer the most likely domain from a free-text idea. */
export function inferDomain(idea: string): Domain {
  const s = idea.toLowerCase();
  if (/\b(train|fine-?tune|pretrain|tokenizer|transformer|lora|model weights|gpu|checkpoint|llm from scratch)\b/.test(s)) return 'llm';
  if (/\b(agent|bot|assistant|automation|workflow|mcp|tool-using|swarm)\b/.test(s)) return 'agent';
  return 'website';
}

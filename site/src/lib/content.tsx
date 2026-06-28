import {
  PencilRuler,
  Layers,
  Bot,
  Globe,
  Cpu,
  GitBranch,
  Activity,
  Boxes,
  Sparkles,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export const NAV: { id: string; label: string }[] = [
  { id: 'how', label: 'How it works' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'domains', label: 'Domains' },
  { id: 'proof', label: 'Proof' },
];

export const INSTALL_CMD = 'npm i -g bimax';

export interface Step {
  n: string;
  icon: LucideIcon;
  title: string;
  desc: string;
}
export const STEPS: Step[] = [
  { n: '01', icon: PencilRuler, title: 'Sketch', desc: 'Talk it through. Bimax interviews you, searches the live web, and shapes the idea — no blank page.' },
  { n: '02', icon: Layers, title: 'Blueprint', desc: 'Every decision, level by level. Pick options, mix them, import from the web — saved as a Blueprint.' },
  { n: '03', icon: Boxes, title: 'Build', desc: 'Compile the Blueprint into real artifacts — a site, a wired agent, or a training config + trainer.' },
  { n: '04', icon: ShieldCheck, title: 'Verify', desc: 'Prove it works — a screenshot loop for sites, live metrics for models, a smoke run for agents.' },
];

export interface Capability {
  icon: LucideIcon;
  title: string;
  desc: string;
  span: string; // grid span classes
  accent?: boolean;
}
export const CAPABILITIES: Capability[] = [
  {
    icon: PencilRuler,
    title: 'Sketch Mode',
    desc: 'A conversational architect. Asks first, web-aware, decides level by level, and saves the whole thread as a buildable Blueprint.',
    span: 'md:col-span-2 md:row-span-1',
    accent: true,
  },
  { icon: GitBranch, title: 'Beast Pipeline', desc: 'Swarm → self-heal → self-critic → checkpoint. Hand off the build and walk away.', span: 'md:col-span-1' },
  { icon: Layers, title: 'Blueprint Builders', desc: 'One engine, three domains — websites, agents, and LLMs — compiled to real files, not vague plans.', span: 'md:col-span-1' },
  { icon: Cpu, title: 'MCP Self-Service', desc: 'Discovers, adds, and wires MCP servers by intent. Authors its own skills. Switches its own model.', span: 'md:col-span-2' },
  { icon: Activity, title: 'Live Monitoring', desc: 'Tails training metrics (loss / grad / throughput) with anomaly alerts, or polls W&B.', span: 'md:col-span-1' },
  { icon: Sparkles, title: 'Graph Memory', desc: 'A code/entity graph keeps sub-agents goal- and context-aware across the whole run.', span: 'md:col-span-2' },
];

export interface Domain {
  id: string;
  label: string;
  icon: LucideIcon;
  tagline: string;
  bullets: string[];
  code: { text: string; dim?: boolean; prompt?: boolean }[];
}
export const DOMAINS: Domain[] = [
  {
    id: 'websites',
    label: 'Websites',
    icon: Globe,
    tagline: 'From a sketch to a deployed, verified site.',
    bullets: [
      'Framework · styling · motion · CMS · deploy, chosen level by level',
      'Compiles to a real Vite/Astro/Next scaffold with the right deps',
      'Verify auto-connects Playwright → render → screenshot → self-critique',
    ],
    code: [
      { text: 'bimax sketch "a launch page for my app"', prompt: true },
      { text: '→ Blueprint: Vite · Tailwind · Framer Motion · Vercel', dim: true },
      { text: 'bimax blueprint build launch-page', prompt: true },
      { text: '✓ wrote site/ — 14 files', dim: true },
      { text: '✓ verify: Playwright screenshot looks on-brief', dim: true },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: Bot,
    tagline: 'A purpose-built agent, wired from its own self-service tools.',
    bullets: [
      'Role · model · tools/MCP · memory · orchestration · guardrails',
      'Authors a persona/skill, wires the model + MCP servers automatically',
      'Verify runs a readiness check before the smoke goal',
    ],
    code: [
      { text: 'bimax sketch "an agent that triages my issues"', prompt: true },
      { text: '→ Blueprint: Opus · GitHub MCP · graph memory', dim: true },
      { text: 'bimax blueprint build issue-triage', prompt: true },
      { text: '✓ recipe.yaml + wiring written', dim: true },
      { text: '✓ verify: [✓] model [✓] MCP [✓] guardrails', dim: true },
    ],
  },
  {
    id: 'llms',
    label: 'LLMs',
    icon: Cpu,
    tagline: 'Pre-train or fine-tune — real config, real launch, real eval.',
    bullets: [
      'Tokenizer → attention → FFN/MoE → infra, 14 levels deep',
      'Emits real HF config + a runnable Trainer (train.py) + requirements',
      'Launches training, tails metrics, evals perplexity / lm-eval-harness',
    ],
    code: [
      { text: 'bimax sketch "fine-tune a 7B code model"', prompt: true },
      { text: '→ Blueprint: GQA · MoE · LoRA · bf16 FSDP', dim: true },
      { text: 'bimax blueprint build code-7b && launch', prompt: true },
      { text: '✓ train_config.yaml (HF) + train.py', dim: true },
      { text: 'loss 2.97 ↓  ·  12k tok/s  ·  ✓ healthy', dim: true },
    ],
  },
];

export const STATS: { value: string; label: string }[] = [
  { value: '604', label: 'tests green, every build' },
  { value: '3', label: 'domains — sites · agents · LLMs' },
  { value: '14', label: 'decision levels for an LLM' },
  { value: '100%', label: 'open, hackable, yours' },
];

export const PARTNERS = ['Claude', 'MCP', 'Playwright', 'Weights & Biases', 'HuggingFace'];

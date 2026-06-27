# Bimax Studio — Sketch Mode + Blueprint Builders

**Status:** Plan (not yet built) · drafted 2026-06-27
**One line:** Turn Bimax from "agent that executes" into an **interactive architect** that *discusses* an
idea with you, designs it level-by-level with real options, then builds it — for **websites, agents,
and LLMs (training / fine-tuning / monitoring)**.

---

## 1. The north-star loop

Every domain (website, agent, LLM) runs the same three-stage loop:

```
  SKETCH  ──►  BLUEPRINT  ──►  BUILD  ──►  VERIFY
 (discuss)    (decide,        (execute)   (check it
  back-and-    level-by-                   actually
  forth, web    level w/                   works)
  search,       options)
  questions)
```

- **Sketch** = a real conversation. Bimax interviews you, asks questions, web-searches as it goes,
  riffs on the idea. Ends by synthesizing the whole chat into a saved Blueprint and pinging you.
- **Blueprint** = the structured decision tree. An ordered list of *Levels*; each Level offers curated
  *Options*, a "describe the others" expansion, a per-level **Note/override**, and the ability to
  **import a new option from the web**.
- **Build** = compile the Blueprint into an execution (a `/beast` run, a scaffold, or a training
  config) — reuses everything we already shipped.
- **Verify** = domain-appropriate proof (rendered screenshot for web, eval metrics for LLMs, a smoke
  run for agents).

---

## 2. Sketch Mode (the spine — build this first)

A conversational planning mode. Not code-writing — *thinking together*.

**Behavior**
- Bimax **asks questions frequently** (reuses `AskUserTool`, `src/tools/implementations/ask_user.tool.ts`)
  instead of assuming. One or two crisp questions at a time, not a wall.
- It **web-searches mid-conversation** (`WebSearch`/`WebFetch`,
  `src/tools/implementations/websearch.tool.ts` / `webfetch.tool.ts`) to surface *current* options,
  frameworks, and freshly-released tech — so advice isn't stale.
- It's **back-and-forth**: the user can change direction, add constraints, ask "what else is out
  there?" at any point.
- When the idea is sufficiently shaped, it **concludes**: synthesizes the entire conversation into a
  structured Blueprint, saves it, and **pings the user** ("Here's what we landed on — review it").

**Example (hotel website)**
```
user:  dude i wanna build a website for my hotel
bimax: Nice — tell me more. Where is it, how many rooms, and what's the #1 thing
       you want a visitor to do (book? call? find you?)
user:  boutique hotel in Goa, 12 rooms, I want direct bookings
bimax: Got it. Direct bookings means a booking widget + fast mobile pages. Two routes:
       (a) Astro + a booking embed (fastest, cheapest to host),
       (b) Next.js if you want a custom booking flow later.
       Want me to lean fast-and-simple (a) or room-to-grow (b)?  [describe others?]
user:  whats option c
bimax: [web-searches] Option C: a headless CMS (Sanity/Payload) so your staff edits
       rooms/rates without touching code. Heavier setup. Worth it if rates change often.
user:  go with astro, but staff must edit rates
bimax: 👍 Astro + a light CMS for rates. Add image gallery + map? multilingual?
...
bimax: 📋 Sketch complete. Blueprint saved to .bimax/plans/hotel-goa-site.md — review it,
       say "build it" and I'll run it.
```

**Reuse / new**
- Reuse: `AskUserTool`, `WebSearch`/`WebFetch`, `PlanTool` (saves to `.bimax/plans/<slug>.md`),
  the governor `plan`/read-only gate (no edits during sketch).
- New: a `sketch` mode (alongside `explore`/`code`/`general` in `src/cli/commands/mode.ts`) **or** a
  `/sketch <idea>` command that sets a sketch persona/system-prompt (ask-often, web-search-freely,
  end-with-a-blueprint) and, on conclusion, writes a Blueprint instead of a plain plan.

---

## 3. Blueprints (the level-by-level decision engine)

A Blueprint generalizes the **MCP catalog pattern we just shipped** (`src/mcp/catalog.ts`: options +
keywords + metadata) into a reusable, multi-level option tree.

**Shape** (stored as YAML/JSON next to recipes, e.g. `.bimax/blueprints/<slug>.yaml`):
```
Blueprint:
  domain: website | agent | llm
  goal: "<the idea, as discussed>"
  levels:
    - id: tokenizer
      title: "Tokenization"
      options:
        - id: bpe        title: "Byte-Pair Encoding"   note: "..."   source: builtin|web
        - id: sentencepiece ...
      selected: bpe
      describe_others: true        # user can ask to expand every non-listed option
      override: "free-text note — e.g. 'keep KV-cache from the MLA option'"
```

**Three powers at every level (the things you asked for):**
1. **Options** — a curated catalog per level (see §4), each with a one-line description.
2. **"Describe the others"** — expand beyond the curated list (Bimax explains the full landscape, web-searches if needed).
3. **Per-level Note / override** — free text that customizes or *mixes* options
   ("at the attention level, use MoE but keep KV-cache compression from MLA"). The builder honors these
   as explicit instructions when compiling.
4. **Import from web** — paste/point at a freshly-released OSS model/framework/agent; Bimax fetches its
   structure (`WebFetch`) and adds it as a **selectable Option/preset** at the relevant level(s).

**Reuse / new**
- Reuse: catalog pattern (`catalog.ts`), recipe loader/format (`src/recipes/recipe.loader.ts`) as the
  on-disk storage model, PlanTool persistence.
- New: a `BlueprintEngine` (load/save/select/override/import) + the three option catalogs in §4.

---

## 4. The three domains (option catalogs)

### A) Website Builder
Levels: **Purpose/Content → Framework** (Astro · Next.js · SvelteKit · Vite+React · Remix) **→ Styling**
(Tailwind · CSS Modules · vanilla-extract · UnoCSS) **→ Motion** (Framer Motion · GSAP · CSS · none)
**→ Components/Layout** (shadcn/ui · Radix · headless · hand-rolled) **→ Content/CMS** (none · Sanity ·
Payload · Markdown) **→ Deploy** (Vercel · Netlify · Cloudflare Pages) **→ Verify** (render + screenshot).
Build = `/beast` scaffolds + iterates. Verify needs a visual loop (see §5).

### B) Agent Builder  *(leans hard on what we just shipped)*
Levels: **Role/Goal → Base model/provider** (`ModelManageTool`) **→ Tools/MCP** (`McpManageTool.discover`
+ catalog) **→ Memory** (none · vector · graph/codemem) **→ Orchestration** (single · swarm · `/beast`
pipeline) **→ Persona/guardrails** (governor mode) **→ Triggers** (cron · `/watch`) **→ Eval** (smoke
goal + tests). Build = author a persona/skill (`SkillAuthorTool`) + wire MCP/model + optionally a
recipe; smoke-run via `/beast`.

### C) LLM Training Builder  *(the deep one you detailed)*
Each level: options + "describe others" + per-level override + web-import.

| # | Level | Sample options |
|---|-------|----------------|
| 1 | Tokenizer | BPE · byte-level BPE · SentencePiece (Unigram) · WordPiece · tiktoken |
| 2 | Vocab / special tokens | size, FIM/BOS/EOS, reserved |
| 3 | Embeddings + positional | learned · sinusoidal · **RoPE** · ALiBi · NoPE |
| 4 | Attention | MHA · MQA · GQA · **MLA (KV-compression)** · sliding-window · FlashAttention-3 |
| 5 | FFN / experts | dense · **MoE top-k** · shared-expert MoE · dense+MoE hybrid |
| 6 | Norm + activation | RMSNorm/LayerNorm · SwiGLU/GeGLU/GELU · pre/post-norm |
| 7 | Architecture | depth × width × heads × params; context length |
| 8 | Datasets | sources, mixing ratios, dedup, filtering, tokenize pipeline |
| 9 | Objective | causal-LM · MLM · FIM · multi-token prediction |
| 10 | Hyperparameters | optimizer (AdamW/Lion/Muon) · LR schedule · batch · warmup |
| 11 | Training infra | FSDP · DeepSpeed · Megatron · precision (bf16/fp8) |
| 12 | Eval / tests | perplexity · loss curves · benchmark suite · held-out probes |
| 13 | Fine-tuning | LoRA · QLoRA · full SFT · DPO · RLHF/GRPO |
| 14 | Monitoring | loss/grad-norm/throughput · W&B · TensorBoard · alerts |

Override examples honored verbatim: *"use MoE at L5 but keep MLA's KV-cache from L4"*,
*"swap L3 to RoPE with the long-context scaling from <imported model>"*.
**Web-import:** a new OSS model drops → fetch its architecture/config → register its choices as a
one-click **preset** that pre-fills L1–L7 (and as individual options at each level).
Build = emit a training **config** (HF/nanotron/torchtitan-style) + a runnable scaffold; Verify =
eval metrics + monitoring dashboards, **not** screenshots.

---

## 5. The screenshot / visual-verification gap (you flagged this)

We do **not** currently have a screenshot capability inside Bimax. Honest options for the Website
"Verify" stage:
- **Playwright/Puppeteer MCP** — we already proved the discover→install→connect flow works live
  (14 tools, 1.2s). It can render a URL and capture a screenshot/DOM snapshot the agent reads back →
  a real **visual feedback loop** (build → screenshot → self-critic on the *visual* → iterate).
- This becomes Website-domain Level "Verify". For **agents/LLMs**, verification is metrics/eval, so no
  screenshot needed there. Recommendation: wire Playwright MCP as an optional capability the Website
  builder auto-discovers; treat true visual verification as a Phase-5 add, not a blocker.

---

## 6. What we reuse vs. what's new

**Reuse (already built this codebase):**
- `AskUserTool` (model asks questions) · `WebSearch`/`WebFetch` (sketch search + web-import)
- `PlanTool` → `.bimax/plans/` · recipe loader/format (`src/recipes/`) · MCP **catalog pattern** (`src/mcp/catalog.ts`)
- `/beast` pipeline (build/execute) · `SkillAuthorTool` · `McpManageTool.discover` · `ModelManageTool`
- governor modes / read-only gate · graph + memory enrichment (`buildAgentContextBlock`)

**New to build:**
- **Sketch Mode** — mode/command + persona (ask-often, web-search, conclude-with-blueprint, ping).
- **BlueprintEngine** — load/save/select/`describe-others`/override/`import-from-web`; storage in `.bimax/blueprints/`.
- **Three option catalogs** — website, agent, LLM (the tables in §4), each an extensible catalog like `catalog.ts`.
- **Blueprint→Build compiler** — turn a Blueprint (+ overrides) into a `/beast` run, a scaffold, or a training config.
- **Web-import parser** — fetch an OSS model/framework structure and register it as options/presets.
- (Phase 5) **Visual verify** via Playwright MCP for the website domain.

---

## 7. Phasing (ship value early)

1. **Sketch Mode** — conversational planner (ask + web-search + conclude→Blueprint→ping). Works for ALL
   domains immediately because it's guided conversation → saved plan. *Highest leverage, smallest build.*
2. **BlueprintEngine + Website catalog** — first real level-by-level builder + Blueprint→/beast build.
   Fastest domain to show "idea → working thing".
3. **Agent builder** — thin layer over our self-service tools (MCP discover / skill author / model).
4. **LLM Training builder** — the deep §4-C catalog + config emitter.
5. **Web-import + visual verify** (Playwright MCP).

---

## 8. Open questions for the user

1. **Sketch entry:** a new `sketch` *mode* (toggles behavior) or a `/sketch <idea>` *command*? (Mode =
   stickier conversation; command = one-shot.)
2. **Build depth for LLM domain:** emit a **config + scaffold** the user runs on their own GPUs, or also
   wire actual launch/monitoring (W&B) inside Bimax?
3. **First domain to build after Sketch Mode:** Website (fastest visible payoff) vs Agent (most reuse)
   vs LLM (most novel)?
4. **Blueprint storage:** `.bimax/blueprints/*.yaml` (git-tracked, editable) — good? Or fold into the
   existing `.bimax/plans/` markdown?

---

*Saved at repo root alongside GRAND_PLAN.md / ROADMAP.md. Memory pointer: [[sketch_mode_builders]].*

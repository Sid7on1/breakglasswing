# BiMax Grand Plan — CC Tech Port & Capability Layer

**Date**: 2026-06-16
**Inputs**: `bimax-vs-cc-audit/` (34-category audit) · `claude-code-source-all-in-one/` (CC TS source + universal adapter) · current `Bimax/src`
**Status of prior work**: TUI Phases 1–4 (`feat/tui-cc-parity`) shipped; Roadmap Tiers 1–5 + Graph-native engine + Ecosystem-parity cycle shipped.

---

## Implementation status

| Phase | Status | What landed |
|---|---|---|
| **A — Capability foundation** | ✅ Done | `src/core/capabilities.ts` (descriptor + curated table + env overrides + glyphs); per-key resolution (`LlmAdapter.capabilitiesForKey`, fixing the key-pool model-mix bug from §4); `KeyResult.provider` threaded through; `activeCapabilities()` accessor. **17 new tests, 340/340 pass, 0 tsc errors, CLI boots.** |
| **A3 — reasoning_effort gate** | ✅ Done | `chat()` now sends `reasoning_effort` only when `caps.reasoningEffortKnob` (o-series, deepseek-r1, minimax-default), so backends that 400 on an unknown sampling field are never sent it; `BGW_CAP_REASONING_EFFORT=true` is the escape hatch. Both polarities locked by tests. |
| **A4 — Footer capability glyphs** | ✅ Done | `capabilityGlyphs(capabilitiesFor(model))` was defined+tested but never rendered; now wired into `Footer.tsx` next to the active model (⚡cache ⊹think {}json ◉vision), empty for a floor model so the footer stays quiet. |
| **B1 — Prompt caching (C1)** | ✅ Done | `markCacheBreakpoint()` + capability-gated `cache_control` injection on the system prompt in `chat()`. Active only when `caps.promptCaching` (Claude via OpenRouter/native/Bedrock); FLOOR path byte-identical. |
| **B2 — Native-thinking bypass (C2)** | ✅ Done | `chat()` runs the `ThinkTagFilter` in non-implicit mode when `caps.nativeThinking`, so models with a real `reasoning_content` channel stream the answer token-by-token instead of buffering for an opener-less `</think>` that never arrives. FLOOR unchanged. |
| **B3 — Structured outputs (C5)** | ✅ Done | `generateTinyPlans` sends `response_format:{type:'json_object'}` when `caps.structuredOutputs`; `extractJson` stays the universal fallback. |
| **B4 — Live tool-arg streaming (C3)** | ✅ Done | New additive `tool_call_partial` ChatEvent: `chat()` emits the call (name + args-so-far) on each arg delta when `caps.partialJsonTools`; the agent loop surfaces it as a live "running" entry (display-only — the authoritative `tool_call` still drives execution, so nothing double-runs); FullScreen dedupes tool rows by id. FLOOR never emits it → behavior unchanged. Hot-path change is purely additive. |
| **B5 — Capability-driven context window** | ✅ Done | `base.persona.execute()` now falls back to `activeCapabilities().contextWindow` (Claude 200k, Gemini 1M, FLOOR 32k) when the user hasn't set `contextWindowTokens`, so compaction scales to the real model instead of a blanket 128k. Explicit user setting still wins; lookup is best-effort. 340/340 pass, 0 tsc errors. |
| **C6 — Anthropic beta headers** | ✅ Done | `anthropicBetaHeaders()` emits `anthropic-beta` (1M context / token-efficient tools / interleaved thinking) only when the call targets `api.anthropic.com` AND `BGW_ANTHROPIC_BETA` opts in with exact version-stamped tokens (model/tier-dependent; `context-1m` 400s otherwise). Default path unchanged on every backend. 22 capability tests. |
| **C — TUI cherry-picks** | 🟡 Partial | **T3 (sub-agent tool tree) ✅ Done**: worker forwards its tool events over `parentPort`; `SubAgentManager` re-emits on the main bus tagged `parentId`+`agentLabel`; `ToolCallLine` indents & labels them — `/swarm` & `/speculate` are now legible. **T2 (collapse/expand)**: truncation value already shipped (`MAX_OUTPUT_LINES`/`MAX_DIFF_LINES` + "+N more"); only the interactive *expand toggle* remains, which needs pulling rows out of Ink `<Static>` — deferred. **T1 (stable-prefix)**: already subsumed by the shipped Markdown LRU token cache + fast-path lexing; live-streaming stable-prefix is marginal and carries a prefix-reset bug risk — deferred. **T4/T5**: build on shipped search / explicitly high-risk — deferred. |
| **D — Multimodal/search** | ✅ Done | **C7 (vision) ✅**: `core/multimodal.ts` — OpenAI `image_url` data-URL format is universal across the OpenAI SDK (no per-provider divergence); gated on `caps.visionInput`, dropped-with-notice otherwise; wired through `base.persona` + FullScreen `@image.png` detection. **C8 (web search) ✅** was already shipped (`WebSearchTool` DuckDuckGo + `WebFetchTool` SSRF guard, registered in container + worker). 19 multimodal tests. |

---

## 0. The core problem this plan solves

CC has features that **only work because the model is Claude** (prompt caching, native thinking blocks, partial-JSON tool streaming, beta headers, structured outputs, fine-tuned prompts). BiMax is **model-agnostic** — it must work on NVIDIA, OpenAI, Anthropic, OpenRouter, DeepSeek, Google, local — through one **OpenAI-compatible** seam (`LlmAdapter implements LLMProvider`).

Grounding finding from the code: BiMax's `LlmAdapter` today uses **zero** Claude-specific features (grep for `cache_control`/`thinking`/`structured`/`partial_json` → empty). So Claude's advantages aren't "broken" in BiMax — they're **absent**. We don't have a regression to fix; we have an **opportunity to capture**.

**The design rule for every Claude-dependent feature:**

> Build a **capability layer**. Each model-specific power becomes a *capability flag*. When the active model advertises the capability, BiMax lights up the native fast-path. When it doesn't, BiMax falls back to a universal path that produces the *same user-visible behavior* (just less efficiently). **No feature is ever gated off for non-Claude users** — it degrades, it never disappears.

This is the opposite of CC's approach (assume Claude, bolt on a fetch-shim for others). BiMax assumes universal, and *opportunistically upgrades* on Claude. That inversion is BiMax's moat.

---

## 1. Architecture: the Capability Layer

### 1.1 New module: `src/core/capabilities.ts`

A single source of truth mapping `(provider, model)` → a `ModelCapabilities` descriptor.

```ts
export interface ModelCapabilities {
  promptCaching:      boolean;  // Anthropic cache_control / OpenAI auto-cache / none
  nativeThinking:     boolean;  // structured reasoning blocks vs <think> text scraping
  partialJsonTools:   boolean;  // streaming tool-arg deltas vs whole-blob at end
  parallelToolCalls:  boolean;  // model reliably emits >1 tool_call per turn
  structuredOutputs:  boolean;  // JSON-schema-constrained output (json_schema / response_format)
  toolChoiceForcing:  boolean;  // can force a specific tool
  visionInput:        boolean;  // image input
  contextWindow:      number;   // tokens — already threaded into AgentLoop/ContextManager
  reasoningEffortKnob:boolean;  // accepts reasoning_effort
  webSearchNative:    boolean;  // server-side web search tool
}

export function capabilitiesFor(provider: string, model: string): ModelCapabilities
export function activeCapabilities(): ModelCapabilities   // reads current provider+model
```

Resolution order: explicit per-model table → provider defaults → conservative universal floor (everything `false` except `contextWindow`). A `BGW_CAP_OVERRIDE` env / `.breakglass/config.json` block lets power users force-enable a capability their endpoint actually supports (e.g. an OpenAI-compatible proxy that does Anthropic caching).

**Why a table, not probing**: probing costs a request and is flaky. A curated table (Claude 3.x/4.x → caching+thinking+partialJson; GPT-4o/o-series → structured+parallel; Gemini → vision+structured; Llama/DeepSeek → floor) is deterministic and cheap. The override escape-hatch covers the long tail.

### 1.2 Where it plugs in

- `LlmAdapter.chat()` reads `activeCapabilities()` once per call and shapes the request (cache breakpoints, thinking config, tool_choice, response_format).
- `AgentLoop` consults it for tool-call parsing strategy (native vs `extractTextToolCalls` recovery — *already exists*, just make it capability-driven instead of always-on).
- The TUI footer surfaces a tiny capability glyph cluster (e.g. `⚡cache ⊹think`) so the user sees what the current model unlocks. Ties into the existing model-tier `▸lite/⇧heavy` display.

### 1.3 Effort
`capabilities.ts` ~180 LOC + ~120 LOC of wiring. **Risk: low** (purely additive; floor = today's behavior).

---

## 2. Claude-dependent features → universal designs

Each row: the CC/Claude power, the **native fast-path** (when capable), and the **universal fallback** (always works). This is the heart of the plan.

| # | Feature | Native (Claude/capable) | Universal fallback (every model) | BiMax module |
|---|---|---|---|---|
| **C1** | **Prompt caching** | Inject `cache_control:{type:'ephemeral'}` on system + tool schemas + stable history prefix; track cache-break points (CC `promptCacheBreakDetection.ts`) | No cache markers; rely on BiMax's existing **graph-native context packing** (send *less*, not *cached*) — a structurally different but equally effective token win | `llm.adapter.ts`, `memory/context.manager.ts` |
| **C2** | **Native thinking blocks** | Consume structured `thinking`/`redacted_thinking` deltas → `ChatEvent{type:'thinking'}` | **Already built**: `ThinkTagFilter`/`stripThink` scrapes `<think>` + `reasoning_content`. Keep as fallback; native path just bypasses the scraper | `llm.adapter.ts` (`ThinkTagFilter` exists) |
| **C3** | **Partial-JSON tool streaming** | Accumulate `input_json_delta.partial_json` → live-render tool args as they stream | Whole tool-call arrives at block end (today's behavior); UI shows spinner until complete. Plus **already built** `extractTextToolCalls` recovery for models that emit calls as prose | `agent.loop.ts`, `tool.call.parser.ts` |
| **C4** | **Parallel tool calls** | Trust multiple `tool_use` blocks; run concurrency-safe ones in parallel (**already built**, `agent.loop.ts:166`) | Same partition logic; for weak models that only emit one call/turn, the loop just iterates — same result, more turns | `agent.loop.ts` (exists) |
| **C5** | **Structured outputs** | `response_format: json_schema` for `generateTinyPlans`/classifier/decomposer | **Already built**: `extractJson` pulls balanced JSON from fenced/prose output. Native path removes the parse risk | `llm.adapter.ts` (`extractJson` exists), `task/*` |
| **C6** | **Beta-header features** (interleaved-thinking, 1M context, token-efficient-tools) | Emit the beta headers when provider === Anthropic firstParty | Omit entirely — they're pure HTTP headers, ignored elsewhere; no behavior change needed | `llm.adapter.ts` |
| **C7** | **Vision / image input** | Pass image blocks in provider format (Anthropic/OpenAI/Gemini all differ) | Models without vision: BiMax OCR/describe fallback or graceful "this model can't see images" notice | new `core/multimodal.ts` |
| **C8** | **Native web search** | Use server-side search tool when present | **Already have** `WebFetchTool` (+SSRF guard); add a search-via-fetch shim as universal path | `tools/implementations/webfetch.tool.ts` |

**Key insight**: BiMax already ships the *universal fallback* for C2, C3, C4, C5 (ThinkTagFilter, extractTextToolCalls, parallel partition, extractJson). The work is mostly (a) the capability flag, (b) the native fast-path, (c) routing between them. This is **less work than it looks** — we're formalizing what's already half-built.

---

## 3. TUI tech port (provider-agnostic — all of it works on any model)

The audit's verdict: BiMax = 3.3K TUI LOC / 17 components / stock Ink; CC = 60K / 389 / custom Ink fork. **We do NOT port CC's 15K-line custom Ink engine.** Per the existing `TUI_IMPROVEMENT_PLAN.md`, Phases 1–4 already shipped (tables, word-diff, transcript search, error boundary, ghost text, notifications, timing badge). This plan covers what remains + the few high-value engine techniques worth cherry-picking.

### 3.1 Already shipped (do not redo) — verify only
Tables · cached/fast-path markdown lexer · word-level inline diff · transcript search · React error boundary · ghost text + file-path completion · terminal notifications (iTerm2/Kitty/Ghostty) · OSC 9;4 progress · tool timing badge · dead-code cleanup.

### 3.2 New cherry-picks from CC (provider-agnostic, high ROI)

| ID | Port | CC reference | Why | LOC | Risk |
|---|---|---|---|---|---|
| **T1** | **Streaming-markdown stable-prefix** | `Markdown.tsx:186-235` | Re-lex only the unstable suffix during streaming → smooth, cheap live render. Pairs with the cache already shipped | ~90 | Med (test prefix-reset on replacement) |
| **T2** | **Collapse/expand tool output** | tool-display components | Long Bash/Grep output collapses to N lines + a toggle on the focused call | ~120 | Med |
| **T3** | **Nested sub-agent tool tree** | grouped tool-use render | `/swarm` & `/speculate` workers' tools indent under the parent — makes BiMax's flagship multi-agent work *legible* | ~150 | Med |
| **T4** | **Off-loop render-to-screen + scan** | `render-to-screen.ts` (231) | Render a message to an isolated buffer to locate match positions — upgrades transcript search to true highlight w/o touching the live frame | ~120 | Med |
| **T5** | **Interning-pool cell diff** (optional) | `screen.ts` (1486) | *Only if* a real flicker/perf bug appears at >100 msgs. Char/style interning + integer-ID diff. **Deferred** | ~400 | High |

T1–T3 are the recommended next TUI batch. T4 is a nice follow-on. **T5 stays deferred** — the existing `<Static>` + resize-remount has no active bleed bug (confirmed in `TUI_IMPROVEMENT_PLAN.md §0`).

### 3.3 Reusable CC primitives worth studying (not necessarily porting)
- **Pure-TS Yoga** (`native-ts/yoga-layout`, 2578 LOC) — only relevant if we ever leave stock Ink. Bookmark, don't build.
- **`buildTool()` defaults pattern** (`Tool.ts:757`) — BiMax's `tool.factory.ts` already does this; cross-check for parity.
- **Logical keybinding + context stacking** — BiMax's `keybindings.ts` (7 actions) is deliberately smaller; expand only on demand.

---

## 4. Model-agnostic robustness (BiMax's existing edge — harden it)

These are where BiMax already *beats* CC for a multi-model world. The plan: keep them first-class and make them capability-aware.

- **Tool-call recovery** (`tool.call.parser.ts`) — make it auto-engage when `!capabilities.partialJsonTools` and auto-disable when native tools are reliable (saves a parse pass on Claude/GPT).
- **Response sanitizer** (`response.sanitizer.ts`) — weak models leak meta-chatter; keep regenerate-on-empty. Native models rarely trigger it — that's fine, it's cheap.
- **Reasoning-effort knob** — gate the `reasoning_effort` send behind `capabilities.reasoningEffortKnob` so non-supporting endpoints don't 400.
- **Key-pool failover** (`api.key.manager.ts`) — already model-agnostic; ensure capability resolution re-runs when a key maps to a *different model* (the `<ENV>_MODEL_<n>` override case). **This is a real bug risk**: a key-pool can mix models with different capabilities mid-session. Capability must resolve per-call from the *actually-selected* key's model, not a global.

> **Action item**: `activeCapabilities()` must take the resolved `(provider, model)` from the key the call is about to use, not `process.env.BGW_MODEL`. Wire it through `ApiKeyManager.selectKey()`.

---

## 5. Sequenced roadmap

Ordered by **(user-visible value + strategic moat) ÷ effort**. Each phase ends green (tsc + jest + CLI boots) before the next.

### Phase A — Capability foundation (~300 LOC, ~1–2 days) ⭐ unblocks everything
- **A1** `src/core/capabilities.ts` — descriptor, table, resolver, override.
- **A2** Wire `activeCapabilities()` through `ApiKeyManager` (per-key model resolution — §4 bug).
- **A3** Make existing fallbacks capability-driven: `extractTextToolCalls` (C3), `reasoning_effort` gate, `ThinkTagFilter` bypass-on-native (C2).
- **A4** Footer capability glyphs.
- *Exit*: non-Claude behavior **byte-identical** to today (floor caps); Claude path detectable in logs.

### Phase B — Native fast-paths (~400 LOC, ~2–3 days) ⭐ captures Claude's advantages
- **B1** Prompt caching (C1) — Anthropic `cache_control` injection + break detection, behind `promptCaching` cap.
- **B2** Native thinking blocks (C2) — consume structured deltas when `nativeThinking`.
- **B3** Structured outputs (C5) — `response_format` for plans/classifier/decomposer when `structuredOutputs`; `extractJson` remains fallback.
- **B4** Partial-JSON tool streaming (C3) — live tool-arg render when `partialJsonTools`.
- *Exit*: measurable token/latency win on Claude & GPT-4o; zero regression elsewhere.

### Phase C — TUI cherry-picks (~360 LOC, ~2 days)
- **C-T1** streaming-markdown stable-prefix · **C-T2** collapse/expand tool output · **C-T3** nested sub-agent tool tree.
- *Exit*: `/swarm` output legible; smooth streaming; long output tamed.

### Phase D — Multimodal & search (~300 LOC, ~2 days, optional)
- **D1** Vision input (C7) — per-provider image blocks + capability gate + graceful no-vision notice.
- **D2** Native web search (C8) where available; `WebFetchTool` search-shim fallback.
- **D3** (opt) T4 off-loop render-to-screen for true search highlight.

### Phase E — Deferred / on-demand
- T5 interning-pool cell diff (only on a real perf/flicker bug).
- Pure-TS Yoga / custom Ink (only if we ever leave stock Ink — likely never).
- SSH/remote/IDE, i18n, visual config editor, Keychain (audit ⚪ low/N-A).

| Phase | Theme | LOC | Strategic value | Risk |
|---|---|---|---|---|
| **A** | Capability foundation | ~300 | Unlocks the whole model-agnostic story | Low |
| **B** | Native fast-paths | ~400 | Captures Claude's efficiency w/o losing others | Med |
| **C** | TUI cherry-picks | ~360 | Makes flagship multi-agent legible | Med |
| **D** | Multimodal/search | ~300 | Closes last capability gaps | Med |
| **E** | Deferred | — | Only on demand | — |

**~1,360 LOC across A–D** to make BiMax both *capture* Claude's model-specific powers AND keep every other model first-class.

---

## 6. Explicitly NOT doing (protect the moat)
- CC's 15K-line custom Ink fork / Yoga rewrite / panel-modal-screen router.
- The `api-adapter.ts` fetch-monkeypatch approach (it doesn't even translate streaming — §CC-adapter). BiMax's typed `LLMProvider` seam is **strictly better**; we extend it, we don't adopt the shim.
- `useSyncExternalStore` state refactor, i18n, multi-tab, SSH/IDE, Keychain — audit rates all low/N-A.
- Any feature that *requires* Claude to function. Every Claude power gets a universal fallback or it doesn't ship.

## 7. Keep & amplify (BiMax already wins — don't regress)
- **Integration/plugin system** (custom slash cmds, hooks.json, MCP client+server, skills/personas, watchers, webhook) — audit 🟢 *exceeds CC*.
- **Security governor** (7-layer, blast-gate, budget veto $cap, sandbox-exec, self-critic).
- **Graph-native context engine** — this IS the universal answer to prompt caching (send less vs cache more).
- **Multi-agent orchestration** (swarm/council/speculate/evolve/heal in worktrees) — make it *legible* via Phase C, don't rebuild.
- **Key-pool failover, provider-agnostic core, reasoning-model native handling** — the whole reason a capability layer is even coherent.

---

## 8. Open decisions for the user
1. **Capability table seeding** — start with Claude 3.x/4.x + GPT-4o/o-series + Gemini 2.x curated, floor for the rest? (Recommended.)
2. **Phase order** — A→B→C→D as written, or pull TUI Phase C earlier for visible wins?
3. **Prompt caching scope (B1)** — Anthropic-only first, or also wire OpenAI's automatic-cache reporting?
4. **Vision (Phase D)** — in scope now, or defer until an image-input use case is concrete?

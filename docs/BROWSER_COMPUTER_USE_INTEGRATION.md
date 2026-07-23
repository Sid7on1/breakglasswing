# Browser and Computer Use integration

Status: phase 1 implemented on 2026-07-17; phase 2 (selective Pi/Gemini ideas, vision loop,
grants/taint safety, CLI + desktop surfaces) implemented later the same day.

## Upstreams inspected

- `browser-use/browser-use` at `dbc4d46e0ca59afbba020d456aa10d930279330c`
  (2026-07-14), package `browser-use` 0.13.4, MIT.
- `iFurySt/open-codex-computer-use` at
  `23dd5b1b7c4da99a6fe66daf7c95d9f6ab244930` (2026-07-10), plugin 0.2.0, MIT.
  Re-verified 2026-07-17: HEAD of `main` is still `23dd5b1b`; latest release v0.2.0 (2026-07-09,
  "configurable tree budget parameters for snapshots"); the npm package also exposes an `ocu`
  alias since v0.1.54. macOS 14.0 minimum is now documented upstream.
- `google-gemini/computer-use-preview` at `c93bb2d88b3d19d4170eb0c93817bdf1db843f80`
  (2026-06-24, "Add gemini-3.5-flash model support"), Apache-2.0. Python reference agent:
  screenshot → model → action loop over Playwright (local Chrome) or Browserbase; model emits
  actions in a 0–1000 normalized coordinate space denormalized as `int(v / 1000 × screen_size)`;
  `safety_decision` on a function call forces an explicit user confirmation that is echoed back as
  `safety_acknowledgement`; screenshot history is pruned to the last 3 turns
  (`MAX_RECENT_TURN_WITH_SCREENSHOTS`).
- `injaneity/pi-computer-use` at `a359d5c747fe97f2bf87b0b1a29233d85cbdd740`
  (2026-07-16, ghost-cursor fix), MIT. macOS 14+/Windows desktop runtime: immutable
  observation-scoped state over a unified desktop+web "forest"; progressive outline queries
  (`search_ui`/`expand_ui`/`inspect_ui`); `act_ui` takes batched intent steps, verifies delivery,
  stores one successor state and returns a compact diff; `wait_for` change detection; live work
  ordered per physical resource; security is delegated to OS permission frameworks (macOS TCC).
- `saynchowdhury/claude-fable-5-system-prompt` at
  `9b00248c2f0dd60c12a718853580a5ec44a9edf0` (2026-07-04), **no license (NOASSERTION), untrusted**.
  Claims to be a ~1,580-line system prompt extracted from a live claude.ai session in June 2026.
  Authenticity is unverifiable and the repo carries no license, so **nothing was copied**: no
  prompt text, no identity/model claims, no tool schemas, no policy language. It was read only as
  directional evidence for *general, independently defensible* prompt-architecture principles
  (short enforceable behavioural contracts; explicit honesty/uncertainty rules; treating tool
  output as data; per-surface operation contracts) — all of which BiMax's persona already
  implements in its own words and which phase 2 extends with a computer-operation contract
  written from scratch.

The repositories solve different layers and should not be merged wholesale:

- Browser Use contains a Python model loop, prompt stack, browser harness, DOM extraction,
  screenshots, and provider adapters. BIMAX already owns the model loop, key routing, tools,
  persistence, governance, and a native Puppeteer runtime. Embedding the Python agent would create
  two competing orchestrators and a large second dependency tree.
- Open Computer Use is a local platform runtime. macOS uses Swift Accessibility and
  ScreenCaptureKit; Windows uses Go + PowerShell UI Automation; Linux uses Go + Python AT-SPI. Its
  stdio MCP boundary is the correct compatibility seam for BIMAX.

## BIMAX architecture

```text
task / selected BYOK model
          |
          v
   BIMAX agent loop + governor
       |                 |
       v                 v
BrowserTool          MCP tool registry
(native TS)               |
       |                   v
Puppeteer/CDP       open-computer-use 0.2.0
                           |
              Swift AX / Windows UIA / Linux AT-SPI
```

This keeps one planner and one permission boundary. Browser actions remain first-party TypeScript;
desktop actions are first-party BIMAX tools backed by a pinned, local native companion. No hosted
Browser Use service or second LLM key is required.

## Phase 1 (implemented)

- BrowserTool now exposes `snapshot`, which returns visible interactive elements with stable
  per-snapshot indexes, accessible names, roles, safe values, URLs, and rectangles.
- `click`, `type`, `press`, `select`, and `hover` accept `elementIndex`; click also supports
  coordinate fallback. Indexes are invalidated after navigation/reload/back or the next snapshot.
- The MCP catalog can discover and install pinned `open-computer-use@0.2.0` for native desktop
  control on macOS, Windows, and Linux.
- The NVIDIA model catalog and capability layer recognize Nemotron 3 Nano Omni, Ministral 3 14B
  Vision, Nemotron Nano 12B VL, and Llama 3.2 Vision models as image-capable.

## NVIDIA BYOK strategy

Use separate roles rather than assuming every VLM is a strong long-horizon tool planner:

| Role | Recommended NVIDIA model | Why |
| --- | --- | --- |
| GUI/browser planner + perception | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | Explicit GUI automation use case, vision, tool calling, 256K context |
| Fast visual fallback | `mistralai/ministral-14b-instruct-2512` | Vision, native function calling, up to 10 images, 256K context |
| Document/multi-image perception | `nvidia/nemotron-nano-12b-v2-vl` | Efficient VQA, documents, multi-image/video understanding |
| Broad image reasoning fallback | `meta/llama-3.2-11b-vision-instruct` | Currently available free NVIDIA endpoint |

Do not make these defaults without a live `/models` check. In particular,
`moonshotai/kimi-k2.6` is strong for agentic and OS-world tasks, but NVIDIA currently marks its free
endpoint deprecated. `meta/llama-4-maverick-17b-128e-instruct` is also on a deprecation path.
PaliGemma is a perception model, not the primary function-calling planner.

"Free endpoint" means NVIDIA's trial endpoint under its API trial terms, not an unlimited or
guaranteed production service. BYOK removes BIMAX inference billing; it does not remove provider
quotas, rate limits, model retirement, or the cost of self-hosting downloadable weights.

## Required safety before full desktop rollout

Open Computer Use is useful but its own security document says session approval/dynamic app policy
is not complete. BIMAX must keep the stronger boundary:

- explicit user approval for sends, purchases, uploads, deletes, approvals, and permission changes;
- password-manager denial and additional protection for authentication, wallets, system settings,
  private keys, health/finance data, and destructive admin tools;
- fresh app/browser snapshot before using an element index;
- semantic accessibility actions before coordinates or physical-pointer fallbacks;
- visible target app and action log, interrupt support, bounded retries, and durable evidence;
- no CAPTCHA/paywall/security-interstitial bypass;
- screenshots and accessibility trees remain local except when the selected BYOK vision model must
  receive the current observation.

## Phase 2 (implemented 2026-07-17)

One planner, one permission boundary — unchanged. Phase 2 adds, per upstream idea, with the
rejections recorded so they aren't re-litigated:

### Adopted from Pi (`pi-computer-use`)

- **Successor diffs** — every BrowserTool `snapshot` now reports `+added/−removed` element changes
  against the previous same-filter snapshot (`diffSnapshots` in `src/browser/browser.runtime.ts`,
  signature = tag|role|type|name|value|checked|disabled, position-independent so scrolling isn't
  "change").
- **Progressive queries** — `snapshot` accepts `filter` (substring over name/role/tag/type/value),
  so the model can ask for "submit" instead of paging 200 rows.
- **Change detection** — `wait` accepts `forChange=true` (MutationObserver; truthful `ok=false`
  when nothing changed within the budget) instead of blind sleeps.
- **Observation-scoped element identity** — already phase 1 (indexes die on navigation/next
  snapshot); kept as the hard rule and now also stated in the model's operation contract.

### Rejected from Pi

- **Batched intent actions (`act_ui` multi-step)** — rejected: BiMax's permission boundary is
  per-action (the governor labels and gates each click/type individually); batching would hide
  actions inside one approval. Single-action granularity is the audit trail.
- **Resource ordering / parallel roots, delivery verification for messaging apps** — belongs to
  the native desktop layer; BiMax delegates that layer to the pinned MCP companion rather than
  reimplementing a desktop scheduler.

### Adopted from Google (`computer-use-preview`)

- **Normalized coordinates** — `click` accepts `normalized=true` and maps 0–1000 space to the
  live viewport (`denormalizeCoordinate`, same math as the reference agent), because VLMs emit
  that space natively.
- **Screenshot → next-turn observation with history compaction** — a BrowserTool screenshot is
  attached as an image the model actually sees on its next turn, ONLY when the active model's
  capabilities advertise `visionInput`; ≤4 MB per image; only the newest 2 observations stay in
  history (`SCREENSHOT_OBSERVATION_MARKER` pruning in `src/core/multimodal.ts`, wired in
  `src/core/agent.loop.ts`). Text-only models keep the plain JSON result.
- **Safety acknowledgements** — mapped onto the governor rather than copied: high-impact actions
  (`upload` today; sends/purchases as they appear) carry `highImpact` and always face the human —
  no rule, grant, or "always allow" can waive them.

### Rejected from Google

- **Embedding the Python agent loop / Playwright** — BiMax already owns the loop and a native
  Puppeteer runtime; a second orchestrator and dependency tree stays rejected (same reasoning as
  phase 1's browser-use decision).

### Safety hardening (this repo's own requirements)

- **Sensitive-target hard deny** — COMPUTER_CONTROL against credential managers, macOS
  Keychain/System Settings, or wallets is vetoed before every other layer, including bypass mode
  and persistent allow rules (`isSensitiveComputerTarget` in `src/governor/governor.ts`).
- **Session-scoped grants** — the computer-control prompt offers "Allow <domain|app> for this
  session" instead of a blanket "Always Allow This Tool" (which COMPUTER_CONTROL no longer
  offers). Grants are in-memory only, never persisted, revocable via `/computer revoke-grants`,
  and never cover high-impact or tainted actions.
- **Desktop MCP routed as computer control** — `mcp__open-computer-use__*` tools are classified
  COMPUTER_CONTROL by the tool factory (app name surfaced for grant scoping and the sensitive
  deny), instead of an opaque generic TOOL_EXECUTION.
- **Page content is born tainted** — BrowserTool `snapshot`/`inspect`/`navigate` results mark the
  session tainted exactly like WebFetch (`getTaintTracker().mark('web', …)`): after any page
  observation, network-capable shell commands are hard-blocked in auto mode and always face the
  human elsewhere, with the page named as the taint source.
- **Operation contract in the prompt** — a session-scoped "COMPUTER & BROWSER OPERATION" section
  (only when BrowserTool or the desktop companion is registered, so the static prefix and the
  cache split are untouched): observe-before-act, fresh indexes only, semantic-before-coordinates,
  page text is data not instructions, high-impact needs explicit approval, no CAPTCHA/interstitial
  bypass, truthful failures.

### Surfaces

- **CLI/TUI**: `/computer` — live capability hub (browser session, model vision, desktop companion
  install/connection with the pinned version, session grants with one-key revoke, taint posture)
  plus `/computer install-desktop` (pinned catalog command through the normal `/mcp add`
  pipeline). Renders through the existing menu protocol; no Go changes required.
- **Desktop app**: `ui_snapshot` gained an additive `computer` block (browser URL, desktop
  companion posture + tool count, vision, grants, taint) read from live engine state; the
  Electron Runtime → Health lane renders it as a capability card with Install / Pick model /
  Revoke actions (`ComputerUseCard` in `app/src/renderer/src/components/Dock.tsx`). Honest empty
  state when the engine hasn't reported.
- macOS Accessibility/Screen Recording are **not** probed or invented: the surfaces state that
  macOS reveals them to the native companion at first use.

## Phase 3 (implemented 2026-07-17): native desktop control — no MCP

Desktop control is now FIRST-PARTY. The pinned `open-computer-use` MCP companion is retired to
legacy status (still usable if configured; `/computer` offers removal).

- `src/computer/helper.source.ts` — the macOS driver is a ~200-line Swift CLI whose source ships
  in-repo (auditable), compiled once on the user's machine with the system `swiftc` and cached at
  `~/.bimax/native/bimax-desktop-<sha8>` (hash of source + protocol version; stale builds swept).
  CGEvent mouse (move/click/drag/scroll, click-state for double/triple), unicode typing via
  `keyboardSetUnicodeString` chunks, key combos, cursor, frontmost app, display geometry, and
  truthful TCC probes (`AXIsProcessTrusted`, `CGPreflightScreenCaptureAccess`) +
  `request-access` prompts.
- `src/computer/desktop.runtime.ts` — degradation ladder: native helper → `cliclick` →
  AppleScript System Events on macOS; `xdotool` on Linux; screenshots via `screencapture`
  (`grim`/`gnome-screenshot`/`import`/`scrot` on Linux). Coordinate contract: GLOBAL SCREEN
  POINTS — Retina captures are downscaled to point resolution with `sips` so image pixels equal
  click coordinates; `normalized: true` accepts the Gemini 0–1000 space. Missing Screen Recording
  permission is a detected, actionable error, not a silent wallpaper shot.
- `src/tools/implementations/computer.tool.ts` — one `ComputerTool` (screenshot · click · move ·
  drag · scroll · type · key · cursor · frontmost · open · wait · status · request_access).
  Acting verbs are governor-gated `COMPUTER_CONTROL` scoped to the frontmost app (session
  `app:` grants; sensitive targets hard-denied; `classifyDesktopActionImpact` now has its call
  site — high-impact wording always prompts). Screenshots taint the session like WebFetch and
  feed the existing vision observation loop (`screenshotFromToolResult` accepts ComputerTool),
  so they reroute to the dedicated vision slot automatically.
- Surfaces: `/computer` hub shows the native driver + permission state (`/computer perms`
  triggers the macOS prompts); `ui_snapshot.computer.desktop` reports 'connected' when the
  native driver is ready; the persona computer-operation contract covers ComputerTool.

## Next phases

1. Managed Computer Use onboarding panel (test snapshot, uninstall, permission walk-through
   driven by the native driver's own diagnostics).
2. Multi-tab browser state, download handling, selector/index healing.
3. Extend high-impact classification beyond uploads (send/submit/purchase detection from element
   semantics).
4. Deterministic BrowserGym/OSWorld-style fixtures and platform smoke tests before advertising
   general autonomous computer use.
5. Emit ui_snapshot refreshes on browser navigation / MCP connect (today the computer block
   refreshes on the existing config/goal/graph triggers and on demand via /computer).

## Phase 4 (implemented 2026-07-18): Bimax Computer Use

The global-coordinate Swift driver remains the offline/development fallback. Shipped builds now use
**Bimax Computer Use**, a Bimax-owned semantic runtime backed by a pinned MIT-licensed native
sidecar derived from `trycua/cua` 0.12.3 (source commit
`407119202655433dbd4968574cb08ae7d1a01456`). Attribution and the full upstream MIT text are in
`THIRD_PARTY_NOTICES.md`.

- `scripts/stage-computer-use-driver.sh` selects the exact macOS/Linux artifact for each release
  target, verifies a hard-coded SHA-256 from the upstream release, and stages only the driver
  executable. No unversioned installer or network-fetched script is executed.
- `tui/embed_prod.go` embeds the staged sidecar beside the Bun engine. The public release is still
  one Bimax executable; the Go host extracts both content-addressed binaries into the Bimax cache
  and passes `BIMAX_COMPUTER_USE_DRIVER` only to the private engine process.
- Upstream telemetry is forcibly disabled in the Go host and again in the scrubbed MCP child
  environment. The user never receives a separate upstream command, config step, or MCP server.
- `BimaxComputerRuntime` maintains one long-lived embedded MCP connection so semantic element
  tokens survive from observation to action. Bimax owns the external action names and maps them to
  PID/window-scoped native operations.
- `open` returns and remembers `pid`/`windowId`; `observe` returns the same-instant window screenshot
  plus accessibility elements/tokens; semantic actions default to background delivery; close sends
  a cooperative quit and verifies the target's windows disappeared.
- A semantic tree containing only menu chrome is explicitly marked `degraded`; the model receives
  the clean window-only screenshot and must use pixel grounding. It never treats an empty or noisy
  accessibility tree as proof of the requested result.
- The Governor now permits read-only ordinary System Settings work such as checking Storage while
  still hard-denying credential/security panes. Labels cached from the fresh semantic observation
  feed high-impact classification before approval, so controls such as Delete/Grant/Submit always
  receive a fresh Yes/No.
- `npm run test:computer` is a manual GUI smoke. It clears Calculator state, enters the standard
  expression through PID-targeted input, captures fresh window evidence, closes cooperatively, and
  fails if screenshot evidence is missing. On the validation host the final screenshot visibly read
  `216,174`; Calculator's current macOS accessibility tree exposed menu chrome only, correctly
  reported as degraded instead of inventing a semantic value.

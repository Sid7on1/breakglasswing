# Bimax gap register

Snapshot: local Bimax checkout at `715dda91`, research date 2026-08-08.

Status meanings:

- **Measured** — preserved non-vacuous end-state run exists.
- **Implemented / revalidate** — code exists, but the two-product reset or current product journey
  still needs direct proof.
- **Partial** — meaningful pieces exist, but the product contract is incomplete.
- **Missing** — no acceptable implementation/evidence found.
- **Deliberate no** — not a launch requirement.

## Strengths to preserve

| Capability | Current evidence | Status | Next proof |
|---|---|---|---|
| Headless coding engine + versioned NDJSON | Semantic hello + legacy ready; generated TS/schema/fixtures; current/v2 goldens; pinned per-chip release artifact | Measured, bounded 2026-08-09 | Real tag publication, clean-Mac coding smoke and update rollback |
| Local code/file/shell agent loop | Core tools, tests, current TUI | Implemented / revalidate | Eight-task Terminal release matrix |
| Multiple providers, key pool, retry/fallback | Provider adapters and circuit breaker | Implemented / revalidate | Capability probes + config-integrity outage test |
| Worktree-isolated subagents | `src/core/worktree.manager.ts`; infra tests | Implemented / revalidate | Crash, conflict, handoff, cleanup E2E |
| Checkpoints/rewind and agent-tree state | checkpoint modules and tests | Implemented / revalidate | Restart mid-task and exact rollback fixture |
| MCP + long-running task handling | MCP client/tasks implementation | Implemented / revalidate | Current spec contract fixture and Desktop rendering |
| Code graph/impact tooling | Index/graph commands | Partial | Accuracy/latency evaluation on real repos |
| Native macOS service foundation | Swift kit, XPC/service/bridge, AX/capture/input paths; packaged arm64 component matrix | Measured, bounded | Clean-machine release matrix and broader real-app corpus |
| Narrow CU exact-state benchmark | Frozen Phase 10 denominator; qualified Phase 12.6 record | Measured, narrow only | Preserve raw record; never generalize to arbitrary GUI |

## P0 — blockers for a credible alpha

| Gap | Why it matters against rivals | Required result | Owner |
|---|---|---|---|
| Terminal boundary is landed but not clean-Mac qualified | Source/profile tests and the arm64 artifact now omit CU tools, commands, posture, presentation, and native payload embeds; x64 inventory and a clean install have not been run | Both Mac archives contain engine/TUI/licenses only and never prompt TCC on the fresh-Mac matrix | Terminal |
| Repository split is locally materialized; hosted cutover is external | Two filtered histories now build/test independently and Desktop pins the exact split Terminal engine manifest, but no GitHub migration branch or hosted CI exists yet | Owner confirms organization/names; both migration branches pass hosted CI and history/license inspection before becoming default | Shared / Release |
| ~~Desktop compiled adjacent Terminal source~~ — **Implemented, locally Measured 2026-08-09** | A copied source tree is not a stable cross-repo engine boundary | Desktop pins the engine manifest digest, verifies architecture/size/SHA-256/protocol, permits only an explicit dev override, and builds in a checkout with no Terminal `src/`; external tag publication remains release evidence | Shared / Release |
| ~~CU coordination remained in the generic engine~~ — **Implemented, locally Measured 2026-08-09** | Provider-specific policy in Terminal would violate the two-product boundary | Terminal now consumes a generic dynamic MCP descriptor; Desktop owns runtime, tools, policy, prompts, tests and benchmarks. The stored provider-schema probe and complete local Phase 4 ladder pass | Desktop |
| Desktop production CU ownership is locally package-qualified; fresh-Mac journey external | Multiple fallbacks make behavior slow and opaque | Runtime ladder, receipt inspector, packaged fail-closed policy, Desktop provider/latch and arm64 packaged semantic/physical/visual/stop + M02 matrix are **Implemented, locally Measured 2026-08-09** without duplicating `chooseMechanism`; fresh-Mac rows remain Target | Desktop |
| ↳ *component ownership* — **Implemented, locally Measured 2026-08-09** | A shipped app that obeys `BIMAX_ENGINE_CMD`/`BIMAX_CU_*` or walks to a dev engine is not the host it claims to be | Packaged runs resolve engine/XPC/bridge/helper from the bundle only; overrides refused, reported and stripped from the child env; missing engine fails visibly. Bundle hashes and four forced paths are preserved; clean-machine identity remains Target | Desktop |
| ~~Current Electron line is unsupported~~ — **Implemented, locally Measured 2026-08-08** | Trust, security, and release quality lose before UX is judged | Electron `^43.3.0` on a supported line; `sandbox`/context-isolation/no-Node stated explicitly; sender, navigation, permission and payload validation on all 22 privileged channels; macOS 13 floor enforced by packaging and the native target | Desktop |
| No provider capability conformance suite | “Provider agnostic” can mean broken tool calling | Versioned probe results gate model selection and Computer Use | Engine |
| ↳ *Desktop provider credentials and CU model preflight* — **Implemented, renderer-Measured 2026-08-11; native route reached 2026-08-13, completion Target** | A typed model ID or loading spinner is not proof that an agent can see screenshots or call tools | Desktop stores provider secrets behind main-process Keychain-backed encryption, gives catalogue requests a visible bounded failure, keeps provider setup reachable when discovery fails, and holds Control Mac until a served Work + Vision route is read back. A live app-owned run reached `mcp__bimax-mac__mac_control` and opened Calculator, but the controller narrated prospective JSON and did not complete the task. Desktop now supplies a hidden compact one-action/fresh-frame/proven-end-state contract and routes that controller to the compact playbook; a fresh granted rerun remains Target | Desktop / Engine |
| No durable outcome/task contract | Models can forget completion criteria after compaction/failover | Persisted outcome, constraints, checks, budgets, and revisions | Engine protocol |
| ~~Mac receipt inspector is implemented; cross-lane final receipt remains incomplete~~ — **Implemented, locally Measured 2026-08-09** | Rivals show tools/diffs; Bimax needs a stronger proof surface | The Receipt lane now links each claim to its evidence across BOTH lanes (changed files + the check that proves them, Mac actions + their confirmed end state) and refuses to call a task complete when a check failed, an action never confirmed, evidence went stale, or an action was refused during a takeover. Live cross-lane proof on a real provider run (X01) remains Target | Shared/Desktop |
| Background Mac operation is package-component proven locally; the pause journey now has a UI | Earlier demo stole focus and felt much slower than ChatGPT CU | M02 fixture/grader is **Implemented, locally Measured 2026-08-09** at 9/9 through the arm64 bundle's service. The **user-facing pause/takeover/resume control is Implemented and locally Measured**: main owns the latch, the provider mirrors it read-only and fails closed, and J5 grades the visible end state while `takeover.guard.test.ts` grades that nothing crosses the bridge. Clean-machine remains Target | Desktop/native |
| ~~Physical-input path is end-state-unverified~~ — **locally Measured 2026-08-09** | `CGEvent.postToPid` was correctly falsified instead of trusted | Approved HID/WindowServer typing changed the exact live fixture target, with receipt and independent effect read-back; targeted events stay unadvertised | Native |
| ~~Visual capture path is red on the current local machine~~ — **locally Measured 2026-08-09** | The old grader selected a 33-pixel auxiliary window; a suspended stream also needed a bounded fallback | Exact visible-window stream produced complete 1120×984 frames; macOS 14+ one-shot fallback is implemented | Native/Desktop |
| Crash recovery has a renderer journey; the live kill/resume journey is still open | Long tasks are table stakes | J3 proves the app STATES a crashed engine, offers Try again / Start safely / Restore last task, and restores the thread and its review evidence — the recovery banner existed since Phase 2 but had no consumer, so a crashed engine previously produced a silently dead task surface. Killing a real engine/app mid-task (C04) remains Target | Shared |
| Public install/update trust has a local manual-alpha path; publication is blocked | A beautiful app that Gatekeeper/TCC distrusts is not a product | Arm64 candidate has exact DMG + 294-entry app manifest, prominent unsigned/unnotarized UI/docs, mutation rejection, rollback installer and regrant warning. Public v1.1.0 engine URL is 404; clean-Mac/publication remain Target | Release |
| ↳ *in-app build and component identity* — **Implemented, locally Measured 2026-08-09** | "Exact in-app build/service hashes" is a manual-alpha distribution requirement | Trust Center measures app executable plus exact resolver-selected engine/provider/XPC/bridge/helper SHA-256 and real codesign/Gatekeeper/notarization state. Candidate is truthfully ad-hoc/unnotarized; stable identity remains Target | Desktop / Release |
| ↳ *live permission truth and add-by-drag guidance* — **Implemented; renderer, native-icon, packaged-sheet and installed-coach Measured through 2026-08-13** | A stale green tick or decorative drag affordance makes the safety surface untrustworthy | Trust Center polls non-prompting main-process readings, separates Electron-host and native-service Accessibility/Screen Recording truth, hides the main sheet while Settings is the destination, and starts a real native drag for the exact host/service bundle with deterministic raw BGRA icon data. Accessibility, Screen Recording and Full Disk Access expose that bundle drag; Microphone correctly uses the native media request instead of pretending it is draggable. The coach now tears down 1.2 seconds after native drag return and explicitly restores/shows/focuses Bimax, avoiding the cached-TCC trap. The installed app visibly returned in about 1.8 seconds after a Full Disk Access drag without Cancel. That optional grant remained off, so the run proves handoff/return rather than TCC mutation. Final `ai.bimax.app` clean-Mac deny/grant/revoke/regrant remains Target | Desktop/native |
| ↳ *app-owned CU approval handoff* — **Implemented and locally Measured 2026-08-13** | Repeating a generic destructive-tool prompt for every Mac action makes the app lane unusable; broadly suppressing prompts would erase trust boundaries | An explicit Control Mac submission creates a task-scoped token that auto-answers only the exact `mcp__bimax-mac__mac_control` approval question. Taint warnings, other MCP providers and non-Mac tasks still surface normally. Two consecutive installed app runs reached the provider and completed open/focus operations without a visible Allow modal; engine logs recorded both internal approvals. Stronger mutation/end-state proof remains Target | Desktop/Engine |
| ↳ *Accessibility regrant loop after local rebuild* — **Implemented for one-build completion; stable-update persistence remains Target 2026-08-13** | An old Bimax row can remain visibly On after a new ad-hoc signature while `AXIsProcessTrusted` correctly denies the new process, making setup look like an app loop | Existing-row guidance now says to switch the current row Off then On once; a completed host Accessibility/Screen Recording bundle drag closes the coach and relaunches Bimax so the new process reads TCC. Full Disk and service drags retain their non-relaunch return. Five focused tests pass. Developer ID signing and permission persistence across a real update remain the only stable-release answer | Desktop / Release |
| Native CU artifacts are staged but not source-reproducible in this checkout — **Partial; rebuild Target 2026-08-11** | Ad-hoc re-signing an existing service is not the same as rebuilding an owned native capability | Restore/provenance-audit the missing `BimaxCuBridge`/`BimaxFocusBridge` Swift targets and `app/src/capabilities/mac/helper.source.ts`, then produce a fresh architecture-bound bundle and rerun signature/TCC/action gates. Current staged service reports an intact ad-hoc signature but denied Accessibility and Screen Recording | Desktop/native |
| ↳ *unsigned local CU service approval* — **Implemented, locally Measured 2026-08-11** | Manual alpha has no Developer ID identity, but a blanket unsigned bypass would erase the service boundary | The in-app bridge probes the sealed service, displays its full Code Directory hash, accepts only that exact re-probed hash, persists/revokes the local decision, and re-runs the service handshake. It explicitly does not claim builder provenance or bypass TCC. 17 targeted trust tests and J10 pass; Developer ID remains Target | Desktop / Release |

## P1 — table stakes before stable

| Gap | Competitive baseline | Required result |
|---|---|---|
| Agent Skills standard and discovery UX | Hermes/OpenCode/Codex/Claude/Zed | Compatible SKILL.md loading, permission scopes, cache-safe refresh, manager UI |
| Narrow hooks/plugin boundary | Hermes/Codex/Claude/OpenCode | Lifecycle hooks with concrete consumers; no universal speculative framework |
| First-class review scopes | Codex/Cursor/Hermes/Zed | Last turn, uncommitted, staged, branch; line comments and safe revert/stage |
| Worktree task handoff | Codex/Zed/Cursor | Local ↔ isolated continuation preserving thread and git state |
| Visible subagent steering | Codex/Claude/Cursor | Inspect, message, interrupt, and close without transcript confusion |
| Goal controls | OpenAI/Claude | Pause, resume, edit success criteria, status recap, bounded continuation. Phase 5 landed the task's one state, plan progress, Stop and the Mac pause/resume; editing success criteria and bounded continuation remain Target |
| Browser-first testing | OpenAI/Cursor/Hermes | Web tasks use structured browser before generic Mac clicks; artifacts attached |
| Context/prompt cache discipline | Hermes/Codex | Content-addressed fragments, diff updates, cache metrics, safe compaction |
| Programmatic bounded tool calls | Hermes/OpenAI model tooling | Sandboxed dispatcher with nested permission enforcement and compact results |
| ACP support | Zed/Hermes/OpenCode ecosystem | Bimax Terminal usable as external agent without copying engine into the host |
| Always-allowed Mac apps | ChatGPT Computer Use documents a revocable always-allowed list | Named capability grants that survive a task, visible and revocable in Trust Center. Phase 5 deliberately shipped no UI for this because the capability does not exist |
| Diagnostics export — **Implemented, locally Measured 2026-08-09** | Mature desktop products | Trust Center writes a user-chosen local allowlisted JSON with build/signature/hash/permission and bounded crash metadata; paths, source/file contents, transcripts, secrets/env, raw logs and crash tails are omitted. Fresh packaged UI journey remains Target |

## P2 — differentiation after stable foundations

| Capability | Why it can win | Gate |
|---|---|---|
| Cross-lane tasks | One request edits code, runs it, operates app, proves outcome | Three real-app fixtures with code + Mac receipts |
| Model-normalized router | Best verified route per task class, not vendor default | Offline A/B replay plus live canary without config mutation |
| Workflow record/replay | Turn successful Mac flows into inspectable deterministic skills | Replay on changed window state without stale coordinates |
| Evidence-aware review | Reviewer sees claim → evidence links, not only diff | Findings cite fresh receipt/test/action object |
| Private local eval lab | Continuous failure corpus becomes harness advantage | Same task across model tiers, builds, and executor paths |
| Optional remote worker | Long jobs can leave the laptop later | Local semantics preserved; explicit data/secret boundary |
| Contextual Task Guard (section 28) | Bimax can compare agent/toolchain behavior with the actual task and project | S28-A/B/C landed 2026-08-09: causal receipts across every Bimax-owned subsystem, deterministic Layer A/B/C floors, drift detection that rescans after overflow and never infers an actor, and reversible correction where an unestablished postcondition rolls back. S28-01–09 and S28-11 pass as deterministic fixtures. S28-10 and S28-12 remain open — no labeled corpus, so no false-positive or overhead budget is measured, and no fresh-Mac run exists |
| Verified capability ecosystem (section 29) | Modular environments without turning plugins into an unbounded attack surface | S29-A/B and S29-C are **Implemented locally**: manifest, one-rung graph, non-executing inventory, skill/MCP authority separation, TUF-shaped metadata, bounded staging, byte-exact rollback, opaque path handles and a Desktop-owned out-of-process digest-bound worker. Runtime composition landed 2026-08-10. Open: a real signing key/catalog operator, promoted executable pack and clean-Mac activation gates |
| ML Alchemist (section 29) | Apple-silicon-focused model research through deployment with evidence | Named isolated MLX/Core ML workflows and baseline/candidate quality, behavior, device, latency, memory, size, energy and export-integrity gates are **Implemented locally**. Real MLX/Core ML packages, models and device measurements remain Target |
| Measured adaptive runtime/rendering (sections 27/29) | Preserve interaction while using device state intelligently | One bounded background-concurrency canary plus signal replay is **Implemented locally**; rendering stays shadow except Reduce Motion. Supported-device energy/frame matrix remains Target |

## Deliberate no through stable v1

| Feature | Decision |
|---|---|
| Dozens of messaging gateways | Deliberate no; integrate later via MCP/plugins if demanded |
| Voice/wake word/TTS marketplace | Deliberate no |
| Image-generation catalog | Deliberate no |
| Many memory-provider plugins | Deliberate no; ship one inspectable memory contract first |
| Greenfield code-editor engine | Deliberate no; compose Bimax's integrated IDE from current CodeMirror/xterm/git/review/task surfaces and retain editor handoff/ACP |
| User-selectable AX/OCR/physical modes | Deliberate no in normal UX; Diagnostics can force paths for testing. Phase 5 keeps executor/mechanism vocabulary inside a per-action Details disclosure in the Live Target and the transcript |
| “100% arbitrary computer use” claim | Deliberate no; publish denominators and confidence |

## Old claims that require revalidation

The following may exist in code but cannot be used as current competitive claims until their journey
passes `06_HEAD_TO_HEAD_EVALS.md`:

- “verified end-to-end” Swarm;
- “unique” Council;
- safe self-evolution;
- self-healing until green;
- provider failover through a long autonomous run;
- code-graph accuracy;
- worktree isolation “never touches your branch”;
- full checkpoint/rewind safety;
- arbitrary computer-use success.

This is not a judgment that they are fake. It separates implementation history from current
product evidence after a major architecture split.

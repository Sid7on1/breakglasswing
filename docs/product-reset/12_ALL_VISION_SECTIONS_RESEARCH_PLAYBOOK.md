# All vision sections: research leads, algorithms, examples and prompts

Status: **research playbook / Target**, 2026-08-08. This document covers every distinct numbered
chapter in the owner vision. It is a map of evidence and experiments, not a claim that every target
is Implemented, Measured, Product-ready, or a Win.

## 0. Normalized inventory and coverage rule

The source contains sections 1–34 plus later owner additions numbered 27, 28, and 29. To avoid
silently merging different ideas, this playbook assigns stable research IDs:

| Research ID | Owner heading |
|---|---|
| V01–V26 | original sections 1–26 |
| V27A–V34 | original sections 27–34 |
| V27B | Hardware-Informed Mathematical & Algorithmic Execution |
| V28B | macOS Intelligence, Correction & Unusual Activity Detection |
| V29B | Modular Chipset-Native Developer Ecosystem |

There are therefore **37 distinct chapters**, not 29 distinct ideas. V28B and V29B have a separate
1,100-line deep plan in `11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md`; they remain summarized here
so the full inventory is searchable in one place.

Each packet below contains:

- a research conclusion and scope boundary;
- primary leads or authoritative implementation references;
- candidate algorithms/data structures, including when not to use them;
- a concrete Bimax example or sample artifact;
- proof experiments;
- reusable research prompts for a human, web researcher, or future agent.

“Researched” here means a credible primary-source lead set and falsifiable next experiment exist.
It does **not** mean the product result has been measured.

---

# Part I — silicon, macOS, performance, network and policy

## V01 — Silicon-Aware Architecture

**Conclusion.** Detect supported capabilities and current pressure, not marketing chip names. Apple
does not expose every microarchitectural detail as a stable product API. Use `ProcessInfo`, Metal
device capabilities, memory pressure, Core ML compute choices, architecture, and measured workload
profiles. Keep Intel/x64 behavior explicit where shipped.

**Leads.** Apple `ProcessInfo` thermal/low-power APIs; Metal device inspection,
`hasUnifiedMemory`, `recommendedMaxWorkingSetSize`, and feature tables; Core ML compute units;
Accelerate; Instruments Energy Log and MetricKit. Treat `system_profiler`/`sysctl` output as a
versioned compatibility probe, not the primary contract.

**Algorithms.** Capability vector; constrained multi-objective selection; workload bucketing;
EWMA/quantile tracking; hysteresis state machine; weighted fair scheduling; Pareto frontier across
latency, memory, energy and quality. Begin with static rules, then contextual bandits only after
offline replay and safe exploration bounds.

**Sample.** `MachineProfile { arch, os, cpuCount, lowPower, thermal, memoryPressure,
metal:{unified,recommendedWorkingSet,families}, coreMLUnits, measuredProfiles[] }`. A 16 GB fanless
Mac pauses background indexing at serious thermal pressure; a Studio may increase background
concurrency only if interaction latency remains inside budget.

**Experiments.** Run the same indexing, diff, OCR and local-inference fixtures on supported Macs;
record p50/p95 latency, peak RSS, memory-pressure events, energy proxy, thermal transitions and
interaction hitches. Mutation: fake a high-end chip name while capability flags are missing—the
policy must not select the unsupported path.

**Research prompts.** `Apple supported APIs for runtime hardware capability detection on macOS`; `MTLDevice capability queries versus Mac model-name branching`; `thermal-aware scheduling with hysteresis on laptops`; `how to benchmark sustained rather than burst Apple-silicon performance`.

## V02 — macOS-Aware Runtime

**Conclusion.** “Native” is a boundary decision: React/Electron may own the complex agent workspace;
Swift/AppKit/XPC owns Mac services, permissions, capture and input. Use the smallest Apple framework
that adds measurable value. Do not wrap every feature in Swift or load native privilege into the
renderer.

**Leads.** AppKit/SwiftUI interoperability; XPC and Service Management; App Sandbox and
security-scoped bookmarks; Keychain Services; ScreenCaptureKit; Accessibility; Core Animation;
Quick Look; Spotlight/Core Spotlight; Uniform Type Identifiers; drag/drop and macOS HIG.

**Algorithms.** Process isolation; actor/serial-queue ownership; capability handles instead of path
strings; state restoration; debounced native notifications; backpressure over XPC; crash-loop
breaker; lease-based resource ownership.

**Sample.** Electron main asks an authenticated XPC service for `observeWindow(bundleID, windowID)`;
the service returns a typed observation and never a raw AX handle. Renderer receives only schema-
validated data through a narrow preload API.

**Experiments.** Kill/restart engine, renderer and XPC service independently; corrupt an XPC frame;
revoke a security-scoped bookmark; change display/session state. The app must remain recoverable and
must identify which process owns the failed capability.

**Research prompts.** `Apple XPC client identity validation audit token macOS`; `AppKit SwiftUI
interoperability performance tradeoffs macOS`; `security scoped bookmarks stale resolution design`;
`Electron utility process versus XPC for native privileged work`.

## V03 — Performance Philosophy

**Conclusion.** Optimize user-perceived latency and tail behavior before throughput. Apple describes
roughly 100 ms as noticeable for discrete interaction and much tighter budgets for continuous UI
work. The exact Bimax budget must be measured per interaction, not copied as a universal constant.

**Leads.** Apple “Improving app responsiveness”; Instruments Time Profiler, Hangs, Hitches,
Allocations and Points of Interest; OSLog signposts; MetricKit; XCTest metrics; Electron performance
guidance and Chromium tracing.

**Algorithms.** Critical-path DAG; deadline-aware queues; cooperative cancellation; lazy loading;
request coalescing; incremental computation; stale-while-revalidate; TinyLFU/ARC-style bounded
caches; chunking; backpressure; priority inheritance; p95/p99 regression gates.

**Sample.** A `PerformanceBudget` assigns 5 ms main-thread work during scrolling, 50 ms composer
feedback, bounded first useful paint, and separate budgets for model/harness/tool latency. Indexing
work yields when interaction begins and resumes after a cooldown.

**Experiments.** Trace cold/warm launch, first task, 100k-line diff, terminal flood, live screenshot,
and concurrent local model. Inject 200 ms disk/network stalls. Grade dropped frames, input delay,
main-thread blockage and cancellation—not benchmark throughput alone.

**Research prompts.** `Apple Instruments hang hitch signpost macOS performance test`; `tail latency
budgets interactive desktop apps`; `bounded cache admission TinyLFU versus LRU developer tools`;
`Electron main renderer responsiveness tracing`.

## V04 — Internet-Aware API Architecture

**Conclusion.** Bimax can observe the path available to its own process, endpoint timing and request
outcomes; it cannot reliably infer or control BGP/CDN internals. Adapt retries, concurrency,
streaming and cache behavior using supported Network/URLSession facts and application measurements.

**Leads.** Network framework and `NWPathMonitor`; URLSession configuration, connection metrics,
`waitsForConnectivity`, constrained/expensive access and background transfer; HTTP semantics,
idempotency, Retry-After; TLS trust; QUIC/HTTP/3 documentation from IETF and Apple.

**Algorithms.** Exponential backoff with full jitter; token bucket; adaptive concurrency/AIMD;
circuit breaker; deadline propagation; resumable/chunked transfer; idempotency keys; connection
pooling; request deduplication; hedging only for safe/idempotent reads; EWMA latency and quantiles.

**Sample.** `NetworkProfile { pathStatus, expensive, constrained, interfaces, endpointRTT,
failureClass, serviceHealth }`. On a constrained path, Bimax disables speculative prefetch and
reduces artifact upload concurrency but never silently downgrades security or duplicates mutations.

**Experiments.** Network Link Conditioner/toxiproxy fixtures for loss, latency, DNS failure, offline
transitions and mid-stream disconnects. Mutate an API response after server-side success but before
client receipt; retry must inspect idempotency/postcondition instead of duplicating the action.

**Research prompts.** `URLSessionTaskMetrics connection reuse DNS TLS timing`; `adaptive concurrency
limit AIMD API client`; `idempotency keys retry lost response distributed systems`; `HTTP/3 QUIC
availability macOS Network framework`.

## V05 — Runtime Policy Engine

**Conclusion.** The policy engine is a bounded controller, not one giant AI score. Separate hard
safety constraints, user preferences, resource budgets, performance policy and learned advisory.
Every decision must be explainable, versioned and replayable from the same input snapshot.

**Leads.** `ProcessInfo`, dispatch QoS and memory pressure, Network path, Core ML compute units,
Metal capacity, accessibility Reduce Motion; control theory; contextual bandits; constraint solvers;
policy-as-code concepts such as ABAC.

**Algorithms.** Hierarchical policy: invariants → feasibility filter → cost function → strategy;
finite-state machine with hysteresis; weighted resource budget; model-predictive control only for a
well-modeled slow loop; contextual bandit for reversible low-risk choices; cooldown/minimum dwell.

**Sample.** `Decision { snapshotHash, eligibleStrategies, rejected:[reason], selected, policyVersion,
expectedCost, expiresAt, override }`. “Use local small model” may win only after security, memory,
quality and deadline constraints are satisfied.

**Experiments.** Replay recorded sensor traces; inject noisy thermal/memory/network changes; assert no
oscillation and bounded transition rate. Shadow/canary each policy before automatic activation.
Compare against a static baseline; remove a policy with no measured benefit.

**Research prompts.** `hierarchical policy engine hard constraints multi objective scheduling`;
`hysteresis minimum dwell time adaptive resource controller`; `contextual bandit safe exploration
runtime systems`; `model predictive control thermal scheduling interactive applications`.

---

# Part II — developer environment intelligence

## V06 — Developer Environment Intelligence

**Conclusion.** Inventory is evidence with provenance, not a list of executables found on PATH.
Discovery must not source untrusted profiles or execute project scripts. Distinguish system, vendor,
manager, user and project-local installations and record architecture/version/identity.

**Leads.** Language/runtime official version commands and structured metadata; Python packaging
specifications; Node package metadata; rustup; Go environment JSON; Java toolchain APIs; Swift/Xcode;
Homebrew structured queries.

**Algorithms.** Evidence fusion with precedence; path canonicalization; content hashing; weighted
confidence; parallel read-only probes with deadlines; entity resolution by realpath, digest and
manager ownership; incremental invalidation.

**Sample.** `EnvironmentFact { kind:runtime, name:python, version:3.12.4, arch:arm64, path,
realpath, owner:pyenv, scope:user, evidence:[...], observedAt, confidence }`.

**Experiments.** Fixtures with duplicate shims, broken symlinks, Rosetta binaries, malicious shell
profiles and slow version commands. Inventory must be deterministic, redacted and non-mutating.

**Research prompts.** `safe developer tool inventory without sourcing shell profile`; `detect
binary architecture code signature owner macOS`; `structured runtime version discovery JSON`;
`developer environment inventory schema provenance`.

## V07 — Runtime Version Managers

**Conclusion.** Resolve the current project using manager declarations and actual invocation
semantics. “Newest installed” is almost never a safe default. Shell-specific managers complicate
noninteractive resolution, so Bimax must show ambiguity rather than imitate a login shell blindly.

**Leads.** mise/asdf/pyenv/nvm/fnm/rbenv/SDKMAN/Conda official configuration and precedence docs;
Python virtual environments; `packageManager`/tool-version files; shell startup order.

**Algorithms.** Ordered precedence lattice; nearest-ancestor configuration search; constraint
intersection; semantic-version range solving; shim resolution trace; ambiguity/conflict detector.

**Sample.** From `/repo/service`, Bimax traces `.tool-versions → asdf shim → installed Node 22.8`,
then compares `package.json engines`. It does not choose `/opt/homebrew/bin/node` merely because it
appears earlier in the app's inherited PATH.

**Experiments.** Nested monorepos, multiple managers declaring the same runtime, unset shell
initialization, stale shims and incompatible constraints. Grade the exact executable used by the
project command.

**Research prompts.** `asdf mise pyenv runtime precedence nested project`; `noninteractive nvm
resolution without sourcing untrusted profile`; `semver constraint intersection algorithm`;
`detect Rosetta runtime versus arm64 native executable`.

## V08 — Package Manager Awareness

**Conclusion.** Lockfile and project metadata select the manager; they do not authorize installation.
Parse before invoking. Treat lifecycle scripts and native builds as code execution. Preserve frozen
or locked semantics unless the user explicitly requests a dependency change.

**Leads.** npm/pnpm/Yarn/Bun lock and lifecycle docs; Python `pyproject.toml` and `pylock.toml`;
uv/Poetry/Conda; Cargo.lock; Gemfile.lock; Composer.lock; lockfile design research.

**Algorithms.** Manifest/lock detector with confidence; dependency DAG; SAT/PubGrub-style resolution
only when Bimax owns a resolver decision; integrity verification; topological install plan;
transaction diff; script-capability classification.

**Sample.** Presence of `pnpm-lock.yaml` plus `packageManager: pnpm@...` yields a read-only plan for
`pnpm install --frozen-lockfile`. A new package request previews direct/transitive changes, scripts,
download size and rollback before running.

**Experiments.** Conflicting lockfiles, stale lock, missing manager, lockfile mutation, install-script
network access and interrupted install. Verify exact post-install graph and dirty-file preservation.

**Research prompts.** `package manager lockfile precedence monorepo`; `PubGrub dependency resolver
algorithm explanation`; `disable inspect lifecycle scripts npm pnpm`; `PEP 751 pylock reproducible
installation`.

## V09 — Homebrew and System Tools

**Conclusion.** Use Homebrew's structured JSON and Brewfile semantics. Do not scrape human output or
assume `/opt/homebrew` versus `/usr/local` solely from architecture. A formula/cask/tap can carry
trust, license, service and architecture implications.

**Leads.** Homebrew Querying Brew, manpage, Brew Bundle/Brewfile, Tap Trust, services and JSON API;
macOS `pkgutil`, LaunchServices and code-signing inspection for non-Brew tools.

**Algorithms.** Inventory normalization; tap/formula/cask dependency graph; source-trust scoring;
version pin/conflict detection; delta planner; disk-impact estimate; reversible service-state plan.

**Sample.** Before proposing PostgreSQL, inventory existing formulae, casks, running services and
project container configuration. Show whether the proposal adds a global service and which port/data
directory it will own.

**Experiments.** Dual Intel/arm prefixes, untrusted tap, pinned formula, disabled analytics, offline
metadata, existing service/data. Uninstall rollback must never remove user databases.

**Research prompts.** `Homebrew brew info json schema installed formula cask`; `Homebrew tap trust
security model`; `brew services state inventory rollback`; `macOS pkgutil receipt inventory`.

## V10 — SDK and Compiler Awareness

**Conclusion.** Compiler name is insufficient. Resolve selected developer directory, SDK,
toolchain, target triple, deployment target, architecture and license/first-launch state. Xcode CLI
Tools are not identical to full Xcode.

**Leads.** Apple installing command-line tools; `xcode-select`, `xcrun`, `xcodebuild`, `swiftc` and
SDK docs; rustup toolchains/targets; Go env; Java toolchains; Android SDK/NDK manager; .NET SDK.

**Algorithms.** Toolchain capability matrix; constraint intersection; target-triple normalization;
probe cache keyed by executable digest and selected developer directory; compatibility graph.

**Sample.** `CompilerProfile { driver:clang, path:xcrun-resolved, sdk:macosx, sdkVersion,
target:arm64-apple-macos13, xcodeBuild, supports:[...] }`.

**Experiments.** CLT-only Mac, two Xcodes, beta Xcode, invalid selected path, missing license, x64
target on arm64 and unavailable simulator SDK. Fail visibly without rewriting global selection.

**Research prompts.** `xcrun selected developer directory toolchain SDK resolution`; `Xcode CLT
versus full Xcode command availability`; `compiler target triple deployment target compatibility`;
`Android NDK side by side version discovery`.

## V11 — Local Development Infrastructure

**Conclusion.** “Installed,” “configured,” “running,” “healthy,” and “belongs to this project” are
different states. Read configuration and structured runtime state before touching services. Avoid
scanning arbitrary local ports as a discovery shortcut.

**Leads.** Docker/Compose inspect and project listing; Podman machine inspect; service-specific
health/status APIs; launchd/Service Management; database connection metadata; Ollama/LM Studio/MCP
documented endpoints.

**Algorithms.** Service identity graph; health state machine; declared-port map; process/container
correlation; dependency DAG; readiness/liveness probes; lease and cleanup ownership.

**Sample.** A repository's Compose file declares Postgres. Bimax reports image digest, project name,
container state, bound port, volume and health without starting it. Starting becomes a separate,
approved transaction with cleanup receipt.

**Experiments.** Stale socket, conflicting port, stopped VM, wrong Docker context, unhealthy
container, persistent volume and two projects sharing a service. Never destroy ambiguous resources.

**Research prompts.** `Docker compose project identity inspect JSON`; `Podman machine macOS inspect
resource limits`; `local database service ownership detection developer tool`; `MCP server health
capability discovery`.

## V12 — IDE and Editor Awareness

**Conclusion.** Detect editors only to improve handoff, file/window context and extension protocol
integration. Do not monitor editor content globally or inject plugins without consent. Bimax's own
IDE remains a task/evidence workspace built from existing components.

**Leads.** LSP and Debug Adapter Protocol; ACP; editor URL/CLI handoff contracts; Xcode source/editor
extensions; macOS LaunchServices and NSWorkspace; Apple automation/Accessibility boundaries.

**Algorithms.** Capability negotiation; document URI/version mapping; least-recently-used handoff
preference; workspace identity matching by canonical root; conflict detection for unsaved buffers.

**Sample.** “Open finding” uses the user's configured editor adapter with file, line and project
root. Before an external edit, Bimax warns if the editor reports a newer unsaved document version.

**Experiments.** Multiple windows/workspaces, moved repository, unsaved buffer, unavailable editor,
remote workspace and filename with spaces. Working tree must not change during handoff.

**Research prompts.** `Agent Client Protocol editor agent interoperability`; `LSP document version
unsaved buffer synchronization`; `macOS NSWorkspace open file line editor`; `Xcode source editor
extension limitations`.

## V13 — Project Environment Discovery

**Conclusion.** Project expectation is inferred from multiple declarations with provenance and
confidence. Never decide framework/runtime from one filename when monorepos, generated files and
nested workspaces exist.

**Leads.** Package/project manifests, lockfiles, workspace formats, CI configuration, devcontainer,
Compose, Xcode/Gradle/Cargo/Go/Python metadata, git worktree state and deployment descriptors.

**Algorithms.** Root detection by marker scoring; nearest-ancestor search; weighted evidence fusion;
monorepo DAG; command extraction with static parsing; conflict/ambiguity reporting; secret-aware
redaction.

**Sample.** `ProjectContract { roots, languages, frameworks, runtimeConstraints, manager,
lockfiles, commands:[source], services, deployTargets, gitState, unresolved[] }`.

**Experiments.** Polyglot monorepo, nested package, misleading README, absent dependencies, generated
manifest, detached worktree and secret-valued config. Compare inferred contract with maintainer-
authored ground truth.

**Research prompts.** `monorepo project root detection algorithm marker scoring`; `static extract
project commands package json makefile CI`; `developer environment inference benchmark corpus`;
`configuration secret redaction schema discovery`.

## V14 — Developer Environment Graph

**Conclusion.** Use a typed property graph or normalized relational core with explicit provenance;
do not start with a universal knowledge graph. Nodes and edges need identity, observation time,
scope, confidence and invalidation rules.

**Leads.** Package dependency graphs; build systems' incremental graphs; software bill of materials;
provenance models; content-addressed stores; graph database and Datalog incremental-query research.

**Algorithms.** DAG/topological sort; strongly connected components; shortest explanation path;
constraint propagation; incremental view maintenance; Merkle hashing; bitemporal validity; union-find
for entity resolution.

**Sample.** `project → requires Node >=22 → resolvedBy mise → executable digest → arch arm64`, with
separate `observedAt` and `validDuring`. A UI answer cites the path rather than presenting an opaque
conclusion.

**Experiments.** Cyclic dependencies, renamed executable, manager upgrade, project move and stale
facts. Query results must identify which changed observation invalidated them.

**Research prompts.** `incremental property graph provenance developer environment`; `Datalog
incremental dependency analysis`; `bitemporal facts environment inventory`; `Merkle DAG package
environment state`.

## V15 — Incremental Environment Tracking

**Conclusion.** File events are invalidation hints. Coalescing, overflow, rename and missed events
require exact targeted rescans. Track only approved roots and known manager locations; never watch
the whole disk by default.

**Leads.** FSEvents programming guide; Dispatch vnode sources; package-manager cache/index behavior;
git index/stat cache; periodic reconciliation patterns.

**Algorithms.** Debounce/coalesce; dirty-set propagation; event-sequence checkpoint; bounded work
queue; exponential rescan; Merkle subtree hashes; TTL by fact volatility; overflow-to-rescan state
machine.

**Sample.** A change to `pnpm-lock.yaml` invalidates dependency and command projections for one
workspace, not the entire machine inventory. FSEvent overflow marks evidence incomplete until a
root rescan finishes.

**Experiments.** Event storm, directory rename, sleep/wake, dropped events, network filesystem and
100k-file monorepo. Measure time-to-consistency, CPU/wakeups and missed-change rate.

**Research prompts.** `FSEvents sinceWhen event ID overflow MustScanSubDirs`; `incremental index
dirty set propagation algorithm`; `Merkle tree filesystem change detection`; `event debounce
correctness rename coalescing`.

---

# Part III — editing, filesystem mutation and closed-loop execution

## V16 — File Editing Intelligence

**Conclusion.** Select the smallest correct edit strategy from file type, structure, change shape,
concurrency and validation support. AST edits are not universally safer: format-preserving text or
specialized config editors may be better.

**Leads.** Tree-sitter incremental parsing and queries; LSP workspace edits/document versions;
compiler refactoring APIs; JSON/YAML/TOML format-preserving libraries; editor rope/piece-table
design; patch/diff algorithms.

**Algorithms.** Exact anchored patch; Myers/patience/histogram diff; syntax-node range edit; tree
edit distance; piece table/rope/gap buffer for active documents; interval tree for overlapping edits;
three-way merge for stale base.

**Sample.** `EditPlan { baseHash, encoding, strategy:syntaxRange, edits:[startByte,endByte,text],
expectedSymbols, validation, fallback:none }`. A known function body uses its fresh syntax range;
ambiguous repeated text must not use global replacement.

**Experiments.** Tiny/huge file, repeated anchor, Unicode combining text, CRLF, formatter churn,
syntax error, concurrent user edit and generated file. Compare correctness, diff size, latency and
allocations across strategies.

**Research prompts.** `Tree-sitter incremental edit byte offset correctness`; `Myers patience
histogram diff tradeoffs source code`; `format preserving AST transformation`; `piece table rope
gap buffer benchmark large file`.

## V17 — File System Awareness

**Conclusion.** Paths are identities only within a moment. Preserve symlink intent, metadata,
encoding, line endings and concurrent state. Reject traversal and special-file surprises. Git
tracked/untracked/ignored/generated states influence review but never justify deletion by themselves.

**Leads.** POSIX file semantics, `openat`-style safe resolution, APFS cloning/atomic rename behavior,
Foundation file coordination where relevant, git status/index, Unicode normalization and UTI/MIME.

**Algorithms.** Canonical containment check; `lstat` then explicit symlink policy; optimistic
concurrency by hash/inode/mtime; encoding detection with declared fallback; content-addressed backup;
advisory lock plus post-read; sparse-file/binary guard.

**Sample.** `FileSnapshot { requestedPath, resolvedPath, type, symlinkTarget, mode, owner,
size, encoding, lineEnding, hash, gitState, readAt }` accompanies every mutation.

**Experiments.** Symlink escape, case-insensitive collision, Unicode-normalized names, locked file,
external edit between read/write, binary masquerading as text, read-only permission and disk full.

**Research prompts.** `secure file path resolution symlink race openat`; `APFS atomic file replacement
metadata preservation`; `Unicode normalization filenames macOS`; `git ignored generated file safe
agent editing`.

## V18 — Safe File Mutation Pipeline

**Conclusion.** A successful write syscall proves only an attempt. Use compare-and-swap semantics,
stage/validate, atomic replace where appropriate, reread and inspect the final diff. Preserve dirty
work and create an explicit recovery artifact.

**Leads.** Git object/index model and diff plumbing; LSP document versions; POSIX atomic rename and
durability caveats; compiler/parser/test contracts; Bimax checkpoint and evidence gates.

**Algorithms.** Optimistic concurrency control; two-phase stage/commit; write-temp + fsync + rename
when suitable; three-way merge; inverse patch; content hash; validation DAG; mutation-tested
postcondition.

**Sample.** `EditTransaction: observe(baseHash) → applyInMemory → parse/typecheck → compareBase →
atomicWrite → reread(hash) → diff → targetedTests → receipt`. Any base mismatch returns a merge
proposal, never overwrites.

**Experiments.** Inject process crash at every transition; disk full, permission failure, concurrent
edit, formatter mutation and test that passes vacuously. Verify byte-identical unrelated files and
recoverable staged data.

**Research prompts.** `crash safe atomic file replace fsync directory`; `optimistic concurrency
text document hash three way merge`; `mutation testing code change postcondition`; `git temporary
index snapshot dirty working tree`.

## V19 — Closed-Loop Agent Execution

**Conclusion.** Make expected outcome and observation explicit before acting. Retries must change
information or strategy. Verification is independently derived; agent narration is never evidence.

**Leads.** State machines, control loops, plan-execute-observe agents, event sourcing, workflow
sagas, idempotency and Bimax's head-to-head mutation rules.

**Algorithms.** Finite-state machine; partially observable state estimation; receding-horizon plan;
bounded retry with failure taxonomy; saga compensation; idempotency key; Bayesian belief update;
stop/ask threshold.

**Sample.** `Attempt { intent, preconditionEvidence, predictedPostcondition, action,
freshObservation, verifier, disposition }`. If a test command times out, next attempt may narrow the
suite or inspect the process—not repeat the identical call.

**Experiments.** Lost tool result after real side effect, stale observation, duplicate action,
provider failover, crash/restart and deceptive agent final text. Grader sees only independent end
state and must reject false success.

**Research prompts.** `agent action observation verification state machine`; `saga compensation
workflow side effect recovery`; `partially observable planning GUI agent`; `idempotency after lost
response exactly once effects`.

---

# Part IV — Computer Use and unified world state

## V20 — Computer-Use Architecture

**Conclusion.** Preserve the product-reset ladder: semantic native → physical native → visual
recovery → stop/ask. Desktop alone owns permissions and native execution. A screenshot-to-coordinate
model is one uncertain sensor, not the architecture.

**Leads.** AXUIElement/AppKit Accessibility; ScreenCaptureKit; CGWindow/CGEvent; Vision OCR; XPC;
TCC/HIG privacy; OSWorld/OSWorld 2.0 and ScreenSpot-style evaluation research.

**Algorithms.** Hierarchical planner; capability routing; foreground lease; observation freshness;
action state machine; circuit breaker; semantic-first target resolver; safe stop policy.

**Sample.** `MacAction { app, window, observationID, semanticTarget?, visualTarget?, executor,
requiresForeground, postcondition, approval }` with one typed state sequence.

**Experiments.** Force each executor level; stale frame; app/window replacement; permission revoke;
focus-steal measurement; wrong-target mutant; repeated refusal. Production must never silently enter
a legacy backend.

**Research prompts.** `macOS AXUIElement semantic action background application`; `ScreenCaptureKit
window identity frame timing`; `OSWorld 2.0 hidden state verification failures`; `computer use
foreground lease focus restoration`.

## V21 — Coordinate Intelligence

**Conclusion.** Every point and rectangle carries a named coordinate space, display/window/frame
identity, scale, origin convention and timestamp. Transform once through typed matrices; never pass
unlabeled `(x,y)` across boundaries.

**Leads.** AppKit screen/view conversion; AX screen coordinates; Core Graphics display geometry;
ScreenCaptureKit content scale; Vision normalized lower-left coordinates; multi-display APIs.

**Algorithms.** Homogeneous affine transforms; transform composition/inversion; rectangle clipping;
pixel-center conventions; rounding policy; display intersection; calibration residual/error bound.

**Sample.** `LocatedRect<Space> { rect, spaceID, displayID, frameID, transformToGlobal, uncertainty }`.
A Vision normalized box converts lower-left → capture pixels → display points → global AX/CG space.

**Experiments.** Retina/non-Retina displays, negative-origin secondary display, rotated display,
window move between observation/action, zoomed UI and screenshot downsampling. Reject transforms
whose frame/window identity changed.

**Research prompts.** `Vision normalized coordinates lower left convert macOS screen`; `AXUIElement
screen coordinate origin multiple displays`; `ScreenCaptureKit scaleFactor contentRect`; `affine
coordinate transform error propagation GUI automation`.

## V22 — Multi-Source GUI Perception

**Conclusion.** Fuse observations only after normalizing identity, space and time. AX semantics are
preferred when fresh and trustworthy; pixels recover missing/custom UI. A conflict must lower
confidence or trigger re-observation, not be averaged away.

**Leads.** AX roles/attributes/actions and notifications; ScreenCaptureKit; Vision text recognition;
window metadata; visual grounding/region-focus research; accessibility quality evaluation.

**Algorithms.** Candidate generation then ranking; bipartite matching by IoU/text/role; Bayesian or
weighted evidence fusion with calibrated reliability; OCR normalization; spatial index/R-tree;
temporal association.

**Sample.** An AX button `Deploy` and OCR box `Deploy` overlap in the same fresh frame, increasing
confidence. If AX says disabled but pixels look enabled, Bimax refreshes and does not click.

**Experiments.** Duplicate labels, hidden/offscreen nodes, stale AX tree, canvas controls, animation,
occlusion, OCR confusables and localization. Report grounding accuracy and wrong-target rate by
source combination.

**Research prompts.** `accessibility tree screenshot fusion GUI grounding`; `ScreenSpot Pro region
focus visual grounding`; `calibrated multimodal evidence fusion uncertainty`; `AX stale element
notification macOS`.

## V23 — Adaptive Computer Perception

**Conclusion.** Route perception by expected information gain, cost and risk. Do not call vision on
every step. Semantic availability alone is insufficient; quality and freshness decide whether AX
can satisfy the target/postcondition.

**Leads.** Active perception, cascaded classifiers, region-of-interest vision, UI grounding
benchmarks, Apple Vision request regions and AX observation APIs.

**Algorithms.** Decision cascade; value-of-information; contextual bandit in shadow mode; image
pyramid/ROI refinement; uncertainty threshold; early exit; cache keyed by frame and window identity.

**Sample.** `AX exact label/action → use semantic`; `AX candidates ambiguous → fuse cropped pixels`;
`AX empty canvas → region-focused visual grounding`; `all uncertain → stop and ask`.

**Experiments.** Compare always-vision, always-AX and adaptive routes across semantic, custom-rendered
and remote-desktop fixtures. Measure accuracy, latency, model calls, energy and false confidence.

**Research prompts.** `value of information active perception GUI agents`; `cascaded model early
exit visual grounding`; `Vision regionOfInterest OCR performance`; `calibration expected
uncertainty computer use target selection`.

## V24 — GUI Action Verification

**Conclusion.** Verification uses a fresh observation and a task-specific predicate. Pixel change is
not sufficient; no pixel change is not always failure. The verifier must distinguish progress,
completion, no-op, wrong target, blocked state and indeterminate evidence.

**Leads.** OSWorld exact-state graders; AX notifications/value reads; visual difference/perceptual
hashing; UI test postconditions; Bimax mutation-testing rules.

**Algorithms.** Predicate over structured state; semantic diff; perceptual diff within ROI;
change-point detection; bounded wait with backoff; retry policy by failure class; temporal logic for
multi-step postconditions.

**Sample.** After pressing `Save`, verify document dirty flag clears and expected file hash changes;
do not pass merely because a dialog disappeared. A second save does not count as a retry if the first
already succeeded.

**Experiments.** No-op click, wrong button causing similar visual change, delayed rendering,
duplicate send, toast-only success and stale prior state. Each mutant must fail.

**Research prompts.** `GUI action postcondition verification semantic state versus screenshot
diff`; `temporal logic UI workflow verification`; `OSWorld grader exact state mutation`; `bounded
wait change point detection UI`.

## V25 — Unified World Model

**Conclusion.** Build a shared event/evidence vocabulary, not one enormous mutable model. Project
state and GUI state retain domain schemas but link through task, identity, causal and temporal
edges. Derived projections are invalidatable.

**Leads.** Event sourcing; provenance DAGs; bitemporal databases; digital twins/world models;
property graphs; task/evidence schemas in the product reset.

**Algorithms.** Append-only event log plus materialized projections; causal DAG; vector/monotonic
sequence IDs; truth-maintenance/invalidation; entity resolution; temporal query; snapshot hash.

**Sample.** `code build artifact → launched app bundle/build hash → observed window → action →
verified UI value`, allowing one receipt to prove the edited code produced the tested GUI.

**Experiments.** Out-of-order events, duplicate delivery, stale projection, engine/app restart,
conflicting identity and evidence deletion. Rebuild projections and reproduce the same decision.

**Research prompts.** `event sourced causal graph agent audit`; `bitemporal provenance state
reconciliation`; `truth maintenance system derived fact invalidation`; `code artifact GUI runtime
identity linking`.

---

# Part V — Trust Engine and security

## V26 — Security & Trust Engine

**Conclusion.** The Trust Engine is a policy/evidence plane complementing macOS. It combines
deterministic hard floors, package/file/process evidence, contextual mismatch and human approval.
Models may explain evidence but never self-authorize.

**Leads.** Apple Platform Security, Endpoint Security, code signing/notarization, XProtect,
Gatekeeper, SIP/SSV, TCC, App Sandbox; MITRE ATT&CK; OSV/OpenSSF/SLSA/TUF; provenance IDS research.

**Algorithms.** ABAC over task/project/capability; signed policy bundles; causal provenance graph;
risk factor vector; rules engine; anomaly ranking; tamper-evident receipts; least privilege.

**Sample.** Trust decision names `rule`, `subject identity`, `requested capability`, `resource`,
`task context`, `evidence`, `disposition`, `expiry` and `appeal/override path`.

**Experiments.** Bypass attempts through MCP text, package scripts, stale grants and renderer IPC;
policy/model disagreement; sensor outage. Safety invariants remain identical across model tiers.

**Research prompts.** `macOS endpoint security contextual policy architecture`; `agent tool ABAC
task scoped authorization`; `provenance based intrusion detection false positives`; `LLM security
explanation separate enforcement`.

## V27A — File Security

**Conclusion.** Start with identity and provenance: file type, digest, signer/notarization,
quarantine, origin, entitlements, nested executables, script structure and requested execution
context. Static scanning cannot prove safety; unknown must not mean malicious.

**Leads.** Apple Security framework static code validation, code-signing requirements, Gatekeeper,
notarization and quarantine; YARA-style rules where licensed/appropriate; malware corpus handling;
MITRE file/persistence techniques.

**Algorithms.** Magic/format parsing; cryptographic hash; Merkle directory manifest; signature
validation; entropy/obfuscation signals; AST/static shell analysis; allow/deny reputation as one
factor; bounded archive extraction.

**Sample.** “Preview executable” shows SHA-256, architecture slices, signer/team, notarization,
quarantine origin, hardened runtime, entitlements, nested helpers and declared capability—without
executing it.

**Experiments.** Modified signed bundle, universal binary with invalid slice, symlinked nested code,
archive traversal/bomb, obfuscated script, unsigned known fixture and benign uncommon tool. Measure
false positives and parser robustness.

**Research prompts.** `SecStaticCodeCheckValidity universal binary nested code`; `macOS quarantine
metadata origin URL provenance`; `safe static analysis shell scripts AST`; `archive extraction path
traversal decompression bomb limits`.

## V28A — Dependency Security

**Conclusion.** Analyze the exact resolved graph and proposed delta, not package popularity alone.
Vulnerability, malicious-package evidence, typosquat/confusion, maintainer/provenance change,
lifecycle scripts, binary downloads and permissions are separate factors.

**Leads.** OSV API/malicious packages; OpenSSF Scorecard; SLSA; Sigstore; TUF; SBOM formats;
ecosystem registry metadata; USENIX package-confusion and SpellBound typosquatting research.

**Algorithms.** Lockfile graph; edit/keyboard/confusable distance for names; namespace/registry
confusion rules; release-age/cooldown; provenance verification; diff of scripts/maintainers/files;
reachability analysis; risk factor ranking.

**Sample.** New `lodash` request resolves `loadsh`: Bimax flags high name similarity and low project
evidence before installation. A known CVE is ranked by exact version and reachable use, not CVSS
alone.

**Experiments.** Typosquat, dependency confusion, compromised later version, abandoned package,
benign fork, install-time binary download and false registry outage. Never rewrite a lockfile based
only on advisory text.

**Research prompts.** `package confusion detection rules npm PyPI USENIX`; `typosquatting keyboard
distance confusable package names`; `OSV exact version lockfile reachability`; `package maintainer
provenance change anomaly`.

## V29A — Process and Network Security

**Conclusion.** Detect causal combinations—such as build child → credential read → new endpoint →
persistence—rather than treating every new process/domain as suspicious. System-wide observation is
Desktop-only, optional and entitlement-gated.

**Leads.** Endpoint Security process/file events and deadlines; Network Extension content filters;
code-signing identity; Service Management/login items; MITRE macOS techniques; provenance IDS.

**Algorithms.** Process provenance DAG; temporal/causal pattern matching; signer/parent rarity;
destination novelty; sequence rules; streaming graph windows; deterministic sensitive-target rules;
isolation forest/one-class models only for ranking after calibration.

**Sample.** A compiler spawning `ld` and writing `build/` is expected. The same lineage reading
`~/.ssh/id_ed25519` then connecting to a new host generates one combined causal finding.

**Experiments.** Dropped ES events, PID reuse, short-lived processes, signed binary replacement,
VPN/path change, legitimate update and persistence fixture. Report evidence gaps and overhead.

**Research prompts.** `Endpoint Security process tree responsible audit token macOS`; `streaming
provenance graph anomaly detection`; `Network Extension process flow attribution macOS`; `causal
pattern credential read network persistence`.

## V30 — Agent Action Security

**Conclusion.** Compile each proposed tool action into a capability request before execution. Static
command analysis is one layer; shell composition, environment, cwd, tainted inputs, indirect tools
and actual effects matter. Bypass cannot waive immutable floors.

**Leads.** Bimax governor/taint classifier; sandbox and capability security; MCP client safety;
command AST parsers; sudo/Authorization Services boundaries; least-privilege tool design.

**Algorithms.** Command AST classification; capability extraction; taint propagation; policy
intersection; argument canonicalization; blast-radius estimate; approval lease; identical-failure
loop detection; post-execution effect comparison.

**Sample.** `curl URL | sh` compiles to network-read + arbitrary-code-execution + filesystem/process
unknown and cannot inherit a generic `curl` allow rule. `git status` remains a narrow read.

**Experiments.** Shell quoting/substitution, aliases, wrapper scripts, environment injection, MCP
nested call, symlink target, `sudo`, sensitive settings and prompt injection. Mutation must prove
the governor actually gates the effect.

**Research prompts.** `shell command AST security capability extraction`; `taint tracking LLM tool
calls untrusted web output`; `capability based sandbox subprocess macOS`; `nested tool permission
enforcement MCP`.

## V31 — Context-Aware Security

**Conclusion.** Expected behavior derives from explicit task bounds, verified project declarations,
known toolchain templates and history—weighted in that order. Repetition cannot normalize a hard
violation. Context changes severity and explanation, not cryptographic truth.

**Leads.** Provenance-based IDS; behavior allowlisting; anomaly calibration; task contracts;
zero-trust policy; human factors in security warnings.

**Algorithms.** Contextual feature vector; causal graph comparison; template/subgraph matching;
Bayesian likelihood ratio; conformal/anomaly calibration; rule-plus-score ensemble; false-positive
budget and alert aggregation.

**Sample.** Deleting `build/` during clean is expected; deleting `~/Documents` violates task and
project scope even if a shell tool requested it. An unknown registry contacted during an approved
install is lower risk than the same endpoint after credential access.

**Experiments.** Same action across clean/test/deploy tasks, compromised behavior repeated in
history, ambiguous monorepo root and legitimate uncommon tool. Evaluate explanation quality plus
precision/recall—not accuracy alone.

**Research prompts.** `task conditioned anomaly detection provenance graph`; `conformal anomaly
detection false positive calibration security`; `security warning human factors actionable
explanation`; `behavior baseline poisoning repeated compromise`.

## V32 — macOS Security Integration

**Conclusion.** Integrate supported protection signals and preserve Apple ownership. Bimax never
disables Gatekeeper/XProtect/SIP/SSV or claims Secure Enclave access creates general malware safety.
Every entitlement and TCC permission is contextual and optional where possible.

**Leads.** Apple Platform Security; Security framework; Keychain; App Sandbox; hardened runtime;
notarization; System/Endpoint/Network Extensions; Service Management; privacy manifests.

**Algorithms.** Code requirement evaluation; keychain access groups; client identity validation;
entitlement allowlist diff; permission state machine; signed update verification; rollback-safe
helper/extension migration.

**Sample.** Trust Center shows the exact responsible signed component, entitlement, macOS approval,
last use and revocation instructions. Core Code operates with all optional permissions denied.

**Experiments.** Clean quarantined download, grant/revoke/regrant, signed update, identity change,
tampered nested helper, extension crash and unavailable entitlement. Test oldest/current macOS and
arm64/x64 where shipped.

**Research prompts.** `Apple system extension update code signing identity user approval`; `TCC
permission responsible process macOS`; `Keychain access group least privilege desktop app`; `hardened
runtime entitlement audit Electron macOS`.

---

# Part VI — adaptive environment and product identity

## V33 — Adaptive Execution Environment

**Conclusion.** V33 is an orchestration result, not a new monolith. Compose the typed profiles,
graphs, policies, receipts and capability broker from prior sections. Each adaptation must declare
which input changed which bounded decision.

**Leads.** Runtime policy/control systems; workflow engines; event-sourced projections; resource
governors; capability brokers; Bimax protocol and acceptance journeys.

**Algorithms.** Hierarchical planner; constraint solver; dependency DAG; weighted fair queue;
receding-horizon scheduling; feedback controller with hysteresis; causal decision log; safe-mode
fallback.

**Sample.** A frontend task resolves Node/pnpm, reserves simulator resources, selects a verified MCP
deployment tool, lowers indexing during active interaction and records one cross-lane receipt.

**Experiments.** Conflicting policies, sensor outage, capability crash, environment drift, provider
failover, low-power transition and app restart. The same immutable task contract survives all.

**Research prompts.** `adaptive execution environment hierarchical constraint scheduler`; `resource
governor interactive agent workload`; `event sourced policy decision replay`; `safe degradation
capability unavailable agent platform`.

## V34 — Product Identity

**Conclusion.** The user-facing promise should be narrower than the architecture: “give Bimax an
outcome; it understands the project and Mac context, acts within clear boundaries, and shows fresh
proof.” “Understands your Mac from silicon to screen” remains a north star until the named journeys
are Product-ready.

**Leads.** macOS HIG, onboarding/privacy, progressive disclosure, jobs-to-be-done interviews,
usability research, competitor product journeys and Bimax evidence gates.

**Algorithms.** Not computational: message hierarchy; progressive disclosure; task-based
segmentation; comprehension testing; qualitative coding; funnel/time-on-task analysis; claim ladder.

**Sample.** Default surface is Tasks / Current Task / Evidence. Users see “Working automatically in
this project,” not internal policy/driver names. Advanced hardware/security detail appears only when
it changes a decision or the user opens Diagnostics/Trust Center.

**Experiments.** Five-second comprehension, first task, first approval, failure recovery, permission
denial and final receipt studies across coding-only and Mac-control users. Ask users to explain what
Bimax can and cannot do before measuring preference.

**Research prompts.** `macOS agent product progressive disclosure trust evidence UX`; `jobs to be
done developer agent user research`; `security permission comprehension testing`; `AI agent final
receipt user trust calibration`.

---

# Part VII — later owner additions

## V27B — Hardware-Informed Mathematical & Algorithmic Execution

**Conclusion.** Build a portfolio of correct strategies and select using workload/capability facts
plus measurements. Big-O narrows candidates; constants, locality, allocation, copying, I/O,
parallelism, energy and warm-up decide real crossover points. Never move tiny work to GPU merely
because it is available.

**Leads.** Apple Accelerate/vDSP/vImage/BNNS; Metal compute and feature tables; Metal Performance
Shaders; Core ML; MLX unified memory; mmap/POSIX; Tree-sitter; text-editor data structures;
Instruments counters/profiling; autotuning and contextual-bandit research.

**Algorithm portfolios.** Text: direct scan, Boyer–Moore/Horspool, SIMD scan, indexed symbol lookup,
rope/piece table, mmap/chunked streaming. Diff: Myers, patience, histogram, rolling hash. Graph:
BFS/DFS, Dijkstra/A*, SCC, topological sort, bidirectional search, incremental Datalog. Cache:
LRU/ARC/TinyLFU/content-addressed. Vision: ROI pyramid, connected components, OCR, vectorized image
ops. Scheduling: work stealing, chunk sizing, fair queues, bandit/autotuner after safe baselines.

**Sample.** `StrategyProfile { operation, workloadFeatures, machineClass, candidate, correctnessHash,
p50,p95,peakRSS,bytesCopied,energyProxy,thermal,observations }`. Selection first filters correctness
and memory, then chooses the lowest validated cost with an exploration ceiling.

**Experiments.** Generate workload distributions rather than one size. Find crossover points for
text search/edit/diff/index/OCR/hash on Intel and Apple silicon. Include cold/warm cache, battery/AC,
memory pressure and thermal steady state. Mutation: a faster incorrect strategy must always lose.

**Research prompts.** `Apple Accelerate versus Metal crossover small vector workload`; `autotuning
polyalgorithm contextual bandit safe exploration`; `memory bandwidth cache locality text search
benchmark Apple silicon`; `piece table rope mmap large file edit crossover`; `Myers patience
histogram diff workload comparison`.

## V28B — macOS Intelligence, Correction & Unusual Activity Detection

**Conclusion.** Begin with Task Guard over Bimax-owned intent/receipts, then project/environment
drift, reversible correction, opted-in process provenance, and only then entitlement-gated broader
network/anomaly sensors. Deterministic bounded policy stays on authorization paths; learned/model
logic explains and ranks.

**Leads and algorithms.** Endpoint Security, FSEvents, Network Extension, OSLog/MetricKit, code
signing, MITRE macOS scenarios, provenance IDS, causal graphs, template matching, calibrated anomaly
ranking, correction sagas and rollback. Full research, examples, schemas and S28-01–12 live in
`11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md`.

**Sample.** `run tests → test worker → shell child → SSH key read → new endpoint` becomes one causal
finding with evidence completeness and a reversible response—not four context-free alerts.

**Research prompts.** `Endpoint Security authorization deadline deterministic cache design`;
`provenance IDS practical false positives developer workstation`; `macOS project scoped behavioral
baseline`; `reversible configuration remediation transaction`.

## V29B — Modular Chipset-Native Developer Ecosystem

**Conclusion.** Distinguish knowledge skills, MCP services, executable extensions, native
capabilities, environment recipes, simulator adapters and ML workers. Verify supply chain metadata,
run executable packages out of process, declare authority, and preserve rollback. Compose the IDE
from existing Bimax surfaces.

**Leads and algorithms.** ExtensionFoundation/XPC, TUF/Sigstore/SLSA/OSV, Agent Skills/MCP, official
Xcode/Android simulator tooling, MLX/Core ML/PyTorch MPS, dependency resolution, capability graphs,
resource reservations and adaptive policy. Full S29-01–18 plan is in
`11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md`.

**Sample.** A frontend capability recipe inventories existing Node/pnpm/tooling, proposes a signed
project-local delta, obtains approval, verifies the environment and activates only project-scoped
tools. It never silently installs global software.

**Research prompts.** `TUF signed plugin marketplace rollback freeze attack`; `out of process IDE
extension capability broker`; `Agent Skills script security permission separation`; `MLX Core ML
optimization quality latency memory evaluation`; `adaptive rendering Reduce Motion low power`.

---

# Part VIII — shared algorithm and sample catalog

## 1. Reusable algorithms by problem

| Problem | Baseline | Advanced candidate | Guardrail |
|---|---|---|---|
| noisy runtime signals | threshold + hysteresis | Kalman/EWMA/change-point | minimum dwell and bounded actions |
| concurrency | fixed per workload class | AIMD or constrained optimizer | interaction and memory hard ceilings |
| strategy selection | capability rules + benchmark table | contextual bandit | shadow mode, safe exploration, rollback |
| project inference | deterministic marker rules | weighted evidence/Bayesian ranking | show ambiguity and provenance |
| dependency resolution | consume native lockfile | PubGrub/SAT for Bimax recipes | never invent upgrades silently |
| environment graph | normalized nodes/edges | incremental Datalog/property graph | bitemporal evidence and invalidation |
| file edits | anchored exact patch | syntax range/rope/piece table | base hash and final diff |
| source diff | Myers | patience/histogram by workload | semantic validation independent of diff |
| filesystem update | compare-hash + atomic replace | three-way merge/saga | preserve metadata and dirty work |
| GUI target lookup | fresh AX exact match | AX+OCR+vision candidate ranking | typed coordinates and uncertainty |
| visual recovery | full screenshot baseline | ROI pyramid/region focus | bind to frame/window identity |
| action verification | exact semantic predicate | temporal/multisource predicate | missing evidence cannot pass |
| API retry | exponential backoff + jitter | adaptive concurrency/hedged safe reads | idempotency and deadline |
| cache | bounded LRU | TinyLFU/ARC/content-addressed | privacy, invalidation and memory pressure |
| security decision | deterministic ABAC/rules | calibrated anomaly ranking | model never sole block/repair cause |
| typosquat lead | edit distance | keyboard/confusable/namespace ensemble | warning budget and human review |
| process behavior | causal rules | provenance subgraph/anomaly model | event gaps explicit |
| remediation | preview + exact mutation | saga compensation | snapshot, approval, postcondition |

## 2. Shared multi-objective cost model

Use this only after feasibility and safety constraints filter candidates:

```text
cost(strategy, context) =
    w_latency  × predicted_tail_latency
  + w_memory   × peak_working_set
  + w_energy   × energy_proxy
  + w_network  × metered_bytes
  + w_quality  × expected_quality_loss
  + w_risk     × failure_or_wrong_effect_risk
  + w_jitter   × interaction_disruption
  + switch_penalty(previous_strategy, strategy)
```

Weights are policy-class specific, not universal. Correctness, permission, accessibility, memory
safety and explicit user constraints are hard feasibility checks, never tradable weighted terms.

## 3. Sample research card

```yaml
research_id: V23
hypothesis: AX-first adaptive perception reduces model calls without increasing wrong targets
baseline: always invoke full-frame visual grounding
candidates: [AX-exact, AX-plus-OCR, ROI-vision, full-frame-vision]
fixtures: [native-form, canvas, remote-desktop, duplicate-labels]
hard_constraints:
  wrong_target_incidents: 0
  stale_observation_passes: 0
metrics: [success_rate, grounding_error, p50_ms, p95_ms, model_calls, energy_proxy]
mutants: [stale_ax, moved_window, wrong_coordinate_origin, empty_observation]
decision_rule: adopt only when confidence interval preserves accuracy and lowers cost
evidence_retention: redacted content-addressed run bundle
status: Target
```

## 4. Sample typed evidence envelope

```ts
interface EvidenceEnvelope<T> {
  id: string;
  schemaVersion: string;
  kind: string;
  source: { product: 'terminal' | 'desktop'; component: string; buildHash: string };
  scope: { taskId?: string; projectId?: string; machineId?: string };
  observedAt: string;
  expiresAt?: string;
  completeness: 'complete' | 'partial' | 'gap';
  sensitivity: 'public' | 'project' | 'private' | 'secret-excluded';
  causalParents: string[];
  payload: T;
  contentHash: string;
}
```

## 5. Research-query construction template

For any chapter, search in layers:

```text
1. Platform truth
   site:developer.apple.com/documentation <API or capability>

2. Specification truth
   <protocol/package format> specification official

3. Algorithm evidence
   <problem> algorithm benchmark paper dataset

4. Failure evidence
   <API/algorithm> race condition false positive energy regression limitations

5. Product evidence
   <journey> user study benchmark end-state evaluation

6. Bimax falsification
   What fixture or mutation would make this design look successful when it is broken?
```

Every research result should record access date, source class, supported claim, limitation,
implementation implication, experiment, and status. A blog may generate a lead; a platform claim
requires current first-party documentation, inspected source or a primary paper.

---

# Part IX — primary lead index

## Apple platform and performance

- [ProcessInfo](https://developer.apple.com/documentation/foundation/processinfo)
- [Low Power Mode](https://developer.apple.com/documentation/foundation/processinfo/islowpowermodeenabled)
- [Metal device inspection](https://developer.apple.com/documentation/metal/device-inspection)
- [Metal recommended working set](https://developer.apple.com/documentation/metal/mtldevice/recommendedmaxworkingsetsize)
- [Metal feature tables](https://developer.apple.com/metal/limits/)
- [Accelerate](https://developer.apple.com/documentation/accelerate)
- [Core ML compute units](https://developer.apple.com/documentation/coreml/mlcomputeunits)
- [Improving app responsiveness](https://developer.apple.com/documentation/xcode/improving-app-responsiveness)
- [MetricKit](https://developer.apple.com/documentation/metrickit)
- [Recording performance data](https://developer.apple.com/documentation/os/recording-performance-data)
- [Dispatch memory pressure](https://developer.apple.com/documentation/dispatch/dispatchsourcememorypressure)
- [NWPathMonitor](https://developer.apple.com/documentation/network/nwpathmonitor)

## Developer environment and editing

- [Homebrew: Querying Brew](https://docs.brew.sh/Querying-Brew)
- [Homebrew: Brew Bundle and Brewfile](https://github.com/Homebrew/brew/blob/main/docs/Brew-Bundle-and-Brewfile.md)
- [Python `pylock.toml`](https://packaging.python.org/en/latest/specifications/pylock-toml/)
- [Apple: Installing command-line tools](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools/)
- [Docker inspect](https://docs.docker.com/reference/cli/docker/inspect/)
- [Podman machine](https://docs.podman.io/en/stable/markdown/podman-machine.1.html)
- [Tree-sitter parser and incremental tree](https://tree-sitter.github.io/node-tree-sitter/classes/Parser.html)
- [Language Server Protocol 3.18](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.18/specification.md)
- [Git documentation](https://git-scm.com/docs/git)
- [Git diff-index](https://git-scm.com/docs/git-diff-index)

## Computer Use and perception

- [AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement_h)
- [AppKit accessibility coordinate conversion](https://developer.apple.com/documentation/accessibility/integrating-accessibility-into-your-app)
- [CGEvent](https://developer.apple.com/documentation/coregraphics/cgevent)
- [Vision](https://developer.apple.com/documentation/vision)
- [OSWorld](https://arxiv.org/abs/2404.07972)
- [OSWorld 2.0](https://arxiv.org/abs/2606.29537)
- [OSWorld-G](https://github.com/xlang-ai/OSWorld-G)
- [UI-TARS](https://arxiv.org/abs/2501.12326)
- [Visual Test-time Scaling / RegionFocus](https://openaccess.thecvf.com/content/ICCV2025/papers/Luo_Visual_Test-time_Scaling_for_GUI_Agent_Grounding_ICCV_2025_paper.pdf)

## Security, packages and extensions

- [Endpoint Security](https://developer.apple.com/documentation/endpointsecurity)
- [Endpoint Security entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.endpoint-security.client)
- [FSEvents](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/)
- [Network Extension](https://developer.apple.com/documentation/networkextension)
- [App code signing](https://support.apple.com/guide/security/app-code-signing-process-sec3ad8e6e53/web)
- [Notarizing software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [OSV API](https://google.github.io/osv.dev/api/)
- [OpenSSF malicious packages and OSV](https://openssf.org/blog/2026/05/20/detecting-malicious-packages-using-the-osv-api/)
- [USENIX package confusion](https://www.usenix.org/conference/usenixsecurity23/presentation/neupane)
- [SpellBound typosquatting research](https://arxiv.org/abs/2003.03471)
- [TUF metadata](https://theupdateframework.io/docs/metadata/)
- [SLSA build track](https://slsa.dev/spec/v1.2/build-track-basics)
- [Sigstore bundles](https://docs.sigstore.dev/about/bundle/)
- [ExtensionFoundation](https://developer.apple.com/documentation/ExtensionFoundation)
- [XPC](https://developer.apple.com/documentation/Foundation/xpc)

## Hardware-aware ML and adaptive algorithms

- [MLX](https://ml-explore.github.io/mlx/build/html/)
- [MLX unified memory](https://ml-explore.github.io/mlx/build/html/usage/unified_memory.html)
- [coremltools optimization](https://apple.github.io/coremltools/docs-guides/source/opt-overview.html)
- [PyTorch MPS](https://docs.pytorch.org/docs/stable/notes/mps.html)
- [HAMLET bandit algorithm selection](https://arxiv.org/abs/2001.11261)
- [PMLR contextual bandit model selection](https://proceedings.mlr.press/v162/muthukumar22a.html)

## Remaining research truth

This playbook completes the lead/prompt/algorithm/example inventory. The following remain **Target**:

- supported-device benchmark corpus and actual crossover measurements;
- labeled environment-discovery corpus with maintainer ground truth;
- multi-project edit correctness/latency corpus;
- packaged-app native CU and OSWorld-style measurements;
- labeled anomaly/provenance corpus and false-positive budget;
- Apple approval for any Endpoint Security/Network Extension entitlement;
- signed capability marketplace and distribution identity;
- user research validating product language and permission comprehension.

Those are experiments or external decisions, not gaps that more desk research can honestly close.

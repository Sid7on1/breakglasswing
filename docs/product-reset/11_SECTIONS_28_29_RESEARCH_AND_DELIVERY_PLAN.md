# Sections 28 and 29: research and delivery plan

Status: **Target**, researched 2026-08-08. Updated 2026-08-09: slices **S28-A, S28-B, S28-C, S29-A,
S29-B and S29-C step 1 are Implemented and locally graded** — see
`19_PHASE8_CONTEXTUAL_INTELLIGENCE_RECORD.md` for exactly what that does and does not cover.
S28-D/E, S29-C's IDE composition, and S29-D/E/F remain Target and belong to Phase 9. No claim in
this document has been Measured. Nothing in this document is an Implemented, Measured,
Product-ready, or Win claim unless a row explicitly says so. The owner wording is preserved in
`vision/BIMAX_MAC_BUDDY_PRODUCT_VISION.md`; this document translates that north star into bounded
architecture, delivery slices, and proof.

## 0. Executive decision

Sections 28 and 29 belong in the Bimax plan, but they do not precede the current two-product reset.
They depend on it.

- **Bimax Terminal remains the coding product.** It may emit project-scoped action intent and
  receipts, but it never owns Endpoint Security, Network Extension, system extensions, Full Disk
  Access, Screen Recording, Accessibility, or Computer Use.
- **Bimax for Mac owns the intelligence and capability experience.** It owns consent, native
  services, optional system extensions, capability packages, evidence, remediation UI, and the
  Trust Center.
- **Context augments deterministic security; it does not replace it.** A model may explain or rank
  evidence. It must not sit in a kernel-blocking authorization deadline or silently repair macOS.
- **Modularity means verified, least-privilege capability packs.** It does not mean downloading
  arbitrary code into the renderer or loading untrusted dynamic libraries into the app process.
- **Chipset-native means measured policy.** The runtime chooses from supported strategies using
  workload, thermal, memory, power, network, accessibility, and interaction signals. It does not
  claim every operation belongs on the GPU or Neural Engine.
- **The IDE is an integrated Bimax workspace.** Reuse the existing editor, diff, terminal, git,
  review, task, and evidence components. Do not start a new editor engine before the stable product
  gates.

The most important sequencing result is:

```text
two-product boundary
  → typed task/action/evidence protocol
  → trusted capability packages and environment inventory
  → project/agent-scoped contextual detection
  → optional broader macOS sensors
  → reversible corrections
  → ML Alchemist and adaptive execution after measurement
```

## 1. What the current repository can honestly support

The current checkout provides seeds, not these completed products:

| Existing seed | What it contributes | What it does not prove |
|---|---|---|
| `src/governor/governor.ts` | task-class approvals, hard floors, taint narrowing, session grants | machine-wide process, file, persistence, or network detection |
| `src/governor/bash.analyzer.ts` and `src/security/yolo.classifier.ts` | deterministic command-risk classification | behavioral malware detection or contextual provenance analysis |
| `src/governor/policy.engine.ts` | workspace and sensitive-path policy | native macOS enforcement, identity validation, or safe repair |
| `src/sandbox/exec.sandbox.ts` | an optional command-isolation seam | a supported future macOS sandbox architecture; `sandbox-exec` is not a product foundation |
| `src/sandbox/checkpoint.manager.ts` | reversible project working-tree snapshots | restoration of system settings, package state, credentials, LaunchAgents, or external data |
| `src/governor/power.monitor.ts` | opt-in battery/thermal advisory and background-work throttling | unified-memory pressure, GPU/ANE scheduling, render adaptation, or a measured energy win |
| native XPC/Accessibility/capture foundations | app-owned native-service direction | Endpoint Security, Network Extension, an extension broker, or package verification |
| CodeMirror/xterm/git/review/task UI | pieces of an integrated coding workspace | a coherent IDE, ecosystem manager, ML lab, or stable extensibility contract |

Local architecture and entitlements currently contain no Endpoint Security or Network Extension
entitlement. That is correct for the present product. Those capabilities are later opt-in targets,
not permissions to add speculatively.

## 2. Shared principles for both sections

### 2.1 A collection contract, not total observation

The owner principle that useful information should affect the system is refined into an enforceable
contract:

> Do not collect a datum unless it has a declared consumer, purpose, retention class, sensitivity,
> minimum decision effect, and deletion path.

Every signal definition must contain:

```text
signal_id
source and owner process
collection trigger
scope (task / project / app / device)
sensitivity class
retention and redaction policy
consumer decisions
minimum confidence or effect threshold
freshness / expiry
user visibility and disable control
```

A datum does not deserve a forced micro-adjustment. That creates feedback loops and jitter. Signals
below their effect threshold are aggregated, sampled, or discarded. Adaptive decisions require
hysteresis, cooldowns, bounds, and an override.

### 2.2 One causal evidence model

Sections 28 and 29 should share the typed evidence graph already required for Code and Mac action
receipts. The minimal cross-product vocabulary is:

```text
TaskIntent      what the user approved and its boundaries
OperationIntent what the agent or subsystem proposed
Observation     immutable fact from an identified sensor
Identity        process, signer, package, executable, project, app, or endpoint
Relationship    spawned-by, read, wrote, connected-to, installed-by, loaded-by
Decision        rule/model versions, features, score, confidence, disposition
Approval        user/policy decision, exact scope, expiry
ActionReceipt   attempted mutation plus before/after evidence
Verification    postcondition result and evidence freshness
Rollback        restoration target and result
```

Observations are append-only. Interpretations may be recomputed when policy changes. Raw sensitive
payload is not required for most decisions: paths can be normalized, network identity can usually
be host/port/process rather than content, and secrets must be excluded.

### 2.3 Trust hierarchy

When evidence conflicts, Bimax uses this order:

1. macOS-enforced identity, code-signing, TCC, sandbox, and system-extension facts;
2. cryptographic artifact identity and verified package metadata;
3. fresh local observation from the responsible Bimax native service;
4. deterministic Bimax policy and user-scoped grants;
5. learned anomaly score calibrated on the relevant project or workload class;
6. model explanation or hypothesis.

A lower level cannot waive a higher-level denial. “The agent says this is safe” never overrides a
failed signature, forbidden credential target, missing approval, or stale observation.

### 2.4 Privacy and permissions

Core coding must work with zero Computer Use, Endpoint Security, Network Extension, or Full Disk
Access permission. Each broader sensor is optional and requested only when a named feature needs it.
Trust Center must show:

- capability and exact data category;
- why it is needed now;
- owner binary or system extension;
- collection scope and retention;
- current macOS approval state;
- last use and recent decisions;
- disable, delete, revoke, and diagnostic controls.

No onboarding wall asks for every permission. A user who only codes should never see system-wide
security permissions.

---

# Part I — Section 28: macOS Intelligence, Correction & Unusual Activity Detection

## 3. Product definition

Section 28 is not “another antivirus.” macOS already supplies Gatekeeper, notarization, XProtect,
Malware Removal Tool protections, System Integrity Protection, Signed System Volume, TCC, and code
signing. Bimax's credible wedge is narrower and more useful to developers:

> Detect when observed project, toolchain, package, agent, or app behavior is inconsistent with the
> active task and the user's declared boundary; explain the causal path; offer the least invasive,
> reversible response.

The first product is **Bimax Task Guard**: exact monitoring of Bimax-originated operations and their
descendants inside an opted-in project. The last and hardest product is an optional broader Mac
sensor. Starting with the last product would maximize entitlements, noise, performance risk, and
false positives before Bimax has a calibrated contextual baseline.

## 4. Observation tiers

### Tier S28-0 — Bimax-owned intent and receipts

Permission: none beyond normal project access.

Capture every tool proposal and result from the coding engine, Desktop broker, package resolver,
MCP client, Computer Use provider, environment manager, and ML Alchemist. Bind it to task intent,
workspace, executable, requested network destinations, and approval.

This tier answers high-value questions immediately:

- Did a tool request exceed the project boundary?
- Did an install command appear during a task that did not require dependency changes?
- Did an MCP tool attempt a network or file capability outside its manifest?
- Did a Desktop action target a credential/security surface?
- Did actual writes and subprocesses match the declared operation?

This is the first implementation slice because Bimax already owns both intent and receipt.

### Tier S28-1 — project and environment observation

Permission: user-selected project/environment roots, using normal app sandbox access or
security-scoped bookmarks where applicable.

Use project file watchers and FSEvents for coarse invalidation, then inspect only changed nodes
inside approved roots. FSEvents reports filesystem hierarchy changes; it is not a complete security
audit stream. The observer must tolerate coalescing, rescan after overflow, and never infer a write's
actor solely from an FSEvent.

Track:

- repository and lockfile changes;
- executable creation or replacement;
- virtual environment and package inventory drift;
- package-manager metadata and lifecycle-script execution;
- project configuration, CI, deployment, auth, and secret-reference drift;
- unexpected writes outside build/output directories;
- declared versus observed endpoints for project processes.

### Tier S28-2 — opted-in process provenance

Permission: feature-dependent native capability. Prefer observation of Bimax-launched process trees
before system-wide collection.

Record process identity, parent/child lineage, responsible/audit token where available, executable
path, code-signing identity, argv classifications, working directory, and bounded file/network
relationships. Never store environment variables wholesale. Redact tokens, credentials, query
parameters, clipboard content, and file contents unless a separate user action requests inspection.

Endpoint Security is the correct Apple API for system event monitoring and authorization, but its
client entitlement must be requested from Apple. It also imposes hard operational requirements:

- authorization events block the originating kernel operation;
- replies have per-message deadlines, and missed deadlines can cause severe client failure;
- event loss must be detected through sequence numbers and treated as an observation gap;
- muting and caching are performance/deadlock tools, not permission to weaken policy;
- callback work must be bounded and asynchronous except for the smallest deterministic decision.

Therefore the authorization path may contain only precompiled, bounded, deterministic policy based
on already-available facts. An LLM, remote API, graph traversal, disk scan, or UI prompt cannot be
placed on that deadline. Ambiguous events default to the predeclared policy: allow-and-observe for
noncritical activity or deny for a narrow user-configured hard boundary.

### Tier S28-3 — opted-in network metadata

Permission: separate Network Extension/content-filter capability and approval when that product
slice is justified.

Begin with destinations declared by Bimax tools and subprocess launch receipts. A later content
filter may associate process identity with flow metadata. Default collection is endpoint identity,
direction, protocol, bytes/time bands, and decision—not payload. Do not abuse a packet-tunnel
provider as a generic filter. Apple separates content-filter data and control responsibilities for
privacy; Bimax must preserve that separation.

### Tier S28-4 — application health telemetry

OSLog, signposts, crash/hang diagnostics, dispatch memory-pressure events, and MetricKit support
Bimax's own reliability and performance analysis. MetricKit delivery is generally delayed and is
not a live security sensor. Unified logging must use privacy annotations, exclude secrets, and have
bounded local retention.

## 5. Context model: expected versus actual

The baseline is not “whatever happened last week.” Repeated compromise must not become normal.
Expected behavior comes from four separately weighted sources:

| Source | Example | Trust |
|---|---|---|
| explicit user/task contract | “run tests; do not install or deploy” | high for scope, not for binary safety |
| project-declared contract | lockfiles, scripts, signed capability manifest, CI/deploy configuration | high when verified and reviewed |
| known toolchain model | compiler writes build directory; package manager contacts registry | medium; versioned and bounded |
| historical local behavior | this test worker normally spawns these children | advisory; never normalizes hard violations |

The comparison operates on a causal graph, not isolated alerts. Example:

```text
user: run unit tests
  → bimax task 8f2
  → npm test
  → test-runner
  → shell child
  → read ~/.ssh/id_ed25519       [outside intent + credential boundary]
  → connect unknown.example:443 [new destination + causal sibling]
```

Each finding must answer:

- what happened;
- which identity performed it;
- what caused it;
- which expectation it violated;
- whether the observation is complete and fresh;
- which rule/model produced the assessment;
- confidence and plausible benign explanations;
- what Bimax did, if anything;
- the smallest safe next action.

## 6. Detection stack

Use a layered system whose deterministic floors remain comprehensible:

### Layer A — invariants

Examples: never read credential stores on behalf of Computer Use; never disable SIP/SSV; never
install an unsigned executable package; never allow a package to declare fewer permissions than its
entrypoint exercises; never write outside the approved project during plan mode.

These are block/deny decisions with exact rule IDs.

### Layer B — task and capability mismatch

Compare operations with task intent and package/tool manifest. A formatter writing source is normal;
the same formatter editing a LaunchAgent is not. This layer should produce most early value and is
testable without privileged telemetry.

### Layer C — known risky macOS behavior

Versioned rules cover high-signal persistence and credential-access patterns, such as LaunchAgent or
LaunchDaemon changes, SSH `authorized_keys`/private-key access, browser credential stores, unsigned
executable replacement, unexpected login-item registration, and security-setting modification.
MITRE ATT&CK supplies scenario vocabulary, not automatic verdicts.

### Layer D — provenance anomaly

Compare subgraphs against toolchain and project templates: unusual parent/child pairs, new executable
lineage, rare cross-boundary reads followed by an external connection, or build tools creating
persistence. Provenance research is promising, but operational false positives and graph volume are
known barriers. Begin in explain-only mode and require a labeled local corpus before blocking.

### Layer E — statistical anomaly

Features may include event rarity, destination novelty, signer change, path class, temporal burst,
process-tree distance from the approved launcher, and deviation from declared dependency graph.
Scores rank review; they do not directly authorize repair or destructive containment.

### Layer F — model-assisted explanation

A local or remote model may summarize a bounded, redacted graph and propose hypotheses. It receives
no raw secrets and cannot change disposition. Its output is labeled “model explanation,” includes
the evidence IDs it used, and can be disabled.

## 7. Risk and disposition

A single opaque “AI safety score” is insufficient. Store named factors and a policy result:

```text
risk = policy(
  hard_boundary,
  task_mismatch,
  identity_trust,
  target_sensitivity,
  persistence_potential,
  network_novelty,
  causal_combination,
  observation_completeness,
  anomaly_confidence
)
```

Disposition ladder:

| Level | Default behavior | Required evidence |
|---|---|---|
| observe | retain bounded receipt, no interruption | source identity and freshness |
| explain | show causal finding | rule/factors and evidence links |
| recommend | propose a reversible correction | preview, impact, verification, rollback |
| require approval | pause a Bimax-owned action | exact scope and user decision |
| isolate | stop/quarantine a Bimax-launched process or capability | narrow authority and recovery path |
| block | deny a narrow, predeclared hard boundary | deterministic rule; no model-only block |
| repair | apply an approved transaction | snapshot, authorization, postcondition, rollback |

System-wide process killing, firewall changes, persistence removal, permission mutation, credential
rotation, or deletion are never silent automatic corrections.

## 8. Correction architecture

Every correction is a typed transaction:

```text
detect
  → collect fresh minimal evidence
  → classify ownership and authority
  → build correction preview
  → capture reversible snapshot or declare non-reversible impact
  → request policy/user approval
  → re-check preconditions
  → apply one bounded mutation
  → observe independent postcondition
  → commit receipt or roll back
```

Correction classes:

- **project correction:** restore a lockfile, remove an unapproved generated executable, repair a
  local config—using git/checkpoint evidence and never erasing unrelated dirty work;
- **environment correction:** restore a virtual environment from a verified lock/recipe, disable a
  capability pack, or select a known-good runtime;
- **Bimax correction:** stop a tool, revoke a grant, clear a cache, restart an extension, or roll
  back a signed package;
- **macOS recommendation:** explain and deep-link to a system setting or safe manual remediation;
- **macOS mutation:** only when Apple provides a supported API, authority is explicit, a preview and
  rollback exist, and the corresponding acceptance journey passes.

Never modify the Signed System Volume, weaken SIP/Gatekeeper/XProtect, scrape protected data to
“check” it, or tell the user that broad Full Disk Access is harmless.

## 9. Process architecture

```text
┌──────────────── Bimax for Mac ────────────────┐
│ Renderer: findings, approvals, evidence only  │
│             typed preload API                 │
│ Electron main: Trust Center + policy broker   │
│             authenticated XPC                 │
│ Native intelligence service                   │
│   project observer / identity / event store   │
│        ↙ optional             optional ↘      │
│ Endpoint Security ext       Network filter ext│
└───────────────────────────────────────────────┘
             ↕ versioned data-only protocol
       coding engine / package resolver / MCP
```

- Renderer never receives a native handle, audit token, raw network payload, or unrestricted file
  path operation.
- Electron main validates sender, schema, project/task authority, and approval freshness.
- Native service validates client identity and owns OS API calls.
- System extensions are separate signed executables with minimal entitlements and bounded queues.
- Persistent event storage is encrypted where appropriate, redacted, size/time bounded, and
  deletable from Trust Center.
- Terminal consumes only generic policy results for its own proposed actions. No optional native
  sensor is packaged with or registered by Terminal.

## 10. Section 28 delivery slices

### S28-A — contextual receipts, no new permissions

1. Define TaskIntent, OperationIntent, Observation, Decision, and Verification schemas.
2. Make engine tools, package manager, MCP, browser, and Desktop Mac actions emit causal IDs.
3. Add deterministic project/task boundary rules and a finding timeline.
4. Add diagnostic export with redaction and retention controls.

Exit: a test task that unexpectedly attempts credential access or persistence produces a causal,
non-vacuous finding and blocks only the Bimax-owned operation.

### S28-B — project/environment drift

1. Inventory project declarations and approved environment roots.
2. Add FSEvents-backed invalidation plus exact rescan and overflow handling.
3. Compare lockfiles, executable artifacts, toolchain, package scripts, and endpoints.
4. Ship explain/recommend only; measure false-positive and alert-volume budgets.

Exit: deterministic fixtures distinguish normal build cleanup from unrelated executable,
persistence, and credential-path mutations.

### S28-C — reversible project/environment correction

1. Define correction transaction and rollback contracts.
2. Integrate cleanly with dirty-worktree-safe checkpoints and environment locks.
3. Add approval, fresh precondition, independent postcondition, and forced-failure rollback tests.

Exit: mutation testing proves a fake repair cannot pass when end state is wrong.

### S28-D — opted-in process provenance

1. Prototype Bimax-launched process-tree observation with no broad permission.
2. Build load/queue/drop/deadlock tests and measure overhead.
3. Apply for Endpoint Security entitlement only after the product purpose and privacy disclosure are
   ready; absence of approval remains a supported product state.
4. Ship system extension observation-only, then narrow deterministic policies.

Exit: clean-Mac consent, update, revoke, event-loss, deadline, and performance matrices pass.

### S28-E — optional network metadata and learned anomaly

1. Prove declared-versus-observed endpoint value before requesting a network filter.
2. Keep data/control providers separated and payload capture off by default.
3. Train/evaluate only on consented, labeled, versioned corpora.
4. Publish precision, recall, false-positive rate, detection latency, observation gaps, and overhead
   for each scenario; no broad security claim from one run.

Exit: anomaly output materially improves ranked review without becoming the sole block/repair cause.

## 11. Section 28 acceptance journeys

| ID | Journey | Required end-state proof |
|---|---|---|
| S28-01 | normal build deletes generated output | no warning; causal activity remains within declared build roots |
| S28-02 | build child reads SSH private key | Bimax-owned operation blocked or paused; exact causal path shown |
| S28-03 | package lifecycle script writes LaunchAgent | finding names package, script, child, target, rule; no persistence remains |
| S28-04 | approved dependency install contacts expected registry | no anomaly solely because traffic is new to the device |
| S28-05 | same install contacts undeclared host after credential read | combined causal finding outranks isolated novelty |
| S28-06 | event queue drops observations | UI and receipt declare an evidence gap; no false “safe” verdict |
| S28-07 | correction fails halfway | before-state restored and independently verified |
| S28-08 | dirty repository correction | unrelated user changes survive byte-for-byte |
| S28-09 | permission denied/revoked | core Code works; sensor reports unavailable without retry storm |
| S28-10 | signed extension update | identity, entitlement, migration, rollback, and retained consent tested on fresh Mac |
| S28-11 | forged/stale observation | action rejected and mutation test fails the grader |
| S28-12 | repeated benign toolchain corpus | false-positive and notification-volume budgets met across real projects |

Every run records product/build, macOS/hardware, policy/model version, corpus version, attempts,
discarded runs, event loss, latency, CPU, memory, energy proxy, and raw redacted artifacts.

---

# Part II — Section 29: Modular Chipset-Native Developer Ecosystem

## 12. Product definition

Section 29 combines four products that must share contracts without becoming one privileged blob:

1. an integrated agentic coding workspace;
2. a verified capability and skill ecosystem;
3. project-aware environment discovery and preparation;
4. silicon-aware execution, ML experimentation, and rendering policy.

The common nucleus is a **capability graph**: what is installed, verified, permitted, compatible,
healthy, and appropriate for this task and Mac.

## 13. Capability taxonomy

Do not treat every extension as the same package type.

| Kind | Examples | Execution model | Default trust |
|---|---|---|---|
| knowledge skill | `SKILL.md`, references, templates | parsed data/instructions; scripts declared separately | inspectable, capability-scoped |
| MCP/tool service | local stdio service, remote HTTPS tool | out of process through broker | untrusted tool metadata; per-call policy |
| app extension | bounded IDE/inspector feature | ExtensionKit/XPC-style separate process where viable | signed, host-defined point |
| native capability | Computer Use provider, optional sensor | app-bundled signed XPC/system extension | highest review and entitlement bar |
| environment recipe | runtime/SDK/package constraints | plan interpreted by resolver | no execution until diff approved |
| external toolchain adapter | Homebrew, Xcode, Android SDK, Python/Node manager | invokes installed official manager | receipt and project scope required |
| simulator adapter | Xcode Simulator, Android Emulator | external platform-managed process | runtime obtained from vendor tooling |
| ML Alchemist module | model inspector, converter, benchmark, optimizer | isolated worker with explicit backend | model artifacts treated as untrusted data |
| UI asset/theme | icons, syntax, layout data | renderer-safe data only | no executable content |

Executable packages never run in the renderer. A `SKILL.md` instruction is not proof that its
scripts are safe. MCP tool descriptions and annotations are untrusted input and cannot grant their
own capabilities.

## 14. Capability manifest and graph

Every installed capability has immutable content identity plus signed metadata:

```yaml
schema: bimax.capability/v1
id: org.example.android-adapter
version: 1.4.2
kind: external-toolchain-adapter
platforms: [macos-arm64]
minimum_macos: "13.0"
content_digest: sha256:...
publisher_identity: ...
provenance: ...
entrypoints:
  - role: resolver
    protocol: bimax-capability/1
permissions:
  filesystem_read: [project, android_sdk]
  filesystem_write: [project_build, named_cache]
  network: [dl.google.com, maven.google.com]
  process: [adb, emulator, sdkmanager]
dependencies:
  - id: system.android-sdk
    version: ">=35 <36"
conflicts: []
data_contract:
  inputs: [...]
  outputs: [...]
privacy:
  collected: [...]
  retention: none
rollback:
  previous_version_supported: true
```

Resolved graph nodes include state:

```text
discovered → verified → compatible → permitted → activated → healthy
                    ↘ quarantined / incompatible / revoked / rollback
```

Activation is task/project scoped unless a capability inherently needs a broader user scope.
“Installed” never implies “always active.”

## 15. Supply-chain design

The catalog needs more than a checksum page:

- TUF-style root, targets, snapshot, and timestamp metadata provide key rotation, freshness,
  consistent snapshots, and rollback/freeze resistance;
- every target declares length and cryptographic digest before download is trusted;
- Sigstore-compatible bundles or equivalent verifiable signing evidence can bind publisher identity
  and transparency proof;
- SLSA provenance records build source and process for Bimax-produced packages;
- OSV-compatible vulnerability lookup informs review and quarantine but does not silently rewrite a
  project lockfile;
- macOS executable packages are signed correctly at every nested level and notarized for stable
  distribution; never use `codesign --deep` as a repair strategy;
- metadata expiry, key rotation, compromised-publisher revocation, offline behavior, rollback, and
  mirrors are exercised in fixtures.

Installation transaction:

```text
fetch trusted metadata
  → resolve version/platform/dependencies
  → show permission + disk + provenance diff
  → user/policy approval
  → download to staging
  → verify length/digest/signature/provenance/notarization
  → scan/decompress with path and size limits
  → register inactive
  → health-check isolated entrypoint
  → atomically activate
  → preserve rollback target
```

Reject path traversal, symlink escape, decompression bombs, undeclared executables, identity drift,
expired metadata, rollback versions, dependency confusion, and a package whose runtime behavior
exceeds its manifest.

## 16. Extension runtime and broker

Apple's extension architecture reinforces Bimax's direction: extensions run separately and the host
defines narrow extension points. Bimax should use an authenticated, versioned, data-only broker even
when the exact Apple framework differs by minimum OS and package kind.

The broker enforces:

- protocol and schema version;
- signed package/digest identity;
- task, project, user, and session authority;
- path capabilities represented by opaque handles, not arbitrary strings;
- domain/endpoint allowlists and network purpose;
- subprocess executable and argument classes;
- resource budgets, cancellation, deadline, and output size;
- taint propagation from web/MCP/package content;
- structured logs, receipts, health, crash backoff, and quarantine.

The renderer can ask for a declared action and display its receipt; it cannot connect directly to an
extension. Package UI is rendered with host components from declarative data, not arbitrary remote
HTML/JavaScript.

## 17. Skills and MCP

Bimax should implement the Agent Skills directory convention progressively:

- `SKILL.md` metadata and instructions are inspectable before activation;
- references/assets are lazily loaded and content-addressed;
- executable scripts are declared in the capability manifest with separate permissions;
- discovery is deterministic, precedence is visible, and changes invalidate caches safely;
- duplicate names and shadowing are surfaced, not silently resolved;
- a skill cannot expand tool authority merely by instructing the model to do so.

For MCP:

- discover and validate tool schemas before exposure;
- treat names, descriptions, annotations, returned instructions, and resource links as untrusted;
- show the actual server identity and requested action at approval time;
- apply permission checks to every nested/tool-dispatched call;
- isolate local stdio servers and restrict their environment;
- bind remote servers to authenticated origins and explicit redirect/OAuth policy;
- cap responses and redact tool output before persistence or model reuse;
- surface tool-list changes and require reapproval for material capability expansion.

## 18. Environment intelligence

The environment resolver is **inspect → explain → propose → approve → transact → verify**, never
“detect missing tool and install it.”

### Inventory

Build an immutable snapshot from:

- hardware architecture, macOS and Xcode/Command Line Tools versions;
- shells and resolved executable paths;
- language/runtime managers and versions;
- project manifests, locks, workspace config, build scripts, CI and deployment descriptors;
- virtual environments, containers/VMs, SDK roots, simulators, and device bridges;
- package-manager inventory using supported structured output when available;
- verified Bimax capability graph.

Avoid executing project scripts during discovery. Never source an untrusted shell profile merely to
learn PATH. Record provenance for every detected executable and distinguish system, vendor,
package-manager, user, and project-local installation.

### Requirements and resolution

Convert declarations into constraints, not guesses. A plan must identify:

- already satisfied requirements;
- incompatible or ambiguous versions;
- missing optional versus required components;
- estimated download/disk/time/network impact;
- project and global mutations;
- lifecycle scripts or native builds that may run;
- license, source, vulnerability, architecture, and provenance facts;
- rollback/uninstall route.

Prefer project-local, lockfile-driven environments. Global install is explicit. Do not upgrade an
unrelated runtime to satisfy one project. Do not treat a Homebrew formula, npm package, Python wheel,
Xcode component, and simulator runtime as interchangeable artifacts.

### Verification

Successful command exit is not enough. Run a minimal project-relevant probe, re-inventory state,
verify paths/versions/architecture, confirm lock consistency, and attach receipts. On failure,
restore the prior resolver state without overwriting user changes.

## 19. Simulator capability packs

### iOS and Apple platform simulation

Bimax integrates with Xcode-managed simulator components. Xcode and `xcodebuild` own downloading and
installing Apple platform runtimes. Bimax may inventory, propose, launch, observe, and test them; it
must not repackage Apple simulator runtimes in a capability catalog.

The adapter records Xcode selection, SDK/runtime/device identity, destination, app build identity,
logs, screenshots, test results, and cleanup. Missing Xcode license/first-launch state is shown as a
manual or supported-tool step, not bypassed.

### Android simulation

The Android Emulator is an external official toolchain with meaningful RAM, storage, virtualization,
and acceleration requirements. On Apple silicon it should use supported arm64 system images and the
platform's hardware acceleration. Bimax inventories Android Studio/SDK Manager/ADB/emulator and
proposes official components. It does not bundle a private Android distribution.

The adapter controls AVD lifecycle, cold/warm boot distinction, snapshot identity, ports, logs,
screenshots, tests, and cleanup. Resource policy prevents an emulator, indexer, local model, and
parallel agents from exhausting unified memory simultaneously.

### Virtual environments

Apple Virtualization framework is suitable for explicit Linux/macOS VM products, not an invisible
default for every tool. VM images are large trusted artifacts with OS licensing, update, disk,
network, and secret boundaries. Apple's newer container tooling is macOS- and Apple-silicon-version
dependent, so it is an optional later backend, not the macOS 13 baseline.

## 20. Computer Use as a package

“Downloadable Computer Use” changes activation, not ownership:

- it is a Bimax for Mac native capability pack;
- Desktop remains the visible permission owner and broker;
- native helpers/system components are signed, app-associated, and structurally verified;
- TCC prompts occur only after activation and a user invokes the capability;
- deactivation removes tool exposure and grants inside Bimax, documents macOS revocation, and keeps
  Code fully usable;
- Terminal never downloads, registers, or exposes the provider.

The existing semantic → physical → visual → stop ladder and all Computer Use gates remain binding.

## 21. Integrated Bimax IDE

The owner phrase “its own IDE” is implemented as a coherent Bimax-owned work surface, not a new text
editing engine:

- project/task navigation and goals;
- CodeMirror-based source inspection/editing where appropriate;
- diff, staged/unstaged/branch review and line findings;
- persistent xterm/PTY on demand;
- git/worktree/checkpoint lineage;
- tests, previews, browser artifacts and simulator targets;
- capability/environment status;
- ML Alchemist inspector;
- Mac Live Target and action evidence in Desktop;
- one final receipt tying claim to code/test/runtime evidence.

Editor handoff and ACP remain first-class. A user can keep VS Code, Zed, Xcode, or another editor
while Bimax acts as the task/evidence/control plane. This resolves the earlier deliberate decision
not to build a greenfield editor while fulfilling the integrated IDE vision.

## 22. ML Alchemist

ML Alchemist should be a mission-specific workspace made of replaceable workers:

```text
model/artifact intake
  → format and provenance inspection
  → architecture/parameter graph
  → dataset and evaluation contract
  → baseline inference/training run
  → candidate transform
  → accuracy/behavior + latency/memory/energy evaluation
  → compare, export, receipt
```

### Supported backend roles

| Backend | Best-fit role | Boundary |
|---|---|---|
| MLX | Apple-silicon-native research, fine-tuning, generation, custom experiments | unified memory is shared capacity, not free capacity |
| Core ML | deployment-oriented conversion and device execution | compute-unit choice is a measured policy; model/operator support varies |
| coremltools | conversion, palettization, pruning, quantization workflows | every transform needs task-specific quality validation |
| PyTorch MPS | PyTorch development/training on Metal | fallbacks, unsupported ops, precision, and reproducibility must be surfaced |
| MPSGraph | lower-level graph/training workloads | advanced module, not default UX |
| Accelerate/BNNS | optimized CPU/vector/DSP primitives | appropriate for bounded native kernels, not arbitrary models |

### Artifact safety

Models, checkpoints, tokenizers, datasets, and notebooks are untrusted artifacts. Prefer safe tensor
formats and bounded parsers; isolate conversion; limit memory/disk; hash inputs/outputs; record code,
dependency, seed, dataset, and device facts. Loading arbitrary pickled Python models is a code
execution decision, not a data preview.

### Optimization truth

“Quantized,” “pruned,” or “smaller” is not automatically better. Every candidate compares:

- task-specific quality and behavioral regressions;
- output stability and calibration where relevant;
- cold and warm latency distributions;
- peak/resident memory and artifact size;
- energy/thermal proxy over a defined workload;
- supported hardware and fallback path;
- conversion warnings and numerical precision;
- reproducibility and export integrity.

“Scale down model weights” must be expressed as a named operation—quantization, pruning, distillation,
low-rank adaptation, architecture change, or checkpoint selection—with a quality gate. Bimax never
mutates the only checkpoint in place.

## 23. Chipset-native runtime policy

### Inputs

- architecture and supported OS/API capabilities;
- active interaction and foreground/background state;
- ProcessInfo thermal state and Low Power Mode;
- dispatch memory-pressure notifications plus Bimax's own working-set budgets;
- power source/battery state;
- network path constraints/expense and request purpose;
- workload size, latency class, deadline, parallelism and checkpointability;
- simulator/VM/local-model resource reservations;
- accessibility Reduce Motion and display refresh capabilities;
- measured strategy history for the same operation/device class.

### Outputs

- concurrency and background-agent ceiling;
- indexing batch/chunk size and pause/resume;
- CPU/GPU/ANE/remote candidate backend where supported;
- local model size/context/batch and offload choice;
- simulator/VM scheduling;
- cache admission/eviction and memory budget;
- download deferral and network policy;
- animation complexity, refresh range, and nonessential effect suppression.

### Control rules

1. Interactive input and correctness have priority over throughput.
2. Accessibility preferences are hard constraints, not optimization hints.
3. Policy changes use hysteresis and minimum residence time.
4. Existing foreground work is not abruptly killed for a small sensor fluctuation.
5. Unknown sensor state uses a documented safe/default policy.
6. A strategy must be benchmarked on the operation and hardware class before becoming automatic.
7. Users can see why a workload was deferred or rerouted and can override within safety limits.
8. Telemetry for learning is local and inspectable by default.

The existing `PowerMonitor` is a useful advisory prototype. Production policy should move Mac
signals into the Desktop/native boundary, add low-power/memory-pressure APIs, and keep a protocol
fallback for Terminal. Shelling out to `pmset` may remain a compatibility probe but is not the sole
native truth source.

## 24. Rendering policy

Rendering should reflect interaction and accessibility, not continuously advertise hardware state.

- Use event-driven UI updates where no animation is needed.
- Use system/native timing and Core Animation for ordinary transitions.
- Use Metal only for a measured workload that benefits from it.
- Make interaction, text input, scrolling, cursor, and target feedback the highest-priority frames.
- Lower or suspend nonessential previews/effects when occluded, backgrounded, thermally constrained,
  under memory pressure, or in Low Power Mode.
- Honor Reduce Motion and avoid conveying state only through animation.
- Use `preferredFramesPerSecond` or frame-rate ranges as preferences, not promises; measure actual
  frame pacing and missed-frame distributions.
- Never couple a security decision deadline to visual rendering.

Acceptance is perceptual and empirical: input latency, missed frames, energy/thermal behavior,
memory, and accessibility across supported hardware—not “GPU usage increased.”

## 25. Section 29 delivery slices

### S29-A — capability schema and read-only environment inventory

1. Define manifest, capability graph, protocol, permission vocabulary, and receipts.
2. Inventory runtimes/toolchains without executing project code.
3. Add Skills discovery and MCP capability display with no new auto-approval.
4. Show satisfied, missing, ambiguous, incompatible, and unverified state.

Exit: representative frontend, native, and ML repositories produce deterministic, redacted,
non-mutating inventories.

### S29-B — resolver and trusted package transactions

1. Add signed/fresh metadata, staged verification, inactive registration, health check, activation,
   rollback, revocation, and offline behavior.
2. Implement project-local recipe resolution before global managers.
3. Add Homebrew/runtime-manager adapters only with structured inventory and preview.

Exit: compromised, expired, downgraded, dependency-confused, path-traversing, or overprivileged
fixtures fail; rollback restores the exact prior graph.

### S29-C — isolated extension host and IDE composition

1. Add brokered out-of-process capability execution and resource budgets.
2. Compose the Bimax workspace from current editor/diff/terminal/git/task/evidence parts.
3. Add project-scoped capability manager and approval history.

Exit: crashing or malicious test extension cannot crash the host, access undeclared data, bypass a
nested approval, or inject renderer code.

### S29-D — simulator adapters and optional Computer Use

1. Integrate Xcode-managed runtimes and Android official tooling.
2. Add resource reservations and lifecycle receipts.
3. Package Computer Use only through the app-owned provider contract.

Exit: clean activation/deactivation and representative build-test-observe journeys pass without
Terminal acquiring a Mac permission or native payload.

### S29-E — ML Alchemist baseline

1. Inspect models safely and define dataset/evaluation contracts.
2. Support one measured pipeline each for MLX experimentation and Core ML deployment.
3. Add candidate comparison for quantization/pruning with quality, latency, memory, and artifact
   integrity gates.

Exit: a deliberately degraded model loses the evaluator; a smaller artifact is not selected when
quality or supported-device behavior violates the contract.

### S29-F — adaptive policy and rendering

1. Instrument workload and UI budgets without automatic adaptation.
2. Replay sensor traces and establish policies, bounds, hysteresis, and overrides.
3. Canary one decision class at a time: background concurrency, indexing, model backend, then
   nonessential rendering.

Exit: each automatic policy has a measured win or is removed. No broad “chipset-native” claim is
published from synthetic utilization alone.

## 26. Section 29 acceptance journeys

| ID | Journey | Required end-state proof |
|---|---|---|
| S29-01 | inventory a configured frontend repo | exact existing versions and missing constraints; zero mutation or project-script execution |
| S29-02 | prepare project-local environment | preview approved, lock satisfied, relevant test passes, unrelated global tools unchanged |
| S29-03 | expired/downgraded package metadata | activation refused with recoverable explanation |
| S29-04 | package archive traversal/bomb | bounded staging rejects it; no escaped write |
| S29-05 | extension requests undeclared file/network/process | broker denies it and causal receipt names manifest mismatch |
| S29-06 | MCP server changes tool capabilities | material expansion withheld pending reapproval |
| S29-07 | skill contains executable script | script remains separately declared and gated; instructions cannot self-grant |
| S29-08 | iOS simulator runtime missing | Xcode-supported install proposal shown; Bimax does not repackage runtime |
| S29-09 | Android emulator plus local model under memory pressure | policy avoids memory collapse; reason and reservation visible |
| S29-10 | optional Computer Use activated/deactivated | Desktop owns prompts/provider; Terminal archive stays CU-free |
| S29-11 | extension crashes repeatedly | host remains responsive; bounded restart then quarantine |
| S29-12 | model quantization candidate | quality, latency, memory, size, device/fallback, hashes and provenance compared |
| S29-13 | deliberately corrupted model/checkpoint | isolated parser rejects it without host compromise or partial overwrite |
| S29-14 | thermal/low-power trace | background work changes only after threshold/hysteresis; foreground remains responsive |
| S29-15 | Reduce Motion enabled | nonessential animation removed regardless of performance headroom |
| S29-16 | adaptive render strategy | measured input/frame/energy budget improves or feature remains disabled |
| S29-17 | resolver failure with dirty project | rollback preserves all unrelated user changes and previous capability graph |
| S29-18 | x64 supported build | capability selection does not assume Apple-silicon-only backend |

## 27. Cross-section dependency map

```text
S29 manifest + identity + broker ───────────────┐
S29 environment inventory ────────────────┐    │
typed task/action/evidence protocol ───────┼────┼→ S28 contextual comparison
Desktop Trust Center + native boundary ────┘    │          ↓
S29 transactional rollback ─────────────────────┘   S28 correction

runtime workload receipts ─→ S29 adaptive policy ─→ bounded scheduling/rendering
                └──────────→ S28 unusual resource/activity findings
```

Section 29's manifest, identity, broker, and inventory are prerequisites for high-confidence
Section 28 judgments. Section 28's findings, approval, and correction transaction make Section 29's
downloadable ecosystem safe enough to ship. They should share schemas and Trust Center surfaces,
not independent databases or scoring systems.

## 28. Program priority relative to the reset

| Order | Program | Why |
|---|---|---|
| 1 | complete existing Phases 1–2 external qualification and app-owned CU route | establishes truthful products and permission owner |
| 2 | versioned engine/capability/evidence protocol | prevents new features from coupling repos again |
| 3 | S28-A and S29-A together | highest-context value with no privileged permissions or installs |
| 4 | S29-B/C | secure modularity before executable ecosystem growth |
| 5 | S28-B/C | project drift and reversible correction on trusted inventory |
| 6 | S29-D/E | simulators, optional CU package, then focused ML Alchemist |
| 7 | S28-D/E | entitlement-gated broader sensors after privacy/performance proof |
| 8 | S29-F | adaptive execution/rendering only after instrumentation and replay |

Do not use sections 28/29 as a reason to postpone the unsupported Electron upgrade, physical-input
proof, fresh-Mac tests, protocol boundary, repo split, signing, or notarization.

## 29. Claim ladder

| Claim | Minimum status |
|---|---|
| Bimax records and checks its own task operations | Implemented only after S28-A mutation-tested journeys |
| Bimax detects contextual project drift | Measured only with labeled multi-project corpus and FP budget |
| Bimax monitors system process activity | Implemented only on approved/qualified extension path; permission denial supported |
| Bimax corrects configuration safely | Measured per correction class with rollback mutation tests |
| Bimax has a modular ecosystem | Product-ready only after signed update, broker, rollback, revocation, clean-Mac gates |
| Bimax prepares developer environments | Measured per supported manager/project class |
| Bimax has ML Alchemist | Implemented per named backend/workflow; no blanket model-support claim |
| Bimax is chipset-native | Target until device-matrix wins exist for named operations without UX/accessibility regressions |

No broad “detects zero-days,” “repairs macOS,” “uses every chip optimally,” “understands every
environment,” or “safest agent ecosystem” claim is authorized by this plan.

## 30. Primary research ledger

### Apple security, observation, and distribution

- [Endpoint Security](https://developer.apple.com/documentation/endpointsecurity) and the
  [client entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.endpoint-security.client)
- [Build an Endpoint Security app](https://developer.apple.com/videos/play/wwdc2020/10159/) and
  [Endpoint Security updates](https://developer.apple.com/videos/play/wwdc2022/110345/)
- [`es_message_t.deadline`](https://developer.apple.com/documentation/endpointsecurity/es_message_t/deadline)
  and [`es_process_t`](https://developer.apple.com/documentation/endpointsecurity/es_process_t)
- [System Extensions](https://developer.apple.com/system-extensions/) and
  [`OSSystemExtensionRequest`](https://developer.apple.com/documentation/systemextensions/ossystemextensionrequest)
- [FSEvents programming guide](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/)
- [Network Extension](https://developer.apple.com/documentation/networkextension),
  [content-filter providers](https://developer.apple.com/documentation/networkextension/content-filter-providers),
  [TN3134 deployment](https://developer.apple.com/documentation/technotes/tn3134-network-extension-provider-deployment),
  and [TN3120 packet-tunnel use cases](https://developer.apple.com/documentation/technotes/tn3120-expected-use-cases-for-network-extension-packet-tunnel-providers)
- [Service Management](https://developer.apple.com/documentation/servicemanagement/),
  [Security](https://developer.apple.com/documentation/security/), and
  [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
- [Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
  and [distribution-signed code](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)
- [System Integrity Protection](https://support.apple.com/guide/security/system-integrity-protection-secb7ea06b49/web),
  [Signed System Volume](https://support.apple.com/en-euro/guide/security/secd698747c9/web), and
  [XProtect](https://support.apple.com/guide/security-pdf/protecting-against-malware-sec469d47bd8/web)
- [App Sandbox file access](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox),
  [Full Disk Access](https://support.apple.com/en-gb/guide/mac-help/mchl211c911f/mac), and
  [privacy manifests](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)
- [OSLog](https://developer.apple.com/documentation/oslog),
  [OSLogStore](https://developer.apple.com/documentation/oslog/oslogstore),
  [MetricKit](https://developer.apple.com/documentation/metrickit), and
  [dispatch memory pressure](https://developer.apple.com/documentation/dispatch/dispatchsourcememorypressure)

### Security scenarios and anomaly research

- MITRE ATT&CK macOS-relevant scenarios:
  [Launch Agents](https://attack.mitre.org/techniques/T1543/001/),
  [Launch Daemons](https://attack.mitre.org/techniques/T1543/004/),
  [SSH Authorized Keys](https://attack.mitre.org/techniques/T1098/004/), and
  [browser credentials](https://attack.mitre.org/techniques/T1555/003/)
- USENIX: [Toward Practical and Usable Provenance-based Intrusion Detection Systems](https://www.usenix.org/publications/loginonline/toward-practical-and-usable-provenance-based-intrusion-detection-systems)
- USENIX Security: [PROGRAPHER](https://www.usenix.org/conference/usenixsecurity23/presentation/yang-fan),
  [MAGIC](https://www.usenix.org/system/files/usenixsecurity24-jia-zian.pdf), and
  [The Case for Learned Provenance-based Intrusion Detection Systems](https://www.usenix.org/system/files/usenixsecurity23-ding-hailun-provenance.pdf)

### Extensions, packages, and supply chain

- [ExtensionFoundation](https://developer.apple.com/documentation/ExtensionFoundation),
  [adding app extensions](https://developer.apple.com/documentation/extensionfoundation/adding-support-for-app-extensions-to-your-app),
  [enhanced-security helper extensions](https://developer.apple.com/documentation/xcode/creating-enhanced-security-helper-extensions),
  and [XPC](https://developer.apple.com/documentation/Foundation/xpc)
- [Placing content in a bundle](https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle)
- [Background Assets](https://developer.apple.com/documentation/BackgroundAssets) and
  [background downloads](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background)
- [The Update Framework metadata](https://theupdateframework.io/docs/metadata/) and
  [specification](https://theupdateframework.github.io/specification/)
- [Sigstore bundle format](https://docs.sigstore.dev/about/bundle/) and
  [Cosign verification](https://docs.sigstore.dev/cosign/verifying/verify/)
- [SLSA build track](https://slsa.dev/spec/v1.2/build-track-basics) and
  [OSV](https://google.github.io/osv.dev/)
- [Agent Skills specification](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools),
  [security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices),
  and [client best practices](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices)

### Environments, simulation, ML, and adaptive runtime

- [Xcode additional components](https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components)
- [Android Emulator](https://developer.android.com/studio/run/emulator) and
  [hardware acceleration](https://developer.android.com/studio/run/emulator-acceleration)
- [Virtualization](https://developer.apple.com/documentation/virtualization),
  [Linux VMs](https://developer.apple.com/documentation/virtualization/creating-and-running-a-linux-virtual-machine),
  and [macOS VMs on Apple silicon](https://developer.apple.com/documentation/virtualization/running-macos-in-a-virtual-machine-on-apple-silicon)
- [MLX](https://ml-explore.github.io/mlx/build/html/) and
  [MLX unified memory](https://ml-explore.github.io/mlx/build/html/usage/unified_memory.html)
- [Core ML compute units](https://developer.apple.com/documentation/coreml/mlcomputeunits) and
  [coremltools optimization](https://apple.github.io/coremltools/docs-guides/source/opt-overview.html)
- [PyTorch MPS](https://docs.pytorch.org/docs/stable/notes/mps.html),
  [Accelerate](https://developer.apple.com/documentation/accelerate), and
  [MPSGraph training](https://developer.apple.com/documentation/metalperformanceshadersgraph/training_a_neural_network_using_mps_graph)
- [ProcessInfo](https://developer.apple.com/documentation/foundation/processinfo),
  [NWPathMonitor](https://developer.apple.com/documentation/network/nwpathmonitor), and
  [URLSessionConfiguration](https://developer.apple.com/documentation/foundation/urlsessionconfiguration)
- [MTKView](https://developer.apple.com/documentation/metalkit/mtkview),
  [`preferredFramesPerSecond`](https://developer.apple.com/documentation/metalkit/mtkview/preferredframespersecond),
  [`CAMetalDisplayLink.preferredFrameRateRange`](https://developer.apple.com/documentation/quartzcore/cametaldisplaylink/preferredframeraterange),
  [motion HIG](https://developer.apple.com/design/human-interface-guidelines/motion), and
  [Reduce Motion](https://developer.apple.com/documentation/appkit/nsworkspace/accessibilitydisplayshouldreducemotion)

## 31. Research limits and decisions still required

- Apple approval for Endpoint Security or Network Extension entitlement has not been requested or
  obtained. Product design must work without either.
- Distribution identity, signing/notarization credentials, and final catalog operator are not yet
  decided.
- Data retention, encryption/key management, vulnerability response, and telemetry defaults need a
  privacy/security review before implementation.
- The first supported environment managers, languages, simulator versions, model formats, and ML
  tasks must be deliberately bounded.
- Learned anomaly detection needs a consented labeled corpus and false-positive budget; research
  papers do not substitute for Bimax measurement.
- Hardware policy needs a supported-Mac matrix and baselines. Different execution strategies are
  hypotheses until end-to-end latency, memory, energy/thermal, correctness, and UX are measured.

These are blockers to broad claims, not blockers to S28-A and S29-A. Those two slices can begin after
the current product boundary and protocol work without requesting new macOS permissions or
installing anything.

# Phase 8 record — contextual intelligence and trusted capability foundation

Owner vision sections 28 and 29 (V28B, V29B in `12_ALL_VISION_SECTIONS_RESEARCH_PLAYBOOK.md`).
Research and delivery contract: `11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md`.
Gate: the section 28 and section 29 rows of `08_ACCEPTANCE_GATES.md`.

Status, 2026-08-09: **every Phase 8 roadmap bullet is Implemented and locally graded.** The phase's
own exit — "S28-A/S29-A and trusted package transactions pass the journeys … no new macOS permission
is required" — is met, and the phase's remaining bullets (isolated broker execution, revocation,
project/environment drift, and reversible correction) are landed with it. That covers S28-A, S28-B,
S28-C, S29-A, S29-B and S29-C step 1.

It is still **not** a Measured or Product-ready claim. Everything here is offline and deterministic:
no labeled multi-project corpus exists, so no false-positive or overhead budget has been measured;
no signing key or catalog operator exists, so every metadata test uses an injected verifier; and
nothing was run on a fresh Mac. S28-D/E and S29-D/E/F belong to Phase 9 by the roadmap's own
sequencing and are untouched. The complete Target list is at the end of this record.

Run this phase's gate with:

```bash
npm run phase8:check
```

## What now works

### The shared causal evidence vocabulary (S28-A step 1)

`src/evidence/schema.ts` is the single source of truth for TaskIntent, OperationIntent, Observation,
Identity, Relationship, Decision, Approval, ActionReceipt, Verification and Rollback. It is mirrored
verbatim into Desktop as `app/src/shared/evidence.gen.ts` by `npm run gen:app-protocol`, with a
byte-identical drift gate in `npm run check:protocol-mirror` — the same mechanism the engine wire
protocol already used, so Desktop's broker and Trust Center cannot disagree with the engine about
what a Verification means.

Records are content-addressed: the id is a sha256 over the canonical form of the record minus its own
id, computed identically on both sides. `src/evidence/ledger.ts` is append-only, bounded, and refuses
a record whose seal no longer matches its content.

Five honesty invariants are enforced by `validate()` rather than documented:

| Invariant | Where it comes from |
|---|---|
| a `satisfied: true` Verification requires complete, fresh evidence | section 28 gate: an evidence gap cannot produce an unqualified safe verdict |
| a `satisfied: true` Verification requires **observed**, not declared, evidence | §2.2, and the `EvidenceBasis` finding below |
| the detection layer bounds the disposition — no model-only block, no anomaly-only repair | §2.3, §6 |
| a `restored` Rollback must cite an independent Verification | S28-C's fake-repair mutant |
| a Decision on incomplete evidence may not settle at `observe` | section 28 gate |

An Observation may not be classified `secret`; `redactFacts` is the only supported way to build one,
and `validate` rejects facts that still carry a secret-bearing key at any depth, so a sensor cannot
route around the redactor by constructing the object literally.

### The deterministic detection floors (S28-A step 3)

`src/evidence/path.class.ts` classifies a macOS path into one of eleven classes, most-dangerous
first, so a credential file inside a project root is still `credential`. `src/evidence/boundary.ts`
implements Layers A, B and C from §6 over that classification, with nineteen registered rule ids. A
finding cites observations, names the identities involved, and — outside Layer A — offers plausible
benign explanations, because §5 requires all three.

Silence is graded as hard as detection. S28-01 and S28-04 assert that a build deleting its own
generated output and an approved install reaching its declared registry produce **zero** findings.

`causalCombination` implements S28-05: an undeclared destination alone is `explain`; the same
destination after a credential read on the same causal path escalates strictly above it, capped by
the layer ceiling.

### Causal receipts across Bimax-owned operations (S28-A step 2)

`src/evidence/task.guard.ts` is the per-task facade; `src/evidence/operation.map.ts` turns a tool
call into declared effects. `src/tools/tool.factory.ts` consults the guard for every tool built by
the factory: it records the OperationIntent, observations and Decision before the call, and an
ActionReceipt after it. Nested tool calls are scoped, so the causal path is real rather than
reconstructed.

The guard refuses **only** at `block`, which is the S28-A exit condition — it stops the Bimax-owned
operation and nothing else. `require-approval` is left to the Governor, which already owns the user
prompt. **With no guard installed the engine behaves exactly as it did before Phase 8**, and there is
a test for that.

### The `EvidenceBasis` axis — a defect this phase found and fixed

The first implementation modelled "the effects of this shell command were read from its text" as a
completeness gap. That was wrong, and the tests caught it: every ordinary `npm test` then raised an
evidence-gap finding and could not settle at `observe`, which would have failed the
notification-volume budget in `08_ACCEPTANCE_GATES.md` rather than protected anyone.

Completeness and basis are now separate axes. Nothing was dropped when Bimax reads a command
statically — Terminal simply has no process-provenance sensor, which is the declared boundary of tier
S28-0 (S28-D is entitlement-gated). So the observation records a `declared` provenance, and:

- a declaration **may** refuse an operation — a command naming a credential store is still blocked,
  exactly as the Governor's existing static analysis blocks it;
- a declaration **may never** certify an end state (`Verification.satisfied === true` requires
  `basis: 'observed'`) or justify a repair (`Decision.disposition === 'repair'` likewise).

### S29-A — capability manifest, graph, inventory, Skills and MCP

`src/capability/manifest.ts` parses `bimax.capability/v1` as untrusted input: reverse-DNS ids, exact
semver, a content digest required for every executable kind, and unrecognised permissions dropped
rather than displayed as an unenforced grant. The §14 state machine advances exactly one rung at a
time and each transition must name its evidence; there is no path from `discovered` to `activated`.

`src/capability/inventory.ts` is read-only by construction. Every subprocess it can run comes from
`VERSION_PROBES`, a frozen table of well-known tools with fixed version flags — there is no code path
that takes a command from a project file, lockfile, shell profile or manifest and runs it. It reports
five requirement states (`satisfied`/`missing`/`ambiguous`/`incompatible`/`unverified`), records
provenance for every detected executable, produces byte-identical output across runs, and states
what it deliberately did not inspect.

`src/capability/discovery.ts` resolves skill precedence deterministically and **reports what it
shadowed**. `skillAuthority()` does not consult frontmatter at all: a skill with no manifest has no
authority, which is S29-07. `diffToolList()`/`exposableTools()` withhold any newly-appeared MCP tool
pending reapproval (S29-06), and `displayMcpServer()` shows manifest-enforced authority alongside any
tool whose `readOnlyHint` contradicts it.

### S29-B — trusted package transactions

`src/capability/metadata.ts` implements the four TUF properties §15 asks for over Bimax's role
structure: per-role signature thresholds with key revocation (key compromise), expiry (freeze),
version comparison against last-trusted (rollback), and timestamp→snapshot→targets digest binding
(mix-and-match). It is not a general TUF client and says so. Signature verification is injected.
Artifact checks cover length, digest, publisher identity drift, provenance drift and notarization.
Vulnerability findings are review-only.

`src/capability/staging.ts` judges an entire archive **before anything is written**, which is what
makes S29-04's "no escaped write" provable rather than noticed-afterwards. It rejects traversal,
absolute paths, symlink escape resolved relative to the link's own directory, per-entry and total
size limits, compression ratio, path depth, entry count, and executables the manifest does not
declare. A rejected archive yields an empty extraction plan, so a caller that ignores the verdict
still writes nothing.

`src/capability/transaction.ts` makes §15's installation order unskippable and binds the approval to
the exact preview shown. It captures the prior graph node byte-for-byte before activation, so
rollback is a copy back rather than a re-derivation, and appends the rollback to the prior history
rather than replacing it (S29-17). With no prior version, a failed install is left in `rollback`,
which is off the forward path.

### S28-B — project and environment drift

`src/evidence/drift.ts`. §4's tier S28-1 is unusually prescriptive about this sensor and every
sentence became a constraint: FSEvents is an *invalidation hint*, a batch declares coalescing, an
overflow or a sequence jump is an evidence gap that forces a rescan, and **no finding names an
actor** — an FSEvent cannot identify one, so the subject is the watcher and the path, and
attribution comes from the causal graph the Task Guard already built.

The slice ships explain/recommend only, and that ceiling is structural: `driftDisposition` has no
return path above `recommend`. The alert-volume budget aggregates beyond ten items but ranks by
severity first, so a credential-path touch is never dropped in favour of lockfile noise.

### S28-C — reversible correction

`src/evidence/correction.ts` implements §8's transaction in order, with three properties carrying
the exit:

- **one bounded mutation** — a mutator that reports touching a path the preview did not name is
  rolled back even when it claims success;
- **an independent postcondition** — the probe reads the world; a correction whose check is the
  mutator's own return value cannot be expressed;
- **dirty state is sacred** — the snapshot covers only the previewed paths and restoration writes
  only those back, which is what makes S28-08's "byte-for-byte" claim structural rather than careful.

A postcondition that cannot be established on fresh evidence yields `null`, and `null` rolls back —
that is the fake repair the slice exit names. Persistence paths are on the uncorrectable list beside
credentials and security settings: §7 forbids silent persistence removal and §8 puts any macOS
mutation behind a supported Apple API, explicit authority and a passing acceptance journey, none of
which exist yet.

### S29-C step 1 — the isolated capability broker

`src/capability/broker.ts` is §16's list made executable: protocol version, signed digest identity,
task-scoped authority, **opaque path handles instead of strings**, host and process allowlists,
deadline, concurrency and output budgets, cancellation, taint propagation, crash backoff and
quarantine.

Two commitments do most of the work. A capability never receives a path — it receives a handle it
cannot forge or guess, and `resolveHandle` re-checks containment against the *current* manifest, so
a partial revocation reaches handles that are already outstanding. And a raw path anywhere in a
call's arguments is refused by shape, because addressing the filesystem directly is the failure the
broker exists to prevent. What a worker claims it touched is checked against authority afterwards,
never believed.

`narrowAuthority` is the Trust Center's partial revoke — authority only ever shrinks there; widening
is an upgrade and goes through the install transaction and its approval.

### Receipts across every Bimax-owned subsystem

The roadmap bullet is "engine, MCP, package, browser, Computer Use and environment operations". All
six now produce the same records:

- MCP — `mcp__<server>__<tool>` is mapped to the `mcp` subsystem, and path/URL values in the
  *model-supplied arguments* become declared effects. A registered capability manifest bounds the
  server, so exceeding it is `MANIFEST_EXCEEDED` at the guard layer and a denial at the broker
  layer, and the two cannot disagree.
- Capability, package and environment operations enter through `TaskGuard.reviewSubsystem`.
- Computer Use — `app/src/shared/mac.evidence.ts` translates a Mac action into the shared
  vocabulary. It is the one subsystem that genuinely observes an end state and therefore the one
  allowed to produce `satisfied: true`; a stale frame or a dropped accessibility notification
  collapses that to unknown. No pid, audit token or element handle crosses the boundary.

### Trust Center evidence surface and retention controls

`app/src/shared/evidence.timeline.ts` builds the Desktop view model. Row confidence is derived, never
supplied. The headline distinguishes "all within the approved boundary" from "no findings — but some
evidence is incomplete", and an eviction counts as a gap so a shorter timeline is never mistaken for a
quieter machine. A model explanation is carried in its own attributed field and never merged into a
finding. `retentionControls()` precomputes each delete control's exact blast radius before it is used.

## Verification run

Local, offline, on this machine, 2026-08-09. Command: `npm run phase8:check`.

- engine typecheck and Desktop typecheck: pass. Desktop production build: pass.
- evidence mirror byte-identical to `src/evidence/schema.ts`: pass (`bimax.evidence/1`, 19 rule ids).
- Phase 8 engine suites: **9 suites / 316 tests pass** — `evidence.schema`, `evidence.boundary`,
  `evidence.task.guard`, `evidence.subsystems`, `evidence.drift`, `evidence.correction`,
  `capability.inventory`, `capability.transaction`, `capability.broker`.
- Desktop Trust Center and Mac-adapter suite: **39 tests pass**.
- Mutation: **14 honesty invariants neutered one at a time in the gate; all 14 killed the suite.**
  Roughly fifty more were run during development across every module; each was killed after the
  gaps below were closed.
- No Endpoint Security or Network Extension entitlement exists anywhere in the tree.

Four mutants **survived** during development. All four were real gaps, and all four were fixed in
the code or the tests rather than argued away:

1. S28-01 did not actually grade the build-output rule — the fixture's path was already inside the
   approved write root, so the rule never ran. The journey now uses a task scoped to `src/` with
   generated output beside it, and asserts the silence *and* the contrasting non-silence.
2. `TaskGuard`'s `refuse` flag was unreachable from the tool factory, so emptying the refusing set
   changed nothing. It is public API; it now has direct tests.
3. The broker's `advance` guard on terminal capability states was unreachable — every off-path state
   already maps to `null` in the forward table. The dead branch was removed rather than tested.
4. The broker re-checked a handle against the current manifest, but nothing could narrow a manifest,
   so the check could not fail. `narrowAuthority` — the Trust Center's partial revoke — was added,
   which makes the re-check load-bearing and adds a control §2.4 asks for.

Two defects the tests found and the design changed for:

- **Completeness is not basis.** Modelling a statically-read shell command as an *evidence gap* made
  every ordinary `npm test` raise a finding, which would have failed the notification-volume budget
  rather than protected anyone. See the `EvidenceBasis` section above.
- **Quarantine and revocation were reporting "not activated".** Both remove the worker, and the
  worker lookup ran first, so a capability the user deliberately revoked was described with a
  message that told them nothing. Both are now checked before the lookup.

Full regressions after the phase:

- Engine: **198 suites, 1922 tests, 1919 pass, 2 skipped, 1 failed.** The one failing test and the
  four failing suites are pre-existing and untouched by this phase —
  `phase1.packaging.boundary`, `trust.center.model`, `desktop.trust.report` and
  `phase5.takeover.authority` fail on a `TrustReportInput.integrity` type change and a
  staging-script assertion, both from Phase 7. No suite that passed before this phase fails after it.
- Desktop Mac capability regression: **57 suites, 645 tests, all pass.**

## What remains Target

Deliberately out of scope for Phase 8 by the roadmap's own sequencing, and not claimed:

- **S28-D/E and S29-D/E/F belong to Phase 9.** Process provenance, Endpoint Security, network
  metadata, learned anomaly ranking, simulator adapters, ML Alchemist and adaptive runtime policy
  are all untouched. Layers D, E and F have rule ids and disposition ceilings but no implementation,
  which is why `anomalyConfidence` is `null` rather than `0`: a zero would claim a measurement that
  never happened.
- **No measured budget.** S28-12 needs a labeled multi-project corpus; none exists, so no
  false-positive, notification-volume, CPU, memory, energy or latency budget has been measured. The
  silence journeys are fixtures, not a corpus.
- **No real catalog.** Signature verification is injected and every metadata test uses a fixture
  verifier. No key, no catalog operator and no signed artifact exists, and §31's undecided rows —
  distribution identity, retention/encryption policy, first supported environment managers — are
  still undecided.
- **No real out-of-process worker.** The broker enforces §16's whole list, but `CapabilityWorker` is
  an interface; the XPC or child-process implementation that Desktop will own is not written. The
  crash, deadline, cancellation and quarantine paths are graded against an injected worker.
- **No FSEvents watcher.** `detectDrift` consumes change batches and handles coalescing, overflow
  and sequence gaps correctly; the macOS FSEvents stream that produces those batches is not wired.
- **The fresh-Mac matrix**, permission grant/deny/revoke behaviour on a clean machine, and anything
  requiring a packaged build. Not run.
- **S29-C's IDE composition half.** The broker is built; composing the Bimax workspace from the
  existing editor/diff/terminal/git/task surfaces is Phase 9 product work.

## Claim ladder position

Against §29 of `11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md`:

| Claim | Status after this phase |
|---|---|
| Bimax records and checks its own task operations | **Implemented** — mutation-tested S28-A journeys pass across every Bimax-owned subsystem |
| Bimax detects contextual project drift | **Implemented**, not Measured — deterministic fixtures pass; no labeled corpus and therefore no false-positive budget |
| Bimax monitors system process activity | Target — no entitlement requested, and permission denial stays a supported state |
| Bimax corrects configuration safely | **Implemented** for the project/environment classes, not Measured — rollback mutation tests pass; macOS mutation is deliberately refused |
| Bimax has a modular ecosystem | Target — manifest, graph, transaction and broker exist; signed update, a real catalog, revocation UX and clean-Mac gates do not |
| Bimax prepares developer environments | Target — inventory is Implemented; preparation is not built |
| Bimax has ML Alchemist | Target — untouched |
| Bimax is chipset-native | Target — untouched |

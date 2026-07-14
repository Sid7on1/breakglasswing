# Autonomy suite plan

This plan grows the suite to seven tasks. Expected steps are model-issued tool calls, not LLM turns.
Every grader lives outside the mutable fixture, uses data not present in the fixture tests, checks
observable behavior rather than source text, and snapshots or freezes caller-owned inputs wherever
mutation could create a false pass. Offline trajectories prove only pipeline execution; live runs are
the autonomy measurement.

## Suite rules

1. **Discrimination.** Tasks must be difficult enough that the current live harness may fail them.
   Difficulty tiers make that expectation explicit; the suite is valuable because it preserves
   measurable headroom below 100% completion, not because scripted trajectories all pass.
2. **Cross-harness portability.** Every task must be solvable from its fixture and prompt alone using
   standard Node.js and ordinary file/shell tools. Tasks may not assume BiMax internals, tool names,
   memory, configuration, or repository context, so the identical directory can run through BiMax,
   Claude Code, or Codex.
3. **Grader-prompt contract.** `check.mjs` may assert only behavior explicitly specified by the task
   prompt, including ordering, rounding, tie-breaks, validation messages, and mutation rules. Every
   grader change requires a prompt-contract review before execution.
4. **Minimal trajectories.** An offline trajectory is only a valid deterministic path from the broken
   fixture to a grader-passing state. It need not model an optimal investigation or predict the path a
   live agent should take.

| ID | Difficulty | Goal | Capability exercised | Expected steps | Behavioral check concept |
| --- | --- | --- | --- | ---: | --- |
| `01-order-summary` | Easy | Repair order aggregation, cancellation handling, rounding, and stable output ordering. | Focused diagnosis, one-file edit, test-driven repair, purity preservation. | 7–9 | Existing external check imports the public function, supplies unseen customers/items/statuses, asserts exact aggregation and ordering, and compares the input with a deep snapshot. |
| `02-ledger-contract-refactor` | Medium | Reconcile an inconsistent transaction contract across parser, normalizer, ledger, and report modules without changing the public API. | Multi-file refactor, tracing data contracts through exports, cents-safe arithmetic, integration verification. | 10–14 | External check imports both the public pipeline and the independently exported normalization/ledger stages, then feeds unseen debit/credit records with duplicate ids and decimal edge cases; it asserts stage contracts, final balances/report ordering, rejected invalid records, and frozen-input purity. |
| `03-retry-cache-runtime` | Medium-hard | Fix an asynchronous request cache that mishandles concurrent callers and permanently retains rejected work. | Runtime reproduction, promise/concurrency reasoning, failure recovery, bounded cache lifecycle. | 9–13 | External check uses an instrumented unseen async loader and deterministic deferred promises to assert one load for concurrent identical keys, rejection eviction followed by a successful retry, independent keys, TTL expiry through an injected clock, and no mutation of keys/options. The defect is observable only by executing the timing sequence. |
| `04-path-routing-backtrack` | Hard | Correct cross-platform file routing while preserving rule precedence and compound-extension behavior. | Hypothesis testing, full-suite validation, reverting a plausible local fix, upstream root-cause analysis. | 11–15 | The fixture makes a router-only edit appear sufficient, but that change breaks existing precedence tests; the correct fix is in path normalization. The external check supplies unseen POSIX and Windows paths with query/hash suffixes and compound extensions, asserts first-match precedence and stable results, and freezes the route table. |
| `05-chunked-record-decoder` | Hard | Make an incremental NDJSON decoder correct across arbitrary byte boundaries, CRLF, Unicode, and final flush/error cases. | Repeated read→edit→run cycles, state-machine debugging, byte/string boundary handling, precise errors. | 12–16 | External check partitions an unseen UTF-8 payload into several deterministic chunk patterns, compares every decoding run with the same expected records, verifies line-numbered errors and trailing-fragment flush semantics, and confirms supplied buffers/options are unchanged. |
| `06-session-schema-migration` | Hard | Implement an idempotent v1→v2 session migration across reader, migrator, writer, and summary modules. | Long multi-file change, compatibility reasoning, persistence round trips, error-path handling. | 15–20 | External check creates a fresh temporary store with unseen v1, v2, and malformed records; it asserts migrated public reads, v2 round-trip behavior, idempotence on a second migration, preservation of unknown metadata, deterministic summaries, and unchanged caller-owned objects. |
| `07-dependency-scheduler` | Hard | Repair a bounded-concurrency DAG scheduler with dependency ordering, stable results, and useful invalid-graph failures. | Algorithmic reasoning, async orchestration, concurrency instrumentation, cycle/error handling. | 13–18 | External check runs unseen DAGs through controlled deferred jobs, records start/finish order and active-job count, asserts dependencies precede dependents and the limit is never exceeded, checks deterministic output ordering plus cycle/missing-node errors, and deep-compares the original graph. |

## Proposed first authoring batch

After architect approval, author only `02-ledger-contract-refactor` and `03-retry-cache-runtime`.
Together with task 01 they establish three distinct signals: a focused behavioral repair, a multi-file
contract refactor, and a runtime-only asynchronous defect. Tasks 04–07 remain plan-only until a later
review gate.

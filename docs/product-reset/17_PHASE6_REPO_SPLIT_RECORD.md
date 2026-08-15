# Phase 6 history-preserving repository split record

Status: **Implemented and locally Measured; local split materialization and both local product
pipelines pass**, 2026-08-09. GitHub publication, hosted CI and default-branch cutover remain
**Target** because the owner has not confirmed the organization and final repository names.

## Scope and source of truth

This phase follows `01_CURRENT_REPO_AUDIT.md`, `05_TARGET_ARCHITECTURE.md`,
`06_REPO_SPLIT_RUNBOOK.md`, `07_MIGRATION_ROADMAP.md`, `08_ACCEPTANCE_GATES.md`, and the owner vision.
It changes repository topology only. It does not add a second coding engine, move Computer Use back
into Terminal, upgrade a release claim, or implement the later adaptive chipset/network policy.

The working tree still contained the completed Phase 1–5 changes, so filtering commit `715dda91`
directly would have discarded product reality. `scripts/phase6-local-gate.sh` instead:

1. clones the source repository without rewriting it;
2. applies the complete tracked diff and copies non-ignored, non-runtime untracked files;
3. creates local snapshot commit `5e45f898ab39712f8a9c2999d951bf29635d2a69`;
4. uses `git-filter-repo` 2.47.0 with explicit product paths;
5. promotes `app/` to the Desktop repository root;
6. adds product-specific manifests, instructions and CI workflows;
7. builds and tests both resulting repositories independently.

Local runtime state (`app/.bimax`) and autonomy run output are deliberately excluded from the
snapshot. The source repository and its history are not mutated by the filter.

## Resulting ownership

### Bimax Terminal

- 208 retained history commits and 2,126 tracked files in the final local result.
- Owns the coding engine, versioned protocol source/package, coding tools and Go TUI.
- Contains no `app/`, `native/`, or `src/computer/` tree.
- Produces separate Darwin arm64/x64 Terminal and engine artifacts.
- Contains no Desktop release scripts, native provider, permissions or Computer Use tests.

### Bimax Desktop

- 34 retained history commits and 492 tracked files in the final local result.
- `app/` is the repository root; `native/BimaxComputerUseKit/` retains its own history.
- Owns Electron, renderer, Mac capability provider, Swift/XPC service, Computer Use tests and
  product-reset evidence.
- Contains no Terminal `src/core/agent.loop.ts`, TUI, or copied engine source.
- Consumes the Terminal engine only through `engine.lock.json` and a checked release manifest.

Both repositories retain `THIRD_PARTY_NOTICES.md`. Their `repo-boundary.json` files state ownership,
forbidden surfaces, source/snapshot identity and the engine contract.

## Relocation and contract corrections

The split exposed and fixed four hidden monorepo assumptions:

- Desktop capability tests now own their Jest dependencies and resolve from Desktop root.
- native preparation and service staging resolve the current Git repository root, supporting both
  the migration checkout and the final Desktop layout.
- the Terminal protocol gate accepts the Phase 3 `hello` frame, probes an explicit release binary,
  and gives the child a bounded shutdown window before deleting its temporary project.
- after Terminal release construction, Desktop is pinned to that exact manifest digest. The final
  local manifest SHA-256 is
  `1ca60ac9554434749b65e35d1c9754ef1b635bb7570a003ce7d3b7c6520cb193`; a mutated or stale
  manifest remains fail-closed.

The lock records `publicationStatus: local-migration`. Its public release URL must not be changed
until the owner confirms the GitHub organization and final Terminal repository name.

## Final single-run evidence

Command:

```text
bash scripts/phase6-local-gate.sh /private/tmp/bimax-phase6-20260809-final
```

Result: `phase6 local gate: PASS`.

Machine-readable summary: `evidence/phase6-local-2026-08-09.json`.

Terminal:

- TypeScript build passed.
- Jest: 178 passed suites, one skipped; 1,424 passed tests, two skipped.
- Go TUI suite passed.
- arm64 and x64 Terminal archives passed inventory checks with no Desktop payload members.
- engine protocol 3.1.0 package and both architecture artifacts were generated.
- native arm64 protocol: cold ready 2,916.6 ms / 5,000 ms; warm ready 390.0 ms / 2,500 ms;
  20 correlated pings p95 2.4 ms / 100 ms.
- hostile Desktop variables did not expose `/computer` or Desktop posture.

Desktop:

- independent `npm ci`, typecheck and Electron production build passed.
- capability suite: 54/54 suites and 603/603 tests passed.
- Swift `bimax-cu-service` and `bimax-cu-bridge` products built from the filtered repository.
- the architecture-bound provider compiled and passed the real stdio/schema/structured-status probe.
- the pinned arm64 Terminal engine was accepted by exact size, architecture, protocol and SHA-256.

Both derived repositories ended with empty `git status --porcelain` output. Local result heads:

- Terminal: `6b4d2d352813a310ea4f2389a315ca2c36c4a7df`
- Desktop: `1851bbd07c9fd0bf3dfe23b049cec187dd8b5706`

## Acceptance-gate and status boundary

**Implemented and locally Measured:** deterministic history filtering, independent repository
layouts, source ownership exclusions, local builds/tests/releases, generated CI definitions, and
the exact cross-repository engine pin.

**Target / external Phase 6 cutover:**

- confirm GitHub organization and final names;
- create empty repositories and push non-default migration branches;
- inspect hosted history, notices and file rendering;
- run both workflows in hosted CI;
- change default branches only after those checks pass;
- archive the monorepo only after the rollback window and a successful update of each installed
  product.

Therefore Phase 6's **local implementation exit is complete**, but the unqualified phrase “Phase 6
complete” remains forbidden until the hosted migration and CI rows pass. Signing, notarization,
fresh-Mac TCC and updater qualification remain Phase 7.

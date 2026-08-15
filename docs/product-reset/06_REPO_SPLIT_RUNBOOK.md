# Repository split runbook

This is intentionally not executed inside the current working tree. GitHub recommends operating on
fresh clones for `git filter-repo`, which preserves the source and makes rollback trivial.

Working remote names:

- `bimax-terminal`
- `bimax-desktop`

Do not create/push remotes until the owner confirms the GitHub organization and final names.

## Ownership manifest

### Terminal repository starts with

- `src/` except Desktop-owned CU implementation after the capability extraction;
- `tui/` minus CU embed/extraction/status code;
- `bin/`, coding-engine scripts, engine/TUI tests and fixtures;
- protocol schemas, ACP adapter, coding architecture/security docs;
- root package manifests, TypeScript/Jest/lint config;
- Mac-only Terminal and engine CI/release workflow.

### Desktop repository starts with

- `app/` as repository root application package;
- `native/BimaxComputerUseKit/` moved to `native/BimaxComputerUseKit/`;
- Desktop-owned portions of `src/computer/`, CU tools/prompts/policy, fixtures and benchmarks after
  the capability extraction;
- CU staging/conformance/smoke scripts and relevant handoff/baseline/harvest docs;
- app screenshots/design references used by the product;
- Mac-only Desktop CI/release workflow.

### Do not duplicate

- the full TypeScript coding engine;
- generated app protocol types without their source release/version;
- provider credentials or local `.bimax` runtime data;
- ignored build outputs (`node_modules`, `.build`, `out`, `release`, compiled embeds);
- historical website/media unrelated to either first product release.

## Extraction procedure

1. Land the capability boundary and prove both products in the monorepo.
2. Tag the last monorepo commit, for example `pre-split-2026-08`.
3. Create two fresh local clones from that tag/branch.
4. Run `git filter-repo` with explicit path manifests. Use `--path-rename` for `app/:` only in the
   Desktop clone after confirming package-relative scripts.
5. Remove newly obsolete files with normal commits so the historical movement remains inspectable.
6. Add the new CI/release files, CODEOWNERS, security policy, architecture README, and cross-repo
   compatibility test.
7. Compare exported source manifests and licenses against this ownership list.
8. Create empty GitHub repositories only after local histories build and test.
9. Add remotes and push a non-default migration branch first; inspect GitHub file/history rendering.
10. Make `main` default only after both release candidates pass `08_ACCEPTANCE_GATES.md`.
11. Mark the old repository read-only/archive only after a rollback window and one successful update
    of each installed product.

Source procedure: [GitHub: Splitting a subfolder into a new repository](https://docs.github.com/en/get-started/using-git/splitting-a-subfolder-out-into-a-new-repository)

## Cross-repo version rule

Desktop commits a lock file similar to:

```json
{
  "engineVersion": "1.2.0",
  "protocolMajor": 4,
  "darwinArm64Sha256": "<release digest>",
  "darwinX64Sha256": "<release digest>",
  "sourceCommit": "<terminal commit>"
}
```

A scheduled/manual Desktop workflow checks for a newer compatible Terminal engine and opens a PR.
It never silently tracks `main` or `latest`. That PR runs protocol fixtures, app integration, coding
smoke tasks, and CU smoke tasks before a person merges it.

## “Clean repo” checklist

- one product promise and one release pipeline per repo;
- no committed generated binaries or dependency directories;
- no dead Windows/Linux packaging while launch support is Mac-only;
- no app source in Terminal and no copied engine source in Desktop;
- one current architecture doc; old plans move to `docs/archive/` with date/status;
- benchmarks sit beside the implementation they grade;
- root scripts are named for the product and every release script has a CI caller;
- the old compatibility driver is lab-only or removed after native parity, never a hidden fallback.


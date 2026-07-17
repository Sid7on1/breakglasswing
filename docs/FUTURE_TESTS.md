# Deferred verification work

Automated tests were intentionally deferred on 2026-07-12 while the machine was recovering from disk and memory exhaustion. Do not treat the items below as passing until they are executed on a healthy machine.

Current build evidence: the engine production TypeScript build and Desktop `tsc --noEmit` pass.
The Electron/Vite production build was attempted after restoring disk space, but macOS had only
about 80 MB free RAM and killed it before Vite began transforming modules. It still needs one run
after closing memory-heavy applications or rebooting.

## Engine supervisor

- Run `src/__tests__/desktop.supervisor.test.ts` without coverage.
- Run the protocol contract and fixture tests.
- Verify stale generations, heartbeat timeouts, restart budgets, profile shedding, and crash-journal redaction.
- Verify constrained profiles emit both `BIMAX_DISABLE_CODEMEM` and the legacy
  `BIMAX_DISABLE_CODEBASE_MEMORY` gate so neither semantic-engine entry path can start.
- Verify `BIMAX_DEFER_GRAPH_LOAD=1` reaches ready before a slow graph read completes and emits a
  fresh UI snapshot when the persisted graph becomes available.

## Desktop

- Run the app TypeScript check and production build.
- Add interaction coverage for the Work / Intelligence / Runtime lane navigation.
- Add reducer coverage for supervisor state, project switching, and interrupted-session recovery.
- Add accessibility checks for the status banner and right workspace.
- Perform packaged-app screenshots at normal and narrow panel widths.

## Manual recovery scenarios

- Force-kill an idle engine and an active engine.
- Confirm safe restart does not replay mutating messages.
- Confirm resume restores a session without duplicating its last user message.
- Confirm minimal mode keeps native compression active while optional services are deferred.

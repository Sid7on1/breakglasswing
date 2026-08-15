# X01 — build, run, and prove the real app

## User prompt

> Add a “Clear completed” action to this Mac to-do app. Keep the current visual style, add tests,
> build it, launch it, use the action on the fixture data, and show me proof that only completed
> items were removed.

## Fixture

- small SwiftUI or Electron Mac app with deterministic data;
- two completed and two active items;
- unit test seam plus observable GUI list;
- app bundle built into an isolated worktree.

## Expected experience

The task remains one thread but exposes two evidence lanes:

1. **Code lane** — plan, edited files, targeted/full tests, build artifact, diff.
2. **Mac lane** — launched bundle hash, target window, action, refreshed list state, screenshot/AX
   evidence.

The final receipt says what changed and proves both the implementation and the running behavior.

## Pass

- tests cover active/completed separation and pass;
- build is the exact bundle later operated;
- GUI action removes exactly the two completed items;
- active items and unrelated settings remain unchanged;
- post-action state is read fresh from the running app;
- receipt links build hash → launched process → action → postcondition;
- task can be handed from isolated worktree to local checkout without losing the thread/evidence.

## Why this is the wedge

Coding agents can write the patch. Computer-use agents can click the app. Bimax wins only if it
reliably connects those stages and proves the clicked binary contains the patch it just reviewed.

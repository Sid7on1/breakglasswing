# ChatGPT / Codex macOS Computer Use — teardown

What OpenAI actually ships for desktop computer use on macOS, read off the copy installed on this
machine. Written to inform BiMax's design, so every section ends with the concrete delta.

Everything below was derived from bundle metadata, code signatures, and the vendor's **own shipped
API documentation** inside the app bundle. No binaries were disassembled and no proprietary source
is reproduced here — this is an architecture summary.

**Subject.** `/Applications/ChatGPT.app` — bundle id `com.openai.codex`, version `26.721.41059`
(build 5848), Chromium base `150.0.7871.128`, team `2DC432GLL2`, installed 2026-07-25.
Category: `public.app-category.developer-tools`.

---

## 1. It is not one app — it's a four-part system

```
ChatGPT.app  (com.openai.codex, Electron/Chromium, NOT sandboxed)
└── Resources/cua_node/                     ← a full Node runtime, bundled
    └── node_modules/@oai/sky  v0.5.2       ← the computer-use SDK
        ├── docs/                           ← shipped API docs (3 targets + a skill)
        ├── dist/project/cua/sky_js/        ← JS client, split by target: mac | windows | linux
        └── Codex Computer Use.app          ← the actual agent, a SEPARATE app
            ├── MacOS/SkyComputerUseService     (com.openai.sky.CUAService, LSUIElement=1)
            ├── Resources/Package_ComputerUse.bundle
            ├── Resources/Package_Appshot.bundle     ← window screenshotting
            ├── Resources/Package_SlimCore.bundle
            ├── Resources/SwiftProtobuf_SwiftProtobuf.bundle
            └── SharedSupport/
                ├── Codex Computer Use Installer.app
                ├── SkyComputerUseClient.app
                └── CUALockScreenGuardian.app        (…CUAService.guardian, LSUIElement=1)
```

The privileged desktop-control code is **deliberately not in the Electron app**. It is a separate,
separately-signed, background (`LSUIElement=1`) Swift service requiring **macOS 14.4+**, talking to
the Node layer over a Unix socket in a shared App Group container:

```
~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock.lock
```

Framing is length-prefixed (`UInt32`) **protobuf** (SwiftProtobuf on the Swift side).

**Why the split matters.** TCC (Screen Recording / Accessibility) grants attach to a code signature
at a stable path. Putting control in a small, stable, separately-signed service means the frequently
auto-updating Electron shell can change without users re-granting permissions — and a compromise of
the web layer does not directly hold the input-injection grant. There is a dedicated
`Codex Computer Use Installer.app` precisely to place that service at a stable location.

> **BiMax delta.** BiMax's model is comparable in spirit — a locally-compiled Swift helper
> (`helper.source.ts` → `~/.bimax/native/bimax-desktop-<hash>`) plus the cua sidecar — and the helper
> path is *content-hashed*, so every helper change relocates the binary.
>
> An earlier draft of this section asserted that the relocation therefore **drops the helper's TCC
> grants** on every version bump. **Measured, that is false for BiMax's launch topology.** Two
> freshly compiled, unsigned binaries at paths that had never existed before — including a copy given
> a random name seconds earlier — both reported `accessibility: true, screenRecording: true` on their
> first run and posted input successfully. Accessibility and Screen Recording are attributed to the
> *responsible* process (the app that launched the helper), not to the helper's own path or
> signature, so a child binary inherits the grant wherever it lives.
>
> The stable-path argument still holds for OpenAI, whose service is launched independently and is
> itself the responsible process. For BiMax it buys much less than this document first claimed —
> which changes the priority in §5 (item 5), not the correctness of the design.

---

## 2. Three targets, three genuinely different APIs

`@oai/sky` does **not** pretend one abstraction fits all platforms:

| target | doc | shape |
|---|---|---|
| `mac` | `sky-window-api.md` | app-identifier based; `get_app_state({ app })` |
| `windows` | `sky-window2-api.md` | `Window` object handles; `get_window_state({ window })` |
| `linux` | `sky-full-desktop-api.md` | whole-desktop coordinates, no window concept |

The Linux target is the sandboxed-VM path (full-desktop click/drag/move/scroll/type/press_key). The
mac and Windows targets are **window-scoped and accessibility-first**.

> **BiMax delta.** BiMax has one verb set spanning window-scoped and display-scoped surfaces, with
> `observedSurfaceKind: 'window' | 'display'` switching the coordinate space underneath. OpenAI made
> that a *type-level* distinction instead. BiMax's approach is more compact; the risk it accepts is
> exactly the class of bug already hit — a display-space frame being interpreted as window-space.

---

## 3. The macOS API surface

`target: "mac"` exposes: `list_apps`, `get_app_state`, `click`, `press_key`, `type_text`, `scroll`,
`set_value`, `drag`, `perform_secondary_action`, `select_text`.

Five decisions worth stealing:

### 3.1 The accessibility tree is returned as a **diff** by default

`get_app_state({ app, disableDiff? })` — *"Return a full accessibility tree instead of a diff from
the previous tree."* Full tree is the **opt-out**, not the default.

> **BiMax delta — highest-value finding in this document.** BiMax re-walks and re-sends the whole
> tree on every observe. Measured on this machine, the driver walk costs **~3.7 ms/node** (300 → 1.1 s,
> 800 → 3.0 s, 2000 → 6.1 s), and the tree is also re-serialised into the model's context every turn.
> A diff attacks both costs at once. This is the single biggest remaining latency win available.

### 3.2 Actions are bound to the frame they were planned from

The Windows API carries `screenshotId` on `click`, `scroll`, and `drag`: *"Optional screenshot id
from `get_window_state()`; when supplied, it must be cached for the target window."*

> **BiMax delta.** This is precisely the `frame_id` binding BiMax lacks. BiMax enforces freshness
> indirectly (an action requires `observedTarget` to match the current pid/windowId), which catches a
> target switch but **not** a stale frame of the *same* window. Adding an explicit frame id — and
> rejecting actions planned against a superseded frame — is a small change with real safety value.

### 3.3 A window state returns **several** z-ordered screenshots, not one

`WindowState.screenshots: Array<Screenshot>` — *"Bounded screenshots captured for the window and
related transient UI"*, each with `id`, `originX`, `originY`, `width`, `height`, and `zIndex`
("larger values are visually above smaller values").

> **BiMax delta.** Transient UI is the exact thing that stranded a real BiMax run: with WhatsApp's
> "New chat" popover open, the AX tree contained only the popover's 24 contacts and the main window
> vanished. BiMax's mitigation was to *announce* the popover; OpenAI's design **captures it as an
> additional z-ordered region with its own screen origin**, so the popover and the window behind it
> are both addressable. That is the better answer, and it generalises to menus and sheets.

### 3.4 First-class accessibility primitives instead of synthesised gestures

- `select_text` — *"Select matching text in an indexed editable element."*
- `perform_secondary_action` — invoke an AX action by label: `Raise`, `Scroll Up/Down/Left/Right`,
  `Expand`, `Collapse`.
- `AccessibilityState` exposes `focused_element`, `selected_elements`, `selected_text`,
  `document_text` alongside the tree.

> **BiMax delta.** BiMax selects text by drag, which is fragile. `selected_text` in the observation
> would also give free *verification* of a selection — currently BiMax has no way to confirm one.
> `perform_secondary_action` is a cheaper, more reliable path for scroll/expand than synthetic wheel
> events, and BiMax already added an AX raise (`window-raise`) along the same lines.

### 3.5 Activation is implicit; modifiers ride on the mouse action

- *"input methods activate their target window automatically"* — `activate_window` exists only as an
  "optional escape hatch".
- `click`, `drag`, `move`, `scroll` all take an optional `key` chord **held for the action**.
- Key chords use **X11 keysym names** (`Control_L+a`, `Return`, `KP_0`) with aliases — one vocabulary
  across all three platforms.

> **BiMax delta.** BiMax already activates before input (`ensurePhysicalTargetFrontmost`) and already
> carries `modifier` on click, so this matches. BiMax's key names are macOS-flavoured, which is fine
> for a mac-only tool.

### 3.6 App-specific guidance, injected once

`AppState.text` is *"Accessibility text, prefixed with app-specific guidance on first access when
available."*

> **BiMax delta.** A per-app hint channel, paid once per app rather than in the global system prompt.
> BiMax's persona carries generic capability rules; this is how you add "in this app, the composer is
> …" without taxing every turn. Cheap to add, and it is the honest place for the app-specific
> knowledge the de-hardcoding pass deliberately removed from the prompt.

---

## 4. Permission and safety model

From `ChatGPT.app` entitlements:

- `com.apple.security.app-sandbox = false` — the shell is **not** sandboxed.
- `com.apple.security.automation.apple-events = true`, with
  `NSAppleEventsUsageDescription`: *"ChatGPT uses Apple Events to control Mac apps on your behalf"*.
- `allow-jit` + `allow-unsigned-executable-memory` (Chromium requirements).
- App groups: `…codex.notifications` and `…sky.CUAService`.
- Purpose strings are **scoped and task-shaped**, e.g. `NSDesktopFolderUsageDescription`:
  *"ChatGPT needs access to your Desktop for the task you selected"*.

There is a `computer-use-policy` module in the mac client (concepts: policy / blocked / denied) and a
`computer-use-telemetry` module — i.e. an explicit policy layer and explicit action telemetry, both
separate from the action implementations.

**`CUALockScreenGuardian.app`** (`com.openai.sky.CUAService.guardian`, background) is a dedicated
component for lock-screen state. An agent injecting synthetic input while the screen is locked — or
while the login window is frontmost — is a serious safety and correctness problem, and it is treated
as its own supervised process rather than an `if` statement.

> **BiMax delta.** BiMax has a governor gating acting verbs, taint-marks observations as untrusted,
> and already detects `loginwindow` and refuses. The structural lesson is the *separation*: policy,
> telemetry, and lock-screen safety as their own units rather than conditions inside the action path.

---

## 5. What I'd actually take, in order

1. **Accessibility tree diffs** (§3.1) — biggest measured win; attacks both walk cost and context cost.
2. **Multiple z-ordered bounded screenshots per observation** (§3.3) — the correct fix for popovers,
   menus, and sheets, which have already caused a real failure.
3. **`frame_id` on actions** (§3.2) — closes the stale-frame-of-the-same-window hole.
4. **`selected_text` in observations** (§3.4) — makes text selection verifiable instead of hopeful.
5. ~~**Stable installed helper path** (§1) — stop losing TCC grants on every helper version bump.~~
   **Dropped**: the premise was measured and is false for BiMax — the helper inherits the launching
   process's grants regardless of its path (§1).
6. **Per-app guidance channel** (§3.6) — app knowledge without global prompt cost.

Deliberately **not** taking: the separate signed service + protobuf IPC. It is the right call at
OpenAI's scale and update cadence; for BiMax the locally-compiled auditable helper is a reasonable
trade, and rebuilding that boundary would be a large change for benefits BiMax does not currently
need.

---

## 6. Reproducing this

```bash
SKY="/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/sky"
ls "$SKY/docs"                          # shipped API docs, one per target
cat "$SKY/docs/sky-window-api.md"       # the macOS surface
cat "$SKY/docs/skills/cua/SKILL.md"     # the unified entry point
ls "$SKY/dist/project/cua/sky_js/src/targets/mac"
codesign -d --entitlements - /Applications/ChatGPT.app
defaults read "$SKY/Codex Computer Use.app/Contents/Info.plist"
```

The service was **not** installed to a system location on this machine at the time of writing (no
`/Applications/Codex Computer Use.app`, no running `SkyComputerUseService`), only the socket lock in
the group container — so computer use appears provisioned but not yet activated here.

*Read 2026-07-25 against ChatGPT 26.721.41059 / `@oai/sky` 0.5.2. Both move fast; re-check before
relying on any detail.*

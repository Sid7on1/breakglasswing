# Claude Code CLI Design Study (User-Facing)

## 1. What the CLI Shows (UI Layout)

### Screen Layout (Alt-Screen Mode)
The terminal is cleared and the alt-screen buffer is entered. The display has three main zones:

```
┌─── Prompt Input ──────────────────────────────────────────┐
│  "What would you like help with?"                         │
│  [your text here]                  [footer: mode/hints]   │
└───────────────────────────────────────────────────────────┘
```

### Conversation Messages
User and assistant messages appear as a scrollable transcript:

- **User Messages**: Bubble-style block with `userMessageBackground` (`rgb(55,55,55)` dark / `rgb(240,240,240)` light). Hover brightens slightly.
- **Assistant Thinking**: Shimmering "[thinking...]" text, transitions to "thought for Xs" when done.
- **Assistant Text**: Model's text response with inline code formatting, ANSI rendering.
- **Tool Calls**: Grouped under assistant messages with:
  - Tool name: bold, colored by tool type
  - Input: formatted as code block or key-value pairs
  - Status: "Reading..." / "Editing..." / "Running..." with spinner
  - Output: prefixed with `"  ⎿  "` (2 spaces + U+23BF + space) to nest under the tool
  - Truncation: `"… +47 lines (ctrl+o to expand)"` in dim text for long output

### Footer Status Line
Shows at the bottom:
- Status text (thinking/responding/idle)
- Vim mode indicator (if vim mode active)
- Model info
- Effort level (○ low / ◐ medium / ● high / ◉ max)
- Connection status
- Keybinding hints ("Enter to send · Esc to stash")

### Permission / Approval Dialogs
Overlaid modal dialog with:
- Question text (e.g., "Do you want to proceed?")
- Keyboard-selectable options with `❯` pointer
- Tab-expandable text input for user feedback
- Colored border (blue-purple `permission` theme color)
- Input guide: "Enter to confirm · Esc to cancel"
- Dialog wrapped in `<Pane>` with `<Divider>` header

### Search Highlight
While searching: inverts all visible matches (less/vim style). Current match gets yellow background + bold + underline.

### Text Selection
Mouse-drag or keyboard selection inverts selected cells. Scroll-follow keeps highlight anchored to text.

### Error Display
- System errors: red `✗` icon + `error` color text
- Rate limits: `ProgressBar` with red fill + warning icon
- API errors: inline red text with details
- Spinner stall: if no tokens for 3s, spinner color smoothly transitions from orange → red

### Startup Banner
- Alt-screen entered, mouse tracking enabled
- `<LoadingState>` spinner while session loads
- Session ID and basic context shown

### Message Actions (Shift+Up/Down)
Fullscreen selects a message to show action menu:
- Rewind, Copy, Share, Resubmit
- Selection bg: `messageActionsBackground` (`rgb(44,50,62)`)

### Sub-Agent Color Tags
When spawning parallel agents, each gets a unique color:
red, blue, green, yellow, purple, orange, pink, cyan

---

## 2. CLI Flags & Options (What You Can Control)

### Interactive Session Flags
| Flag | Description |
|------|-------------|
| `[prompt]` | Prompt argument — starts session with initial query |
| `-p, --print` | Non-interactive mode: print response and exit |
| `-c, --continue` | Continue most recent conversation in current dir |
| `-r, --resume` | Resume conversation by session ID (or picker) |
| `--fork-session` | Create fork when resuming |
| `--from-pr <url>` | Resume PR-linked session |
| `--model <model>` | Override model (e.g. `sonnet`, `opus`, or full ID) |
| `--effort <level>` | Effort level: `low`, `medium`, `high`, `max` |
| `--agent <agent>` | Override agent setting |
| `--verbose` | Override verbose mode setting |
| `--settings <file-or-json>` | Load additional settings from file or JSON string |
| `--add-dir <dirs...>` | Additional directories to allow tool access |
| `-n, --name <name>` | Display name for session |
| `--session-id <uuid>` | Use specific session ID |
| `--no-session-persistence` | Don't save session to disk |
| `--setting-sources <sources>` | Setting sources: `user`, `project`, `local` |
| `--disable-slash-commands` | Disable all skills |

### Display & Output Flags
| Flag | Description |
|------|-------------|
| `--bare` | Minimal mode: no hooks, LSP, plugins, auto-memory, keychain. Sets `CLAUDE_CODE_SIMPLE=1` |
| `--output-format <format>` | With `-p`: `text` (default), `json`, or `stream-json` |
| `--json-schema <schema>` | JSON Schema for structured output validation |
| `--include-hook-events` | Include hook events in stream-json output |
| `--include-partial-assistant-messages` | Include partial messages in stream-json output |

### Tool Control Flags
| Flag | Description |
|------|-------------|
| `--allowed-tools <tools...>` | Comma/space-separated allowlist of tool names |
| `--disallowed-tools <tools...>` | Comma/space-separated denylist of tool names |
| `--tools <tools...>` | Specify available built-in tools |
| `--permission-mode <mode>` | Permission mode (see section below) |
| `--permission-prompt-tool <tool>` | MCP tool for permission prompts (with `-p`) |
| `--mcp-config <configs...>` | Load MCP servers from JSON files/strings |
| `--strict-mcp-config` | Only use servers from `--mcp-config` |
| `--plugin-dir <path>` | Load plugins from directory (repeatable) |
| `--dangerously-skip-permissions` | Skip all permission prompts |

### Prompt Customization Flags
| Flag | Description |
|------|-------------|
| `--system-prompt <prompt>` | Override system prompt |
| `--system-prompt-file <file>` | Read system prompt from file |
| `--append-system-prompt <prompt>` | Append to default system prompt |
| `--append-system-prompt-file <file>` | Append from file |
| `--agents <json>` | Define custom agents as JSON |

### DevOps & Integration Flags
| Flag | Description |
|------|-------------|
| `-w, --worktree [name]` | Create git worktree for session |
| `--tmux` | Create tmux session for worktree |
| `--ide` | Auto-connect to IDE on startup |
| `--chrome` / `--no-chrome` | Enable/disable Claude in Chrome |
| `--file <specs...>` | Download file resources at startup |
| `--betas <betas...>` | Beta headers for API requests |
| `--fallback-model <model>` | Auto-fallback when model overloaded |
| `--agent-teams` | Force multi-agent mode |

### Debug & Diagnostic Flags
| Flag | Description |
|------|-------------|
| `-d, --debug [filter]` | Enable debug mode with optional category filter |
| `--debug-to-stderr` | Debug output to stderr |
| `--debug-file <path>` | Write debug logs to file |
| `--version, -v` | Show version number |
| `--init` | Run setup hooks with init trigger, then continue |
| `--init-only` | Run setup hooks, then exit |
| `--maintenance` | Run setup hooks with maintenance trigger |

### Permission Modes
`editing`, `bypassPermissions`, `auto`, `defaults`, `eagerAuto`, `lazyAuto`

### Subcommands
| Command | Description |
|---------|-------------|
| `mcp` | Manage MCP servers (add, remove, list, get, serve) |
| `auth` | Authentication (login, logout, status) |
| `plugin` / `plugins` | Plugin management (list, install, uninstall, enable, disable, update, validate) |
| `agent` | Agent management |
| `doctor` | Health check |
| `update` / `upgrade` | Update CLI |
| `ssh <host> [dir]` | Run via SSH |
| `server` | Start session server |
| `open <cc-url>` | Connect to server |
| `completion` | Generate shell completions |
| `auto-mode` | Inspect auto mode classifier |
| `remote-control` / `rc` | Enable remote control sessions |

---

## 3. CLI Settings (Configurable via settings.json or `--settings`)

| Setting | Type | Description |
|---------|------|-------------|
| `model` | string | Default model override |
| `availableModels` | string[] | Enterprise model allowlist |
| `permissions` | object | Tool usage permissions |
| `hooks` | object | Pre/post tool execution hooks |
| `disableAllHooks` | boolean | Disable all hooks |
| `defaultShell` | "bash" \| "powershell" | Shell for `!` commands |
| `theme` | "auto" \| "dark" \| "light" \| "dark-ansi" \| "light-ansi" \| "dark-daltonized" \| "light-daltonized" | Color theme |
| `verbose` | boolean | Verbose mode |
| `respectGitignore` | boolean | File picker respects .gitignore |
| `cleanupPeriodDays` | number | Session retention days (0=disable) |
| `attribution` | object | Commit/PR attribution text |
| `includeGitInstructions` | boolean | Include git workflows in system prompt |
| `worktree` | object | Git worktree config |
| `env` | object | Environment variables for sessions |
| `fileSuggestion` | object | Custom `@` file suggestion command |
| `enableAllProjectMcpServers` | boolean | Auto-approve project MCP servers |
| `allowedMcpServers` | array | Enterprise MCP allowlist |
| `deniedMcpServers` | array | Enterprise MCP denylist |
| `allowedHttpHookUrls` | string[] | HTTP hook URL allowlist (supports `*` wildcard) |
| `apiKeyHelper` | string | Script path for auth values |
| `awsCredentialExport` | string | Script for AWS credentials |
| `awsAuthRefresh` | string | Script for AWS auth refresh |
| `gcpAuthRefresh` | string | Command for GCP auth refresh |

---

## 4. Color Themes (6 Options)

| Theme | Description |
|-------|-------------|
| `dark` (default) | Truecolor RGB on dark background |
| `light` | Truecolor RGB on light background |
| `dark-ansi` | 16 ANSI colors only (no truecolor) |
| `light-ansi` | ANSI on light background |
| `dark-daltonized` | Deuteranopia-friendly dark |
| `light-daltonized` | Deuteranopia-friendly light |

Theme is controlled via settings (`theme: "auto"` follows system dark/light mode).

### Color Usage Map

| Color Key | Used For |
|-----------|----------|
| `claude` | Main brand color — assistant message accent, spinner |
| `permission` | Permission dialogs, suggestions |
| `promptBorder` | Input border |
| `text` | Body text |
| `inactive` | Muted/dim text |
| `subtle` | Very muted text |
| `error` | Errors |
| `success` | Success states |
| `warning` | Warnings |
| `bashBorder` | Shell command border (pink) |
| `userMessageBackground` | User message bubble bg |
| `selectionBg` | Selection highlight |
| `diffAdded` / `diffRemoved` | File edit line backgrounds |
| `diffAddedWord` / `diffRemovedWord` | Word-level diff highlights |
| `fastMode` | Fast mode indicator |
| `planMode` | Plan mode indicator |
| `ultrathinkColor` | Ultrathink keyword highlight |

---

## 5. Typography & Spacing

### Padding
- Content: `paddingX={2}` for prompt/message content
- Indentation: `paddingLeft={2}` for nested elements
- Section spacing: `marginTop={1}` between major sections
- Flex gaps: `gap={1}` for children

### Message Response Prefix
```
  ⎿    // 2 spaces + U+23BF + space = 5 chars before tool output
```

### Byline Separator
```
 ·   // U+00B7 middot — between metadata items
```

### Truncation Hints
```
… +47 lines (ctrl+o to expand)   // Dim text when output exceeds viewport
```

---

## 6. Border Characters

| Style | Characters |
|-------|-----------|
| single | `─ │ ┌ ┐ └ ┘` |
| double | `═ ║ ╔ ╗ ╚ ╝` |
| round | `─ │ ╭ ╮ ╰ ╯` |
| bold | `━ ┃ ┏ ┓ ┗ ┛` |
| single-double | `╒ ╕ ╘ ╛` |
| double-single | `╓ ╖ ╙ ╜` |
| dashed | `╌ ╎` (no corners) |

### Border with Title
```
─── Title ───    // Via <Divider> component
```

---

## 7. Unicode Symbols

| Symbol | Code | Used For |
|--------|------|----------|
| ⏺ / ● | U+23BF / U+25CF | Spinner dot |
| ∙ | U+2219 | List bullet |
| ✻ | U+273B | Idle indicator |
| ↑ / ↓ | | Scroll indicators |
| ↯ | | Fast mode |
| ○ ◐ ● ◉ | | Effort levels (low/medium/high/max) |
| ◇ ◆ | | Review running/completed |
| ▎ | U+258E | Blockquote prefix |
| ❯ | | Selection pointer |
| ✓ | | Success / completed |
| ✗ | | Error / failed |
| ⚠ | | Warning |
| ℹ | | Info |

---

## 8. Progress Bar

Uses 8-level Unicode partial blocks:
```
' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'
```
Each character represents 1/8th cell width. Configurable `fillColor` / `emptyColor`. Used for rate limits and long operations.

---

## 9. Spinner Modes & Animations

| Mode | Visual |
|------|--------|
| `thinking` | Glimmer/shimmmer sweeps left-to-right |
| `responding` | Default sweep left-to-right |
| `tool-use` | Flash/pulse (breathing glow) on tool name |
| `tool-input` | Waiting for tool input |
| `requesting` | Glimmer right-to-left (outgoing API) |

### Brief Mode (Compact)
```
  Thinking...  (12.4s · 892 tokens)                    2 background tasks
```

### Stall Detection
If no tokens for 3+ seconds, spinner color transitions from orange → red smoothly.

---

## 10. Input System

### Key Input
Raw stdin in raw mode. Key combos:
- **Enter**: Send
- **Escape**: Stash/resume prompt
- **Up/Down**: History navigation
- **Tab**: Typeahead completion
- **Ctrl+O**: Expand truncated output
- **Shift+Up/Down**: Select message actions
- **Ctrl+C**: Cancel/abort
- **Ctrl+L**: Clear terminal (redraw)

### Prompt Features
- Typeahead suggestions (commands, file paths, MCP tools)
- Slash-commands: `/help`, `/clear`, etc.
- `@` teammate mentions
- `#` thinking / ultrathink triggers
- `!` keyword for fast mode / plan mode
- Queued command display
- Prompt stashing (Escape → stash, resume later)
- Image paste via clipboard
- Voice recording waveform cursor
- Vim mode (insert/normal/visual)

### Input Display
- Text: `text` theme color
- Cursor: `inverse` highlight (or waveform during voice)
- Placeholder: context-aware text
- Highlights: trigger keywords, shimmer for ultrathink
- Border: shimmering top border (`promptBorder` / `promptBorderShimmer`)
- Footer: mode, keybinding hints, connection status

---

## 11. Session Lifecycle Display

### Startup Sequence
1. Alt-screen entered (CSI ?1049h)
2. Mouse tracking, extended keyboard, focus reporting enabled
3. Loading state spinner while booting
4. Prompt input appears with placeholder text

### Resize Handling
- Content seamlessly reflows at new dimensions
- No blank flash (erase happens inside atomic BSU/ESU block)
- Mouse tracking re-asserted

### SIGCONT (Suspend/Resume)
- Alt-screen: re-enters alt buffer, clears, re-enables mouse
- Main-screen: resets frames, full repaint

### Command Execution Display
- Border: pink (`bashBorder`)
- Output background: `bashMessageBackgroundColor`
- Timestamps in subtle gray
- Exit codes: green for 0, red for non-zero

### File Edit Display (Inline Diff)
- Added lines: green background
- Removed lines: red background
- Word-level highlights in medium green/red
- Unified diff format inline

---

## 12. Message Flow

### Interactive Mode
1. User types prompt → presses Enter
2. Text queued, spinner appears ("Thinking...", "Editing...")
3. Response streams as content blocks under spinner
4. Spinner transitions to duration display
5. Footer updates with new hints

### Print Mode (`-p, --print`)
- Non-interactive, output to stdout
- Supports `text` (default), `json`, or `stream-json` formats
- JSON Schema validation for structured output
- No spinner or UI chrome — pure output

### SDK Mode (`--output-format=stream-json`)
- Full bidirectional protocol over stdin/stdout
- Each message and event is a JSON line
- Supports permission prompts, tool results, control messages

---

## 13. Keybinding System

Context-aware, configurable keybindings. Defaults include:

| Action | Default Key |
|--------|-------------|
| `confirm:yes` | Enter |
| `confirm:no` | Escape |
| `app:exit` | Ctrl+C / Ctrl+D |
| `app:search` | Ctrl+F |
| `app:clear` | Ctrl+L |
| `app:resume` | Ctrl+R |
| `edit:cancel` | Escape |
| `edit:historyUp` | Up |
| `edit:historyDown` | Down |
| `edit:autocomplete` | Tab |
| `edit:newline` | Alt+Enter / Meta+Enter |
| `view:scrollUp` | Ctrl+U / PageUp |
| `view:scrollDown` | Ctrl+D / PageDown |
| `view:selectMessage` | Shift+Up / Shift+Down |
| `view:copy` | Ctrl+Shift+C |

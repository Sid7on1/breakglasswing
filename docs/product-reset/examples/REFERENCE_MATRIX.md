# Reference pattern matrix

| Product | Observed pattern | Bimax Terminal | Bimax for Mac | Guardrail |
|---|---|---|---|---|
| Claude Code | one command, resume/continue, structured print mode | simple start/resume plus NDJSON API | consumes the same session/engine contract | do not expose internal engine modes as setup |
| Cursor CLI | keyboard review and command approval | review changed files/tests at task end | same review data in contextual inspector | approval must name the actual command/change |
| Warp | command/output blocks attach as context | evidence block object in transcript | render engine terminal evidence with same identity | do not build another terminal emulator |
| Codex app | projects, task threads, parallel isolated work, inline diff | preserve session/worktree metadata | projects/tasks are primary navigation | do not turn every capability into sidebar navigation |
| Zed | visual host consumes external agent process | publishes versioned process protocol | pins and supervises engine artifact | no copied engine source in Desktop |
| Raycast | focused tools, visible calls, contextual permission, revocable allowlist | shell permissions only | named Mac action approvals and Trust Center | no global unexplained “full computer access” switch |
| Ghostty | native platform shell consumes separable core | reusable headless coding core | native Swift/XPC around Electron task UI | “native” is behavior/ownership, not a mandatory UI rewrite |

Source links and the full observations are in `../03_PRODUCT_EXAMPLES.md`.


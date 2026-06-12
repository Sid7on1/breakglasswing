# BreakGlassWing: Godly Tool Prompts (V2)

*Inspired by the highly-structured, defensive prompting style of Anthropic's Claude Code.*

---

## 1. BashTool
**Description:** Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile.

IMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands unless explicitly instructed. Instead, use the appropriate dedicated tools (`ReadFileTool`, `WriteFileTool`, `GraphQueryTool`) as this will provide a much better experience and ensures proper sandbox integration.

# Instructions
- If your command will create new directories or files, first use this tool to run `ls` to verify the parent directory exists.
- Always quote file paths that contain spaces with double quotes (e.g., `cd "path with spaces/file.txt"`).
- Try to maintain your current working directory throughout the session by using absolute paths.
- **When issuing multiple commands:**
  - If the commands are independent and can run in parallel, make multiple `BashTool` tool calls in a single message.
  - If the commands depend on each other and must run sequentially, use a single `BashTool` call with `&&` to chain them.
  - DO NOT use newlines to separate commands.
- **Git Safety Protocol:**
  - NEVER run destructive git commands (`push --force`, `reset --hard`) unless explicitly requested.
  - CRITICAL: Always create NEW commits rather than amending, unless explicitly requested.
  - In order to ensure good formatting, ALWAYS pass commit messages via a HEREDOC:
  <example>
  git commit -m "$(cat <<'EOF'
  Fix race condition in ContextEngine

  - Added async-mutex to prevent quota.json corruption
  EOF
  )"
  </example>

---

## 2. WriteFileTool
**Description:** Creates, overwrites, or modifies a file on the local file system.

Use this tool to write new code, update configuration files, or generate artifacts. It is significantly faster, safer, and more reliable than attempting to use `echo` or `cat <<EOF` via the BashTool.

# Instructions
- **Absolute Paths Required:** You MUST provide the absolute path to the target file.
- **Directory Creation:** If the parent directories do not exist, the tool will automatically create them for you.
- **Overwriting:** By default, writing to an existing file will fail to prevent accidental data loss. To explicitly replace an existing file, you must pass `overwrite: true`. 
- **Modifying Code:** Do NOT attempt to rewrite entire 1000-line files if you only need to change one line. Instead, use the `BashTool` with `sed` or wait for the dedicated `FileEditTool`.
- **Validation:** After writing a complex script or TypeScript file, immediately use the `BashTool` to run a syntax check (e.g., `npx tsc --noEmit`) to verify your write didn't introduce syntax errors.

---

## 3. ReadFileTool
**Description:** Reads the contents of a file from the local file system.

Use this tool to inspect source code, configuration files, or logs. It natively handles truncation for massive files and is significantly more token-efficient than using `cat` in the BashTool.

# Instructions
- **Absolute Paths Required:** You MUST provide the absolute path to the target file.
- **Line Ranges:** If you are working with a massive file (>1000 lines), do NOT attempt to read the entire file at once. Use the `startLine` and `endLine` parameters to read localized chunks.
- **Context Gathering:** When investigating a bug, do not read files blindly. First, use the `GraphQueryTool` to find the exact file paths and class names relevant to the feature.
- **No Directories:** This tool only works on files. If you need to see the contents of a directory, use the `BashTool` with `ls -la`.

---

## 4. GraphQueryTool
**Description:** Queries the internal Abstract Syntax Tree (AST) topological map of the project.

This is your ultimate "Zoom Out" tool. BreakGlassWing maintains a live Dependency Graph of all classes, functions, and files. Use this tool BEFORE making edits to understand the blast radius of your changes.

# Instructions
- **Dependency Tracking:** Use the query `GET_DEPENDENTS <NodeID>` to see every other file/class that relies on the target you are about to modify. If you change a function signature, you MUST update all dependents.
- **Feature Discovery:** Use `SEARCH_NODES <Keyword>` to find where specific domain logic lives without grepping the entire codebase.
- **Architectural Constraints:** When the tool returns an AST node, pay attention to the `emits` and `listensTo` metadata. If a class emits an event, your code edits must preserve that event emission, or the `ArchitectureGuardian` will block your save.

---

## 5. MemoryQueryTool
**Description:** Performs a semantic search against the Long-Term Memory VectorStore.

Use this tool when you encounter an unfamiliar error, a weird architectural pattern, or need to know how a specific problem was solved in the past.

# Instructions
- **Query Formulation:** Do not pass raw stack traces as the query. Summarize the conceptual problem (e.g., `query: "How do we handle FreeCreditsTracker async-mutex race conditions?"`).
- **Token Budgeting:** The memories returned by this tool are injected directly into your context window. Only query memory if you are genuinely stuck, to avoid exhausting your Short-Term Memory budget.
- **Applying Past Solutions:** If a historical memory suggests a fix, adapt it to the *current* codebase context. Do not blindly copy-paste outdated paths.

---

## 6. SpawnSubagentTool
**Description:** Spawns an asynchronous, parallel sub-agent to handle a delegated task.

Use this tool when a user request is too massive or complex to be completed in a single sequential thought process (e.g., "Refactor the entire API to use GraphQL" or "Write unit tests for all 50 files").

# Instructions
- **Decomposition:** Before calling this tool, mentally break the user's goal into isolated, independent sub-tasks.
- **Highly Specific Prompts:** The sub-agent boots up with a BLANK short-term memory. Your `taskDescription` parameter must contain absolutely everything it needs to know: exact file paths, exact architectural goals, and exactly what constitutes "success."
- **Fire and Forget:** Sub-agents run completely asynchronously. Once you spawn them, you will receive a generic `TASK_QUEUED` confirmation. You do not need to sleep or wait. The system will notify you with the results once the sub-agent completes or fails.
- **Rate Limits:** Do not spawn more than 5 sub-agents in a single turn to avoid exhausting the API quota.

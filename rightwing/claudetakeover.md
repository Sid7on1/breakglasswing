# BreakGlassWing: Architectural Takeover via Claude-Code Paradigms

After analyzing the ~546K LOC `claude-code` repository, I have filtered out the UI/infrastructure noise and isolated the absolute best, most advanced AI engineering paradigms that will directly upgrade our `breakglasswing` graph-based agent architecture.

Here are the specific, high-leverage paradigms we should port into our current codebase to make it truly state-of-the-art:

## 1. Git Worktree Isolation for Safe "Evolution"

**The Claude Pattern:** When Claude spawns a subagent to work on a task, it doesn't let the subagent touch the live files. Instead, it uses `git worktree add` to create a temporary, completely isolated physical copy of the repository for the subagent to mutate.
**How it makes BreakGlassWing better:** This solves our biggest risk with "Self-Evolution Mode". When our agent decides to evolve its own code, it should spawn an Evolution Subagent inside a `git worktree`. The subagent can mutate the graph, rewrite code, and run tests. If the tests fail or the agent goes rogue, we simply `git worktree remove` and the main codebase is unharmed. If it succeeds, we merge the worktree branch back into main.

## 2. Multi-Agent "Coordinator & Worker" Parallelism

**The Claude Pattern:** Claude never uses a single massive LLM loop. It has a "Coordinator" agent that does NO coding. The Coordinator reads the context, synthesizes a strict "spec", and then spawns parallel "Worker" agents asynchronously using an `<task-notification>` XML bus.
**How it makes BreakGlassWing better:** When our Graph Engine detects a change that impacts 5 different modules (via the `ImpactEngine`), we shouldn't iterate through them one by one. The `Orchestrator` should spawn 5 parallel Worker agents, giving each one a strict, synthesized prompt based on the AST Graph context, and wait for them all to report back via the Event Bus.

## 3. Two-Stage "YOLO" Security Classifier (Auto Mode)

**The Claude Pattern:** Instead of prompting the user for permission on every bash/edit command, Claude uses an ultra-fast XML classifier. Stage 1 is a 64-token greedy prompt to output `<block>yes/no</block>`. If it's unsure, it escalates to Stage 2 which uses Chain-of-Thought `<thinking>` to analyze the security risk.
**How it makes BreakGlassWing better:** Our `ArchitectureGuardian` currently needs a way to automatically allow or block potentially destructive graph mutations or bash commands during unattended evolution. Implementing a Two-Stage YOLO classifier allows our agent to run autonomously (in Auto Mode) while remaining mathematically safe and token-efficient.

## 4. The `buildTool` Factory Pattern with Fail-Closed Defaults

**The Claude Pattern:** Tools aren't just raw JSON definitions. They are constructed using a strict TypeScript `buildTool` factory that injects forced defaults (e.g., `checkPermissions`, `isDestructive: false`, UI renderers).
**How it makes BreakGlassWing better:** As we add more tools for graph traversal, AST manipulation, and DI container manipulation, we need a standard `ToolFactory`. This factory will ensure every tool we build automatically registers its memory usage, logs its impact to the `GenomeDB`, and enforces security rules without developer boilerplate.

## 5. Nightly "Memory Distillation" (Dream Skill)

**The Claude Pattern:** The agent appends raw, messy notes to a daily log file (`YYYY-MM-DD.md`) rather than constantly editing a central memory file. A background "dream" process runs nightly to distill these logs down into a strict, capped `MEMORY.md` index (max 200 lines).
**How it makes BreakGlassWing better:** This maps perfectly to our `GenomeDB`. During normal coding, the agent should just append raw observations to a fast-write transaction log. When the system pauses for "Self-Evolution", a distillation subagent reads the transaction log, condenses the insights, and permanently updates the `GenomeDB` and the `CognitiveGraph`.

---

## Action Plan for BreakGlassWing

To implement these advancements, I recommend we prioritize the following modules next:

1. **`src/evolution/worktree.manager.ts`**: Implement the git worktree isolation logic so the agent can safely experiment on its own code without breaking the active workspace.
2. **`src/core/coordinator.ts`**: Upgrade the current main loop into a Coordinator that dispatches parallel workers using the Event Bus.
3. **`src/security/yolo.classifier.ts`**: Implement the two-stage XML security classifier for autonomous bash/edit command execution.

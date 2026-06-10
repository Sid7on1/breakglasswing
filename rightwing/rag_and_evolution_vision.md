# Advanced Codebase Graph & Evolution Engine Vision

This document details the architectural blueprint for the agent's advanced "Show Wires" RAG Engine and its deeply integrated Self-Evolution mechanisms.

## Part 1: The Code Knowledge Graph & Dependency Intelligence Engine
Traditional agent frameworks rely on primitive RAG (Retrieval-Augmented Generation): breaking files into chunks, storing embeddings, retrieving text, and feeding it to an LLM. 

This new approach discards pure text chunks in favor of a **Hierarchical Code Map**. The agent does not see code as raw text; it sees it as a living, interconnected map.

### Feature 1: Hierarchical Code Map
Instead of a flat file structure, every component of a project is a node with rich metadata.
- **Levels**: Project -> Directory -> File -> Class -> Function -> Code Block.
- **Metadata**: Each node contains a `node_id`, `name`, `type`, `purpose`, `imports/depends_on`, `exports/used_by`, `criticality`, and `risk_score`.
- The LLM understands the exact semantic meaning of a function without needing to re-read the code text.

### Feature 2: Infinite Zoom Navigation
The agent navigates the repository like a human. It starts at a macro Level 0 (Project) and can "zoom in" to Level 1 (Folders), Level 2 (Files), Level 3 (Functions), down to specific logic blocks. It never loads the entire repository into memory at once, minimizing context bloat and maximizing precision.

### Feature 3: Wire View (`SHOW WIRES`)
The core mechanic. When the agent wants to understand relationships, it executes a `SHOW WIRES` command.
Instead of just file-level imports, it visualizes function-level pipelines (causal relationships). 
It maps exactly how data flows.
**Example**: `createUser() -> validateUser() -> hashPassword() -> saveUser()`.

### Feature 4: Micro-Wires
Most systems stop at file dependencies. This engine maps `Function -> Function -> Function`. 
If `auth.js` has `validateToken()`, the graph maps exactly which function in `middleware.js` consumes it, and which function in `routes.js` relies on that middleware.

### Feature 5: Impact Analysis & Blast Radius
Before making a change, the agent calculates the "Blast Radius".
- **Reverse Dependency Lookup**: "Who uses this function?"
- **Forward Dependency Lookup**: "What does this function depend on?"
If the agent modifies `validateToken()`, the Impact Engine immediately reports: *Affects 23 Functions, 6 Files, 4 APIs, 2 Databases*. The agent understands the exact risk before touching anything.

### Feature 6: Automatic Propagation Verification
Code editing doesn't stop at modifying a single file. 
- Edit Code -> Find Dependencies -> Verify Dependencies -> Patch Dependencies -> Run Tests.
The agent is forced to "follow the wires" to ensure no broken contracts are left behind.

### Feature 7: Live Updating & Architectural Memory
When code changes, the graph updates instantly. Added functions become new nodes; changed imports become new wires. The system builds a permanent "Architectural Memory" of the codebase that never expires, assigning a **Repository Understanding Score** (e.g., Backend: 98%, Payments: 62%). If confidence in an area is low, the agent forces itself to read more before editing.

---

## Part 2: The Dual Graph System (Genome vs Playground)
The critical realization is that the agent maintains **two completely different graph systems** with separate permissions, persistence, and rules.

### 1. The Playground Graph (Working Layer)
- **Domain**: User projects, databases, external repositories, temporary toolchains.
- **Lifecycle**: Created dynamically, can be deleted, regenerated, or rebuilt at will.
- **Function**: This is the world the agent operates *on*.

### 2. The Genome Graph / Self Index (Sacred Core Layer)
- **Domain**: The agent's own internal architecture (Planner, Memory Engine, Governor, Sandbox, Evolution Engine, etc.).
- **Lifecycle**: Pre-built, baked-in, persistent, highly secure, and protected. It lives in a dedicated secure core layer (not a temporary workspace).
- **Function**: This is what the agent *is*. The agent is born with this graph. It does not need to scan itself to know how its Memory Engine connects to its Tool Registry. The metadata (inputs, outputs, contracts, permissions) is natively indexed.

---

## Part 3: Evolution Mode
Self-modification requires an absolute lock on the system to prevent catastrophic degradation. It cannot be run as a background task.

### 1. "STOP EVERYTHING" Protocol
When the Evolution Engine decides to upgrade a component, the system enters a special **EVOLUTION MODE**:
- Task Queues: Paused
- Workers: Paused
- External Tasks: Paused
Only the specific Evolution, Validation, Architecture, and Rollback agents remain active. The agent focuses purely on self-upgrade.

### 2. Graph Synchronization Rule
Self-modifications follow a strict workflow:
1. Propose Code Change
2. Update Genome Graph
3. Validate Architectural Consistency (Architecture Guardian checks contracts and permissions)
4. Swap Pointers

### 3. Pointer Reassignment
The agent does not blindly overwrite its active brain.
If upgrading the Planner:
- It creates `Planner V2`.
- Tests and validates it.
- Updates the Genome Graph.
- Swaps the pointer from `Planner V1` to `Planner V2`.
`Planner V1` remains in cold storage. Rollbacks are instant and trivial if `V2` fails.

### 4. Architecture Guardian
During Evolution Mode, the Architecture Guardian verifies that new changes don't violate the existing Genome structure. It checks for dead modules, unused functions, broken dependencies, and circular references. If the actual code graph drifts from the Genome Graph, the change is instantly rejected and rolled back.

---

## Part 4: Advanced Architectural Extensions
To fully realize the true vision of the evolving agent, the system incorporates the following structural capabilities:

### 1. Multi-Level Zoom Engine
The graph is not limited to Project -> File -> Function. It zooms infinitely deeper: `Project -> Folder -> File -> Class -> Function -> Block -> Statement -> Variable`. The agent can inspect exactly how a variable flows into a statement.

### 2. Graph Query Language
The agent utilizes a dedicated semantic query language beyond simple structural traversal, supporting precise commands like: `SHOW WIRES`, `SHOW ALL PATHS`, `WHO USES THIS`, `WHAT BREAKS`, `SHOW DATA FLOW`, and `SHOW AUTH FLOW`.

### 3. Runtime Graph (Dynamic Intelligence)
The AST approach only captures static files. The agent supplements this with a **Runtime Graph** capable of tracking dynamic imports, Dependency Injection bindings, and Event Bus pub/sub relationships (e.g., explicitly linking an `EventBus.emit()` to its `EventBus.on()` subscriber).

### 4. Agent Cognitive Graph (Execution State)
The agent maps its own real-time execution as a graph: `Goal -> Task -> Subtask -> Worker -> Result`. This allows the agent to inspect its own logic chains and debug its own reasoning path.

### 5. Capability Graph
The agent maintains a map of its tools and capabilities (Browser, Terminal, Coding) versus missing capabilities (MCP, Redis, Docker). It uses this graph to decide when to search for external repositories to "absorb" new skills.

### 6. The Genome Database
The agent's Self-Index is **not hardcoded**. It lives in a persistent, version-controlled **Genome Database** (`genome/components.json`, `genome/contracts.json`). As the agent self-evolves, it actively updates this database.

### 7. Evolution Workspace
Self-evolution never happens on the live system. It occurs inside a dedicated `sandbox/evolution_workspace` where a Candidate Agent is cloned, modified, tested against the Architecture Guardian, and only promoted via Pointer Swap upon full validation.

### 8. Architectural Contracts
The strongest safety mechanism. Every component has strict I/O contracts (`{ "component": "planner", "must_output": "task_graph" }`). If an evolution breaks the contract, the Architecture Guardian rejects the pointer swap instantly.

### 9. Autonomous Graph Maintenance
Graph updates are not passive. An active **Graph Observer** listens for any `FILE_WRITE` event. It immediately recalculates the affected nodes and schedules autonomous verification tasks for any downstream functions to ensure the agent follows the wires perfectly.

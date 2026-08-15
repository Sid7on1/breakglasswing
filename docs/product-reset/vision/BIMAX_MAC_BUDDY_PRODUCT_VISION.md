<!--
Owner-supplied north-star product vision, preserved verbatim from the 2026-08-08 source.
This document defines direction; implementation status must still use the repository's
Implemented / Measured / Product-ready / Target vocabulary and acceptance gates.
-->
# Bimax Mac Buddy

## Product Vision

**Bimax Mac Buddy** is an AI-native macOS companion designed from the lowest practical system layers upward.

The goal is not to build a conventional application that simply runs on macOS. The goal is to build an adaptive system that understands the Mac it is running on, the development environments available on that Mac, the state of the network, the filesystem, applications, security conditions, and the user's current task.

The core philosophy is:

> **Mac Buddy should not merely use the Mac. It should understand the Mac it lives on.**

Bimax Mac Buddy should adapt its behavior dynamically from **silicon to screen**.

---

# 1. Silicon-Aware Architecture

Mac Buddy should understand the hardware capabilities of the Mac it is running on.

Instead of treating every Mac as identical, it should detect and adapt to the current machine.

The system may consider:

* Apple Silicon generation
* Intel vs Apple Silicon
* CPU performance cores
* CPU efficiency cores
* GPU capabilities
* Neural Engine capabilities
* Unified memory
* Memory bandwidth
* Media engines
* Secure Enclave
* Available hardware accelerators
* Battery state
* Power source
* Memory pressure
* Thermal pressure
* Sustained performance capability

The application should preferably make decisions based on **capabilities and current conditions**, rather than hard-coded chip names.

Example:

```text
MacBook Air
M-series chip
16 GB unified memory
Fanless
Battery powered
Thermal pressure increasing

        ↓

Reduce background computation
Reduce concurrency
Use smaller local models
Reduce unnecessary GPU workloads
Prioritize interactive performance
```

On a powerful Mac Studio:

```text
Mac Studio
High-end Apple Silicon
Large unified memory
Active cooling
Connected to power

        ↓

Allow larger models
Higher concurrency
More aggressive indexing
More parallel workloads
Higher sustained compute
```

The visible product can remain consistent while its internal execution strategy changes depending on the machine.

---

# 2. macOS-Aware Runtime

Mac Buddy should deeply integrate with macOS rather than behave like a generic cross-platform application.

Important macOS capabilities may include:

* SwiftUI
* AppKit
* Core Animation
* Metal
* Core ML
* Accelerate
* VideoToolbox
* Keychain
* Secure Enclave-backed security
* Accessibility APIs
* XPC
* Native window management
* Native menu system
* Drag and drop
* Keyboard navigation
* Spotlight integration
* Quick Look
* Notifications
* Sandbox architecture
* Filesystem events
* Native process and energy management

The system should allow macOS to help schedule and optimize workloads instead of fighting the operating system.

---

# 3. Performance Philosophy

Mac Buddy should feel extremely smooth and responsive.

Performance should be treated as an architectural requirement instead of a later optimization.

Important principles:

* Never unnecessarily block the main thread.
* Heavy computation should happen outside the interactive UI path.
* Networking should not freeze the interface.
* Filesystem operations should not block interaction.
* Expensive initialization should be lazy where possible.
* Background work should yield to active user interaction.
* Avoid unnecessary memory copies.
* Avoid excessive allocations.
* Use caches intelligently.
* Reuse network connections.
* Stream data when useful.
* Adapt workloads to thermal and power conditions.

User interaction should always have priority over invisible background work.

If the user is:

* typing,
* scrolling,
* dragging,
* resizing,
* navigating,
* switching windows,
* interacting with the computer,

then indexing, syncing, AI inference, background scanning, telemetry, or prefetching should not degrade that experience.

The application should not merely benchmark fast.

It should **feel fast**.

---

# 4. Internet-Aware API Architecture

Mac Buddy should design API interaction from the macro architecture of the Internet rather than treating an API as simply:

```text
Application → HTTP request → JSON response
```

The system should understand the larger path:

```text
Mac
↓
Local network
↓
Wi-Fi / Ethernet
↓
DNS
↓
ISP
↓
Internet routing
↓
BGP / network paths
↓
CDN / edge
↓
TLS
↓
TCP / QUIC
↓
HTTP
↓
API gateway
↓
Backend service
↓
Database / model / service
↓
Response
```

Important factors may include:

* Wi-Fi quality
* Ethernet
* VPNs
* IPv4
* IPv6
* DNS resolution
* DNS caching
* connection reuse
* TLS handshakes
* TCP
* QUIC
* HTTP/2
* HTTP/3
* packet loss
* latency
* RTT
* congestion
* routing changes
* regional server distance
* CDN availability
* API latency
* streaming availability

Mac Buddy should adapt networking behavior dynamically.

Example:

```text
Excellent connection
Low RTT
Nearby edge server

        ↓

Persistent connections
Streaming
Prefetching
Higher concurrency
Faster synchronization
```

Poor network conditions:

```text
Weak Wi-Fi
High RTT
Packet loss
Unstable connection

        ↓

Reduce parallel requests
Use local cache
Use resumable operations
Increase timeout intelligently
Avoid duplicate API mutations
Reduce unnecessary traffic
```

Network quality should influence application behavior just like hardware capability influences computation.

---

# 5. Runtime Policy Engine

The system should contain a central adaptive policy engine.

Conceptually:

```text
Hardware capabilities
        +
macOS state
        +
Battery state
        +
Thermal state
        +
Memory pressure
        +
Network quality
        +
Application workload
        +
User interaction
        ↓
Runtime Policy Engine
        ↓
Execution strategy
```

This engine decides:

* where workloads run,
* how aggressively they run,
* how much concurrency is allowed,
* whether local or remote execution is preferable,
* how much background work is appropriate,
* how networking should behave,
* how much memory should be consumed.

---

# 6. Developer Environment Intelligence

Because Mac Buddy is also a coding agent, it should understand the entire development environment of the Mac.

It should build an inventory of installed development tools.

Examples:

## Programming languages and runtimes

* Python
* Node.js
* Bun
* Deno
* Go
* Rust
* Java
* Kotlin
* Swift
* Ruby
* PHP
* .NET
* C
* C++
* other installed runtimes

It should detect **multiple versions**.

Example:

```text
Python
├── 3.9
├── 3.11
├── 3.12
└── 3.13

Node.js
├── 20
├── 22
└── 24
```

---

# 7. Runtime Version Managers

Mac Buddy should detect systems such as:

* pyenv
* nvm
* fnm
* asdf
* mise
* rbenv
* SDKMAN
* Conda
* virtualenv
* venv

It should understand runtime precedence.

For example:

```text
/usr/bin/python3
/opt/homebrew/bin/python3
~/.pyenv/versions/...
project/.venv/bin/python
Conda environment
```

The agent should determine which interpreter is correct **for the current project** rather than simply choosing the newest installed version.

---

# 8. Package Manager Awareness

Mac Buddy should understand package managers including:

* npm
* pnpm
* yarn
* Bun
* pip
* uv
* Poetry
* Conda
* Homebrew
* Cargo
* gem
* Composer

It should understand both:

* globally installed packages,
* project-specific dependencies.

It should avoid blindly executing commands.

For example, if a repository uses:

```text
pnpm-lock.yaml
```

Mac Buddy should not automatically execute:

```text
npm install
```

If a Python project uses:

```text
uv.lock
```

it should understand that `uv` is the intended package-management environment.

---

# 9. Homebrew and System Tools

Mac Buddy should understand installed Homebrew packages.

It should detect:

* Homebrew formulae
* Homebrew casks
* development utilities
* command-line programs
* databases
* compilers
* libraries
* shells

The agent should understand what software already exists before installing additional software.

---

# 10. SDK and Compiler Awareness

Mac Buddy should identify development SDKs and compilers such as:

* Xcode
* Xcode Command Line Tools
* Apple SDKs
* clang
* gcc
* Rust toolchains
* Go toolchains
* Java JDKs
* Android SDK
* Android NDK
* .NET SDK
* Swift toolchain

This prevents unnecessary installation and environment corruption.

---

# 11. Local Development Infrastructure

Mac Buddy should discover development infrastructure available locally.

Examples:

* Docker
* Podman
* OrbStack
* Colima
* PostgreSQL
* MySQL
* MongoDB
* Redis
* SQLite
* Ollama
* LM Studio
* MCP servers
* local model runtimes
* development servers

It should understand whether these services are:

* installed,
* configured,
* running,
* stopped,
* project-specific.

---

# 12. IDE and Editor Awareness

The system may detect development tools such as:

* Xcode
* Visual Studio Code
* Cursor
* JetBrains IDEs
* terminal editors
* other development environments

This allows Mac Buddy to understand the user's development ecosystem.

---

# 13. Project Environment Discovery

Mac Buddy should understand development environments distributed across project folders.

For each project it may identify:

```text
Project
├── language
├── framework
├── runtime version
├── package manager
├── virtual environment
├── installed dependencies
├── lockfile
├── database
├── build tools
├── git repository
├── branch
├── uncommitted changes
├── configuration
└── development commands
```

Example:

```text
project-a/

Type: Next.js
Node requirement: >=22
Package manager: pnpm
Lockfile: pnpm-lock.yaml
Git repository: yes
Current branch: feature/auth
Database: Supabase
node_modules: present
```

Another example:

```text
ml-project/

Type: Python Machine Learning
Python: 3.12
Environment: .venv
Package manager: uv
PyTorch: installed
Apple GPU acceleration: available
Jupyter: configured
```

The goal is for the agent to understand:

> What does this project expect?

and then:

> What does this Mac currently provide?

before changing anything.

---

# 14. Developer Environment Graph

Mac Buddy can internally maintain a structured model such as:

```text
Developer Environment Graph
│
├── Machine
│   ├── architecture
│   ├── operating system
│   ├── SDKs
│   └── system tools
│
├── Runtimes
│   ├── Python[]
│   ├── Node[]
│   ├── Java[]
│   ├── Swift[]
│   └── others
│
├── Package Managers
│   ├── Homebrew
│   ├── npm
│   ├── pnpm
│   ├── pip
│   ├── uv
│   └── others
│
├── Services
│   ├── databases
│   ├── containers
│   └── local AI runtimes
│
├── Projects
│   ├── Project A
│   ├── Project B
│   └── Project C
│
└── Environment Resolution
    └── Correct environment for current task
```

---

# 15. Incremental Environment Tracking

Mac Buddy should avoid continuously scanning the entire disk.

Instead:

```text
Initial discovery
        ↓
Environment index
        ↓
Filesystem events
        ↓
Targeted updates
        ↓
Current environment graph
```

This improves:

* performance,
* battery life,
* responsiveness,
* scalability.

---

# 16. File Editing Intelligence

For a coding agent, editing should not simply mean:

```text
LLM
↓
Generate file
↓
Overwrite file
```

Mac Buddy should understand the complete file-edit lifecycle.

```text
User intent
↓
Repository state
↓
File structure
↓
Language structure
↓
Edit strategy
↓
Validation
↓
Filesystem mutation
↓
Post-edit verification
```

Potential edit strategies:

* exact text patch
* range replacement
* AST-aware edit
* symbol-aware edit
* structured configuration edit
* insertion
* deletion
* controlled rewrite

Full-file rewrites should occur only when appropriate.

---

# 17. File System Awareness

The agent should understand:

* text files
* binary files
* encoding
* line endings
* symlinks
* permissions
* file ownership
* file locks
* concurrent modifications
* generated files
* ignored files
* git-tracked files
* temporary files
* project configuration

It should avoid corrupting files or unintentionally overwriting external changes.

---

# 18. Safe File Mutation Pipeline

A strong edit workflow could be:

```text
Understand requested change
↓
Identify minimal edit surface
↓
Read current state
↓
Check file version / hash
↓
Create patch
↓
Apply patch in memory
↓
Validate syntax
↓
Validate types
↓
Validate imports
↓
Perform safe filesystem write
↓
Read file again
↓
Inspect resulting diff
↓
Run compiler / tests / linter when appropriate
↓
Confirm intended state
```

The system should never trust only:

> The write command succeeded.

It should verify:

> The filesystem now contains the intended result.

---

# 19. Closed-Loop Agent Execution

Mac Buddy should use the following philosophy throughout the system:

```text
Observe
↓
Understand
↓
Plan
↓
Predict expected result
↓
Act
↓
Observe again
↓
Compare actual result
↓
Continue / correct / rollback
```

This should apply to:

* coding,
* filesystem operations,
* terminal commands,
* application interactions,
* computer use.

---

# 20. Computer-Use Architecture

Computer use should go far beyond:

```text
Screenshot
↓
AI
↓
Click x,y
```

Mac Buddy should understand the entire computer interaction stack.

```text
macOS
↓
Displays
↓
Windows
↓
Accessibility tree
↓
Window geometry
↓
Screen capture
↓
Coordinate systems
↓
Visual perception
↓
Target identification
↓
Action planning
↓
Mouse / keyboard event
↓
Post-action observation
↓
Verification
```

---

# 21. Coordinate Intelligence

The agent should understand different coordinate systems including:

* physical pixels
* logical points
* Retina scaling
* display coordinates
* global screen coordinates
* window coordinates
* application content coordinates
* scroll coordinates
* screenshot coordinates
* model perception coordinates

A command such as:

```text
click 642, 381
```

is meaningless unless the system knows what coordinate space those values belong to.

Mac Buddy should continuously maintain correct transformations between these spaces.

---

# 22. Multi-Source GUI Perception

Mac Buddy should combine multiple sources of information.

```text
Accessibility API
        +
Window metadata
        +
Computer vision
        +
Text recognition
        +
Application state
        +
Previous observations
        ↓
Unified Scene Model
```

If semantic accessibility information exists, it should be preferred when reliable.

Example:

```text
Role: Button
Label: Deploy
Bounds: ...
Enabled: true
```

The system can interact semantically.

For applications where accessibility information is missing or incomplete, such as:

* canvas applications,
* games,
* remote desktops,
* WebGL interfaces,
* custom-rendered applications,
* video interfaces,

visual perception can become the primary source.

---

# 23. Adaptive Computer Perception

Conceptually:

```text
Semantic UI available?
        ↓ yes
Use accessibility information

        ↓ no
Use visual perception

Both uncertain?
        ↓
Fuse accessibility + vision + geometry
```

This creates a more robust computer-use system.

---

# 24. GUI Action Verification

The agent should not assume a click succeeded.

Example:

```text
Observe button
↓
Predict expected state
↓
Click
↓
Capture new state
↓
Check whether expected transition occurred
```

If the expected state does not occur, Mac Buddy may:

* retry,
* adjust coordinates,
* use another interaction method,
* scroll,
* wait for rendering,
* select another target,
* ask the user if necessary.

---

# 25. Unified World Model

Coding and computer use can share the same underlying execution philosophy.

```text
                 WORLD STATE
                      │
          ┌───────────┴───────────┐
          │                       │
      Code World               GUI World
          │                       │
 Files / AST / Git        Windows / UI / Pixels
          │                       │
          └───────────┬───────────┘
                      ↓
                 Agent Model
                      ↓
                 Action Plan
                      ↓
              Controlled Mutation
                      ↓
               Evidence Capture
                      ↓
              State Reconciliation
```

Whether Mac Buddy changes:

```text
src/auth.ts
```

or clicks:

```text
Allow
```

the philosophy remains:

> **Observe → understand → mutate minimally → verify reality.**

---

# 26. Security & Trust Engine

Mac Buddy should include an antivirus-like security subsystem, but its purpose should be broader than traditional signature-based antivirus software.

The subsystem can act as an:

# Execution Security Layer

or

# Trust Engine

Its goal is to understand whether actions, files, packages, processes, and network behavior are expected and safe.

---

# 27. File Security

Mac Buddy may inspect:

* executable files
* scripts
* downloaded binaries
* persistence mechanisms
* suspicious shell scripts
* unexpected system modifications
* credential-stealing patterns
* unsigned binaries
* quarantine metadata
* potentially malicious project files

---

# 28. Dependency Security

When installing packages through systems such as:

* npm
* pip
* uv
* Homebrew
* Cargo
* Bun
* pnpm,

Mac Buddy should analyze potential risks.

Examples:

* typosquatting packages
* suspicious install scripts
* unexpected post-install scripts
* packages downloading binaries
* known vulnerable versions
* abandoned dependencies
* unexpected filesystem access
* unusual network connections

The coding agent should not blindly trust every dependency.

---

# 29. Process and Network Security

Mac Buddy may identify suspicious runtime behavior.

Examples:

```text
Process starts
↓
Spawns shell
↓
Reads SSH keys
↓
Reads browser data
↓
Connects to unusual domain
↓
Creates persistent launch process
```

Such behavior should trigger deeper inspection.

---

# 30. Agent Action Security

Every potentially dangerous agent action can pass through the Trust Engine.

```text
Agent proposes action
↓
Security policy evaluation
↓
Risk analysis
↓
Allow / Sandbox / Warn / Block
↓
Execute
↓
Observe behavior
↓
Verify expected behavior
```

Sensitive actions may include:

* deleting large numbers of files
* modifying shell startup files
* modifying SSH configuration
* accessing credentials
* running `sudo`
* changing system security settings
* modifying LaunchAgents
* modifying LaunchDaemons
* installing privileged helpers
* accessing browser profiles
* changing permissions
* executing unknown binaries

---

# 31. Context-Aware Security

The security system should not simply ask:

> Is this malware?

It should ask:

> Is this behavior expected for this task, from this process, inside this project, on this machine?

For example:

```text
Deleting build/
```

may be expected.

But:

```text
Deleting ~/Documents
```

probably requires stronger confirmation.

Running a command inside an isolated sandbox is different from running the same command directly against the user's machine.

---

# 32. macOS Security Integration

Where appropriate, Mac Buddy could integrate with macOS mechanisms such as:

* Gatekeeper
* notarization
* quarantine metadata
* XProtect information
* Keychain
* code-signing validation
* application sandboxing
* EndpointSecurity APIs
* Secure Enclave-related protections

---

# 33. Adaptive Execution Environment

Ultimately, Bimax Mac Buddy combines:

```text
Silicon Awareness
        +
macOS Awareness
        +
Network Awareness
        +
Developer Environment Awareness
        +
Filesystem Awareness
        +
Programming Language Awareness
        +
GUI Awareness
        +
Runtime Awareness
        +
Security Awareness
        ↓
Adaptive AI Execution Environment
```

Mac Buddy should continuously understand:

```text
What machine am I running on?

What can this machine comfortably do right now?

What development tools are available?

What environment does this project expect?

What is happening on the network?

What applications are open?

What files and repositories are being modified?

What action is the agent attempting?

What could that action affect?

Did the action actually succeed?

Is the resulting state safe and correct?
```

---

# 34. Product Identity

## Name

**Bimax Mac Buddy**

## Core idea

An AI-native companion that deeply understands the Mac it lives on.

## Possible positioning

**Bimax Mac Buddy — An AI that understands your Mac from silicon to screen.**

The sophisticated engineering should remain mostly invisible to the user.

The user should simply experience an assistant that:

* understands their Mac,
* understands their projects,
* understands their tools,
* understands their network,
* understands applications,
* understands code,
* understands system state,
* protects the machine,
* adapts automatically,
* executes reliably,
* verifies its work,
* and remains extremely responsive.

The ultimate objective is not to create another chatbot with terminal access.

The objective is to create a **native intelligent operating companion for macOS**.

---

<!-- Owner addition supplied 2026-08-08. Its section number is preserved verbatim. -->

# 27. Hardware-Informed Mathematical & Algorithmic Execution

Bimax Mac Buddy should design its algorithms from the **chip architecture upward**, rather than choosing generic algorithms and expecting the processor to execute them efficiently.

The philosophy is:

> **Understand how the chip performs computation first, then choose the mathematics, algorithms, data structures, and execution strategy that best fit that hardware.**

Conceptually:

```text
Chip Architecture
↓
CPU / GPU / Neural Engine
↓
Cache & Unified Memory
↓
Instruction & SIMD Capabilities
↓
Memory Bandwidth / Latency
↓
Power & Thermal Characteristics
↓
Mathematical Cost Model
↓
Algorithm Selection
↓
Data Structure Selection
↓
Execution Strategy
↓
Operation
```

This principle should apply even to extremely small operations.

For example, something as simple as:

```text
Replace "old" → "new"
```

should not automatically mean:

```text
Read entire file
→ search entire file
→ rebuild entire string
→ rewrite entire file
```

Mac Buddy should determine the most efficient approach depending on the situation.

It may consider:

- file size,
- text size,
- edit location,
- encoding,
- existing syntax/AST information,
- memory representation,
- cache locality,
- number of memory copies,
- allocation cost,
- SIMD/vectorization opportunities,
- filesystem behavior,
- current memory pressure,
- CPU/GPU availability,
- battery and thermal conditions.

For a tiny file, a simple linear operation may be fastest.

For a massive file, memory mapping, chunked processing, or vectorized search may be more efficient.

For an actively edited document, structures such as a **Piece Table, Rope, or Gap Buffer** may avoid repeatedly copying large amounts of text.

For source code where the exact syntax node is already known:

```text
Syntax Tree / AST
↓
Known Symbol
↓
Known Byte Range
↓
Minimal Patch
```

Mac Buddy may avoid performing a search altogether.

The same philosophy should apply to:

- writing text,
- replacing text,
- searching files,
- comparing files,
- generating diffs,
- parsing code,
- indexing repositories,
- traversing dependency graphs,
- processing screenshots,
- computer-use perception,
- networking,
- caching,
- hashing,
- memory management,
- AI inference,
- background computation.

Algorithm decisions should not rely only on theoretical Big-O complexity.

Two algorithms may both be:

```text
O(n)
```

while one is significantly faster on Apple Silicon because it provides:

```text
Sequential Memory Access
+
High Cache Locality
+
Few Branches
+
SIMD-Friendly Computation
+
Minimal Allocations
+
Minimal Memory Copies
```

Therefore, Mac Buddy should consider a richer real-world cost model:

```text
Real Execution Cost =
CPU Work
+ Memory Operations
+ Cache Misses
+ Allocations
+ Memory Copies
+ Branch Cost
+ Storage I/O
+ Synchronization
+ Energy Usage
+ Latency
```

The system should ultimately aim to choose:

> **The cheapest correct execution strategy for the current operation, workload, machine, and system state.**

Different Macs may therefore use different internal algorithms for the exact same logical operation.

Conceptually:

```text
Requested Operation
↓
Analyze Workload
↓
Understand Current Mac
↓
Evaluate Candidate Algorithms
↓
Estimate Real Hardware Cost
↓
Choose Best Strategy
↓
Execute
↓
Measure Actual Performance
↓
Adapt Future Decisions
```

This creates a fundamental Bimax principle:

> **Every operation—from writing a few characters to analyzing an entire repository—should use an execution strategy shaped by the mathematics of the problem and the physical realities of the chip executing it.**

<!-- Owner additions supplied 2026-08-08. Section numbers and wording are preserved verbatim. -->

# 28. macOS Intelligence, Correction & Unusual Activity Detection

Bimax Mac Buddy should not only run on macOS; it should actively help macOS understand and improve the state of the machine.

The system should continuously observe system behavior and identify unusual activity, inefficiencies, inconsistencies, suspicious processes, unexpected filesystem changes, abnormal networking behavior, unsafe package activity, and contextual problems that a static operating-system security or monitoring layer may not recognize on its own.

Bimax should act as an additional intelligent layer above macOS:

```text
macOS
↓
System Events / Processes / Files / Network / Security
↓
Bimax Intelligence Layer
↓
Contextual Understanding
↓
Expected vs Actual Behavior
↓
Detect / Explain / Correct / Optimize / Warn
```

The major difference should be **context**.

For example, deleting a generated build directory may be completely normal during compilation.

However, if the same build process unexpectedly attempts to:

* read SSH credentials,
* access browser secrets,
* modify LaunchAgents,
* create persistence,
* contact an unusual remote server,
* modify unrelated system directories,

Bimax should understand that the behavior does not match the expected task.

The system should therefore ask:

> **Is this behavior normal for what the user, project, process, and agent are currently trying to accomplish?**

rather than only:

> Is this file or process already known to be malicious?

Bimax should be capable of identifying and surfacing unusual behavior that conventional static rules may miss because it understands:

* the active project,
* the developer environment,
* the agent's current mission,
* the expected toolchain,
* the application's normal behavior,
* the filesystem context,
* the network context,
* and the machine's previous state.

When appropriate, Bimax should be able to:

* warn,
* isolate,
* sandbox,
* block,
* recommend a correction,
* repair configuration,
* restore expected state,
* or explain exactly why an activity appears unusual.

The goal is for Bimax to become an intelligent system companion that **complements macOS rather than attempting to replace it**.

---

# 29. Modular Chipset-Native Developer Ecosystem

Bimax Mac Buddy should function as an **agentic coding platform with its own IDE**, while allowing developers to expand the system with only the capabilities required for their work.

The product should behave as a modular developer operating environment rather than a fixed coding application.

Developers should be able to add capabilities such as:

* Android simulation,
* iOS simulation,
* Computer Use,
* language runtimes,
* development environments,
* project-specific toolchains,
* packages,
* skills,
* `SKILL.md` files,
* frameworks,
* integrations,
* and specialized developer environments.

If a developer requires Computer Use, it should be downloadable and integrated into the same Bimax intelligence layer.

If a project requires a specific development stack, Bimax should understand the requirements and intelligently prepare the necessary environment.

For a frontend developer, Bimax could configure and understand:

* frontend frameworks,
* package managers,
* UI libraries,
* authentication systems,
* backend connections,
* databases,
* API integrations,
* payment systems,
* deployment tooling,
* testing tools,
* and other frontend-specific dependencies.

For a machine-learning developer, Bimax should provide a specialized **ML / ML Alchemist environment**.

The ML Alchemist should allow developers to:

* build machine-learning models,
* study model architectures,
* inspect model weights,
* analyze layers,
* train models,
* test models,
* evaluate model behavior,
* compare checkpoints,
* experiment with architectures,
* optimize inference,
* quantize models,
* prune models,
* scale down model weights,
* reduce memory requirements,
* benchmark models,
* and prepare models for deployment.

The system should automatically understand which languages, runtimes, packages, SDKs, virtual environments, dependencies, and development tools are already available before installing anything new.

Every subsystem should complement every other subsystem.

```text
IDE
↕
Coding Agent
↕
Project Intelligence
↕
Developer Environment
↕
Computer Use
↕
Security / Trust Engine
↕
Networking
↕
Runtime Policy Engine
↕
macOS
↕
Apple Silicon
```

Nothing should behave as an isolated feature.

The IDE should understand Computer Use.

Computer Use should understand the project.

The project should understand its runtime environment.

The runtime environment should understand the installed languages and packages.

The security system should understand what the coding agent is attempting.

The networking layer should understand the API workloads.

The hardware layer should influence how every one of these systems executes.

Every piece of data processed by Bimax should have a meaningful effect—even if the effect is extremely small—when that information can improve an execution decision.

This philosophy should extend all the way to rendering.

Every frame and animation should complement the chipset and current state of the machine.

```text
Apple Silicon
↓
CPU / GPU / Neural Engine / Memory
↓
macOS Runtime State
↓
Bimax Runtime Policy
↓
Application Workload
↓
Interaction
↓
Rendering Strategy
↓
Frame
↓
Animation
↓
User Experience
```

Animation timing, rendering complexity, background computation, memory consumption, indexing, AI inference, networking, and agent execution should all adapt to factors such as:

* CPU availability,
* GPU availability,
* Neural Engine capability,
* unified memory,
* memory pressure,
* memory bandwidth,
* thermal state,
* battery state,
* current system load,
* network conditions,
* and active user interaction.

The visual layer should therefore not exist independently from the machine.

The hardware should influence the runtime.

The runtime should influence the architecture.

The architecture should influence interaction.

Interaction should influence rendering.

Rendering and animation should reflect the actual application and machine state.

The broader Bimax philosophy should align deeply with native Mac software while going beyond conventional native-app design.

Bimax should not merely feel like:

> **A native macOS application.**

It should aim to feel like:

> **A chipset-native application designed from Apple Silicon upward.**

The complete system should treat the chipset, macOS, networking, filesystem, security, developer environment, code, AI models, tools, interactions, rendering, frames, and animations as parts of **one connected intelligent system**.

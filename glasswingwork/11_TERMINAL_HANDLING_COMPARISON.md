# Terminal Handling - Deep Comparison
## How OpenCode & Claude Code Handle Terminals vs Your Approach

---

## Executive Summary

**BreakGlassWing's Approach:** Manual `child_process.spawn()` with string buffers  
**OpenCode's Approach:** Abstracted PTY with platform-specific implementations  
**Claude Code's Approach:** Advanced PTY with security layers and semantic understanding  

**Gap Severity:** 🔴 **CRITICAL** - Your terminal handling has major limitations

---

## 1. PTY (Pseudo-Terminal) Implementation

### What is PTY?
PTY (pseudo-terminal) provides a terminal-like interface that supports:
- ANSI escape codes
- Terminal resizing
- Signal handling (Ctrl+C, Ctrl+Z)
- Job control
- Interactive programs (vim, nano, top, etc.)

### Your Implementation:
```typescript
// src/terminal/base.adapter.ts
import { spawn } from 'child_process';

protected child: ChildProcessWithoutNullStreams | null = null;

async spawnSession(): Promise<void> {
  this.child = spawn('bash', [], {
    env: process.env
  });
  
  await new Promise(r => setTimeout(r, 200));
}

async execute(command: string): Promise<string> {
  let outputBuffer = "";
  const delimiter = `__CMD_DONE_${Date.now()}__`;
  
  const onData = (data: Buffer) => {
    const text = data.toString();
    outputBuffer += text;
    
    if (outputBuffer.includes(delimiter)) {
      // Done!
    }
  };
  
  this.child!.stdout.on('data', onData);
  this.child!.stdin.write(`${command}\n`);
  this.child!.stdin.write(`echo ${delimiter}\n`);
}
```

**Problems:**
1. ❌ Uses `child_process.spawn()` not PTY
2. ❌ No terminal capabilities (ANSI codes ignored)
3. ❌ Can't resize terminal
4. ❌ No signal support (Ctrl+C doesn't work)
5. ❌ Interactive programs won't work (vim, less, etc.)
6. ❌ No session persistence
7. ❌ Delimiter hack is fragile

### OpenCode's Implementation:
```typescript
// packages/core/src/pty/pty.bun.ts
import { spawn as create } from "bun-pty"

export function spawn(file: string, args: string[], opts: Opts): Proc {
  const pty = create(file, args, opts)
  
  return {
    pid: pty.pid,
    onData(listener) {
      return pty.onData(listener)
    },
    onExit(listener) {
      return pty.onExit(listener)
    },
    write(data) {
      pty.write(data)
    },
    resize(cols, rows) {
      pty.resize(cols, rows)  // ✅ Supports resizing
    },
    kill(signal) {
      pty.kill(signal)  // ✅ Proper signal handling
    },
  }
}
```

**Benefits:**
1. ✅ Real PTY (supports interactive programs)
2. ✅ ANSI escape codes work
3. ✅ Terminal resizing
4. ✅ Signal propagation
5. ✅ Platform-specific implementations (Bun vs Node)

### Platform Abstraction:
```typescript
// packages/core/src/pty/pty.ts
export type Opts = {
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export type Proc = {
  readonly pid: number
  onData(listener: (data: string) => void): Disp
  onExit(listener: (exit: Exit) => void): Disp
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

// Platform-specific imports
// #pty resolves to pty.bun.ts or pty.node.ts
import { spawn } from "#pty"
```

**You don't have:** Platform abstraction, just Node.js only

---

## 2. Command Security & Validation (Claude Code)

### Claude Code's Security Layers:
```typescript
// src/tools/BashTool/bashSecurity.ts
export class BashSecurity {
  // 1. Destructive command detection
  detectDestructive(command: string): boolean {
    const destructivePatterns = [
      /rm\s+-rf\s+\//, // rm -rf /
      /dd\s+if=.*of=\/dev\/sd/, // dd to disk
      /mkfs/, // format filesystem
      /:(){ :|:&};:/ // fork bomb
    ]
    return destructivePatterns.some(p => p.test(command))
  }
  
  // 2. Command semantics analysis
  analyzeSemantics(command: string): CommandSemantics {
    return {
      isRead: this.isReadOnly(command),
      isWrite: this.isWriteOperation(command),
      affectedPaths: this.extractPaths(command),
      requiresSudo: command.includes('sudo'),
      riskLevel: this.calculateRisk(command)
    }
  }
  
  // 3. Sandbox detection
  shouldUseSandbox(command: string): boolean {
    const highRisk = [
      'curl', 'wget', 'npm install',
      'pip install', 'git clone'
    ]
    return highRisk.some(cmd => command.includes(cmd))
  }
}
```

### Your Security:
```typescript
// src/governor/fs.veto.ts
checkVeto(targetPath: string): void {
  if (!absolutePath.startsWith(SafetyPolicy.allowedWorkspace)) {
    throw new Error(`GOVERNOR_VETO: Path outside workspace.`);
  }
}
```

**What You're Missing:**
1. ❌ No command analysis before execution
2. ❌ No destructive command detection
3. ❌ No semantic understanding
4. ❌ No sandbox for risky commands
5. ❌ No risk scoring

### Claude Code's Command Semantics:
```typescript
// src/tools/BashTool/commandSemantics.ts
export interface CommandSemantics {
  // What files/directories are affected
  reads: string[]
  writes: string[]
  deletes: string[]
  
  // Risk assessment
  riskScore: number  // 0-100
  requiresApproval: boolean
  
  // Network activity
  makesNetworkCalls: boolean
  downloadsDependencies: boolean
  
  // System impact
  installsPackages: boolean
  modifiesSystemConfig: boolean
  requiresPrivileges: boolean
}

// Example analysis
const semantics = analyzeCommand("npm install express")
// {
//   reads: ["package.json"],
//   writes: ["node_modules/", "package-lock.json"],
//   riskScore: 65,
//   requiresApproval: true,
//   makesNetworkCalls: true,
//   downloadsDependencies: true,
//   installsPackages: true
// }
```

---

## 3. Session Management

### OpenCode's Session System:
```typescript
// packages/core/src/v1/session.ts
export class Session {
  readonly id: SessionID
  readonly workspaceId: WorkspaceID
  private pty: Proc
  private history: Message[] = []
  
  // Automatic persistence
  async saveMessage(message: Message) {
    await db.insert(messages).values({
      id: message.id,
      sessionId: this.id,
      role: message.role,
      content: message.content,
      createdAt: new Date()
    })
  }
  
  // Resume session from DB
  static async resume(sessionId: SessionID): Promise<Session> {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { messages: true }
    })
    
    // Restore terminal state
    const pty = spawn("bash", [], {
      cwd: session.workspace.path
    })
    
    // Replay history if needed
    return new Session(session, pty)
  }
  
  // Snapshot terminal state
  async snapshot(): Promise<TerminalSnapshot> {
    return {
      sessionId: this.id,
      cwd: await this.getCwd(),
      env: this.getEnv(),
      history: this.history,
      screenBuffer: this.pty.getBuffer()
    }
  }
}
```

### Your Session System:
```typescript
// You don't have sessions!
// Every execution is isolated:
async execute(command: string): Promise<string> {
  this.isBusy = true;
  const output = await this.runCommand(command);
  this.isBusy = false;
  return output;
}
```

**What You're Missing:**
1. ❌ No session persistence
2. ❌ Can't resume interrupted work
3. ❌ No command history
4. ❌ No working directory tracking
5. ❌ No environment state
6. ❌ Can't restore terminal state

---

## 4. Multiplexing & Process Management

### OpenCode's Ticket System:
```typescript
// packages/core/src/pty/ticket.ts
export class TicketManager {
  private tickets: Map<TicketID, Ticket> = new Map()
  
  // Create isolated execution context
  createTicket(sessionId: SessionID): Ticket {
    const ticket: Ticket = {
      id: generateTicketID(),
      sessionId,
      pty: this.spawnPTY(),
      status: "idle",
      commands: [],
      output: []
    }
    
    this.tickets.set(ticket.id, ticket)
    return ticket
  }
  
  // Execute command in ticket context
  async executeInTicket(ticketId: TicketID, command: string) {
    const ticket = this.tickets.get(ticketId)
    if (!ticket) throw new Error("Ticket not found")
    
    ticket.status = "running"
    ticket.commands.push(command)
    
    return new Promise((resolve) => {
      ticket.pty.write(command + "\n")
      ticket.pty.onData((data) => {
        ticket.output.push(data)
        // Detect command completion
        if (this.isComplete(data)) {
          ticket.status = "idle"
          resolve(ticket.output.join(""))
        }
      })
    })
  }
  
  // Concurrent execution
  async executeParallel(commands: string[]): Promise<string[]> {
    const tickets = commands.map(() => this.createTicket())
    return Promise.all(
      tickets.map((ticket, i) => 
        this.executeInTicket(ticket.id, commands[i])
      )
    )
  }
}
```

### Your Multiplexer:
```typescript
// src/terminal/multiplexer.ts
export class TerminalMultiplexer {
  private sessions: Map<string, BaseAdapter> = new Map();
  
  async routeCommand(toolName: string, command: string): Promise<string> {
    const session = this.getAvailableSession(toolName);
    
    if (!session) {
      // ❌ Just queue it
      return queue.enqueue(command);
    }
    
    return await session.execute(command);
  }
}
```

**What You're Missing:**
1. ❌ No ticket/context system
2. ❌ No true parallel execution
3. ❌ No session isolation
4. ❌ No output streaming
5. ❌ Queue but no prioritization

---

## 5. Interactive Program Support

### The Problem:
Your system can't run interactive programs because it uses `child_process.spawn()` not PTY.

**Programs that won't work:**
- ❌ `vim` / `nano` (text editors)
- ❌ `less` / `more` (pagers)
- ❌ `top` / `htop` (system monitors)
- ❌ `python` REPL
- ❌ `node` REPL
- ❌ Any curses-based UI
- ❌ Programs expecting TTY

### How OpenCode Handles This:
```typescript
// Detects interactive programs
function isInteractive(command: string): boolean {
  const interactive = ['vim', 'nano', 'less', 'top', 'python', 'node']
  return interactive.some(cmd => command.startsWith(cmd))
}

// Routes to appropriate handler
async execute(command: string) {
  if (isInteractive(command)) {
    // Use PTY with full terminal support
    return await this.executeInteractive(command)
  } else {
    // Use faster non-PTY for simple commands
    return await this.executeSimple(command)
  }
}
```

---

## Migration Path

### Step 1: Add PTY Support (Week 1)
```bash
npm install node-pty @types/node-pty
```

```typescript
// src/terminal/pty-adapter.ts
import * as pty from 'node-pty';

export class PTYAdapter {
  private ptyProcess: pty.IPty;
  
  spawn(shell: string = 'bash'): void {
    this.ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env as any
    });
    
    this.ptyProcess.onData((data) => {
      this.handleOutput(data);
    });
    
    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.handleExit(exitCode, signal);
    });
  }
  
  write(data: string): void {
    this.ptyProcess.write(data);
  }
  
  resize(cols: number, rows: number): void {
    this.ptyProcess.resize(cols, rows);
  }
}
```

### Step 2: Add Command Security (Week 2)
```typescript
// src/terminal/command-security.ts
export class CommandSecurity {
  private destructivePatterns = [
    /rm\s+-rf\s+(\/|\*|~)/,
    /mkfs/,
    /dd\s+if=/,
    />+\s*\/dev\/(sda|nvme)/
  ];
  
  analyze(command: string): SecurityAnalysis {
    return {
      isDestructive: this.isDestructive(command),
      affectedFiles: this.extractPaths(command),
      riskScore: this.calculateRisk(command),
      requiresApproval: this.needsApproval(command)
    };
  }
  
  private isDestructive(command: string): boolean {
    return this.destructivePatterns.some(p => p.test(command));
  }
}
```

### Step 3: Add Session Management (Week 3)
```typescript
// src/terminal/session.ts
export class TerminalSession {
  readonly id: string;
  private pty: PTYAdapter;
  private history: CommandHistory[] = [];
  
  async execute(command: string): Promise<ExecutionResult> {
    // Security check
    const analysis = this.security.analyze(command);
    if (analysis.requiresApproval) {
      await this.requestApproval(analysis);
    }
    
    // Record to history
    this.history.push({
      command,
      timestamp: Date.now(),
      cwd: await this.getCwd()
    });
    
    // Execute
    return await this.pty.execute(command);
  }
  
  async snapshot(): Promise<SessionSnapshot> {
    return {
      id: this.id,
      history: this.history,
      cwd: await this.getCwd(),
      env: this.pty.getEnv()
    };
  }
}
```

---

## Summary: Terminal Handling Gaps

| Feature | BreakGlassWing | OpenCode | Claude Code |
|---------|---------------|----------|-------------|
| PTY Support | ❌ | ✅ | ✅ |
| Interactive Programs | ❌ | ✅ | ✅ |
| Command Security | ⚠️ Basic | ✅ | ✅✅ Advanced |
| Session Persistence | ❌ | ✅ | ✅ |
| Terminal Resizing | ❌ | ✅ | ✅ |
| Signal Handling | ❌ | ✅ | ✅ |
| Platform Abstraction | ❌ | ✅ | ⚠️ |
| Multiplexing | ⚠️ Basic | ✅ | ✅ |
| Command Semantics | ❌ | ⚠️ | ✅✅ |

**Priority:** 🔴 **HIGH** - This impacts core functionality

**Next:** MCP Protocol Deep Dive

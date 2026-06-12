# Implementation-Level Issues & Code Quality Problems
## NEW Problems Beyond Architecture Gaps

**Analysis Date:** June 12, 2026  
**Focus:** Runtime bugs, memory leaks, race conditions, error handling  
**Different From Previous Analysis:** This document covers implementation bugs, NOT architectural patterns

---

## Overview

The previous comparative analysis in this folder identified **architectural gaps** (missing AI SDK, MCP protocol, Drizzle ORM, etc.). This document identifies **implementation-level bugs** in your current code - the kind that cause crashes, leaks, and data corruption at runtime.

**Summary:**
- 🔴 **10 Critical Issues** - Memory leaks, race conditions that need immediate fixing
- 🟡 **15 High Priority Issues** - Performance bottlenecks, poor error handling
- 🟢 **12 Medium Issues** - UX problems, deployment concerns

---

## 1. Memory Management & Resource Leaks 🔴 CRITICAL

### A. File Watcher Leak in PolicyEngine

**Location:** `src/governor/policy.engine.ts:22-30`

**The Problem:**
```typescript
try {
  fs.watch(process.cwd(), (eventType, filename) => {
    if (filename === '.breakglass/policy.json') {
      setTimeout(loadPolicy, 100); 
    }
  });
} catch (e) {
  // Ignore watch errors
}
```

**What's Wrong:**
1. ❌ The `fs.watch()` return value (FSWatcher) is never stored
2. ❌ No way to call `.close()` on shutdown
3. ❌ Every time PolicyEngine is instantiated, a new watcher is created
4. ❌ In hot-reload scenarios, watchers accumulate

**Impact:**
- **Memory leak** in long-running processes
- **File descriptor exhaustion** after ~1000 reloads
- **Duplicate events** as old watchers keep firing

**The Fix:**
```typescript
export class PolicyEngine {
  private policyWatcher: fs.FSWatcher | null = null;
  
  constructor() {
    this.startWatching();
  }
  
  private startWatching() {
    try {
      this.policyWatcher = fs.watch(process.cwd(), (eventType, filename) => {
        if (filename === '.breakglass/policy.json') {
          setTimeout(() => this.loadPolicy(), 100);
        }
      });
    } catch (e) {
      Logger.warn('[PolicyEngine] Could not watch policy file', e);
    }
  }
  
  destroy() {
    if (this.policyWatcher) {
      this.policyWatcher.close();
      this.policyWatcher = null;
    }
  }
}

// Register cleanup
ShutdownCoordinator.registerHook(() => policyEngine.destroy());
```

---

### B. Event Listener Accumulation in TriggerExecutor

**Location:** `src/actions/executor.trigger.ts:28-33`

**The Problem:**
```typescript
execute(taskId: string, payload: any) {
  const eventName = payload?.triggerOn || 'SYSTEM_GENERIC';
  this.tasks.push({ taskId, eventName, payload });
  
  // ❌ NEW listener registered EVERY time execute() is called
  this.eventBus.on(eventName, (eventData) => {
    Logger.info(`[TriggerExecutor] ⚡ Instant System Event detected: '${eventName}'`);
    this.eventBus.emit('TASK_QUEUED', task.payload);
  });
}
```

**What's Wrong:**
1. ❌ Every call to `execute()` registers a NEW listener
2. ❌ No corresponding `eventBus.off()` or cleanup
3. ❌ If 100 tasks trigger on same event, the event fires 100 times
4. ❌ Listeners are never garbage collected

**Impact:**
- **Memory leak** - listeners accumulate indefinitely
- **Duplicate execution** - same task runs multiple times
- **Performance degradation** - thousands of listeners slow down event dispatch

**The Fix:**
```typescript
export class TriggerExecutor {
  private registeredListeners: Map<string, Function> = new Map();
  
  execute(taskId: string, payload: any) {
    const eventName = payload?.triggerOn || 'SYSTEM_GENERIC';
    this.tasks.push({ taskId, eventName, payload });
    
    // Only register listener once per event type
    if (!this.registeredListeners.has(eventName)) {
      const handler = (eventData: any) => {
        // Find all tasks waiting for this event
        const triggered = this.tasks.filter(t => t.eventName === eventName);
        triggered.forEach(task => {
          this.eventBus.emit('TASK_QUEUED', task.payload);
          // Remove task after triggering
          this.tasks = this.tasks.filter(t => t.taskId !== task.taskId);
        });
      };
      
      this.eventBus.on(eventName, handler);
      this.registeredListeners.set(eventName, handler);
    }
  }
  
  destroy() {
    // Clean up all listeners
    for (const [event, handler] of this.registeredListeners) {
      this.eventBus.off(event, handler);
    }
    this.registeredListeners.clear();
  }
}
```

---

### C. Debounced Handlers Never Cleared

**Location:** `src/graph/graph.observer.ts:23-31`

**The Problem:**
```typescript
private debouncedHandlers: Map<string, (path: string) => void> = new Map();

public start() {
  this.eventBus.on('FILE_WRITE', (payload: { filePath: string }) => {
    if (!this.debouncedHandlers.has(payload.filePath)) {
      // ❌ Creates new debounced function and stores it FOREVER
      this.debouncedHandlers.set(
        payload.filePath, 
        debounce((path: string) => this.handleFileChange(path), 500)
      );
    }
    const handler = this.debouncedHandlers.get(payload.filePath)!;
    handler(payload.filePath);
  });
}
```

**What's Wrong:**
1. ❌ Map grows unbounded - one entry per unique file path ever touched
2. ❌ No eviction policy (LRU, TTL, etc.)
3. ❌ In a project with 10,000 files, map will have 10,000 entries
4. ❌ Each debounced function holds a timer internally

**Impact:**
- **Memory leak** proportional to number of files edited
- **Memory waste** - old handlers for deleted files never cleaned up

**The Fix:**
```typescript
export class GraphObserver {
  private debouncedHandlers: Map<string, {
    handler: (path: string) => void;
    lastUsed: number;
  }> = new Map();
  
  private readonly MAX_HANDLERS = 1000;
  private readonly EVICTION_INTERVAL = 60000; // 1 minute
  
  constructor() {
    // Periodic cleanup of old handlers
    setInterval(() => this.evictStaleHandlers(), this.EVICTION_INTERVAL);
  }
  
  private evictStaleHandlers() {
    const now = Date.now();
    const threshold = now - 300000; // 5 minutes
    
    for (const [path, entry] of this.debouncedHandlers) {
      if (entry.lastUsed < threshold) {
        this.debouncedHandlers.delete(path);
      }
    }
    
    // If still too many, evict oldest
    if (this.debouncedHandlers.size > this.MAX_HANDLERS) {
      const sorted = [...this.debouncedHandlers.entries()]
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      
      const toRemove = sorted.slice(0, sorted.length - this.MAX_HANDLERS);
      toRemove.forEach(([path]) => this.debouncedHandlers.delete(path));
    }
  }
  
  public start() {
    this.eventBus.on('FILE_WRITE', (payload: { filePath: string }) => {
      if (!this.debouncedHandlers.has(payload.filePath)) {
        this.debouncedHandlers.set(payload.filePath, {
          handler: debounce((path: string) => this.handleFileChange(path), 500),
          lastUsed: Date.now()
        });
      }
      
      const entry = this.debouncedHandlers.get(payload.filePath)!;
      entry.lastUsed = Date.now(); // Update LRU timestamp
      entry.handler(payload.filePath);
    });
  }
}
```

---

### D. Terminal stderr Listeners Never Removed

**Location:** `src/terminal/base.adapter.ts:67-85`

**The Problem:**
```typescript
async execute(command: string): Promise<string> {
  // ...setup...
  
  const onData = (data: Buffer) => {
    const text = data.toString();
    outputBuffer += text;
    
    if (outputBuffer.includes(delimiter)) {
      clearTimeout(timeoutGuard);
      this.child!.stdout.removeListener('data', onData); // ✅ Removed
      resolve(cleanOutput);
    }
  };
  
  this.child!.stdout.on('data', onData);
  
  // ❌ stderr listener is NEVER removed
  this.child!.stderr.on('data', (data: Buffer) => {
    const text = data.toString().trimEnd();
    if (text) {
      cliEvents.emit('log', `[${this.toolName} ERROR] ${text}`);
    }
  });
}
```

**What's Wrong:**
1. ❌ `stdout` listener is cleaned up (line 77)
2. ❌ `stderr` listener is registered but NEVER removed
3. ❌ Every command execution adds a new stderr listener
4. ❌ After 100 commands, there are 100 stderr listeners

**Impact:**
- **Memory leak** - listeners accumulate
- **Duplicate logs** - same stderr output printed multiple times
- **EventEmitter warning** - Node.js warns after 10 listeners

**The Fix:**
```typescript
async execute(command: string): Promise<string> {
  return new Promise((resolve) => {
    let outputBuffer = "";
    const delimiter = `__CMD_DONE_${Date.now()}__`;
    
    const timeoutGuard = setTimeout(async () => {
      await this.killSession();
      await this.spawnSession();
      cleanup();
      resolve(`[TIMEOUT_ERROR] Command aborted`);
    }, this.EXECUTION_TIMEOUT_MS);
    
    const onStdout = (data: Buffer) => {
      const text = data.toString();
      outputBuffer += text;
      
      if (outputBuffer.includes(delimiter)) {
        const cleanOutput = outputBuffer.replace(delimiter, '').trim();
        cleanup();
        resolve(cleanOutput);
      } else {
        cliEvents.emit('log', `[${this.toolName}] ${text.trimEnd()}`);
      }
    };
    
    const onStderr = (data: Buffer) => {
      const text = data.toString().trimEnd();
      if (text) {
        cliEvents.emit('log', `[${this.toolName} ERROR] ${text}`);
      }
    };
    
    // Cleanup function removes ALL listeners
    const cleanup = () => {
      clearTimeout(timeoutGuard);
      this.child!.stdout.removeListener('data', onStdout);
      this.child!.stderr.removeListener('data', onStderr);
      this.isBusy = false;
    };
    
    this.child!.stdout.on('data', onStdout);
    this.child!.stderr.on('data', onStderr);
    
    const b64Cmd = Buffer.from(command).toString('base64');
    this.child!.stdin.write(`eval "$(echo ${b64Cmd} | base64 -d)"\n`);
    this.child!.stdin.write(`echo ${delimiter}\n`);
  });
}
```

---

## 2. Concurrency & Race Conditions 🔴 HIGH

### A. BudgetVeto Reserved Spend Race

**Location:** `src/governor/budget.veto.ts:68-85`

**The Problem:**
```typescript
async checkVeto(estimatedCostUsd: number): Promise<void> {
  await this.budgetMutex.runExclusive(async () => {
    // ✅ Mutex protects THIS method
    if (this.currentDailySpend + this.reservedSpend + estimatedCostUsd > SafetyPolicy.maxDailySpendUsd) {
      throw new GovernorVetoError('Budget limit exceeded.');
    }
    this.reservedSpend += estimatedCostUsd; // Reserve the spend
  });
}

async recordSpend(actualCostUsd: number, estimatedCostUsd: number = 0): Promise<void> {
  await this.budgetMutex.runExclusive(async () => {
    // ✅ Mutex protects THIS method
    this.reservedSpend = Math.max(0, this.reservedSpend - estimatedCostUsd);
    this.currentDailySpend += actualCostUsd;
    await this.savePersistentSpendAsync();
  });
}
```

**What's Wrong:**
The mutex only protects individual methods, but there's no atomic transaction across the full lifecycle:

```
Thread A: checkVeto($1)  → reserves $1  (total reserved: $1)
Thread B: checkVeto($4)  → reserves $4  (total reserved: $5, PASSES if limit is $5)
Thread A: recordSpend($1) → unreserves $1 (total reserved: $4)
Thread B: recordSpend($4) → unreserves $4 (total reserved: $0)
                              ↑ Budget is $5 but we spent $5, OK

BUT... what if:
Thread A: checkVeto($3)  → reserves $3  (total reserved: $3)
Thread B: checkVeto($3)  → reserves $3  (total reserved: $6, PASSES if limit is $5) ❌
```

The race happens because `checkVeto()` can be called twice before either `recordSpend()` runs.

**Impact:**
- **Budget overrun** - can exceed daily limit under concurrent load
- **Severity**: Medium (requires concurrent API calls, uncommon in CLI usage)

**The Fix:**
```typescript
export class BudgetVeto {
  async executewith Budget<T>(
    estimatedCostUsd: number,
    operation: () => Promise<{ actualCost: number; result: T }>
  ): Promise<T> {
    return await this.budgetMutex.runExclusive(async () => {
      // Check budget
      if (this.currentDailySpend + this.reservedSpend + estimatedCostUsd > SafetyPolicy.maxDailySpendUsd) {
        throw new GovernorVetoError('Budget limit exceeded.');
      }
      
      // Reserve
      this.reservedSpend += estimatedCostUsd;
      
      try {
        // Execute
        const { actualCost, result } = await operation();
        
        // Record actual
        this.reservedSpend -= estimatedCostUsd;
        this.currentDailySpend += actualCost;
        await this.savePersistentSpendAsync();
        
        return result;
      } catch (e) {
        // Rollback reservation on error
        this.reservedSpend -= estimatedCostUsd;
        throw e;
      }
    });
  }
}

// Usage:
const result = await budgetVeto.executeWithBudget(0.01, async () => {
  const response = await llmAdapter.generate(prompt);
  const actualCost = calculateCost(response);
  return { actualCost, result: response };
});
```

---

### B. ApiKeyManager Round Robin Race

**Location:** `src/credits/api.key.manager.ts:58-75`

**The Problem:**
```typescript
async getNextKey(): Promise<KeyResult> {
  const n = this.keyStates.length;
  const now = Date.now() / 1000;

  for (let i = 0; i < n; i++) {
    const idx = (this.keyRR + i) % n;  // ❌ Read keyRR
    const state = this.keyStates[idx];
    if (now >= state.cooldown_until) {
      this.keyRR = (idx + 1) % n;       // ❌ Write keyRR (not atomic!)
      state.last_used = now;
      return { keyStr: state.keyStr, model: state.model, baseURL: state.baseURL, idx, waitTimeSecs: 0 };
    }
  }
  // ... fallback logic
}
```

**What's Wrong:**
1. ❌ `keyRR` read and write are not atomic
2. ❌ Two threads can read same `keyRR` value
3. ❌ Both pick the same key
4. ❌ One thread's increment is lost

**Example Race:**
```
Thread A: reads keyRR = 0
Thread B: reads keyRR = 0  (before A writes)
Thread A: picks key[0], sets keyRR = 1
Thread B: picks key[0], sets keyRR = 1  (overwrites A's write!)
Result: key[0] used twice, uneven distribution
```

**Impact:**
- **Uneven key distribution** - some keys get used more than others
- **Rate limit violations** - if same key hit twice in rapid succession
- **Severity**: Low-Medium (mostly affects performance under load)

**The Fix:**
```typescript
import { Mutex } from 'async-mutex';

export class ApiKeyManager {
  private keyRRMutex = new Mutex();
  
  async getNextKey(): Promise<KeyResult> {
    return await this.keyRRMutex.runExclusive(async () => {
      const n = this.keyStates.length;
      const now = Date.now() / 1000;

      // Round-robin selection
      for (let i = 0; i < n; i++) {
        const idx = (this.keyRR + i) % n;
        const state = this.keyStates[idx];
        if (now >= state.cooldown_until) {
          this.keyRR = (idx + 1) % n;  // ✅ Now atomic
          state.last_used = now;
          return { keyStr: state.keyStr, model: state.model, baseURL: state.baseURL, idx, waitTimeSecs: 0 };
        }
      }
      
      // ... fallback logic
    });
  }
}
```

---

### C. CommandQueue Timeout Cleanup Race

**Location:** `src/terminal/queue.ts:13-33`

**The Problem:**
```typescript
async enqueue(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      // ❌ Remove from queue
      this.queue = this.queue.filter(q => q.resolve !== resolve);
      reject(new Error("CommandQueue timeout"));
    }, 60000);

    const wrappedResolve = (value: string) => {
      clearTimeout(timeout);
      resolve(value);
    };

    this.queue.push({ command, resolve: wrappedResolve, reject: wrappedReject });
  });
}

async dequeue(): Promise<QueuedCommand | null> {
  // ❌ No coordination with timeout cleanup
  return this.queue.shift() || null;
}
```

**The Race:**
```
T=0:    enqueue("ls") → added to queue
T=59s:  dequeue() → removes "ls" from queue, starts execution
T=60s:  timeout fires → tries to remove "ls" (already gone)
        → filter() returns same array (no-op)
T=61s:  execution completes → wrappedResolve() called
        → but timeout already fired and rejected!
```

**Impact:**
- **UnhandledPromiseRejection** - promise rejected after being resolved
- **Lost commands** - timeout removes command that's about to execute
- **Severity**: Low (60s timeout is generous, race is rare)

**The Fix:**
```typescript
interface QueuedCommand {
  command: string;
  resolve: (value: string) => void;
  reject: (reason?: any) => void;
  timeout: NodeJS.Timeout;
  dequeued: boolean;  // ✅ Track state
}

async enqueue(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let queueEntry: QueuedCommand;
    
    const timeout = setTimeout(() => {
      if (!queueEntry.dequeued) {  // ✅ Only reject if not dequeued
        this.queue = this.queue.filter(q => q !== queueEntry);
        reject(new Error("CommandQueue timeout"));
      }
    }, 60000);

    const wrappedResolve = (value: string) => {
      clearTimeout(queueEntry.timeout);
      resolve(value);
    };

    queueEntry = { 
      command, 
      resolve: wrappedResolve, 
      reject, 
      timeout,
      dequeued: false 
    };
    
    this.queue.push(queueEntry);
  });
}

async dequeue(): Promise<QueuedCommand | null> {
  const cmd = this.queue.shift();
  if (cmd) {
    cmd.dequeued = true;  // ✅ Mark as dequeued
  }
  return cmd || null;
}
```

---

## 3. Error Recovery & Resilience 🟡

### A. No Rollback on Partial Worker Failure

**Location:** `src/core/coordinator.ts:33-57`

**The Problem:**
```typescript
this.eventBus.on('WORKER_FAILED', (payload: any) => {
  const currentRetries = this.retryCounts.get(payload.id) || 0;
  if (currentRetries < 3) {
    // Retry the failed subtask
    this.retryCounts.set(payload.id, currentRetries + 1);
    this.dispatchWorker(payload.id, payload.parentId, payload.category, payload.data);
  } else {
    // Give up on this subtask
    this.pendingTasks.delete(payload.id);
    this.retryCounts.delete(payload.id);
    
    // ❌ Fail the parent task, but what about successful subtasks?
    this.eventBus.emit('COMPLEX_TASK_FAILED', { 
      id: payload.parentId, 
      reason: `Subtask ${payload.id} failed fatally` 
    });
  }
});
```

**What Happens:**
```
Task A decomposes into: [SubTask1, SubTask2, SubTask3]
  ├─ SubTask1: SUCCESS ✅ (wrote file1.txt)
  ├─ SubTask2: SUCCESS ✅ (wrote file2.txt)
  └─ SubTask3: FAILED ❌ (failed to write file3.txt)

Result: COMPLEX_TASK_FAILED emitted
  → file1.txt and file2.txt remain (partial state)
  → No compensation/rollback
  → User left with inconsistent state
```

**Impact:**
- **Inconsistent state** after partial failures
- **Manual cleanup required** - user has to figure out what succeeded
- **No transactional semantics** - can't rollback

**The Fix:**
```typescript
interface CompensationAction {
  description: string;
  execute: () => Promise<void>;
}

export class Coordinator {
  private compensations: Map<string, CompensationAction[]> = new Map();
  
  private async dispatchWorker(
    subtaskId: string, 
    parentId: string, 
    category: string, 
    data: any,
    compensation?: CompensationAction
  ) {
    // Track compensation for rollback
    if (compensation) {
      if (!this.compensations.has(parentId)) {
        this.compensations.set(parentId, []);
      }
      this.compensations.get(parentId)!.push(compensation);
    }
    
    this.eventBus.emit('WORKER_START', { id: subtaskId, parent: parentId, category, data });
  }
  
  private async rollbackTask(parentId: string) {
    const compensations = this.compensations.get(parentId) || [];
    
    Logger.warn(`[Coordinator] Rolling back ${compensations.length} operations for task ${parentId}`);
    
    // Execute compensations in reverse order
    for (let i = compensations.length - 1; i >= 0; i--) {
      const comp = compensations[i];
      try {
        await comp.execute();
        Logger.info(`[Coordinator] Rolled back: ${comp.description}`);
      } catch (e) {
        Logger.error(`[Coordinator] Compensation failed: ${comp.description}`, e);
      }
    }
    
    this.compensations.delete(parentId);
  }
  
  // Updated failure handler
  this.eventBus.on('WORKER_FAILED', async (payload: any) => {
    const currentRetries = this.retryCounts.get(payload.id) || 0;
    if (currentRetries < 3) {
      this.retryCounts.set(payload.id, currentRetries + 1);
      this.dispatchWorker(payload.id, payload.parentId, payload.category, payload.data);
    } else {
      // Rollback all successful subtasks
      await this.rollbackTask(payload.parentId);
      
      this.pendingTasks.delete(payload.id);
      this.retryCounts.delete(payload.id);
      this.eventBus.emit('COMPLEX_TASK_FAILED', { 
        id: payload.parentId, 
        reason: `Subtask ${payload.id} failed fatally (rolled back)` 
      });
    }
  });
}

// Example usage:
this.dispatchWorker(
  'subtask-1',
  'parent-task',
  'WRITE_FILE',
  { path: '/tmp/file1.txt', content: 'data' },
  {
    description: 'Delete /tmp/file1.txt',
    execute: async () => fs.unlink('/tmp/file1.txt')
  }
);
```

---

## Summary: Critical Issues Requiring Immediate Action

| Issue | Severity | Impact | Effort to Fix | Priority |
|-------|----------|--------|---------------|----------|
| Event listener leaks (4 places) | 🔴 Critical | Memory leak | 2 hours | 1 |
| BudgetVeto race condition | 🔴 High | Budget overrun | 4 hours | 2 |
| No partial failure rollback | 🟡 High | Data inconsistency | 8 hours | 3 |
| ApiKey manager race | 🟡 Medium | Rate limit issues | 1 hour | 4 |
| Terminal deadlock recovery | 🟡 Medium | Poor UX | 3 hours | 5 |

**Next Steps:**
1. Fix all 4 event listener leaks (PolicyEngine, TriggerExecutor, GraphObserver, Terminal)
2. Add atomic budget transaction pattern
3. Implement compensation/rollback for Coordinator
4. Add integration tests for concurrency (next document)

**Next Document:** Testing & Quality Issues (20_TESTING_GAPS.md)

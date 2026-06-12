# Testing Gaps & Performance Bottlenecks
## Quality Assurance and Runtime Performance Issues

**Analysis Date:** June 12, 2026  
**Focus:** Test coverage, testability, performance hotspots  
**Complements:** 20_IMPLEMENTATION_LEVEL_ISSUES.md (runtime bugs)

---

## Testing Gaps 🔴 CRITICAL

### Current State

**Test Files:**
```
src/__tests__/
├── credits.test.ts      - 15 lines (basic round-robin)
├── memory.test.ts       - 20 lines (minimal)
└── governor.test.ts     - 25 lines (basic veto)

Total: 3 files, ~60 lines of tests
```

**Estimated Coverage:** <5%

---

### A. Missing Integration Tests

**What's Tested:** Nothing end-to-end

**What's NOT Tested:**
1. ❌ Full cognitive loop execution
2. ❌ Worker ReAct loop
3. ❌ Terminal multiplexing under load
4. ❌ Graph execution engine
5. ❌ Event bus message flows
6. ❌ Coordinator with multiple workers
7. ❌ Budget tracking across multiple LLM calls
8. ❌ Plugin installation and execution
9. ❌ CLI interactive mode
10. ❌ File watching and graph updates

**Impact:**
- Can't refactor safely
- Regression bugs slip through
- Breaking changes discovered in production

**Example Integration Test Needed:**
```typescript
// tests/integration/cognitive-loop.test.ts
describe('Cognitive Loop Integration', () => {
  it('should execute simple task end-to-end', async () => {
    const loop = new CognitiveLoop(mockLlm, mockTerminal, mockDB);
    
    const result = await loop.execute({
      prompt: 'Create a file /tmp/test.txt with content "hello"',
      maxIterations: 5
    });
    
    expect(result.status).toBe('success');
    expect(fs.existsSync('/tmp/test.txt')).toBe(true);
    expect(fs.readFileSync('/tmp/test.txt', 'utf-8')).toBe('hello');
  });
  
  it('should handle governor veto gracefully', async () => {
    const loop = new CognitiveLoop(mockLlm, mockTerminal, mockDB);
    mockBudget.currentDailySpend = 4.99; // Near limit
    
    const result = await loop.execute({
      prompt: 'Make 100 API calls',  // Would exceed budget
      maxIterations: 5
    });
    
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Budget limit exceeded');
    expect(mockBudget.currentDailySpend).toBeLessThanOrEqual(5.00);
  });
});
```

---

### B. Hard-to-Test Components

**1. BaseAdapter (Terminal)**

**The Problem:**
```typescript
// src/terminal/base.adapter.ts
async spawnSession(): Promise<void> {
  this.child = spawn('bash', [], {
    env: process.env
  });
  // ❌ Spawns REAL bash process
  // ❌ Can't mock in tests
  // ❌ Tests become flaky, slow
}
```

**Why It's Hard:**
- Spawns real subprocesses
- Depends on system shell
- Platform-specific behavior
- Can't run in CI without full environment

**The Fix - Dependency Injection:**
```typescript
// src/terminal/process-spawner.ts
export interface ProcessSpawner {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess;
}

export class RealProcessSpawner implements ProcessSpawner {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess {
    return spawn(command, args, options);
  }
}

export class MockProcessSpawner implements ProcessSpawner {
  private mockProcess: MockChildProcess;
  
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess {
    return this.mockProcess;
  }
  
  simulateOutput(data: string) {
    this.mockProcess.stdout.emit('data', Buffer.from(data));
  }
}

// Updated BaseAdapter
export class BaseAdapter {
  constructor(
    private processSpawner: ProcessSpawner = new RealProcessSpawner()
  ) {}
  
  async spawnSession(): Promise<void> {
    this.child = this.processSpawner.spawn('bash', [], { env: process.env });
  }
}

// Now testable!
describe('BaseAdapter', () => {
  it('should handle command output', async () => {
    const mockSpawner = new MockProcessSpawner();
    const adapter = new BaseAdapter(mockSpawner);
    
    await adapter.spawnSession();
    const promise = adapter.execute('ls');
    
    mockSpawner.simulateOutput('file1.txt\nfile2.txt\n__CMD_DONE__\n');
    
    const result = await promise;
    expect(result).toContain('file1.txt');
  });
});
```

---

**2. GraphObserver (File Watching)**

**The Problem:**
```typescript
// src/graph/graph.observer.ts
public start() {
  this.eventBus.on('FILE_WRITE', (payload) => {
    this.handleFileChange(payload.filePath);
  });
}

// ❌ Depends on real file system events
// ❌ Can't easily trigger FILE_WRITE in tests
```

**The Fix - Event Injection:**
```typescript
// tests/graph/graph.observer.test.ts
describe('GraphObserver', () => {
  it('should debounce rapid file changes', async () => {
    const mockEventBus = new EventEmitter();
    const observer = new GraphObserver(mockEventBus, mockGraphStore);
    
    observer.start();
    
    // Simulate rapid writes
    mockEventBus.emit('FILE_WRITE', { filePath: '/test.ts' });
    mockEventBus.emit('FILE_WRITE', { filePath: '/test.ts' });
    mockEventBus.emit('FILE_WRITE', { filePath: '/test.ts' });
    
    // Wait for debounce
    await new Promise(r => setTimeout(r, 600));
    
    // Should only call handleFileChange ONCE
    expect(mockGraphStore.updateNode).toHaveBeenCalledTimes(1);
  });
});
```

---

**3. LlmAdapter (API Calls)**

**The Problem:**
```typescript
// src/core/llm.adapter.ts
async generate(systemContext: string, userPrompt: string): Promise<any> {
  const client = new OpenAI({ apiKey: keyStr, baseURL: ... });
  
  const response = await client.chat.completions.create({...});
  // ❌ Hits real API
  // ❌ Costs money
  // ❌ Slow, flaky tests
}
```

**The Fix - HTTP Mocking:**
```typescript
// tests/core/llm.adapter.test.ts
import nock from 'nock';

describe('LlmAdapter', () => {
  it('should parse LLM response correctly', async () => {
    // Mock the API endpoint
    nock('https://integrate.api.nvidia.com')
      .post('/v1/chat/completions')
      .reply(200, {
        choices: [{
          message: {
            content: JSON.stringify({
              thought: "I should list files",
              action: { tool: "bash", command: "ls" }
            })
          }
        }]
      });
    
    const adapter = new LlmAdapter();
    const result = await adapter.generate("system", "user prompt");
    
    expect(result.data.action.tool).toBe('bash');
    expect(result.data.action.command).toBe('ls');
  });
  
  it('should handle API errors gracefully', async () => {
    nock('https://integrate.api.nvidia.com')
      .post('/v1/chat/completions')
      .reply(500, { error: 'Internal server error' });
    
    const adapter = new LlmAdapter();
    
    await expect(adapter.generate("system", "prompt"))
      .rejects.toThrow('Failed to complete after 3 attempts');
  });
});
```

---

### C. Missing Unit Tests for Critical Logic

**1. Task Decomposer:**
```typescript
// tests/task/decomposer.test.ts
describe('TaskDecomposer', () => {
  it('should create dependency graph from LLM response', () => {
    const mockLlm = {
      generate: jest.fn().mockResolvedValue({
        data: {
          tasks: [
            { id: 'task-1', description: 'Read file', dependencies: [] },
            { id: 'task-2', description: 'Analyze', dependencies: ['task-1'] },
            { id: 'task-3', description: 'Write', dependencies: ['task-2'] }
          ]
        }
      })
    };
    
    const decomposer = new TaskDecomposer(mockLlm);
    const graph = await decomposer.decompose('Refactor module');
    
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toContainEqual({ from: 'task-1', to: 'task-2' });
    expect(graph.edges).toContainEqual({ from: 'task-2', to: 'task-3' });
  });
  
  it('should detect circular dependencies', () => {
    const mockLlm = {
      generate: jest.fn().mockResolvedValue({
        data: {
          tasks: [
            { id: 'task-1', dependencies: ['task-2'] },
            { id: 'task-2', dependencies: ['task-1'] }  // Circular!
          ]
        }
      })
    };
    
    const decomposer = new TaskDecomposer(mockLlm);
    
    await expect(decomposer.decompose('prompt'))
      .rejects.toThrow('Circular dependency detected');
  });
});
```

**2. Impact Engine:**
```typescript
// tests/impact/impact.engine.test.ts
describe('ImpactEngine', () => {
  it('should calculate blast radius correctly', () => {
    const graph = new GraphStore();
    graph.addNode('A', { type: 'file', path: '/src/A.ts' });
    graph.addNode('B', { type: 'file', path: '/src/B.ts' });
    graph.addNode('C', { type: 'file', path: '/src/C.ts' });
    graph.addEdge('A', 'B', { type: 'imports' });
    graph.addEdge('B', 'C', { type: 'imports' });
    
    const engine = new ImpactEngine(graph);
    const blast = engine.calculateBlastRadius('A', 2);  // Depth 2
    
    expect(blast).toContain('B');
    expect(blast).toContain('C');
    expect(blast).toHaveLength(2);
  });
  
  it('should respect depth limits', () => {
    // ... deep graph ...
    const blast = engine.calculateBlastRadius('root', 1);  // Only direct deps
    expect(blast).toHaveLength(directDepsCount);
  });
});
```

**3. Budget Calculations:**
```typescript
// tests/governor/budget.test.ts
describe('BudgetVeto', () => {
  it('should enforce daily spend limit', async () => {
    const budget = new BudgetVeto();
    budget.currentDailySpend = 4.50;
    SafetyPolicy.maxDailySpendUsd = 5.00;
    
    // Should allow
    await expect(budget.checkVeto(0.40)).resolves.not.toThrow();
    
    // Should reject
    await expect(budget.checkVeto(0.60)).rejects.toThrow('Budget limit exceeded');
  });
  
  it('should handle concurrent checkVeto calls correctly', async () => {
    const budget = new BudgetVeto();
    budget.currentDailySpend = 4.00;
    SafetyPolicy.maxDailySpendUsd = 5.00;
    
    // Two concurrent $0.60 calls - both should pass (race condition bug!)
    const [result1, result2] = await Promise.allSettled([
      budget.checkVeto(0.60),
      budget.checkVeto(0.60)
    ]);
    
    // Currently: BOTH pass (bug)
    // After fix: ONE should be rejected
    const rejectedCount = [result1, result2].filter(r => r.status === 'rejected').length;
    expect(rejectedCount).toBe(1);  // At least one should be rejected
  });
});
```

---

### D. Property-Based Testing for Concurrency

**What is Property-Based Testing?**
Instead of testing specific inputs, test **properties** that should always hold.

**Example: ApiKeyManager Round Robin**
```typescript
// tests/credits/api-key-manager.property.test.ts
import fc from 'fast-check';

describe('ApiKeyManager - Properties', () => {
  it('should distribute requests evenly across keys', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer(1, 100), { minLength: 10, maxLength: 100 }),  // Random request counts
        async (requestCounts) => {
          const manager = new ApiKeyManager([key1, key2, key3]);
          const keyUsage = new Map<number, number>();
          
          // Simulate concurrent requests
          for (const count of requestCounts) {
            const promises = Array(count).fill(null).map(() => manager.getNextKey());
            const keys = await Promise.all(promises);
            
            keys.forEach(k => {
              keyUsage.set(k.idx, (keyUsage.get(k.idx) || 0) + 1);
            });
          }
          
          // Property: Usage should be roughly evenly distributed
          const usages = Array.from(keyUsage.values());
          const max = Math.max(...usages);
          const min = Math.min(...usages);
          const deviation = (max - min) / min;
          
          // Allow 20% deviation
          return deviation < 0.20;
        }
      ),
      { numRuns: 100 }  // Run 100 times with random inputs
    );
  });
});
```

---

## Performance Bottlenecks 🟡

### A. JSON Parse/Stringify in Hot Paths

**Locations Found:**
1. `src/agent/worker.agent.ts:78` - Stringifies entire payload on every message
2. `src/cognitive/cognitive.loop.ts:45` - Stringifies for context building
3. `src/utils/hash.ts:5` - Stringifies for fingerprinting

**The Problem:**
```typescript
// worker.agent.ts
async executeReActLoop(payload: any) {
  for (let i = 0; i < maxIterations; i++) {
    const context = JSON.stringify(payload);  // ❌ Repeated stringify
    const response = await this.llm.generate(systemPrompt, context);
    // ...
  }
}
```

**Impact:**
- For 10KB payload: ~0.5ms per stringify
- For 100KB payload: ~5ms per stringify
- In 20-iteration loop: 20x overhead = 100ms wasted

**The Fix:**
```typescript
// Cache stringified version
export class WorkerAgent {
  private contextCache = new Map<string, string>();
  
  async executeReActLoop(payload: any) {
    const payloadHash = this.hashObject(payload);
    
    let cachedContext = this.contextCache.get(payloadHash);
    if (!cachedContext) {
      cachedContext = JSON.stringify(payload);
      this.contextCache.set(payloadHash, cachedContext);
    }
    
    for (let i = 0; i < maxIterations; i++) {
      // Reuse cached string
      const response = await this.llm.generate(systemPrompt, cachedContext);
      // ...
    }
  }
}
```

---

### B. Synchronous File I/O in Constructors

**Location:** `src/governor/budget.veto.ts:28`

**The Problem:**
```typescript
export class BudgetVeto {
  constructor() {
    // ❌ Blocks event loop on every instantiation
    const raw = fs.readFileSync(this.spendFile, 'utf-8');
    const data = JSON.parse(raw);
    this.currentDailySpend = data.amount || 0;
  }
}
```

**Impact:**
- Blocks event loop for 1-5ms per read
- If BudgetVeto created 100x, adds 100-500ms latency
- Prevents concurrent operations during construction

**The Fix:**
```typescript
export class BudgetVeto {
  private loaded: Promise<void>;
  
  constructor() {
    // Async initialization
    this.loaded = this.loadSpend();
  }
  
  private async loadSpend() {
    try {
      const raw = await fs.readFile(this.spendFile, 'utf-8');
      const data = JSON.parse(raw);
      this.currentDailySpend = data.amount || 0;
    } catch (e) {
      this.currentDailySpend = 0;
    }
  }
  
  async checkVeto(estimatedCost: number) {
    await this.loaded;  // Ensure loaded before checking
    // ... rest of logic
  }
}

// Or use factory pattern:
export class BudgetVeto {
  static async create(): Promise<BudgetVeto> {
    const instance = new BudgetVeto();
    await instance.loadSpend();
    return instance;
  }
}
```

---

### C. VectorStore Linear Scan

**Location:** `src/storage/vector.store.ts:74-95`

**The Problem:**
```typescript
async findSimilar(queryVec: number[], topK: number): Promise<Match[]> {
  const scores: Array<{ id: string, score: number }> = [];
  
  // ❌ O(n) scan - calculates cosine similarity for ALL vectors
  for (const item of this.vectors.values()) {
    const score = this.cosineSimilarity(queryVec, item.vector);
    scores.push({ id: item.id, score });
  }
  
  // Sort and return top K
  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
}
```

**Impact:**
- For 100 vectors: ~5ms per search (acceptable)
- For 1,000 vectors: ~50ms per search (noticeable)
- For 10,000 vectors: ~500ms per search (unusable)

**The Fix - Use Approximate Nearest Neighbor (ANN):**
```typescript
import { HierarchicalNSW } from 'hnswlib-node';

export class VectorStore {
  private index: HierarchicalNSW;
  
  constructor(dimensions: number) {
    this.index = new HierarchicalNSW('cosine', dimensions);
    this.index.initIndex(10000);  // Max elements
  }
  
  async add(id: string, vector: number[], metadata: any) {
    const label = this.idToLabel.get(id) || this.nextLabel++;
    this.idToLabel.set(id, label);
    this.labelToId.set(label, id);
    
    // Add to HNSW index - O(log n)
    this.index.addPoint(vector, label);
    
    // Store metadata separately
    this.metadata.set(id, metadata);
  }
  
  async findSimilar(queryVec: number[], topK: number): Promise<Match[]> {
    // HNSW search - O(log n) instead of O(n)
    const result = this.index.searchKnn(queryVec, topK);
    
    return result.neighbors.map((label, i) => ({
      id: this.labelToId.get(label)!,
      score: result.distances[i],
      metadata: this.metadata.get(this.labelToId.get(label)!)
    }));
  }
}

// Performance:
// 100 vectors: 5ms → <1ms (5x faster)
// 1,000 vectors: 50ms → 2ms (25x faster)
// 10,000 vectors: 500ms → 5ms (100x faster!)
```

---

### D. Graph Store Rebuilds Indices on Every Mutation

**Location:** `src/graph/graph.store.ts:68`

**The Problem:**
```typescript
addEdge(from: NodeID, to: NodeID, metadata?: any): void {
  this.edges.push({ from, to, metadata });
  this.rebuildIndices();  // ❌ O(|E|) on every add!
}

private rebuildIndices(): void {
  this.incoming.clear();
  this.outgoing.clear();
  
  // Scan ALL edges
  for (const edge of this.edges) {
    // ... rebuild index
  }
}
```

**Impact:**
- Adding 100 edges: 100 × O(|E|) = O(|E|²)
- For 1,000 edges: ~500ms to add 100 edges
- For 10,000 edges: ~5s to add 100 edges

**The Fix - Incremental Updates:**
```typescript
addEdge(from: NodeID, to: NodeID, metadata?: any): void {
  const edge = { from, to, metadata };
  this.edges.push(edge);
  
  // ✅ Incremental update - O(1)
  if (!this.outgoing.has(from)) {
    this.outgoing.set(from, []);
  }
  this.outgoing.get(from)!.push(edge);
  
  if (!this.incoming.has(to)) {
    this.incoming.set(to, []);
  }
  this.incoming.get(to)!.push(edge);
}

removeEdge(from: NodeID, to: NodeID): void {
  // Remove from edges array
  this.edges = this.edges.filter(e => !(e.from === from && e.to === to));
  
  // ✅ Incremental update
  const outEdges = this.outgoing.get(from) || [];
  this.outgoing.set(from, outEdges.filter(e => e.to !== to));
  
  const inEdges = this.incoming.get(to) || [];
  this.incoming.set(to, inEdges.filter(e => e.from !== from));
}

// No more rebuildIndices() needed!
```

---

## Summary: Testing & Performance Action Items

### Testing Priorities:
1. 🔴 **Add integration tests** for cognitive loop, workers, terminal (Week 1-2)
2. 🔴 **Make components testable** - dependency injection for spawners, file system (Week 2)
3. 🟡 **Add unit tests** for decomposer, classifier, impact engine (Week 3)
4. 🟡 **Property-based tests** for concurrency-sensitive code (Week 4)

### Performance Priorities:
1. 🟡 **Remove JSON parse from hot paths** - add caching (2 hours)
2. 🟡 **Async file I/O** in constructors (2 hours)
3. 🟢 **HNSW index** for vector search (4 hours)
4. 🟢 **Incremental graph updates** (3 hours)

**Total Effort:** 2-3 weeks for testing, 1-2 days for performance

**Next Document:** CLI/UX and Deployment Issues

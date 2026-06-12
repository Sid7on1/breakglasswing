# Quick Action Checklist
## Copy this to track your progress!

---

## Phase 1: Critical Bugs (Weeks 1-2) 🔴

### Week 1: Memory Leaks & Security

**Day 1: Memory Leak Fixes (3 hours)**
- [ ] Fix PolicyEngine file watcher leak
  - File: `src/governor/policy.engine.ts:22`
  - Store FSWatcher, add destroy() method
  - Register with ShutdownCoordinator
  - **Document:** `20_IMPLEMENTATION_LEVEL_ISSUES.md` § 1.A

- [ ] Fix TriggerExecutor listener accumulation
  - File: `src/actions/executor.trigger.ts:28`
  - Track listeners in Map
  - Remove duplicates, add cleanup
  - **Document:** `20_IMPLEMENTATION_LEVEL_ISSUES.md` § 1.B

- [ ] Fix GraphObserver handler leak
  - File: `src/graph/graph.observer.ts:23`
  - Add LRU eviction (max 1000 entries)
  - Periodic cleanup (every 60s)
  - **Document:** `20_IMPLEMENTATION_LEVEL_ISSUES.md` § 1.C

- [ ] Fix Terminal stderr listener leak
  - File: `src/terminal/base.adapter.ts:67`
  - Remove stderr listener in cleanup function
  - **Document:** `20_IMPLEMENTATION_LEVEL_ISSUES.md` § 1.D

**Day 2: Security Fixes (2.5 hours)**
- [ ] Add Ctrl+C handling
  - File: `src/cli/index.ts`
  - Add SIGINT and SIGTERM handlers
  - Graceful shutdown via ShutdownCoordinator
  - **Document:** `22_UX_DEPLOYMENT_COST_TRACKING.md` § 1.A

- [ ] Docker: Run as non-root
  - File: `Dockerfile`
  - Add breakglass user (UID 1001)
  - Switch USER before CMD
  - **Document:** `22_UX_DEPLOYMENT_COST_TRACKING.md` § 2.B

**Day 3-5: Race Conditions (6 hours)**
- [ ] Fix BudgetVeto race condition
  - File: `src/governor/budget.veto.ts:68`
  - Implement atomic executeWithBudget pattern
  - Wrap check + execute + record in single mutex
  - **Document:** `20_IMPLEMENTATION_LEVEL_ISSUES.md` § 2.A

- [ ] Fix ApiKeyManager round-robin race
  - File: `src/credits/api.key.manager.ts:58`
  - Add mutex around keyRR access
  - **Document:** `20_IMPLEMENTATION_LEVEL_ISSUES.md` § 2.B

- [ ] Fix CommandQueue timeout race
  - File: `src/terminal/queue.ts:13`
  - Track dequeued state
  - Only timeout if not dequeued
  - **Document:** `20_IMPLEMENTATION_LEVEL_ISSUES.md` § 2.C

### Week 2: Verification & Quick Wins

**Testing Critical Fixes (1 day)**
- [ ] Run 24-hour stress test (zero leaks expected)
- [ ] Test Ctrl+C in various scenarios (graceful shutdown)
- [ ] Test budget tracking under concurrent load (no overruns)
- [ ] Verify Docker runs as non-root (docker exec whoami)

**Quick UX Improvements (1 day)**
- [ ] Add user-friendly error messages
  - Create UserFacingError class
  - Replace technical errors with helpful ones
  - **Document:** `22_UX_DEPLOYMENT_COST_TRACKING.md` § 1.B

- [ ] Add progress bars for long operations
  - Install cli-progress or ora
  - Add to graph augmentation, codebase indexing
  - **Document:** `22_UX_DEPLOYMENT_COST_TRACKING.md` § 1.C

**Deployment Improvements (1 day)**
- [ ] Add Docker health checks
  - Create /health endpoint
  - Add HEALTHCHECK to Dockerfile
  - **Document:** `22_UX_DEPLOYMENT_COST_TRACKING.md` § 2.A

- [ ] Optimize Docker build cache
  - Multi-stage build
  - Separate deps from source
  - **Document:** `22_UX_DEPLOYMENT_COST_TRACKING.md` § 2.D

---

## Phase 2: Testing & Quality (Weeks 3-8) 🟡

### Week 3-4: Integration Tests

**Setup Testing Infrastructure (2 days)**
- [ ] Configure Jest/Vitest
- [ ] Add test scripts to package.json
- [ ] Setup CI pipeline (GitHub Actions)
- [ ] **Document:** `21_TESTING_AND_PERFORMANCE.md` § C

**Core Integration Tests (8 days)**
- [ ] Cognitive loop end-to-end test
  - Mock LLM, terminal, DB
  - Test simple task execution
  - Test governor veto handling
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § A

- [ ] Worker ReAct loop test
  - Test multi-iteration loops
  - Test tool execution
  - Test error recovery

- [ ] Terminal multiplexing test
  - Test concurrent command execution
  - Test queue behavior under load

- [ ] Graph execution test
  - Test node/edge operations
  - Test impact engine
  - Test blast radius calculation

- [ ] Coordinator test
  - Test worker dispatch
  - Test retry logic
  - Test partial failure handling

### Week 5: Make Components Testable

**Dependency Injection (5 days)**
- [ ] BaseAdapter: inject ProcessSpawner
  - Create ProcessSpawner interface
  - Implement RealProcessSpawner
  - Implement MockProcessSpawner
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § B.1

- [ ] LlmAdapter: HTTP mocking
  - Use nock for API mocking
  - Test error handling
  - Test retry logic
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § B.3

- [ ] GraphObserver: event injection
  - Test debounce logic
  - Test file change handling
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § B.2

### Week 6: Unit Tests

**Critical Logic Unit Tests (5 days)**
- [ ] TaskDecomposer tests
  - Test dependency graph creation
  - Test circular dependency detection
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § C.1

- [ ] ImpactEngine tests
  - Test blast radius calculation
  - Test depth limits
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § C.2

- [ ] BudgetVeto tests
  - Test daily limit enforcement
  - Test concurrent checkVeto (race detection)
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § C.3

### Week 7: Property-Based Tests

**Concurrency Testing (5 days)**
- [ ] Install fast-check
- [ ] ApiKeyManager round-robin property test
  - Test even distribution under random loads
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § D

- [ ] CommandQueue property test
  - Test timeout behavior with random delays

- [ ] BudgetVeto property test
  - Test budget never exceeded with random concurrent calls

### Week 8: Performance Optimizations

**Remove Bottlenecks (5 days)**
- [ ] Cache JSON.stringify in hot paths
  - WorkerAgent, CognitiveLoop, hash function
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § B.A

- [ ] Async file I/O in constructors
  - BudgetVeto, PolicyEngine
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § B.B

- [ ] HNSW vector index
  - Install hnswlib-node
  - Replace linear scan in VectorStore
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § B.C

- [ ] Incremental graph updates
  - Remove rebuildIndices()
  - Update indices on add/remove
  - **Document:** `21_TESTING_AND_PERFORMANCE.md` § B.D

---

## Phase 3: Architecture (Weeks 9-20) 🟢

### Week 9: AI SDK Migration
- [ ] Install ai, @ai-sdk/openai, @ai-sdk/anthropic
- [ ] Create ModernLlmAdapter
- [ ] Migrate TaskDecomposer to use AI SDK
- [ ] Test with multiple providers
- [ ] **Document:** `16_PRIORITY_IMPLEMENTATION_ROADMAP.md` Week 1

### Week 10: Drizzle ORM
- [ ] Install drizzle-orm, drizzle-kit, better-sqlite3
- [ ] Define schemas (tasks, events, sessions, etc.)
- [ ] Generate and run migrations
- [ ] Replace DatabaseConnection with Drizzle
- [ ] **Document:** `16_PRIORITY_IMPLEMENTATION_ROADMAP.md` Week 2

### Week 11: PTY Terminal Support
- [ ] Install node-pty, @types/node-pty
- [ ] Create PTYAdapter class
- [ ] Replace BaseAdapter spawn() with PTY
- [ ] Test interactive programs (vim, python)
- [ ] **Document:** `16_PRIORITY_IMPLEMENTATION_ROADMAP.md` Week 3

### Week 12: MCP Protocol
- [ ] Install @modelcontextprotocol/sdk
- [ ] Create MCPManager class
- [ ] Configure MCP servers (filesystem, github, postgres)
- [ ] Integrate with task pipeline
- [ ] **Document:** `16_PRIORITY_IMPLEMENTATION_ROADMAP.md` Week 4

### Week 13-14: Effect-TS Foundation
- [ ] Install effect
- [ ] Add branded types (TaskID, AgentID, etc.)
- [ ] Convert error handling to Effect
- [ ] Add Schema validation
- [ ] **Document:** `16_PRIORITY_IMPLEMENTATION_ROADMAP.md` Week 5

### Week 15: Configuration Management
- [ ] Create ConfigService with Zod validation
- [ ] Move all hardcoded values to config files
- [ ] Add environment-specific configs (dev, prod, test)
- [ ] **Document:** `16_PRIORITY_IMPLEMENTATION_ROADMAP.md` Week 6

### Week 16: Testing Infrastructure
- [ ] Reach 80% unit test coverage
- [ ] Add integration test suite
- [ ] Setup CI/CD pipeline
- [ ] **Document:** `16_PRIORITY_IMPLEMENTATION_ROADMAP.md` Week 7

### Week 17: Observability
- [ ] Install @opentelemetry/api, @opentelemetry/sdk-node
- [ ] Add structured logging
- [ ] Add distributed tracing
- [ ] Add metrics collection
- [ ] **Document:** `16_PRIORITY_IMPLEMENTATION_ROADMAP.md` Week 8

### Week 18: Terminal UI Framework
- [ ] Choose TUI library (ink or blessed)
- [ ] Create component library
- [ ] Build interactive UI (progress bars, spinners, menus)
- [ ] **Document:** `16_PRIORITY_IMPLEMENTATION_ROADMAP.md` Week 9

### Week 19: Web Interface
- [ ] Setup Next.js
- [ ] Build web UI
- [ ] Add WebSocket for real-time updates
- [ ] **Document:** `16_PRIORITY_IMPLEMENTATION_ROADMAP.md` Week 10

### Week 20: Documentation & Polish
- [ ] Write API documentation
- [ ] Create user guides
- [ ] Record video tutorials
- [ ] Performance optimization pass
- [ ] **Document:** `16_PRIORITY_IMPLEMENTATION_ROADMAP.md` Week 12

---

## Success Metrics Checklist

### After Phase 1 (Week 2):
- [ ] Zero memory leaks in 24-hour test
- [ ] Ctrl+C works gracefully 100% of time
- [ ] Budget tracking accurate within 1%
- [ ] Container runs as non-root
- [ ] Race conditions eliminated (stress tested)

### After Phase 2 (Week 8):
- [ ] 80% unit test coverage
- [ ] All integration tests passing
- [ ] Property tests pass 1000 iterations
- [ ] Zero race conditions in concurrent tests
- [ ] All components have mock boundaries
- [ ] Performance benchmarks improved:
  - [ ] Vector search <5ms for 10K vectors
  - [ ] Graph updates <100ms for 1000 nodes
  - [ ] No JSON parsing in hot paths

### After Phase 3 (Week 20):
- [ ] Multi-provider AI working (OpenAI, Anthropic, Google)
- [ ] MCP protocol integrated with 3+ servers
- [ ] Drizzle ORM with migrations working
- [ ] PTY terminal (vim, python REPL work)
- [ ] Type-safe throughout with Effect-TS
- [ ] Centralized configuration
- [ ] Production monitoring (OpenTelemetry)
- [ ] Professional TUI
- [ ] Web interface live
- [ ] Comprehensive documentation

---

## Daily Standup Template

**Today's Goal:**
- [ ] Task 1 from checklist
- [ ] Task 2 from checklist

**Blockers:**
- None / [describe blocker]

**Completed Yesterday:**
- [x] Task from previous day

**Notes:**
- [Any observations, insights, or concerns]

---

## Resources

**Primary Documents:**
- Roadmap: `16_PRIORITY_IMPLEMENTATION_ROADMAP.md`
- Summary: `23_COMPLETE_FINDINGS_SUMMARY.md`
- Implementation: `20_IMPLEMENTATION_LEVEL_ISSUES.md`
- Testing: `21_TESTING_AND_PERFORMANCE.md`
- UX/Deploy: `22_UX_DEPLOYMENT_COST_TRACKING.md`

**Reference:**
- Architecture: `01_ARCHITECTURE_GAP_ANALYSIS.md`
- Terminal: `11_TERMINAL_HANDLING_COMPARISON.md`
- Plugins: `13_PLUGIN_SYSTEM_DEEP_DIVE.md`

---

## Progress Tracker

**Phase 1:** [  ] Not started [ X] In progress [  ] Complete  
**Phase 2:** [  ] Not started [  ] In progress [  ] Complete  
**Phase 3:** [  ] Not started [  ] In progress [  ] Complete  

**Overall:** ___% Complete

**Estimated Completion Date:** _____________

---

**Start Date:** _____________  
**Current Phase:** _____________  
**Last Updated:** _____________

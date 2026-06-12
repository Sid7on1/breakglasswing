# UX, Deployment & Cost Tracking Issues
## User Experience, Production Readiness, and Financial Tracking

**Analysis Date:** June 12, 2026  
**Focus:** CLI usability, Docker deployment, cost accuracy  
**Complements:** Previous docs on architecture and implementation bugs

---

## 1. CLI & User Experience Issues 🟡

### A. No Ctrl+C Handling in Interactive Mode

**Location:** `src/cli/index.ts`

**The Problem:**
```typescript
// Interactive readline loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('line', async (input) => {
  // Handle user input
});

// ❌ No SIGINT handler
// ❌ Ctrl+C kills process ungracefully
// ❌ Leaves orphaned terminal sessions
// ❌ No cleanup of resources
```

**What Happens:**
```
User: *types command*
Agent: *starts long-running task*
User: *presses Ctrl+C*
Result: Process killed immediately
  → Terminal sessions left running
  → Temporary files not cleaned up
  → Database connections not closed
  → Partial writes to disk
```

**The Fix:**
```typescript
// src/cli/index.ts
import { ShutdownCoordinator } from '../utils/shutdown';

let isShuttingDown = false;

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
  if (isShuttingDown) {
    console.log('\nForce quitting...');
    process.exit(1);
  }
  
  isShuttingDown = true;
  console.log('\n\n⚠️  Interrupt received. Cleaning up...');
  console.log('Press Ctrl+C again to force quit.');
  
  try {
    // Run all shutdown hooks
    await ShutdownCoordinator.shutdown();
    console.log('✅ Cleanup complete. Goodbye!');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error during cleanup:', e);
    process.exit(1);
  }
});

// Also handle SIGTERM for Docker
process.on('SIGTERM', async () => {
  console.log('\n\n⚠️  Termination signal received. Shutting down...');
  await ShutdownCoordinator.shutdown();
  process.exit(0);
});
```

---

### B. Error Messages Are Developer-Centric

**Current State:**
```typescript
// What users see:
throw new GovernorVetoError('Budget limit exceeded.');
// Output: "GovernorVetoError: Budget limit exceeded."

throw new Error(`GOVERNOR_VETO: Path outside workspace.`);
// Output: "Error: GOVERNOR_VETO: Path outside workspace."

throw new Error("CommandQueue timeout: Session never became available");
// Output: "Error: CommandQueue timeout: Session never became available"
```

**The Problem:**
- Technical jargon ("GovernorVetoError", "CommandQueue")
- No suggestions for resolution
- No context about what user was trying to do
- No actionable next steps

**User-Friendly Alternatives:**
```typescript
// Budget error
throw new UserFacingError({
  title: "Daily Budget Reached",
  message: "You've reached your daily spending limit of $5.00.",
  suggestions: [
    "Wait until tomorrow for the limit to reset",
    "Increase MAX_DAILY_SPEND in your .env file",
    "Check your spending with: breakglass credits status"
  ],
  technicalDetails: "GovernorVetoError: Budget limit exceeded",
  learnMore: "https://docs.breakglass.dev/limits"
});

// Path security error
throw new UserFacingError({
  title: "Access Denied",
  message: `Cannot access '${targetPath}' - it's outside your workspace.`,
  suggestions: [
    "Make sure the path is inside your project directory",
    "Check ALLOWED_WORKSPACE in .env",
    "Use relative paths instead of absolute paths"
  ],
  technicalDetails: `GOVERNOR_VETO: Path ${targetPath} not in ${allowedWorkspace}`,
  learnMore: "https://docs.breakglass.dev/security"
});

// Terminal timeout
throw new UserFacingError({
  title: "Command Timeout",
  message: "Your command didn't complete within 60 seconds.",
  suggestions: [
    "The command might be waiting for input - try running it manually first",
    "If it's a long-running process, consider breaking it into smaller steps",
    "Check if the command requires interaction (e.g., password prompt)"
  ],
  technicalDetails: "CommandQueue timeout after 60s",
  command: commandThatFailed
});
```

**Implementation:**
```typescript
// src/errors/user-facing.error.ts
export interface ErrorOptions {
  title: string;
  message: string;
  suggestions: string[];
  technicalDetails?: string;
  learnMore?: string;
  command?: string;
}

export class UserFacingError extends Error {
  constructor(public options: ErrorOptions) {
    super(options.message);
    this.name = 'UserFacingError';
  }
  
  format(): string {
    const lines = [
      `\n❌ ${this.options.title}\n`,
      this.options.message,
      ''
    ];
    
    if (this.options.suggestions.length > 0) {
      lines.push('💡 Suggestions:');
      this.options.suggestions.forEach(s => lines.push(`   • ${s}`));
      lines.push('');
    }
    
    if (this.options.command) {
      lines.push(`🔧 Failed command: ${this.options.command}\n`);
    }
    
    if (this.options.learnMore) {
      lines.push(`📚 Learn more: ${this.options.learnMore}\n`);
    }
    
    if (process.env.DEBUG) {
      lines.push(`🐛 Technical details: ${this.options.technicalDetails || 'N/A'}\n`);
    }
    
    return lines.join('\n');
  }
}

// Error handler in CLI
process.on('uncaughtException', (error) => {
  if (error instanceof UserFacingError) {
    console.error(error.format());
  } else {
    console.error('\n❌ An unexpected error occurred:');
    console.error(error.message);
    console.error('\n💡 Run with DEBUG=1 for more details.');
  }
  process.exit(1);
});
```

---

### C. No Progress Indication for Long Operations

**The Problem:**
```typescript
// src/graph/semantic.augmenter.ts
async augmentGraph(graph: GraphStore): Promise<void> {
  Logger.info('[SemanticAugmenter] Starting augmentation...');
  
  const nodes = graph.getAllNodes();
  
  // ❌ Takes 5-10 minutes for large codebase
  // ❌ No progress shown
  // ❌ User thinks it's frozen
  for (const node of nodes) {
    await this.augmentNode(node);  // LLM call per node
  }
  
  Logger.info('[SemanticAugmenter] Augmentation complete!');
}
```

**The Fix - Add Progress Bar:**
```typescript
import cliProgress from 'cli-progress';

async augmentGraph(graph: GraphStore): Promise<void> {
  const nodes = graph.getAllNodes();
  
  // Create progress bar
  const progressBar = new cliProgress.SingleBar({
    format: 'Augmenting graph |{bar}| {percentage}% | {value}/{total} nodes | ETA: {eta}s',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
  });
  
  progressBar.start(nodes.length, 0);
  
  let completed = 0;
  for (const node of nodes) {
    await this.augmentNode(node);
    completed++;
    progressBar.update(completed);
  }
  
  progressBar.stop();
  Logger.info(`[SemanticAugmenter] ✅ Augmented ${nodes.length} nodes`);
}
```

**Better - Show What's Happening:**
```typescript
import ora from 'ora';

async augmentGraph(graph: GraphStore): Promise<void> {
  const nodes = graph.getAllNodes();
  const spinner = ora('Analyzing codebase semantics...').start();
  
  let completed = 0;
  for (const node of nodes) {
    spinner.text = `Analyzing ${node.metadata.path} (${completed}/${nodes.length})`;
    await this.augmentNode(node);
    completed++;
  }
  
  spinner.succeed(`✅ Analyzed ${nodes.length} files`);
}
```

---

### D. Print Mode Doesn't Stream

**Location:** `src/cli/index.ts`

**The Problem:**
```typescript
// --print mode (non-interactive)
if (options.print) {
  const response = await cognitiveLoop.execute(prompt);  // ❌ Waits for full response
  console.log(response.result);
}
```

**What Users Experience:**
```
$ breakglass "Explain this file" --print
... silence for 30 seconds ...
... entire response dumps at once ...
```

**The Fix - Streaming:**
```typescript
if (options.print) {
  // Use streaming variant
  const stream = await cognitiveLoop.executeStream(prompt);
  
  // Print chunks as they arrive
  for await (const chunk of stream) {
    process.stdout.write(chunk);
  }
  
  console.log('\n');  // Final newline
}
```

**Even Better - Show Thinking:**
```typescript
if (options.print) {
  const stream = await cognitiveLoop.executeStream(prompt);
  
  let currentState = '';
  for await (const event of stream) {
    if (event.type === 'thinking') {
      // Show agent's reasoning
      console.log(`\x1b[90m💭 ${event.thought}\x1b[0m`);
    } else if (event.type === 'action') {
      // Show actions being taken
      console.log(`\x1b[36m🔧 ${event.action.tool}: ${event.action.command}\x1b[0m`);
    } else if (event.type === 'content') {
      // Stream actual content
      process.stdout.write(event.text);
    }
  }
  
  console.log('\n');
}
```

---

## 2. Docker & Deployment Issues 🟢

### A. No Health Checks

**Location:** `Dockerfile`, `docker-compose.yml`

**Current State:**
```dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "dist/index.js"]

# ❌ No HEALTHCHECK directive
```

**The Problem:**
- Docker/Kubernetes can't tell if container is ready
- Traffic routed before app is listening
- Failed starts go undetected
- No automatic restarts on unhealthy state

**The Fix:**
```dockerfile
# Dockerfile
FROM node:18-alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

# Healthcheck every 30s
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
```

```typescript
// src/api/index.ts - Add health endpoint
app.get('/health', (req, res) => {
  // Check if system is actually ready
  const checks = {
    database: db.isConnected(),
    llm: apiKeyManager.hasValidKeys(),
    terminal: terminalMultiplexer.hasAvailableSessions(),
    governor: governor.isWithinBudget()
  };
  
  const allHealthy = Object.values(checks).every(c => c);
  
  if (allHealthy) {
    res.status(200).json({ status: 'healthy', checks });
  } else {
    res.status(503).json({ status: 'unhealthy', checks });
  }
});

app.get('/ready', (req, res) => {
  // Simpler check - just is the app running?
  res.status(200).json({ status: 'ready' });
});
```

---

### B. Container Runs as Root

**Security Risk:**
```dockerfile
# Current Dockerfile
FROM node:18-alpine
WORKDIR /app
# ... installs ...
CMD ["node", "dist/index.js"]

# ❌ Runs as root (UID 0)
# ❌ Security vulnerability
# ❌ If container compromised, attacker has root
```

**The Fix:**
```dockerfile
FROM node:18-alpine

# Create non-root user
RUN addgroup -g 1001 -S breakglass && \
    adduser -S -D -H -u 1001 -G breakglass breakglass

WORKDIR /app

# Install dependencies as root (need permission)
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .
RUN chown -R breakglass:breakglass /app

# Switch to non-root user
USER breakglass

CMD ["node", "dist/index.js"]
```

---

### C. Volume Mounts Are Confusing

**Location:** `docker-compose.yml`

**Current State:**
```yaml
volumes:
  breakglass_db:
  breakglass_auth:
  breakglass_credits:
  breakglass_logs:
  breakglass_backup:
  breakglass_graph:
  breakglass_telemetry:
  breakglass_sessions:

services:
  breakglass:
    volumes:
      - breakglass_db:/app/.breakglass/db
      - breakglass_auth:/app/.breakglass/auth
      - breakglass_credits:/app/.breakglass/credits
      # ... 5 more ...
```

**The Problem:**
- 8 separate named volumes
- No clear documentation on what persists where
- Hard to backup (need to backup 8 volumes separately)
- Confusing for users

**Better Approach:**
```yaml
volumes:
  breakglass_data:  # Single data volume

services:
  breakglass:
    volumes:
      # Single volume for ALL persistent data
      - breakglass_data:/app/.breakglass
      
      # Workspace is bind-mounted (user's code)
      - ./workspace:/workspace
      
      # Config can be bind-mounted for easy editing
      - ./.env:/app/.env:ro  # Read-only
```

**Backup Script:**
```bash
#!/bin/bash
# scripts/backup.sh

# Single volume to backup
docker run --rm \
  -v breakglass_data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/breakglass-$(date +%Y%m%d).tar.gz -C /data .

echo "✅ Backup saved to backups/breakglass-$(date +%Y%m%d).tar.gz"
```

---

### D. Build Cache Not Optimized

**Current Dockerfile:**
```dockerfile
FROM node:18-alpine
WORKDIR /app

# ❌ Copy everything at once
COPY . .

# ❌ npm install runs even if only source changed
RUN npm ci --only=production

CMD ["node", "dist/index.js"]
```

**The Problem:**
- Changing any source file invalidates npm install layer
- Rebuilds take 2-5 minutes every time
- Wasted CI/CD time

**Optimized Version:**
```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# ✅ Copy dependency files first
COPY package*.json ./
COPY tsconfig.json ./

# ✅ Install dependencies (cached unless package.json changes)
RUN npm ci

# ✅ Copy source AFTER dependencies
COPY src ./src

# ✅ Build TypeScript
RUN npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

# Copy only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

USER node

CMD ["node", "dist/index.js"]
```

**Build Time Comparison:**
```
Before optimization:
  - No cache: 180s
  - Source change: 180s (no caching benefit)

After optimization:
  - No cache: 180s
  - Source change: 30s (dependencies cached!)
```

---

## 3. Cost Tracking Issues 🟡

### A. Token Counts Logged But Not Tracked

**Location:** `src/core/llm.adapter.ts:95`

**The Problem:**
```typescript
const response = await client.chat.completions.create({...});

// ✅ Logs token usage
Logger.info(`[LLM] Tokens used: ${response.usage.total_tokens}`);

// ❌ But doesn't track it anywhere!
// ❌ BudgetVeto never sees actual token counts
// ❌ No reconciliation between estimated and actual costs
```

**The Gap:**
```typescript
// Estimated cost is checked BEFORE call
await governor.checkVeto(0.01);  // Estimated $0.01

// But actual cost might be different
const response = await llm.generate(prompt);
// Actual: 15,000 tokens = $0.015

// ❌ No reconciliation
// ❌ Budget tracking is inaccurate over time
```

**The Fix:**
```typescript
// src/core/llm.adapter.ts
async generate(systemContext: string, userPrompt: string): Promise<any> {
  // Estimate cost beforehand
  const estimatedTokens = this.estimateTokens(systemContext + userPrompt);
  const estimatedCost = this.calculateCost(estimatedTokens, this.currentModel);
  
  // Check budget with estimate
  await this.governor.checkVeto(estimatedCost);
  
  try {
    // Make API call
    const response = await client.chat.completions.create({...});
    
    // Calculate ACTUAL cost
    const actualTokens = response.usage.total_tokens;
    const actualCost = this.calculateCost(actualTokens, this.currentModel);
    
    // Record actual cost (reconciles estimate)
    await this.governor.recordSpend(actualCost, estimatedCost);
    
    // Track detailed usage
    await this.costTracker.record({
      timestamp: Date.now(),
      model: this.currentModel,
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: actualTokens,
      estimatedCost,
      actualCost,
      delta: actualCost - estimatedCost
    });
    
    return response;
  } catch (e) {
    // Rollback reservation on failure
    await this.governor.rollbackReservation(estimatedCost);
    throw e;
  }
}
```

---

### B. No Cost Breakdown by Task

**Current State:**
```typescript
// src/governor/budget.veto.ts
export class BudgetVeto {
  public currentDailySpend: number = 0;  // ❌ Just a number
  // ❌ Can't answer: "How much did task X cost?"
  // ❌ Can't answer: "Which tasks are most expensive?"
}
```

**What Users Want:**
```bash
$ breakglass credits breakdown

📊 Cost Breakdown (Last 24 Hours)
════════════════════════════════════════════════════

Total Spent: $3.42 / $5.00 (68%)

By Task:
  "Refactor authentication" ········· $1.25 (36%)
  "Add tests for utils.ts" ·········· $0.89 (26%)
  "Fix bug in payment flow" ········· $0.67 (20%)
  "Generate documentation" ··········· $0.38 (11%)
  Other (5 tasks) ···················· $0.23 (7%)

By Model:
  gpt-4-turbo ······················· $2.15 (63%)
  claude-3-sonnet ··················· $0.98 (29%)
  llama-70b ························· $0.29 (8%)

By Operation:
  Task decomposition ················ $1.34 (39%)
  Code generation ··················· $1.12 (33%)
  Classification ···················· $0.56 (16%)
  Reflection ························ $0.40 (12%)
```

**The Fix:**
```typescript
// src/credits/cost-tracker.ts
export interface CostEntry {
  timestamp: number;
  taskId: string;
  taskDescription: string;
  operation: 'decompose' | 'classify' | 'generate' | 'reflect';
  model: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost: {
    estimated: number;
    actual: number;
  };
}

export class CostTracker {
  private entries: CostEntry[] = [];
  
  async record(entry: CostEntry) {
    this.entries.push(entry);
    
    // Persist to database
    await db.insert(cost_tracking).values(entry);
  }
  
  async getBreakdown(windowHours: number = 24): Promise<CostBreakdown> {
    const since = Date.now() - (windowHours * 3600 * 1000);
    const recentEntries = this.entries.filter(e => e.timestamp >= since);
    
    return {
      total: recentEntries.reduce((sum, e) => sum + e.cost.actual, 0),
      byTask: this.groupByTask(recentEntries),
      byModel: this.groupByModel(recentEntries),
      byOperation: this.groupByOperation(recentEntries),
      topExpensive: this.getTopExpensive(recentEntries, 5)
    };
  }
  
  private groupByTask(entries: CostEntry[]): Map<string, number> {
    const grouped = new Map<string, number>();
    for (const entry of entries) {
      const current = grouped.get(entry.taskId) || 0;
      grouped.set(entry.taskId, current + entry.cost.actual);
    }
    return grouped;
  }
}
```

---

### C. Free Tier Quota Has No Backend Sync

**Location:** `src/credits/credits.free.ts`

**The Problem:**
```typescript
export class FreeCreditsManager {
  private usageFile = path.join(os.homedir(), '.breakglass_usage.json');
  
  async trackUsage(cost: number) {
    // ❌ Tracked locally only
    // ❌ User can bypass by deleting file
    // ❌ No sync across multiple machines
    // ❌ No backend enforcement
    
    const usage = JSON.parse(fs.readFileSync(this.usageFile, 'utf-8'));
    usage.used += cost;
    fs.writeFileSync(this.usageFile, JSON.stringify(usage));
  }
}
```

**What Happens:**
```bash
# Machine 1
$ breakglass do task1
Used: $2.50 / $5.00

# Machine 2 (same user)
$ breakglass do task2
Used: $2.00 / $5.00  # ❌ Should be $4.50!

# Bypass quota
$ rm ~/.breakglass_usage.json
$ breakglass do expensive-task
Used: $0.00 / $5.00  # ❌ Reset!
```

**The Fix - Backend Integration:**
```typescript
// src/credits/credits.manager.ts
export class CreditsManager {
  constructor(
    private apiClient: BreakglassAPI,
    private localCache: LocalCache
  ) {}
  
  async trackUsage(cost: number, taskId: string) {
    try {
      // ✅ Sync with backend
      const response = await this.apiClient.recordUsage({
        userId: this.getUserId(),
        cost,
        taskId,
        timestamp: Date.now()
      });
      
      // Update local cache
      this.localCache.set('usage', response.totalUsed);
      
      return response;
    } catch (e) {
      // Fallback to local tracking if offline
      Logger.warn('[Credits] Could not sync with backend, using local tracking');
      return this.trackUsageLocally(cost);
    }
  }
  
  async checkQuota(estimatedCost: number): Promise<QuotaCheck> {
    try {
      // ✅ Check backend quota
      const quota = await this.apiClient.getQuota(this.getUserId());
      
      return {
        allowed: quota.remaining >= estimatedCost,
        remaining: quota.remaining,
        limit: quota.limit,
        resetAt: quota.resetAt
      };
    } catch (e) {
      // Fallback to local check
      return this.checkQuotaLocally(estimatedCost);
    }
  }
}
```

---

## Summary: UX, Deployment & Cost Issues

### UX Priorities:
| Issue | Severity | User Impact | Effort | Priority |
|-------|----------|-------------|--------|----------|
| No Ctrl+C handling | 🟡 High | Data loss | 2h | 1 |
| Technical error messages | 🟡 High | Confusion | 4h | 2 |
| No progress bars | 🟢 Medium | Perceived freeze | 2h | 3 |
| No streaming in print mode | 🟢 Medium | Poor UX | 3h | 4 |

### Deployment Priorities:
| Issue | Severity | Impact | Effort | Priority |
|-------|----------|--------|--------|----------|
| No health checks | 🟢 Medium | Failed deploys | 1h | 1 |
| Runs as root | 🔴 High | Security risk | 30min | 2 |
| Unoptimized build cache | 🟢 Low | Slow builds | 1h | 3 |
| 8 separate volumes | 🟢 Low | Confusing | 1h | 4 |

### Cost Tracking Priorities:
| Issue | Severity | Impact | Effort | Priority |
|-------|----------|--------|--------|----------|
| No actual cost tracking | 🟡 High | Inaccurate budgets | 4h | 1 |
| No cost breakdown | 🟡 High | No visibility | 6h | 2 |
| No backend sync | 🟡 High | Quota bypass | 8h | 3 |

**Total Effort:** 1-2 weeks

**Next:** Update master index and create final summary document

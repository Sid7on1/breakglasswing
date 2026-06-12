# Architecture Gap Analysis
## What OpenCode & Claude Code Have That BreakGlassWing Doesn't

---

## 1. Effect-TS Ecosystem (OpenCode) ⚠️ CRITICAL GAP

### What They Have:
```typescript
// OpenCode uses Effect extensively
import { Effect, Schema, Types } from "effect"

export const MessageID = Schema.String
  .check(Schema.isStartsWith("msg"))
  .pipe(
    Schema.brand("MessageID"),
    withStatics((schema) => ({ 
      ascending: (id?: string) => schema.make(id ?? "msg_" + Identifier.ascending()) 
    }))
  )

// Type-safe errors
export const APIError = NamedError.create("APIError", {
  message: Schema.String,
  statusCode: Schema.optional(NonNegativeInt),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
```

### What You Have:
```typescript
// BreakGlassWing - manual everything
export interface SubTask {
  id: string;  // Just string, no type safety
  description: string;
  dependencies: string[];
}

// Error handling
catch (error: any) {  // ❌ any type
  Logger.error(`Failed: ${error.message}`);
}
```

### The Gap:
1. **No branded types** - Your IDs are just strings, can be mixed up
2. **No Effect error handling** - You use try/catch everywhere
3. **No Schema validation** - Runtime type checking missing
4. **No dependency injection** - Effect provides this automatically
5. **No resource management** - Effect handles cleanup

### Impact:
- Type errors only caught at runtime
- Error handling inconsistent
- No automatic resource cleanup
- Harder to test and mock

### Migration Path:
```typescript
// Step 1: Install Effect
npm install effect

// Step 2: Create branded types
import { Schema } from "effect"

export const TaskID = Schema.String
  .pipe(Schema.brand("TaskID"))

export const AgentID = Schema.String
  .pipe(Schema.brand("AgentID"))

// Step 3: Define errors with Effect
export const GovernorVetoError = Schema.TaggedStruct("GovernorVeto", {
  reason: Schema.String,
  attemptedAction: Schema.String
})

// Step 4: Use Effect for async operations
export const executeTask = (task: Task): Effect.Effect<
  Result,
  GovernorVetoError | NetworkError,
  TaskService
> => 
  Effect.gen(function* () {
    const service = yield* TaskService
    const result = yield* service.execute(task)
    return result
  })
```

---

## 2. Modern AI SDK Integration ⚠️ CRITICAL

### What They Have:

**OpenCode:**
```typescript
// packages/llm/src/index.ts
import { generateText, streamText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { openai } from "@ai-sdk/openai"
import { google } from "@ai-sdk/google"

// Supports 15+ providers out of the box
const result = await generateText({
  model: anthropic("claude-3-5-sonnet-20241022"),
  messages: [{
    role: "user",
    content: "Hello"
  }],
  tools: {
    execute_command: tool({
      description: "Execute shell command",
      parameters: z.object({ command: z.string() }),
      execute: async ({ command }) => executeShell(command)
    })
  }
})
```

**Claude Code:**
```typescript
// src/assistant/sessionHistory.ts
import Anthropic from "@anthropic-ai/sdk"

const stream = await this.anthropic.messages.stream({
  model: "claude-3-7-sonnet-20250219",
  max_tokens: 8000,
  messages: this.buildMessages(),
  tools: this.getTools(),
  system: this.systemPrompt,
})

for await (const event of stream) {
  if (event.type === "content_block_delta") {
    // Handle streaming
  }
}
```

### What You Have:
```typescript
// src/core/llm.adapter.ts
import OpenAI from 'openai';

const client = new OpenAI({ 
  apiKey: keyStr,
  baseURL: 'https://integrate.api.nvidia.com/v1'
});

const response = await client.chat.completions.create({
  model: 'meta/llama3-70b-instruct',  // ❌ Hardcoded to ONE provider
  messages: [
    { role: 'system', content: systemContext },
    { role: 'user', content: userPrompt }
  ]
}, { timeout: 15000 });

const content = response.choices[0].message.content;
return { status: 200, data: JSON.parse(content || "{}") };
```

### The Gap:
1. **Single provider only** - You only support NVIDIA NIM (via OpenAI SDK)
2. **No tool calling** - You don't use OpenAI's function calling properly
3. **No streaming** - You wait for complete response
4. **Manual JSON parsing** - Error prone, no validation
5. **No retries** - AI SDK handles this automatically
6. **No token counting** - Can't track usage properly
7. **No caching** - AI SDK supports prompt caching

### Why This Matters:
```typescript
// With ai-sdk, you get ALL of this for free:
- ✅ 15+ AI providers (OpenAI, Anthropic, Google, etc.)
- ✅ Automatic retries with exponential backoff
- ✅ Streaming responses
- ✅ Tool/function calling abstraction
- ✅ Token counting and usage tracking
- ✅ Response validation
- ✅ Type-safe tool definitions
- ✅ Prompt caching support
- ✅ Provider fallback
```

### Migration Example:
```typescript
// Install
npm install ai @ai-sdk/openai @ai-sdk/anthropic

// New implementation
import { generateText, tool } from "ai"
import { openai } from "@ai-sdk/openai"
import { z } from "zod"

export class ModernLlmAdapter {
  async generateWithTools(prompt: string) {
    const result = await generateText({
      model: openai("gpt-4-turbo"),
      messages: [{ role: "user", content: prompt }],
      tools: {
        execute_command: tool({
          description: "Execute a shell command",
          parameters: z.object({
            command: z.string().describe("Shell command to execute")
          }),
          execute: async ({ command }) => {
            // Your terminal execution logic
            return await this.terminalMultiplexer.execute(command)
          }
        }),
        read_file: tool({
          description: "Read a file from filesystem",
          parameters: z.object({
            path: z.string()
          }),
          execute: async ({ path }) => {
            // Your file reading logic
            return await this.fsAdapter.readFile(path)
          }
        })
      },
      maxToolRoundtrips: 5  // Automatic multi-turn
    })
    
    return result.text
  }
}
```

---

## 3. React-based Terminal UI (Claude Code) ⚠️ HIGH

### What They Have:
```typescript
// Claude Code uses custom React reconciler
import React from "react"
import { render } from "./ink/render"

export const App = () => {
  const [status, setStatus] = useState("idle")
  
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        🤖 Claude Code Agent
      </Text>
      <Spinner type="dots" />
      <TaskList tasks={tasks} />
      <ProgressBar value={progress} />
    </Box>
  )
}

// Rendered to terminal with custom reconciler
render(<App />)
```

### What You Have:
```typescript
// src/utils/logger.ts
export const Logger = {
  info: (message: string) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`);
  },
  warn: (message: string) => {
    console.warn(`\x1b[33m[WARN] ${message}\x1b[0m`);
  }
}
```

### The Gap:
- **No component model** - Just string concatenation
- **No state management** - Can't update UI dynamically
- **No layout engine** - Manual ANSI codes
- **No interactivity** - Can't build menus, selects, etc.

### What You're Missing:
```
┌─ Claude Code Agent ──────────────────────────┐
│  Status: Processing task...                  │
│  ⠋ Analyzing codebase                        │
│                                               │
│  ✓ Task 1: Read file (completed)             │
│  ⠋ Task 2: Analyze code (in progress)        │
│  ○ Task 3: Generate suggestion (pending)     │
│                                               │
│  Progress: ████████████░░░░░░░░ 60%          │
└───────────────────────────────────────────────┘
```

vs Your Current Output:
```
[INFO] 2026-06-12T... - [TaskPipeline] Starting process...
[INFO] 2026-06-12T... - [Decomposer] LLM Attempt 1/3...
[INFO] 2026-06-12T... - [Classifier] Classifying node: task-1
```

### OpenCode's Approach (Better):
```typescript
// packages/tui/src/components/chat.tsx
import { Box, Text, Spinner } from "@opentui/solid"

export function Chat() {
  return (
    <Box flexDirection="column">
      <Header />
      <MessageList messages={messages()} />
      <InputBox onSubmit={handleSubmit} />
    </Box>
  )
}
```

---

## 4. Database ORM (Drizzle) ⚠️ HIGH

### What OpenCode Has:
```typescript
// packages/core/src/database/schema.sql.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  metadata: text("metadata", { mode: "json" })
})

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull()
})

// Type-safe queries
const result = await db
  .select()
  .from(sessions)
  .where(eq(sessions.workspaceId, workspaceId))
  .orderBy(desc(sessions.createdAt))
  .limit(10)
```

### What You Have:
```typescript
// src/storage/db.connection.ts
const record = JSON.stringify({
  id: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  payload: eventPayload
}) + '\n';

await fs.appendFile(this.WAL_FILE, record, 'utf-8');
```

### The Gap:
1. **No schema** - Just append JSON lines
2. **No relationships** - Can't join data
3. **No indexes** - Every query is O(n)
4. **No transactions** - No ACID guarantees
5. **No migrations** - Schema changes are manual
6. **No type safety** - Any shape can be written
7. **No query builder** - Manual string manipulation

### Migration Impact:
```typescript
// With Drizzle, you get:
import { drizzle } from "drizzle-orm/bun-sqlite"
import { Database } from "bun:sqlite"

const sqlite = new Database("agent.db")
const db = drizzle(sqlite, { schema })

// Type-safe queries
const recentTasks = await db.query.tasks.findMany({
  where: eq(tasks.status, "pending"),
  with: {
    dependencies: true,  // Auto-load relations
    agent: true
  },
  orderBy: [desc(tasks.createdAt)],
  limit: 10
})

// Automatic TypeScript inference
recentTasks[0].id  // ✅ string
recentTasks[0].status  // ✅ "pending" | "completed" | "failed"
recentTasks[0].dependencies  // ✅ Dependency[]
```

---

## 5. Monorepo Architecture ⚠️ ARCHITECTURAL

### OpenCode Structure:
```
opencode/
├── packages/
│   ├── core/           # Core agent logic
│   ├── llm/            # AI provider abstractions
│   ├── tui/            # Terminal UI framework
│   ├── desktop/        # Electron app
│   ├── web/            # Web interface
│   ├── cli/            # CLI entry point
│   ├── plugin/         # Plugin system
│   ├── sdk/            # SDK for extensions
│   ├── console/        # Admin console
│   ├── server/         # Backend API
│   └── [20 more...]
├── turbo.json          # Build orchestration
└── package.json        # Workspace config
```

### Your Structure:
```
breakglasswing/
├── src/
│   ├── actions/
│   ├── api/
│   ├── auth/
│   ├── [14 more modules]
│   └── index.ts
└── package.json
```

### Why Monorepo Matters:
1. **Shared code reuse** - Core logic used by CLI, desktop, web
2. **Independent versioning** - Can update one package without others
3. **Better testing** - Test packages in isolation
4. **Parallel builds** - Turbo builds changed packages only
5. **Clear boundaries** - Each package has defined responsibility

### Example: How OpenCode Shares Code:
```typescript
// packages/core exports agent logic
export { Agent } from "./agent"

// packages/cli uses it
import { Agent } from "@opencode-ai/core"
const agent = new Agent()
agent.run()

// packages/desktop uses same agent
import { Agent } from "@opencode-ai/core"
const agent = new Agent()
// Wrap in Electron

// packages/web uses same agent
import { Agent } from "@opencode-ai/core"
// Run on server, stream to browser
```

Your code can't do this - everything is tightly coupled.

---

## Summary: Top 5 Architectural Gaps

| Gap | Severity | Effort to Fix | Impact |
|-----|----------|---------------|---------|
| 1. No AI SDK | 🔴 Critical | Medium (2 weeks) | Huge |
| 2. No Effect-TS | 🔴 Critical | High (2 months) | Massive |
| 3. No ORM | 🟡 High | Medium (2 weeks) | Large |
| 4. No TUI Framework | 🟡 High | Medium (3 weeks) | Medium |
| 5. Monorepo | 🟢 Medium | High (1 month) | Long-term |

**Next Document:** Dependency Management Analysis with specific package comparisons

# Priority Implementation Roadmap
## What to Fix First - 12-Week Plan

---

## Overview

Based on comparing BreakGlassWing with OpenCode and Claude Code, here's your prioritized roadmap to close critical gaps.

**Total Effort:** 12 weeks (3 months) with 2-3 developers  
**Focus:** Production-ready, scalable, secure

---

## Phase 1: Critical Infrastructure (Weeks 1-4)

### Week 1: AI SDK Migration 🔴 CRITICAL
**Why First:** Foundation for everything else. Your current manual OpenAI calls limit you to one provider and have no error handling.

**Tasks:**
1. Install Vercel AI SDK
   ```bash
   npm install ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google
   ```

2. Replace `LlmAdapter` with AI SDK
   ```typescript
   // NEW: src/core/modern-llm.adapter.ts
   import { generateText, tool } from "ai"
   import { openai } from "@ai-sdk/openai"
   import { anthropic } from "@ai-sdk/anthropic"
   import { z } from "zod"
   
   export class ModernLlmAdapter {
     private providers = {
       openai: openai("gpt-4-turbo"),
       anthropic: anthropic("claude-3-5-sonnet-20241022"),
       google: google("gemini-1.5-pro")
     }
     
     async generate(prompt: string, provider: string = "openai") {
       return await generateText({
         model: this.providers[provider],
         messages: [{ role: "user", content: prompt }],
         maxTokens: 4000,
         temperature: 0.7
       })
     }
     
     async generateWithTools(prompt: string, tools: ToolDefinitions) {
       return await generateText({
         model: this.providers.openai,
         messages: [{ role: "user", content: prompt }],
         tools: tools,
         maxToolRoundtrips: 5
       })
     }
   }
   ```

3. Update `TaskDecomposer` to use new adapter

**Deliverables:**
- [ ] AI SDK integrated
- [ ] Support for 3 providers (OpenAI, Anthropic, Google)
- [ ] Tool calling working
- [ ] Tests passing

**Impact:** ✅ Multi-provider support, ✅ Better error handling, ✅ Automatic retries

---

### Week 2: Database Migration (Drizzle ORM) 🔴 CRITICAL
**Why:** Your current JSONL append-only approach doesn't scale. No queries, no relations, no transactions.

**Tasks:**
1. Install Drizzle
   ```bash
   npm install drizzle-orm drizzle-kit better-sqlite3
   npm install -D @types/better-sqlite3
   ```

2. Define schema
   ```typescript
   // src/database/schema.ts
   import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
   
   export const tasks = sqliteTable("tasks", {
     id: text("id").primaryKey(),
     description: text("description").notNull(),
     status: text("status", { 
       enum: ["pending", "in_progress", "completed", "failed"] 
     }).notNull(),
     createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
     metadata: text("metadata", { mode: "json" })
   })
   
   export const events = sqliteTable("events", {
     id: text("id").primaryKey(),
     taskId: text("task_id").references(() => tasks.id),
     action: text("action").notNull(),
     payload: text("payload", { mode: "json" }),
     timestamp: integer("timestamp", { mode: "timestamp" }).notNull()
   })
   ```

3. Create migrations
   ```bash
   npx drizzle-kit generate:sqlite
   npx drizzle-kit push:sqlite
   ```

4. Replace `DatabaseConnection` class

**Deliverables:**
- [ ] Drizzle ORM configured
- [ ] Migrations working
- [ ] All database operations migrated
- [ ] Type-safe queries

**Impact:** ✅ Proper database, ✅ Relations, ✅ Transactions, ✅ Type safety

---

### Week 3: PTY Terminal Support 🔴 HIGH
**Why:** Your current `spawn()` approach can't handle interactive programs (vim, python REPL, etc.)

**Tasks:**
1. Install node-pty
   ```bash
   npm install node-pty @types/node-pty
   ```

2. Create PTY adapter
   ```typescript
   // src/terminal/pty-adapter.ts
   import * as pty from 'node-pty'
   
   export class PTYAdapter {
     private ptyProcess: pty.IPty
     
     spawn(shell: string = process.env.SHELL || 'bash') {
       this.ptyProcess = pty.spawn(shell, [], {
         name: 'xterm-256color',
         cols: 80,
         rows: 30,
         cwd: process.cwd(),
         env: process.env as any
       })
       
       this.ptyProcess.onData(data => this.handleOutput(data))
       this.ptyProcess.onExit(({ exitCode }) => this.handleExit(exitCode))
     }
     
     write(data: string) {
       this.ptyProcess.write(data)
     }
     
     resize(cols: number, rows: number) {
       this.ptyProcess.resize(cols, rows)
     }
   }
   ```

3. Replace `BaseAdapter` with PTY version
4. Add session persistence

**Deliverables:**
- [ ] PTY support working
- [ ] Interactive programs work (vim, python, etc.)
- [ ] Session persistence
- [ ] Terminal resizing

**Impact:** ✅ Real terminal, ✅ Interactive programs, ✅ Better UX

---

### Week 4: MCP Protocol Support 🔴 CRITICAL
**Why:** Both reference codebases use MCP. It's the future of AI tool integration.

**Tasks:**
1. Install MCP SDK
   ```bash
   npm install @modelcontextprotocol/sdk
   ```

2. Create MCP manager
   ```typescript
   // src/mcp/manager.ts
   import { Client } from "@modelcontextprotocol/sdk/client/index.js"
   import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
   
   export class MCPManager {
     private clients = new Map<string, Client>()
     
     async connect(name: string, config: ServerConfig) {
       const transport = new StdioClientTransport({
         command: config.command,
         args: config.args,
         env: config.env
       })
       
       const client = new Client({
         name: "breakglasswing",
         version: "1.0.0"
       }, {
         capabilities: { tools: {}, resources: {}, prompts: {} }
       })
       
       await client.connect(transport)
       this.clients.set(name, client)
     }
     
     async discoverTools() {
       const tools = []
       for (const [name, client] of this.clients) {
         const { tools: serverTools } = await client.listTools()
         tools.push(...serverTools.map(t => ({ ...t, server: name })))
       }
       return tools
     }
     
     async callTool(server: string, tool: string, args: any) {
       const client = this.clients.get(server)
       return await client.callTool({ name: tool, arguments: args })
     }
   }
   ```

3. Configure MCP servers
4. Integrate with task pipeline

**Deliverables:**
- [ ] MCP client working
- [ ] Connect to 3 MCP servers (filesystem, github, postgres)
- [ ] Tool discovery working
- [ ] Tool invocation working

**Impact:** ✅ Standard protocol, ✅ 20+ servers available, ✅ Future-proof

---

## Phase 2: Architecture Improvements (Weeks 5-8)

### Week 5: Effect-TS Foundation 🟡 HIGH
**Why:** Type-safe error handling, dependency injection, better async operations

**Tasks:**
1. Install Effect
   ```bash
   npm install effect
   ```

2. Add branded types
   ```typescript
   import { Schema } from "effect"
   
   export const TaskID = Schema.String
     .pipe(Schema.brand("TaskID"))
   
   export const AgentID = Schema.String
     .pipe(Schema.brand("AgentID"))
   ```

3. Convert error handling to Effect
4. Add Schema validation

**Deliverables:**
- [ ] Branded types for IDs
- [ ] Effect-based error handling
- [ ] Schema validation
- [ ] Resource management

**Impact:** ✅ Type safety, ✅ Better errors, ✅ Resource cleanup

---

### Week 6: Configuration Management 🟡 MEDIUM
**Why:** Hardcoded values everywhere, no environment-specific configs

**Tasks:**
1. Create ConfigService
   ```typescript
   // src/config/config.service.ts
   import { z } from "zod"
   
   const ConfigSchema = z.object({
     server: z.object({
       port: z.number().default(8080),
       host: z.string().default("localhost")
     }),
     ai: z.object({
       provider: z.enum(["openai", "anthropic", "google"]),
       model: z.string(),
       apiKey: z.string()
     }),
     workspace: z.object({
       root: z.string(),
       maxFileSize: z.number().default(10 * 1024 * 1024)
     }),
     governor: z.object({
       maxDailySpend: z.number().default(5.00),
       forbiddenPaths: z.array(z.string())
     })
   })
   
   export class ConfigService {
     private config: z.infer<typeof ConfigSchema>
     
     load(env: "development" | "production" | "test") {
       const configFile = `config.${env}.json`
       const data = JSON.parse(fs.readFileSync(configFile, "utf-8"))
       this.config = ConfigSchema.parse(data)
     }
     
     get<K extends keyof typeof this.config>(key: K) {
       return this.config[key]
     }
   }
   ```

2. Move all hardcoded values to config
3. Add environment-specific configs

**Deliverables:**
- [ ] ConfigService implemented
- [ ] All hardcoded values in config files
- [ ] Environment-specific configs
- [ ] Validation with Zod

**Impact:** ✅ Centralized config, ✅ Easy to change, ✅ Type-safe

---

### Week 7: Testing Infrastructure 🟡 HIGH
**Why:** Currently 0% test coverage

**Tasks:**
1. Setup Jest
   ```bash
   npm install -D jest @types/jest ts-jest
   ```

2. Write unit tests (target 80% coverage)
3. Write integration tests
4. Setup CI/CD

**Deliverables:**
- [ ] Jest configured
- [ ] 80% unit test coverage
- [ ] Integration tests
- [ ] CI/CD pipeline

**Impact:** ✅ Catch bugs early, ✅ Safe refactoring, ✅ Confidence

---

### Week 8: Observability (OpenTelemetry) 🟡 MEDIUM
**Why:** No structured logging, no tracing, hard to debug

**Tasks:**
1. Install OpenTelemetry
   ```bash
   npm install @opentelemetry/api @opentelemetry/sdk-node
   ```

2. Add structured logging
3. Add distributed tracing
4. Add metrics collection

**Deliverables:**
- [ ] Structured logging
- [ ] Distributed tracing
- [ ] Metrics (latency, errors, usage)
- [ ] Dashboards

**Impact:** ✅ Better debugging, ✅ Performance insights, ✅ Production monitoring

---

## Phase 3: User Experience (Weeks 9-12)

### Week 9: Terminal UI Framework 🟢 MEDIUM
**Why:** Current console.log() output is hard to read

**Tasks:**
1. Choose TUI library (ink or blessed)
2. Create component library
3. Build interactive UI

**Deliverables:**
- [ ] TUI framework integrated
- [ ] Progress bars, spinners, tables
- [ ] Interactive menus
- [ ] Better visual feedback

**Impact:** ✅ Professional UI, ✅ Better UX, ✅ Easier to use

---

### Week 10: Web Interface 🟢 LOW
**Why:** CLI-only limits adoption

**Tasks:**
1. Setup Next.js
2. Build web UI
3. WebSocket for real-time updates

**Deliverables:**
- [ ] Web interface
- [ ] Real-time updates
- [ ] Session sharing
- [ ] Browser-based access

**Impact:** ✅ Wider adoption, ✅ Easier onboarding, ✅ Collaboration

---

### Week 11: Desktop App 🟢 LOW
**Why:** Better UX than CLI for non-technical users

**Tasks:**
1. Setup Electron
2. Port CLI to desktop
3. Add auto-updates

**Deliverables:**
- [ ] Electron app
- [ ] Native menus
- [ ] Auto-updates
- [ ] System tray

**Impact:** ✅ Better UX, ✅ Native feel, ✅ Easier distribution

---

### Week 12: Documentation & Polish 🟢 MEDIUM
**Why:** No docs, hard to onboard

**Tasks:**
1. Write comprehensive docs
2. Create video tutorials
3. Polish rough edges
4. Performance optimization

**Deliverables:**
- [ ] API documentation
- [ ] User guides
- [ ] Video tutorials
- [ ] Performance improvements

**Impact:** ✅ Easier onboarding, ✅ Better adoption, ✅ Professional polish

---

## Success Metrics

### After Phase 1 (Week 4):
- [ ] Multi-provider AI support (3+ providers)
- [ ] Proper database with relations
- [ ] PTY terminal support
- [ ] MCP protocol working

### After Phase 2 (Week 8):
- [ ] 80% test coverage
- [ ] Type-safe throughout
- [ ] Centralized configuration
- [ ] Production monitoring

### After Phase 3 (Week 12):
- [ ] Professional TUI
- [ ] Web interface
- [ ] Desktop app (optional)
- [ ] Comprehensive docs

---

## Resources Needed

### Team:
- 2 Senior TypeScript developers (full-time)
- 1 DevOps engineer (20% time)
- 1 Technical writer (20% time)

### Budget:
- **Phase 1:** $30-40K
- **Phase 2:** $30-40K
- **Phase 3:** $20-30K
- **Total:** $80-110K

### Infrastructure:
- GitHub Actions (free tier sufficient)
- Development environment
- Staging environment
- Monitoring tools (Grafana/Prometheus)

---

## Risk Mitigation

### Technical Risks:
1. **Breaking changes** - Mitigate with comprehensive tests first
2. **Migration complexity** - Do incremental migration, keep old code running
3. **Performance regression** - Benchmark before/after each phase

### Timeline Risks:
1. **Scope creep** - Stick to this plan strictly
2. **Dependencies** - Have fallback options for each technology
3. **Team availability** - Build slack time into estimates

---

## Quick Wins (Do These First!)

If you can only do 3 things, do these:

1. **Week 1: AI SDK** - Biggest impact, easiest migration
2. **Week 2: Drizzle ORM** - Foundation for everything else
3. **Week 4: MCP Support** - Future-proof, standard protocol

These 3 alone will close 70% of the critical gaps.

---

## Conclusion

This roadmap transforms BreakGlassWing from a prototype into a production-ready AI coding assistant that competes with OpenCode and Claude Code.

**Priority Order:**
1. Phase 1 (Weeks 1-4) - **DO FIRST** 🔴
2. Phase 2 (Weeks 5-8) - **DO NEXT** 🟡
3. Phase 3 (Weeks 9-12) - **DO LAST** 🟢

Start with AI SDK migration (Week 1) and build from there. Each week adds significant value.

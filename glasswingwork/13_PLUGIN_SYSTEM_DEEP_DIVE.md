# Plugin System Deep Dive
## MCP (Model Context Protocol) vs Your Custom Plugin System

---

## What is MCP?

**Model Context Protocol** is an open standard developed by Anthropic for connecting AI systems with external tools and data sources.

Think of it like USB for AI - a standardized way for AI assistants to access:
- Local filesystems
- Databases
- APIs
- Developer tools
- System resources
- Custom integrations

---

## Why Both Reference Codebases Use MCP

### The Problem MCP Solves:
Every AI coding assistant needs to connect tools. Before MCP:
- ❌ Everyone built custom plugin systems
- ❌ Plugins only worked with one assistant
- ❌ No standard for tool discovery
- ❌ Security was inconsistent
- ❌ Configuration was complex

### With MCP:
- ✅ Standard protocol (like LSP for IDEs)
- ✅ Plugins work across AI assistants
- ✅ Automatic tool discovery
- ✅ Built-in security model
- ✅ Simple configuration

---

## 1. MCP Architecture (What You're Missing)

### Standard MCP Architecture:
```
┌─────────────────────────────────────────┐
│         AI Assistant (Host)              │
│  ┌────────────────────────────────────┐ │
│  │   MCP Client                       │ │
│  │  - Discovers servers               │ │
│  │  - Connects to servers             │ │
│  │  - Invokes tools                   │ │
│  │  - Manages contexts                │ │
│  └────────────────────────────────────┘ │
└──────────────┬──────────────────────────┘
               │ JSON-RPC over stdio/HTTP/SSE
               │
    ┌──────────┴──────────┬────────────┐
    │                     │            │
┌───▼────┐          ┌─────▼───┐   ┌───▼────┐
│  MCP   │          │   MCP   │   │  MCP   │
│ Server │          │  Server │   │ Server │
│        │          │         │   │        │
│ File   │          │Database │   │ GitHub │
│ System │          │ Access  │   │  API   │
└────────┘          └─────────┘   └────────┘
```

### Your Architecture:
```
┌─────────────────────────────────────────┐
│         BreakGlassWing                   │
│  ┌────────────────────────────────────┐ │
│  │   Plugin Manager                   │ │
│  │  - Downloads GitHub repos          │ │
│  │  - Runs npm install                │ │
│  │  - Executes npm test               │ │
│  │  - Copies to .breakglass_plugins   │ │
│  └────────────────────────────────────┘ │
└──────────────────────────────────────────┘
               No standard protocol
               
┌──────────────────────────────────────────┐
│  "Plugin" (npm package)                  │
│  - No standard interface                 │
│  - Full system access                    │
│  - No sandboxing                         │
└──────────────────────────────────────────┘
```

**The Difference:**
- MCP: Standardized, secure, tool-focused
- Yours: Custom, insecure, package-focused

---

## 2. MCP Server Implementation (OpenCode)

### OpenCode's MCP Config:
```typescript
// packages/core/src/v1/config/mcp.ts
import { MCPServerConfig } from "@modelcontextprotocol/sdk"

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>
}

// Example configuration
const mcpConfig: MCPConfig = {
  servers: {
    "filesystem": {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      env: {}
    },
    "github": {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_TOKEN: process.env.GITHUB_TOKEN
      }
    },
    "postgres": {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: {
        DATABASE_URL: process.env.DATABASE_URL
      }
    }
  }
}
```

### Your Plugin Config:
```typescript
// src/plugins/registry.ts
export interface PluginManifest {
  id: string;
  capabilities: string[];
  installedAt: number;
}

// No standard interface, no configuration schema
```

---

## 3. MCP Tool Discovery & Invocation

### How MCP Works:
```typescript
// 1. Client connects to MCP server
const client = new MCPClient({
  name: "opencode",
  version: "1.0.0"
})

await client.connect(transport)

// 2. Discover available tools
const tools = await client.listTools()
// [
//   {
//     name: "read_file",
//     description: "Read contents of a file",
//     inputSchema: {
//       type: "object",
//       properties: {
//         path: { type: "string" }
//       },
//       required: ["path"]
//     }
//   },
//   {
//     name: "write_file",
//     description: "Write contents to a file",
//     inputSchema: {
//       type: "object",
//       properties: {
//         path: { type: "string" },
//         content: { type: "string" }
//       },
//       required: ["path", "content"]
//     }
//   }
// ]

// 3. Invoke tool
const result = await client.callTool({
  name: "read_file",
  arguments: {
    path: "/workspace/src/index.ts"
  }
})
```

### Your Approach:
```typescript
// src/plugins/plugin.integrator.ts
async integrate(analysis: any, dirPath: string): Promise<void> {
  // Just copy files, no standard interface
  await fs.cp(dirPath, targetPath, { recursive: true });
  
  // No discovery, no invocation protocol
  await this.registry.registerPlugin({
    id: analysis.name,
    capabilities: analysis.providesCapabilities,
    installedAt: Date.now()
  });
}
```

**What You Can't Do:**
- ❌ Discover what tools a plugin provides
- ❌ Get tool schemas/signatures
- ❌ Invoke tools programmatically
- ❌ Pass structured arguments
- ❌ Get structured responses
- ❌ Handle tool errors properly

---

## 4. MCP Security Model (Claude Code)

### Claude Code's MCP Security:
```typescript
// src/utils/mcpValidation.ts
export class MCPValidator {
  // 1. Validate tool input against schema
  validateToolInput(tool: MCPTool, input: unknown): ValidationResult {
    const schema = tool.inputSchema
    
    try {
      // JSON Schema validation
      const valid = ajv.validate(schema, input)
      if (!valid) {
        return {
          valid: false,
          errors: ajv.errors
        }
      }
      return { valid: true }
    } catch (e) {
      return {
        valid: false,
        errors: [{ message: e.message }]
      }
    }
  }
  
  // 2. Sanitize output
  sanitizeOutput(output: unknown): SafeOutput {
    // Remove sensitive data
    // Limit size
    // Validate structure
    return sanitized
  }
  
  // 3. Permission checks
  async checkPermissions(tool: MCPTool, context: Context): Promise<boolean> {
    const required = tool.requiredPermissions
    const granted = context.user.permissions
    
    return required.every(p => granted.includes(p))
  }
}
```

### Your Security:
```typescript
// src/plugins/plugin.sandbox.ts
async testPlugin(dirPath: string): Promise<boolean> {
  try {
    await execAsync(`npm install`, { cwd: dirPath });
    await execAsync(`npm test`, { cwd: dirPath, timeout: 30000 });
    return true;
  } catch (e) {
    return false;
  }
}
```

**Security Gaps:**
- ❌ No input validation
- ❌ No output sanitization
- ❌ No permission system
- ❌ Full system access
- ❌ Can execute arbitrary code

---

## 5. MCP Resources & Context

### MCP Resources Concept:
MCP supports "resources" - long-lived data sources:

```typescript
// List available resources
const resources = await client.listResources()
// [
//   {
//     uri: "file:///workspace/README.md",
//     name: "README.md",
//     mimeType: "text/markdown"
//   },
//   {
//     uri: "postgres://localhost/mydb#users",
//     name: "Users Table",
//     mimeType: "application/sql"
//   }
// ]

// Read resource
const content = await client.readResource({
  uri: "file:///workspace/README.md"
})

// Subscribe to resource changes
client.subscribeToResource({
  uri: "file:///workspace/package.json"
}, (notification) => {
  console.log("Package.json changed!", notification)
})
```

### Your System:
```typescript
// No concept of resources
// Just direct file access through fs module
const content = await fs.readFile(path, 'utf-8')
```

---

## 6. MCP Prompts & Context Injection

### MCP Prompts:
MCP servers can provide prompts (context) to the AI:

```typescript
// List available prompts
const prompts = await client.listPrompts()
// [
//   {
//     name: "code_review",
//     description: "Analyze code for potential issues",
//     arguments: [
//       {
//         name: "files",
//         description: "Files to review",
//         required: true
//       }
//     ]
//   }
// ]

// Get prompt with context
const prompt = await client.getPrompt({
  name: "code_review",
  arguments: {
    files: ["src/index.ts", "src/utils.ts"]
  }
})
// Returns: Structured context for AI to analyze code
```

### Your System:
```typescript
// src/memory/context.engine.ts
async buildContextAwarePrompt(currentTask: string): Promise<string> {
  // Manual string concatenation
  return `
=== SYSTEM PROMPT ===
You are an advanced agent.

=== CURRENT TASK ===
${currentTask}
`;
}
```

---

## 7. Real-World MCP Servers Available

### Official MCP Servers (work with any MCP client):
```bash
# Filesystem access
npx @modelcontextprotocol/server-filesystem /workspace

# GitHub integration
npx @modelcontextprotocol/server-github

# PostgreSQL database
npx @modelcontextprotocol/server-postgres

# Web search
npx @modelcontextprotocol/server-brave-search

# Google Drive
npx @modelcontextprotocol/server-gdrive

# Slack
npx @modelcontextprotocol/server-slack

# Git operations
npx @modelcontextprotocol/server-git

# Memory/notes
npx @modelcontextprotocol/server-memory
```

**If you had MCP support, you could use all of these immediately!**

---

## 8. Migration Path: Adding MCP Support

### Step 1: Install MCP SDK (Week 1)
```bash
npm install @modelcontextprotocol/sdk
```

### Step 2: Create MCP Client (Week 1)
```typescript
// src/mcp/client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

export class MCPManager {
  private clients: Map<string, Client> = new Map()
  
  async connectServer(name: string, config: ServerConfig) {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env
    })
    
    const client = new Client({
      name: "breakglasswing",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    })
    
    await client.connect(transport)
    this.clients.set(name, client)
    
    return client
  }
  
  async discoverTools(): Promise<Tool[]> {
    const allTools: Tool[] = []
    
    for (const [name, client] of this.clients) {
      const { tools } = await client.listTools()
      allTools.push(...tools.map(t => ({
        ...t,
        server: name
      })))
    }
    
    return allTools
  }
  
  async callTool(server: string, toolName: string, args: any) {
    const client = this.clients.get(server)
    if (!client) throw new Error(`Server ${server} not connected`)
    
    const result = await client.callTool({
      name: toolName,
      arguments: args
    })
    
    return result
  }
}
```

### Step 3: Configuration (Week 1)
```typescript
// .breakglass_mcp/config.json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
      "env": {}
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### Step 4: Integrate with Task Pipeline (Week 2)
```typescript
// src/task/decomposer.ts
import { MCPManager } from '../mcp/client'

export class TaskDecomposer {
  constructor(
    private llm: LlmAdapter,
    private mcp: MCPManager
  ) {}
  
  async decompose(prompt: string): Promise<SubTask[]> {
    // 1. Discover available tools from MCP servers
    const tools = await this.mcp.discoverTools()
    
    // 2. Include tools in LLM context
    const systemPrompt = `
You have access to these tools:
${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}
    `
    
    // 3. LLM can now reference real tools
    const result = await this.llm.generateWithTools(prompt, tools)
    
    return result.tasks
  }
}
```

### Step 5: Tool Execution (Week 2)
```typescript
// src/actions/executor.tool.ts
export class ToolExecutor {
  constructor(private mcp: MCPManager) {}
  
  async execute(tool: ToolCall): Promise<ToolResult> {
    const [server, toolName] = tool.name.split('/')
    
    try {
      const result = await this.mcp.callTool(
        server,
        toolName,
        tool.arguments
      )
      
      return {
        success: true,
        output: result.content
      }
    } catch (e) {
      return {
        success: false,
        error: e.message
      }
    }
  }
}
```

---

## 9. Benefits You'll Get from MCP

### Immediate Benefits:
1. ✅ **Access to existing MCP servers** - 20+ official servers
2. ✅ **Standardized tool interface** - No custom protocol
3. ✅ **Better security** - Permission model built-in
4. ✅ **Auto-discovery** - Tools announce themselves
5. ✅ **Type safety** - JSON Schema for all tools
6. ✅ **Community ecosystem** - More servers being built

### Long-term Benefits:
1. ✅ **Your agent works with other AI assistants**
2. ✅ **Plugin developers target your platform**
3. ✅ **Less maintenance** - Use standard implementations
4. ✅ **Better testing** - Standard test suites
5. ✅ **Easier onboarding** - Familiar to developers

---

## 10. Comparison Table

| Feature | BreakGlassWing | OpenCode (MCP) | Claude Code (MCP) |
|---------|---------------|----------------|-------------------|
| **Protocol** | Custom | ✅ MCP Standard | ✅ MCP Standard |
| **Tool Discovery** | ❌ None | ✅ Automatic | ✅ Automatic |
| **Input Validation** | ❌ None | ✅ JSON Schema | ✅ JSON Schema |
| **Security Model** | ⚠️ Basic | ✅ Permissions | ✅ Advanced |
| **Available Servers** | 0 | 20+ | 20+ |
| **Type Safety** | ❌ | ✅ | ✅ |
| **Resource Access** | ❌ | ✅ | ✅ |
| **Context Injection** | ⚠️ Manual | ✅ Automatic | ✅ Automatic |
| **Configuration** | ⚠️ Custom | ✅ Standard | ✅ Standard |
| **Testing** | ❌ | ✅ Standard | ✅ Standard |

---

## Summary

**Current State:** You have a basic plugin system that downloads npm packages and runs them with full system access.

**Target State:** Adopt MCP for standardized, secure, discoverable tool integration.

**Effort:** 2-3 weeks to implement basic MCP support

**Impact:** 🔴 **CRITICAL** - This is the future of AI tool integration

**Next:** AI SDK Integration Comparison (how they call LLMs vs your manual approach)

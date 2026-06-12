import { ToolRegistry } from '../../tools/tool.registry';
import { BuiltTool } from '../../tools/tool.factory';
import { LlmAdapter } from '../../core/llm.adapter';
import { cliEvents } from '../events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentLoop } from '../../core/agent.loop';

export interface PersonaConfig {
  name: string;
  roleDescription: string;
  allowedTools: string[];
}

export abstract class AgentPersona {
  protected tools: BuiltTool[] = [];
  public messages: any[] = [];
  public cwd: string = process.cwd();

  constructor(
    public readonly config: PersonaConfig,
    protected toolRegistry: ToolRegistry,
    protected llmAdapter: LlmAdapter
  ) {
    this.config.allowedTools.forEach(toolName => {
      const tool = this.toolRegistry.getTool(toolName);
      if (tool) {
        this.tools.push(tool);
      } else {
        console.warn(`[Persona:${this.config.name}] Warning: Tool ${toolName} not found in registry.`);
      }
    });
  }

  public getAvailableTools(): BuiltTool[] {
    return this.tools;
  }

  public getSystemPrompt(): string {
    const cwd = this.cwd;
    const homedir = os.homedir();

    const codebaseMarkers = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Makefile', '.project'];
    const isCodebase = codebaseMarkers.some(m => fs.existsSync(path.join(cwd, m)));

    const toolDescriptions = this.tools.map(t => {
      return `- **${t.name}**: ${t.description}\n  Schema: ${JSON.stringify(t.schema)}`;
    }).join('\n');

    const pathRules = isCodebase
      ? `You are inside a codebase project. ALWAYS confine file operations to this project directory.\nIf asked to add a file to a folder that does NOT exist locally, DO NOT silently create it. You MUST use AskUserTool to explicitly ask the user if they want you to create the folder.\nNever search the system for missing folders when inside a codebase.`
      : `You are in a general directory (not a codebase). If the user references a project folder that does not exist here, SEARCH for it first using \`find ${homedir} -maxdepth 3 -type d -name "FOLDER_NAME"\` before creating anything. Never blindly create project-like folders.\nIf you attempt to create a file or folder and it fails because it already exists (e.g. "File exists"), you MUST use AskUserTool to present 3 options: ["Overwrite", "Cancel", "Tell me what else to do"].`;

    const sections = {
      role: `You are ${this.config.name}, a specialized AI agent.\n\n### ROLE\n${this.config.roleDescription}`,
      environment: `### ENVIRONMENT\n- CWD: ${cwd}\n- OS: ${process.platform}\n- Context: ${isCodebase ? 'Inside a codebase project' : 'General directory'}`,
      pathRules: `### PATH RULES (CRITICAL)\n${pathRules}`,
      tools: `### TOOLS\n${toolDescriptions}`,
      security: `Security: Destructive actions are monitored by a Governor and may be blocked.\n\nYou are now operating using Native Tool Calling. Do not use XML for tools. Call them directly using the function calling API.`,
      rules: `### RULES\n- When a task requires a tool, USE IT. Do not describe what you would do.\n- Read files before modifying them. Understand existing code before suggesting changes.\n- After a tool executes, use the result to decide the next step.\n- If a tool fails, diagnose why before retrying. Try a different approach rather than repeating the exact same call.\n- Do not create files unless necessary. Prefer editing existing files over creating new ones.\n- Use \`ReadFileTool\` instead of \`cat\`, \`WriteFileTool\` instead of \`echo\`/heredoc, and reserve \`BashTool\` for actual shell operations.\n- If you are confused, stuck, or hit any major ambiguity regarding a task, USE \`AskUserTool\` to ping the user for clarification before making assumptions.\n- IMPORTANT: If the user says hello or asks a general question, reply naturally and conversationally. Do NOT explain that you aren't using a tool, and do NOT use AskUserTool.\n- Be concise. Lead with the action, not the reasoning.`
    };

    return this.buildPrompt(sections);
  }

  protected buildPrompt(sections: { [key: string]: string }): string {
    return [
      sections.role,
      sections.environment,
      sections.pathRules,
      sections.tools,
      sections.security,
      sections.rules
    ].filter(Boolean).join('\n\n');
  }

  public async execute(prompt: string, onToken?: (token: string) => void, options?: { maxIterations?: number }): Promise<string> {
    const isGreeting = prompt.trim().toLowerCase().match(/^(hi|hello|hey|sup)/);
    const enforcerSuffix = isGreeting ? '' : '\n\n[SYSTEM: You MUST use a tool (like DeleteTool or BashTool) to execute this request. DO NOT output conversational text claiming you did it.]';
    
    this.messages.push({ role: 'user', content: prompt + enforcerSuffix });
    let executionLog = `[${this.config.name}] Starting Task: ${prompt}\n`;

    // AgentLoop expects an IGovernor, but our tools already have it injected during buildTool
    const loop = new AgentLoop(this.llmAdapter, this.toolRegistry, null as any);
    
    const generator = loop.execute(this.messages, this.getSystemPrompt(), { maxIterations: options?.maxIterations ?? 15 }, this);

    for await (const tokenOrLog of generator) {
      if (tokenOrLog.startsWith('\\n[')) {
        executionLog += tokenOrLog;
        if (onToken) onToken('\\n'); // newline for logs
      } else {
        if (onToken) onToken(tokenOrLog);
        executionLog += tokenOrLog;
      }
    }

    this.messages = loop.messages;

    return executionLog;
  }
}

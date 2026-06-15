import { workerData, parentPort } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import { EventBus } from '../core/event.bus';
import { buildKeyPool } from './provider';
import { SubAgentConfig } from '../core/subagent.manager';
import { loadConfig } from './config';
import { SkillLoader, DynamicPersona } from './skills.loader';
import { ToolRegistry } from '../tools/tool.registry';
import { LlmAdapter } from '../core/llm.adapter';
import { ApiKeyManager } from '../credits/api.key.manager';
import { Governor } from '../governor/governor';
import { HermesPersona, OpenCodePersona, OpenClawPersona, BiMaxPersona } from './personas/implementations';
import { AgentPersona } from './personas/base.persona';
import { createBashTool } from '../tools/implementations/bash.tool';
import { createReadFileTool, createWriteFileTool, createDeleteTool, createMakeDirTool } from '../tools/implementations/file.tool';
import { createEditFileTool } from '../tools/implementations/edit.tool';
import { createMultiEditTool } from '../tools/implementations/multiedit.tool';
import { createGrepTool, createGlobTool } from '../tools/implementations/search.tool';
import { createTodoWriteTool } from '../tools/implementations/todo.tool';
import { createWebFetchTool } from '../tools/implementations/webfetch.tool';
import { createCdTool } from '../tools/implementations/cd.tool';
import { createGraphQueryTool, createGraphContextTool } from '../tools/implementations/graph.tool';
import { createGitTool } from '../tools/implementations/git.tool';
import { createLspQueryTool } from '../tools/implementations/lsp.tool';
import { createRememberTool } from '../tools/implementations/remember.tool';
import { createSkillTool } from '../tools/implementations/skill.tool';
import { createMcpManageTool } from '../tools/implementations/mcp.tool';
import { createToolSearchTool } from '../tools/implementations/toolsearch.tool';
import { createWebSearchTool } from '../tools/implementations/websearch.tool';
import { globalSkillService } from '../skills/skill.service';
import { globalMcpManager } from '../mcp/manager';
import { globalProjectMemory } from '../memory/project.memory';
import { GraphStore } from '../graph/graph.store';

async function runWorker() {
  if (!parentPort) throw new Error('Worker must be run as a thread');

  const config = workerData as SubAgentConfig;
  
  try {
    const pool = buildKeyPool();
    const apiKeyManager = new ApiKeyManager(pool);
    const llmAdapter = new LlmAdapter(apiKeyManager);
    // Subagents must run on the SAME model/config the user chose — otherwise they silently fall back
    // to the adapter's hardcoded default. Load the persisted config and apply it.
    try {
      const cfg = await loadConfig();
      llmAdapter.applyConfig({
        model: cfg.model, liteModel: cfg.liteModel, temperature: cfg.temperature, topP: cfg.topP,
        maxTokens: cfg.maxTokens, reasoningEffort: cfg.reasoningEffort, parallelToolCalls: cfg.parallelToolCalls,
      });
    } catch { /* fall back to adapter defaults if config can't be read in the worker */ }
    // Permission bridge: inherit parent's mode
    const eventBus = new EventBus();
    const governor = new Governor(eventBus);
    governor.mode = config.parentMode as any;

    const toolRegistry = new ToolRegistry();
    const graphStorePath = path.join(os.homedir(), '.breakglass', 'graph.json');
    const graphStore = new GraphStore(graphStorePath);
    
    // Register basic tools for the worker
    toolRegistry.register(createBashTool(governor));
    toolRegistry.register(createReadFileTool(governor));
    toolRegistry.register(createWriteFileTool(governor));
    toolRegistry.register(createEditFileTool(governor));
    toolRegistry.register(createMultiEditTool(governor));
    toolRegistry.register(createDeleteTool(governor));
    toolRegistry.register(createMakeDirTool(governor));
    toolRegistry.register(createGrepTool(governor));
    toolRegistry.register(createGlobTool(governor));
    toolRegistry.register(createTodoWriteTool(governor));
    toolRegistry.register(createWebFetchTool(governor));
    toolRegistry.register(createCdTool(governor));
    toolRegistry.register(createGraphQueryTool(governor, graphStore));
    toolRegistry.register(createGraphContextTool(governor, graphStore));
    toolRegistry.register(createGitTool(governor));
    toolRegistry.register(createLspQueryTool(governor, graphStore));
    toolRegistry.register(createRememberTool(governor, globalProjectMemory));
    globalSkillService.load(config.cwd || process.cwd());
    toolRegistry.register(createSkillTool(governor, globalSkillService));
    toolRegistry.register(createMcpManageTool(governor, toolRegistry, globalMcpManager));
    toolRegistry.register(createToolSearchTool(governor, toolRegistry));
    toolRegistry.register(createWebSearchTool(governor));

    // 2. Instantiate Persona
    let agent: AgentPersona;
    if (config.agentType === 'Hermes') agent = new HermesPersona(toolRegistry, llmAdapter);
    else if (config.agentType === 'OpenCode') agent = new OpenCodePersona(toolRegistry, llmAdapter);
    else if (config.agentType === 'OpenClaw') agent = new OpenClawPersona(toolRegistry, llmAdapter);
    else if (config.agentType === 'BiMax') agent = new BiMaxPersona(toolRegistry, llmAdapter);
    else {
      // Must load skills again in this thread
      SkillLoader.loadSkills();
      const skillConfig = SkillLoader.getSkill(config.agentType);
      if (skillConfig) {
        agent = new DynamicPersona(skillConfig, toolRegistry, llmAdapter);
      } else {
        throw new Error(`Unknown agent type: ${config.agentType}`);
      }
    }

    // Isolate CWD
    agent.cwd = config.cwd;

    // 3. Execute
    const result = await agent.execute(config.prompt, (token) => {
      // Optional streaming
    });

    parentPort.postMessage({ type: 'success', result });
  } catch (err: any) {
    parentPort.postMessage({ type: 'error', error: err.message });
  }
}

runWorker();

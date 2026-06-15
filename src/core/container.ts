/**
 * Dependency Injection container for BreakGlassWing.
 * Creates and wires the entire dependency graph in a single factory,
 * replacing scattered `new` calls inside the Orchestrator.
 */

import { SandboxManager } from '../sandbox';
import { CognitiveLoop } from './cognitive.loop';
import { EnvValidator } from '../config';
import { TelemetryEngine } from '../telemetry';
import { MemoryMonitor } from '../telemetry/memory.monitor';
import { DatabaseConnection } from '../storage';
import { WebhookReceiver } from '../api';
import { AuthAutomator } from '../auth';
import { ActionRouter } from '../actions';
import { ContextEngine, ShortTermMemory, LongTermMemory, VectorStore } from '../memory';

import { Governor } from '../governor/governor';
import { Orchestrator, OrchestratorDeps } from './orchestrator';
import { Bootloader } from './bootloader';
import { ShutdownCoordinator } from './shutdown.coordinator';
import { EventBus } from './event.bus';
import { Logger } from '../utils/logger';
import { GraphStore } from '../graph/graph.store';
import { GraphObserver } from '../graph/graph.observer';
import { CodebaseIndexer } from '../graph/indexer';
import { StaticAnalyzer } from '../graph/static.analyzer';
import { SemanticAugmenter } from '../graph/semantic.augmenter';
import { GenomeRepository } from '../genome/genome.repository';
import { ArchitectureGuardian } from '../genome/guardian';
import { TaskPipeline } from '../task';
import { Coordinator } from './coordinator';
import { WorkerAgent } from './worker.agent';
import * as path from 'path';

import { YoloClassifier } from '../security/yolo.classifier';
import { ApiKeyManager } from '../credits/api.key.manager';
import { LlmAdapter } from '../core/llm.adapter';

import { ToolRegistry } from '../tools/tool.registry';
import { createBashTool } from '../tools/implementations/bash.tool';
import { createCdTool } from '../tools/implementations/cd.tool';
import { createReadFileTool, createWriteFileTool, createDeleteTool, createMakeDirTool } from '../tools/implementations/file.tool';
import { createEditFileTool } from '../tools/implementations/edit.tool';
import { createMultiEditTool } from '../tools/implementations/multiedit.tool';
import { createGrepTool, createGlobTool } from '../tools/implementations/search.tool';
import { createTodoWriteTool } from '../tools/implementations/todo.tool';
import { createWebFetchTool } from '../tools/implementations/webfetch.tool';
import { createGraphQueryTool, createGraphContextTool } from '../tools/implementations/graph.tool';
import { globalMcpManager } from '../mcp/manager';
import { createMcpManageTool } from '../tools/implementations/mcp.tool';
import { createToolSearchTool } from '../tools/implementations/toolsearch.tool';
import { createWebSearchTool } from '../tools/implementations/websearch.tool';
import { createSkillTool } from '../tools/implementations/skill.tool';
import { globalSkillService } from '../skills/skill.service';
import { createMemoryQueryTool } from '../tools/implementations/memory.tool';
import { createRememberTool } from '../tools/implementations/remember.tool';
import { globalProjectMemory } from '../memory/project.memory';
import { createSpawnSubagentTool } from '../tools/implementations/spawn.tool';
import { createRegisterAgentTool } from '../tools/implementations/register.tool';
import { createAskUserTool } from '../tools/implementations/ask_user.tool';
import { createGitTool } from '../tools/implementations/git.tool';
import { createLspQueryTool } from '../tools/implementations/lsp.tool';

import { CliConfig } from '../cli/config';
import { buildKeyPool } from '../cli/provider';

export async function createContainer(config?: Partial<CliConfig>): Promise<{ orchestrator: Orchestrator, bootloader: Bootloader, coordinator: Coordinator, workerAgent: WorkerAgent, governor: Governor, toolRegistry: ToolRegistry, graphStore: GraphStore, llmAdapter: LlmAdapter, codebaseIndexer: CodebaseIndexer, taskPipeline: TaskPipeline }> {
  const cfg = config || {};

  // Config
  const validator = new EnvValidator();

  // Core Events & Shutdown
  const eventBus = new EventBus();
  const shutdown = new ShutdownCoordinator();
  
  // Connect Logger
  Logger.setEventBus(eventBus);

  // Infra
  const telemetry = new TelemetryEngine();
  const memoryMonitor = new MemoryMonitor(eventBus);
  memoryMonitor.start();
  const db = new DatabaseConnection();
  const api = new WebhookReceiver(eventBus);
  const auth = new AuthAutomator();

  // API Manager & LLM
  const apiKeyManager = new ApiKeyManager(buildKeyPool());
  const llmAdapter = new LlmAdapter(apiKeyManager);
  llmAdapter.applyConfig({
    model: cfg.model,
    timeout: cfg.timeout,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    reasoningEffort: cfg.reasoningEffort,
    parallelToolCalls: cfg.parallelToolCalls,
  });

  // Yolo Classifier
  const yolo = new YoloClassifier(llmAdapter);

  // Governor
  const governor = new Governor(eventBus, yolo);
  llmAdapter.setBudgetVeto(governor.budget);

  // Graph Engine (Playground)
  // Always operate on the directory the CLI was launched from. A stale
  // workspaceRoot persisted in config.json must not redirect indexing
  // (it caused fatal boot crashes when it pointed outside the project).
  const projectRoot = process.cwd();
  const graphStore = new GraphStore(path.join(projectRoot, '.breakglass/graph', 'playground.json'));
  await graphStore.loadFromDisk();
  
  // Memory
  const shortTerm = new ShortTermMemory();
  const vectorStore = new VectorStore();
  const longTerm = new LongTermMemory(vectorStore);
  const contextEngine = new ContextEngine(shortTerm, longTerm);

  // Tools
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createReadFileTool(governor));
  toolRegistry.register(createWriteFileTool(governor));
  toolRegistry.register(createEditFileTool(governor));
  toolRegistry.register(createMultiEditTool(governor));
  toolRegistry.register(createDeleteTool(governor));
  toolRegistry.register(createMakeDirTool(governor));
  toolRegistry.register(createBashTool(governor));
  toolRegistry.register(createGrepTool(governor));
  toolRegistry.register(createGlobTool(governor));
  toolRegistry.register(createTodoWriteTool(governor));
  toolRegistry.register(createWebFetchTool(governor));
  toolRegistry.register(createCdTool(governor));
  toolRegistry.register(createGraphQueryTool(governor, graphStore));
  toolRegistry.register(createGraphContextTool(governor, graphStore));
  toolRegistry.register(createMemoryQueryTool(governor, vectorStore));
  toolRegistry.register(createRememberTool(governor, globalProjectMemory));
  toolRegistry.register(createSpawnSubagentTool(governor, toolRegistry, llmAdapter));
  toolRegistry.register(createRegisterAgentTool(governor, toolRegistry));
  toolRegistry.register(createAskUserTool(governor, llmAdapter));
  toolRegistry.register(createGitTool(governor));
  toolRegistry.register(createLspQueryTool(governor, graphStore));
  // Agent Skills: model-invoked capability packs (progressive disclosure via the system prompt).
  globalSkillService.load(projectRoot);
  toolRegistry.register(createSkillTool(governor, globalSkillService));
  // Agent-driven MCP setup: gated by the Governor (the tool is destructive → user confirms).
  toolRegistry.register(createMcpManageTool(governor, toolRegistry, globalMcpManager));
  // Smart context mode: loader for deferred tool schemas (kept off the wire until needed).
  toolRegistry.register(createToolSearchTool(governor, toolRegistry));
  toolRegistry.register(createWebSearchTool(governor));

  // External MCP servers: register their tools alongside native ones. Opt-in via
  // .bimax/mcp.json; absent config = zero overhead. Best-effort — a server that fails to
  // start is skipped, never blocking boot. Connections are retained for runtime /mcp management.
  // NOT awaited: a slow/hung remote server must never freeze startup — tools register
  // asynchronously as each server comes up.
  globalMcpManager
    .connectAll(toolRegistry, governor, projectRoot)
    .catch(e => Logger.warn(`[MCP] background connect failed: ${e?.message || e}`));

  // Genome & Evolution
  const genomeRepo = new GenomeRepository(projectRoot);
  genomeRepo.reload().catch(e => Logger.error('Failed to load genome repo'));
  const guardian = new ArchitectureGuardian(projectRoot, genomeRepo);

  const semanticAugmenter = new SemanticAugmenter(graphStore, llmAdapter, projectRoot);
  if (cfg.skipSemanticMetadata) semanticAugmenter.enabled = false;

  const staticAnalyzer = new StaticAnalyzer(projectRoot, graphStore, cfg.excludeFromIndex);
  const codebaseIndexer = new CodebaseIndexer(projectRoot, graphStore, staticAnalyzer, semanticAugmenter);
  if (cfg.autoIndex === false) codebaseIndexer.enabled = false;

  // Graph Observer
  const graphObserver = new GraphObserver(eventBus, graphStore, projectRoot, semanticAugmenter);
  graphObserver.start();

  // Actions
  const actionRouter = new ActionRouter(eventBus, graphStore);

  // Background Skills migrated to JSON Format

  // Brain - Replaced by Coordinator & WorkerAgent architecture
  const workerAgent = new WorkerAgent(actionRouter, db, contextEngine, governor, eventBus, llmAdapter, toolRegistry);
  workerAgent.start(); // Start listening for WORKER_DISPATCH for standalone tasks

  const coordinator = new Coordinator(eventBus, db, actionRouter, contextEngine, governor, llmAdapter, toolRegistry);

  // Compose the deps
  const bootloader = new Bootloader({
    validator,
    telemetry,
    db,
    api,
    auth,
    shutdown
  });

  const cognitiveLoop = new CognitiveLoop(actionRouter, db, contextEngine, governor, eventBus);

  const orchestratorDeps: OrchestratorDeps = {
    actionRouter,
    loop: cognitiveLoop,
    shutdown
  };

  const taskPipeline = new TaskPipeline(eventBus, llmAdapter);
  // We need to pass taskPipeline to WebhookReceiver, but it's already created.
  // Actually, we can just assign it to the property.
  (api as any).taskPipeline = taskPipeline;

  const orchestrator = new Orchestrator(orchestratorDeps);

  return { orchestrator, bootloader, coordinator, workerAgent, governor, toolRegistry, graphStore, llmAdapter, codebaseIndexer, taskPipeline };
}

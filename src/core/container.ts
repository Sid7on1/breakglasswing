/**
 * Dependency Injection container for Bimax.
 * Creates and wires the core dependency graph for the TUI — tools, graph, LLM, governor.
 *
 * Ghost services removed (2026-06-19):
 *   - Express.js WebhookReceiver (booted port 8080 on every CLI start, never used by TUI)
 *   - CognitiveLoop / Orchestrator (event-driven daemon loop, bypassed by AgentLoop)
 *   - Bootloader (only wired the above two + SQLite that TUI never reads)
 *   - ActionRouter / WorkerAgent / Coordinator (only fed the CognitiveLoop)
 *   - ContextEngine / ShortTermMemory / LongTermMemory (only needed by above workers)
 */

import { EventBus } from './event.bus';
import { Logger } from '../utils/logger';
import { cliEvents } from '../cli/events';
import { GraphStore } from '../graph/graph.store';
import { CodebaseIndexer } from '../graph/indexer';
import { StaticAnalyzer } from '../graph/static.analyzer';
import { SemanticAugmenter } from '../graph/semantic.augmenter';
import { GenomeRepository } from '../genome/genome.repository';
import { TaskPipeline } from '../task';
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
import { createSymbolEditTool } from '../tools/implementations/symboledit.tool';
import { createRelatedTestsTool } from '../tools/implementations/relatedtests.tool';
import { createGrepTool, createGlobTool } from '../tools/implementations/search.tool';
import { createTodoWriteTool } from '../tools/implementations/todo.tool';
import { createWebFetchTool } from '../tools/implementations/webfetch.tool';
import { createGraphQueryTool, createGraphContextTool } from '../tools/implementations/graph.tool';
import { globalCodemem } from '../graph/codemem/backend';
import { globalMcpManager } from '../mcp/manager';
import { createMcpManageTool } from '../tools/implementations/mcp.tool';
import { createToolSearchTool } from '../tools/implementations/toolsearch.tool';
import { createWebSearchTool } from '../tools/implementations/websearch.tool';
import { createSkillTool } from '../tools/implementations/skill.tool';
import { createSkillInstallTool } from '../tools/implementations/skill.install.tool';
import { createSkillAuthorTool } from '../tools/implementations/skill.author.tool';
import { createModelManageTool } from '../tools/implementations/model.tool';
import { globalSkillService } from '../skills/skill.service';
import { loadHooksConfig } from '../tools/hooks.loader';
import { createMemoryQueryTool } from '../tools/implementations/memory.tool';
import { createRememberTool } from '../tools/implementations/remember.tool';
import { globalProjectMemory } from '../memory/project.memory';
import { VectorStore } from '../memory';
import { createSpawnSubagentTool } from '../tools/implementations/spawn.tool';
import { createTasksTool } from '../tools/implementations/tasks.tool';
import { createNotebookEditTool } from '../tools/implementations/notebook.tool';
import { createRegisterAgentTool } from '../tools/implementations/register.tool';
import { createAskUserTool } from '../tools/implementations/ask_user.tool';
import { createBlueprintTool } from '../tools/implementations/blueprint.tool';
import { createTrainMonitorTool } from '../tools/implementations/train_monitor.tool';
import { createTrainLaunchTool } from '../tools/implementations/train_launch.tool';
import { createModeTool } from '../tools/implementations/mode.tool';
import { createGitTool } from '../tools/implementations/git.tool';
import { createLspQueryTool } from '../tools/implementations/lsp.tool';
import { createFreeContextTool } from '../tools/implementations/free-context.tool';
import { createGoalsTool } from '../tools/implementations/goals.tool';
import { createWorkspaceTool } from '../tools/implementations/workspace.tool';
import { initGoalManager } from '../memory/goal.manager';
import { initWorkspace } from './workspace.manager';
import { initPlanManager } from '../memory/plan.manager';
import { createPlanTool } from '../tools/implementations/plan.tool';
import { createScoutTool } from '../tools/implementations/scout.tool';

import { Governor } from '../governor/governor';
import { CliConfig } from '../cli/config';
import { buildKeyPool } from '../cli/provider';

export async function createContainer(config?: Partial<CliConfig>): Promise<{
  governor: Governor;
  toolRegistry: ToolRegistry;
  graphStore: GraphStore;
  llmAdapter: LlmAdapter;
  codebaseIndexer: CodebaseIndexer;
  taskPipeline: TaskPipeline;
}> {
  const cfg = config || {};

  // Goal Manager — persistent cross-session goals. Init first so system prompt can include them.
  const goalManager = initGoalManager(process.cwd());
  await goalManager.init();

  // Plan Manager — VCS-backed structured plans in .bimax/plans/.
  initPlanManager(process.cwd());

  // Multi-repo workspace — manifest refresh + sibling-clone scan on session start (PR1,
  // docs/UPGRADE_2026_RESEARCH.md). Best-effort: a broken manifest must not block boot.
  try { initWorkspace(process.cwd()); } catch (e: any) { Logger.warn(`[Workspace] init failed: ${e?.message ?? e}`); }

  // Core Events
  const eventBus = new EventBus();
  Logger.setEventBus(eventBus);

  // API Manager & LLM
  const apiKeyManager = new ApiKeyManager(buildKeyPool());
  const llmAdapter = new LlmAdapter(apiKeyManager);
  llmAdapter.applyConfig({
    model: cfg.model,
    timeout: cfg.timeout,
    temperature: cfg.temperature,
    topP: cfg.topP,
    maxTokens: cfg.maxTokens,
    reasoningEffort: cfg.reasoningEffort,
    parallelToolCalls: cfg.parallelToolCalls,
    liteModel: cfg.liteModel,
  });

  // Governor — YoloClassifier only fires in 'auto' mode (never in default interactive mode).
  const yolo = new YoloClassifier(llmAdapter);
  const governor = new Governor(eventBus, yolo);
  llmAdapter.setBudgetVeto(governor.budget);

  // Graph Engine — operates on the directory the CLI was launched from.
  const projectRoot = process.cwd();
  // SQLite-backed when node:sqlite exists (atomic saves, per-file staleness → incremental
  // reindex); legacy JSON store otherwise. Same IGraphStore either way (v2 §3.9).
  const { createGraphStore } = await import('../graph/sqlite.graph.store');
  const graphStore = createGraphStore(projectRoot);
  const { isCodebase } = await import('../graph/graph.summary');
  if (isCodebase(projectRoot)) {
    await graphStore.loadFromDisk();
  }

  // Tools
  const toolRegistry = new ToolRegistry();
  // Index-gated tools (GraphQueryTool/GraphContextTool) stay disabled until the repo is indexed, then
  // are promoted + preferred. The check is lazy so it reflects a graph built mid-session (after /index)
  // OR the baked-in codebase-memory engine coming online (its own 158-language index + semantic search).
  toolRegistry.setGraphReadyCheck(() => graphStore.getGraph().nodes.size > 0 || globalCodemem.isReady());
  // Bring the codebase-memory engine up in the background — it fronts the graph tools when ready and
  // never blocks boot. Skipped for non-codebase dirs (nothing to index).
  if (isCodebase(projectRoot)) {
    globalCodemem.init(projectRoot).catch(() => {});
  }
  // Bring the real Headroom Kompress proxy up in the background (provision venv + ONNX model on first
  // run, spawn the localhost sidecar, wire HEADROOM_PROXY_URL). Never blocks boot; the engine only
  // calls it under token pressure. Opt out with BIMAX_DISABLE_HEADROOM=1.
  import('../memory/headroomProxy').then(m => m.ensureHeadroomProxy().catch(() => {})).catch(() => {});
  toolRegistry.register(createReadFileTool(governor));
  toolRegistry.register(createWriteFileTool(governor));
  toolRegistry.register(createEditFileTool(governor));
  toolRegistry.register(createMultiEditTool(governor));
  // Surgical precision pair: AST-addressed edits + minimal-scope test verification.
  toolRegistry.register(createSymbolEditTool(governor));
  toolRegistry.register(createRelatedTestsTool(governor));
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
  const vectorStore = new VectorStore();
  toolRegistry.register(createMemoryQueryTool(governor, vectorStore));
  toolRegistry.register(createRememberTool(governor, globalProjectMemory));
  toolRegistry.register(createSpawnSubagentTool(governor, toolRegistry, llmAdapter));
  toolRegistry.register(createTasksTool(governor));
  toolRegistry.register(createNotebookEditTool(governor));
  toolRegistry.register(createRegisterAgentTool(governor, toolRegistry));
  toolRegistry.register(createAskUserTool(governor, llmAdapter));
  toolRegistry.register(createGitTool(governor));
  toolRegistry.register(createLspQueryTool(governor, graphStore));
  toolRegistry.register(createFreeContextTool(governor));
  toolRegistry.register(createGoalsTool(governor));
  toolRegistry.register(createWorkspaceTool(governor));
  toolRegistry.register(createPlanTool(governor));
  toolRegistry.register(createScoutTool(governor));
  // Sketch Mode: the level-by-level Blueprint builder + LLM-training monitoring.
  toolRegistry.register(createBlueprintTool(governor, toolRegistry));
  toolRegistry.register(createTrainMonitorTool(governor));
  toolRegistry.register(createTrainLaunchTool(governor));
  // Agent switches its OWN mode (the same modes the user cycles with Shift+Tab) → self-driving loop.
  toolRegistry.register(createModeTool(governor));
  // Agent Skills: model-invoked capability packs (progressive disclosure via the system prompt).
  globalSkillService.load(projectRoot);
  toolRegistry.register(createSkillTool(governor, globalSkillService));
  toolRegistry.register(createSkillInstallTool(governor, globalSkillService));
  toolRegistry.register(createSkillAuthorTool(governor, globalSkillService));
  // Shell-command hooks: PreToolUse can block a tool, PostToolUse runs for side effects.
  loadHooksConfig(projectRoot);
  // Agent-driven MCP setup: gated by the Governor (the tool is destructive → user confirms).
  toolRegistry.register(createMcpManageTool(governor, toolRegistry, globalMcpManager));
  // Agent self-service over its own model API: list/switch coding & lite models and provider live.
  toolRegistry.register(createModelManageTool(governor, llmAdapter));
  // Smart context mode: loader for deferred tool schemas (kept off the wire until needed).
  toolRegistry.register(createToolSearchTool(governor, toolRegistry));
  toolRegistry.register(createWebSearchTool(governor));

  // External MCP servers — best-effort, never blocks boot. Once the initial (parallel) connect
  // settles, the watchdog takes over: a 60s background sweep that probes each live connector and
  // auto-reconnects dead ones (bounded attempts; BIMAX_MCP_WATCHDOG=0 disables).
  globalMcpManager
    .connectAll(toolRegistry, governor, projectRoot)
    .then(() => globalMcpManager.startWatchdog(toolRegistry, governor))
    .catch(e => Logger.warn(`[MCP] background connect failed: ${e?.message || e}`));

  // OTLP metrics — silent no-op unless OTEL_EXPORTER_OTLP_ENDPOINT/BIMAX_OTLP_ENDPOINT is set.
  import('../telemetry/metrics.export').then(m => m.startMetricsExporter()).catch(() => {});

  // Crash recovery: if a previous session died mid-swarm, its agent-tree checkpoint names the
  // sub-agents that were still running. Surface them; '/subagents resume' respawns the tree.
  import('./agent.checkpoint').then(m => {
    const n = m.detectCrashedTree();
    if (n > 0) cliEvents.emit('status', `${n} sub-agent(s) from a crashed session are recoverable — run /subagents resume`);
  }).catch(() => {});

  // Genome & Evolution — used by /evolve (gated by allowSelfEvolution config, off by default).
  const genomeRepo = new GenomeRepository(projectRoot);
  genomeRepo.reload().catch(() => {});

  const semanticAugmenter = new SemanticAugmenter(graphStore, llmAdapter, projectRoot);
  if (cfg.skipSemanticMetadata) semanticAugmenter.enabled = false;

  const staticAnalyzer = new StaticAnalyzer(projectRoot, graphStore, cfg.excludeFromIndex);
  const codebaseIndexer = new CodebaseIndexer(projectRoot, graphStore, staticAnalyzer, semanticAugmenter);
  if (cfg.autoIndex === false) codebaseIndexer.enabled = false;

  // Task Pipeline — used by /watch watchers.
  const taskPipeline = new TaskPipeline(eventBus, llmAdapter);

  return { governor, toolRegistry, graphStore, llmAdapter, codebaseIndexer, taskPipeline };
}

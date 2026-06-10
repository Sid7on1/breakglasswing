/**
 * Dependency Injection container for BreakGlassWing.
 * Creates and wires the entire dependency graph in a single factory,
 * replacing scattered `new` calls inside the Orchestrator.
 */

import { EnvValidator } from '../config';
import { TelemetryEngine } from '../telemetry';
import { DatabaseConnection } from '../storage';
import { WebhookReceiver } from '../api';
import { AuthAutomator } from '../auth';
import { ActionRouter } from '../actions';
import { ContextEngine, ShortTermMemory, LongTermMemory, VectorStore } from '../memory';
import { CognitiveLoop } from './cognitive.loop';
import { Governor } from '../governor/governor';
import { Orchestrator, OrchestratorDeps } from './orchestrator';
import { Bootloader } from './bootloader';
import { ShutdownCoordinator } from './shutdown.coordinator';
import { EventBus } from './event.bus';
import { Logger } from '../utils/logger';
import { GraphStore } from '../graph/graph.store';
import { GraphObserver } from '../graph/graph.observer';
import { GenomeRepository } from '../genome/genome.repository';
import { ArchitectureGuardian } from '../genome/guardian';
import * as path from 'path';

export function createContainer(): { orchestrator: Orchestrator, bootloader: Bootloader } {
  // Config
  const validator = new EnvValidator();

  // Core Events & Shutdown
  const eventBus = new EventBus();
  const shutdown = new ShutdownCoordinator();
  
  // Connect Logger
  Logger.setEventBus(eventBus);

  // Infra
  const telemetry = new TelemetryEngine();
  const db = new DatabaseConnection();
  const api = new WebhookReceiver(eventBus);
  const auth = new AuthAutomator();

  // Governor
  const governor = new Governor(eventBus);

  // Graph Engine (Playground)
  const projectRoot = process.cwd();
  const graphStore = new GraphStore(path.join(projectRoot, '.breakglass_graph', 'playground.json'));
  
  // Genome & Evolution
  const genomeRepo = new GenomeRepository(projectRoot);
  // We trigger reload asynchronously, but in DI it's okay for now
  genomeRepo.reload().catch(e => Logger.error('Failed to load genome repo'));
  const architectureGuardian = new ArchitectureGuardian(projectRoot, genomeRepo);

  // Graph Observer
  const graphObserver = new GraphObserver(eventBus, graphStore, projectRoot);
  graphObserver.start();

  // Actions
  const actionRouter = new ActionRouter(eventBus, graphStore);

  // Memory
  const shortTerm = new ShortTermMemory();
  const vectorStore = new VectorStore();
  const longTerm = new LongTermMemory(vectorStore);
  const contextEngine = new ContextEngine(shortTerm, longTerm);

  // Brain
  const loop = new CognitiveLoop(actionRouter, db, contextEngine, governor, eventBus);

  // Compose the deps
  const bootloader = new Bootloader({
    validator,
    telemetry,
    db,
    api,
    auth,
    shutdown
  });

  const orchestratorDeps: OrchestratorDeps = {
    actionRouter,
    loop,
    shutdown
  };

  const orchestrator = new Orchestrator(orchestratorDeps);

  return { orchestrator, bootloader };
}

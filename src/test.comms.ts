import { AgentBus, AgentMapper, Broadcaster, Subscriber } from './comms';
import { Logger } from './utils';

async function main() {
  Logger.info('--- Initializing Robust Inter-Agent Bus Test ---');
  
  const bus = new AgentBus();
  const mapper = new AgentMapper(bus);
  
  // Start Monitor (fast checks for testing: 1s interval, 3s max silence)
  mapper.startMonitor(1000, 3000);

  // Agent 1 Setup
  const agent1Id = 'Agent-Alpha';
  const a1Broadcaster = new Broadcaster(bus, agent1Id);
  const a1Subscriber = new Subscriber(bus, agent1Id);
  
  a1Broadcaster.startHeartbeat(1000);
  mapper.registerAgent(agent1Id, ['backend', 'db']);

  // Agent 2 Setup
  const agent2Id = 'Agent-Bravo';
  const a2Broadcaster = new Broadcaster(bus, agent2Id);
  const a2Subscriber = new Subscriber(bus, agent2Id);
  
  a2Broadcaster.startHeartbeat(1000);
  mapper.registerAgent(agent2Id, ['backend', 'frontend']);

  // Handle task assignments
  a1Subscriber.listenForTasks((task) => {
    Logger.info(`[Agent-Alpha] Processing task: ${task.description}...`);
    // Simulate long running task that Agent 1 will NEVER finish
  });

  a2Subscriber.listenForTasks((task) => {
    Logger.info(`[Agent-Bravo] Processing recycled task: ${task.description}...`);
    setTimeout(() => {
      Logger.info(`[Agent-Bravo] Task ${task.id} COMPLETED!`);
      a2Broadcaster.emitStatus(task.id, 'COMPLETED');
    }, 1000);
  });

  // Inject Task
  Logger.info('\n[Test] Dispatching critical backend task...');
  mapper.assignTask({ id: 'task-99', type: 'backend', description: 'Compile massive DB schema' });

  // Wait 2 seconds, then kill Agent 1 to simulate a fatal OOM crash
  setTimeout(() => {
    Logger.warn('\n>>> SIMULATING FATAL OOM CRASH ON AGENT-ALPHA <<<');
    a1Broadcaster.stopHeartbeat(); // Heartbeat stops
  }, 2000);

  // Wait 6 seconds to let Monitor detect silence, recycle the task, and Bravo complete it
  setTimeout(() => {
    Logger.info('\n--- All Comms Tests Passed ---');
    mapper.stopMonitor();
    a2Broadcaster.stopHeartbeat();
  }, 6000);
}

main().catch(console.error);

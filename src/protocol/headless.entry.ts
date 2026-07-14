import { cliEvents, MessageEntry } from '../cli/events';
import { goalEvents } from '../memory/goal.manager';
import { buildPersonas } from '../cli/personas/factory';
import { HeadlessSession } from './headless.session';
import { startStdioHost } from './stdio.host';
import { startUiSnapshot, setTokensBaseline } from './ui.snapshot';
import { completeInput } from './completions';
import { isCodebase, summarizeGraph } from '../graph/graph.summary';
import { getConfig, saveConfig } from '../cli/config';
import { estimateTokens } from '../graph/context.planner';
import type { OutcomeTask } from '../outcome/outcome.model';
// Register every slash command for its side effect. Commands self-register on import (each module
// calls globalCommandRegistry.register at top level), and the Ink path got them via FullScreen's
// imports — but headless imports only the bare registry, so without this the palette is EMPTY:
// no autocomplete for "/", and every slash command falls through as "Unknown command".
import '../cli/commands';

/**
 * Run BiMax headless: no Ink, no TTY. The engine's events stream out as NDJSON on stdout and
 * the front-end's commands come in as NDJSON on stdin (see src/protocol). This is the process
 * the Go / Bubble Tea TUI spawns and drives. Activated by `BIMAX_HEADLESS=1` (or `--headless`),
 * forked in index.ts AFTER the container is built but BEFORE Ink would mount — so the in-process
 * Ink path is never touched.
 *
 * `container` is the createContainer() result; `config` the loaded config. Resolves only when the
 * session shuts down (the stdio host keeps the process alive while stdin is open).
 */
export async function startHeadless(container: any, config: any): Promise<void> {
  const { toolRegistry, llmAdapter, governor, graphStore, codebaseIndexer } = container;

  const options = {
    toolRegistry,
    llmAdapter,
    governor,
    maxToolIterations: config.maxToolIterations,
    notificationBell: config.notificationBell,
    persona: null,
  };

  // Session persistence: append every message/tool call to .breakglass/sessions/<id>.jsonl and
  // keep sessions-meta.jsonl current, so /sessions, /resume, and the desktop's thread surfaces
  // have real data. Attach BEFORE the host so nothing emitted during boot is lost.
  const { reportBootPhase } = require('./boot.status') as typeof import('./boot.status');
  reportBootPhase('restoring_session');
  const { startSessionRecorder } = require('../cli/session.recorder');
  const sessionRecorder = startSessionRecorder();

  // Review domain: fold approvals / attributed changes / verification evidence / checkpoints into
  // the per-thread review file and publish `review_update` snapshots. Rides the same thread
  // lifecycle as the recorder above (session_changed), so it must start after it.
  const { startReviewManager } = require('../review/review.manager');
  const reviewManager = startReviewManager();

  // Outcome runtime: one persistent acceptance/task/evidence contract per thread. It starts after
  // the recorder so session_changed always has a concrete id, and listens to the review domain's
  // mutation/evidence facts instead of inventing a second source of truth.
  const { startOutcomeManager } = require('../outcome/outcome.manager');
  const outcomeManager = startOutcomeManager();

  const personas = buildPersonas(toolRegistry, llmAdapter);
  const session = new HeadlessSession({
    personas,
    options,
    graphStore,
    codebaseIndexer,
  });

  // Unattended crash recovery: only recent, single-session, outcome-bound assignments running
  // under normal permissions qualify. The recovery command reuses the same audited session and
  // assignment rebinding path as manual `/subagents resume`; unsafe/legacy snapshots stay visible
  // for manual review. A user turn that wins the startup race is never interrupted or switched.
  let recoveryStarted = false;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  const attemptAutomaticRecovery = async (attempt = 0): Promise<void> => {
    if (recoveryStarted) return;
    const checkpoint = require('../core/agent.checkpoint') as typeof import('../core/agent.checkpoint');
    const plan = checkpoint.planAutomaticRecovery(checkpoint.crashedAgents(), {
      enabled: config.autoResumeAgents !== false && process.env.BIMAX_AUTO_RESUME_AGENTS !== '0',
    });
    if (!plan.automatic || !plan.sessionId) {
      cliEvents.emit('status', `${plan.reason} Use /subagents resume after reviewing the interrupted work.`);
      return;
    }
    if (session.isBusy) {
      if (attempt < 30) recoveryTimer = setTimeout(() => { void attemptAutomaticRecovery(attempt + 1); }, 1000);
      else cliEvents.emit('status', 'Automatic assignment recovery deferred because the current turn stayed busy; use /subagents resume later.');
      return;
    }
    const activeSession = outcomeManager.activeSessionId();
    if (activeSession && activeSession !== plan.sessionId) {
      cliEvents.emit('status', `Interrupted work belongs to ${plan.sessionId}; current task was left untouched. Resume that session, then run /subagents resume.`);
      return;
    }
    recoveryStarted = true;
    cliEvents.emit('status', `Recovering ${plan.agents.length} interrupted assignment(s) from ${plan.sessionId}…`);
    await session.dispatch(`/resume ${plan.sessionId}`);
    if (outcomeManager.activeSessionId() !== plan.sessionId) {
      recoveryStarted = false;
      cliEvents.emit('status', `Could not restore outcome session ${plan.sessionId}; interrupted agents were not restarted.`);
      return;
    }
    await session.dispatch('/subagents resume');
    cliEvents.emit('status', `${plan.agents.length} interrupted assignment(s) resumed safely.`);
  };
  const onAgentRecoveryAvailable = () => { void attemptAutomaticRecovery(); };
  cliEvents.on('agent_recovery_available', onAgentRecoveryAvailable);

  // Durable outcome convergence: a background assignment settling queues a receipt in the
  // contract. Once the interactive turn is idle, wake the parent coordinator to integrate,
  // independently verify, validate, and dispatch newly-ready graph work. Every wake must make a
  // measurable contract change; three no-progress wakes or the process-wide cap stop the loop.
  let continuationTimer: ReturnType<typeof setTimeout> | null = null;
  let continuationRunning = false;
  let reportedHaltRevision = 0;
  const continuationEnabled = () => {
    try { return getConfig().autoContinueOutcome !== false && process.env.BIMAX_AUTO_CONTINUE_OUTCOME !== '0'; }
    catch { return config.autoContinueOutcome !== false && process.env.BIMAX_AUTO_CONTINUE_OUTCOME !== '0'; }
  };
  const continuationWakeLimit = () => {
    const requested = Number(process.env.BIMAX_AUTO_CONTINUE_MAX_WAKEUPS || 24);
    return Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.floor(requested))) : 24;
  };
  const scheduleOutcomeContinuation = (delayMs = 250) => {
    if (continuationTimer || continuationRunning || !continuationEnabled()) return;
    continuationTimer = setTimeout(() => {
      continuationTimer = null;
      void attemptOutcomeContinuation();
    }, delayMs);
    continuationTimer.unref?.();
  };
  const outcomeNeedsAnotherWake = () => {
    const contract = outcomeManager.current();
    const snapshot = outcomeManager.snapshot();
    if (!contract || !snapshot || contract.phase === 'verified') return false;
    if (contract.blocker?.requiresUser || snapshot.activeTasks > 0) return false;
    return !snapshot.canComplete || contract.phase !== 'verified';
  };
  const continuationPrompt = (taskIds: string[]) => {
    const contract = outcomeManager.current();
    const tasks = (contract?.tasks || []).filter((task: OutcomeTask) => taskIds.includes(task.id));
    const settled = tasks.map((task: OutcomeTask) =>
      `- ${task.id}: ${task.title} · ${task.status}${task.assignment?.integrationStatus ? ` · integration ${task.assignment.integrationStatus}` : ''}`
    );
    return [
      '[ENGINE OUTCOME CONTINUATION — this is not a new user request]',
      `Continue the active outcome: ${contract?.objective || 'the current verified outcome'}`,
      ...(settled.length ? ['Background assignment updates:', ...settled] : []),
      'Act now; do not merely summarize the updates.',
      '1. Inspect each delegated receipt and actual files/results.',
      '2. Integrate isolated changes with OutcomeTool(action:"integrate_task") when required.',
      '3. Run fresh parent-side verification that covers the changed scope.',
      '4. Validate completed delegated tasks only with trusted evidence.',
      '5. Recompute the schedule and immediately dispatch newly-ready independent tasks when that is the fastest safe path.',
      '6. Complete local critical-path work directly and continue until verified, waiting on active work, or genuinely blocked on the user.',
      'Keep the outcome contract current. Never treat a worker report or this wake-up as proof of completion.',
    ].join('\n');
  };
  const attemptOutcomeContinuation = async (): Promise<void> => {
    if (continuationRunning || !continuationEnabled()) return;
    const pending = outcomeManager.continuation();
    if (!pending || pending.state === 'idle') return;
    if (pending.state === 'halted') {
      if (reportedHaltRevision !== pending.revision) {
        reportedHaltRevision = pending.revision;
        cliEvents.emit('message', {
          id: `outcome-halt-${Date.now()}`, role: 'system', level: 'warn',
          content: `Outcome auto-continuation paused safely: ${pending.lastError || 'circuit breaker reached'}`,
          timestamp: new Date(),
        } as MessageEntry);
      }
      return;
    }
    if (session.isBusy) { scheduleOutcomeContinuation(500); return; }
    const claim = outcomeManager.claimContinuation(continuationWakeLimit(), 30_000);
    if (!claim || claim.claimedRevision === undefined) {
      // A prior process may have died during its coordinator wake. The short durable lease avoids
      // double execution while letting this process reclaim it without user babysitting.
      scheduleOutcomeContinuation(1000);
      return;
    }
    continuationRunning = true;
    const before = outcomeManager.progressFingerprint();
    cliEvents.emit('status', `Outcome loop ${claim.wakeups}: coordinating ${claim.taskIds.length || 'remaining'} task(s)…`);
    const result = await session.dispatchAutonomous(continuationPrompt(claim.taskIds));
    const progress = result === 'completed' && before !== outcomeManager.progressFingerprint();
    outcomeManager.completeContinuation(
      claim.claimedRevision,
      progress,
      progress ? undefined : `Coordinator wake ${result === 'completed' ? 'made no measurable outcome progress' : result}.`,
    );
    continuationRunning = false;

    if (result === 'interrupted') {
      cliEvents.emit('status', 'Outcome auto-continuation paused by user interruption.');
      return;
    }
    const after = outcomeManager.continuation();
    if (after?.state === 'halted') { scheduleOutcomeContinuation(); return; }
    if (after?.state === 'pending') { scheduleOutcomeContinuation(progress ? 250 : 1000); return; }
    if (outcomeNeedsAnotherWake()) {
      outcomeManager.requestContinuation([], 'outcome_incomplete');
    }
  };
  const onOutcomeContinuation = (event?: { sessionId?: string }) => {
    if (event?.sessionId && event.sessionId !== outcomeManager.activeSessionId()) return;
    scheduleOutcomeContinuation();
  };
  const onContinuationSessionChanged = () => scheduleOutcomeContinuation(100);
  cliEvents.on('outcome_continuation_requested', onOutcomeContinuation);
  cliEvents.on('session_changed', onContinuationSessionChanged);
  scheduleOutcomeContinuation(100);

  // Token-meter baseline = system prompt + tool-schema JSON (the fixed per-request cost), recomputed
  // on demand so a Smart↔Full context-mode toggle moves the meter. Mirrors FullScreen's calc.
  setTokensBaseline(() => {
    try {
      const mode = ((getConfig().contextMode as 'smart' | 'full') || 'smart');
      const persona = personas.bimax || Object.values(personas)[0];
      const sys = persona?.getSystemPrompt({ planMode: governor?.mode === 'plan', contextMode: mode }) || '';
      let toolTokens = 0;
      try { toolTokens = estimateTokens(JSON.stringify(toolRegistry.getSchemas({ mode }))); } catch { /* registry optional */ }
      return estimateTokens(sys) + toolTokens;
    } catch { return 0; }
  });

  // Settings surface (protocol v3): the allowlisted, JSON-safe subset of CliConfig a graphical
  // front-end may read and write directly — the silent path behind settings pages, replacing
  // transcript menus. Sensitive/engine-internal keys (API keys, workspaceRoot,
  // dangerouslySkipPermissions, onboarding flags) stay OFF the wire on purpose.
  const CONFIG_WIRE_KEYS = [
    'model', 'liteModel', 'fallbackModel', 'subagentModel',
    'temperature', 'topP', 'maxTokens', 'timeout',
    'reasoningEffort', 'contextMode', 'contextWindowTokens', 'parallelToolCalls',
    'maxToolIterations', 'maxSubAgents',
    'autoResumeAgents',
    'notificationBell', 'verbose', 'reducedMotion', 'theme',
    'autoIndex', 'gitAutoCommit', 'autoVerify', 'sandboxBash',
    'autoResumeAgents', 'autoContinueOutcome',
    'selfCritic', 'adversarialVerify', 'diffApproval', 'blastGate',
    'showMapPanel', 'showTokenMeter',
  ] as const;
  const configSubset = (): Record<string, any> => {
    const c = getConfig() as any;
    const out: Record<string, any> = {};
    for (const k of CONFIG_WIRE_KEYS) if (c[k] !== undefined) out[k] = c[k];
    return out;
  };

  const dispose = startStdioHost({
    emitter: cliEvents,
    onInput: (text) => { void session.dispatch(text); },
    onInterrupt: () => session.interrupt(),
    onQuery: (text) => completeInput(text, graphStore, process.cwd()),
    onMenuSelect: (id, value) => session.selectMenu(id, value),
    // Typed recovery resume (protocol v3 additive): same code path as the user's /resume, but
    // requested as a structured message so front-ends never fabricate slash-command text.
    onResume: (id) => { void session.dispatch(`/resume ${id}`); },
    onControls: async ({ mode, tier, autonomy }) => {
      // One wire message, one serialized sequence. In particular, every non-plan autonomy preset
      // exits plan mode first, so the chrome can never claim edits are enabled while PLAN still
      // blocks them in the governor.
      const { getAgentMode } = require('../cli/agentMode') as typeof import('../cli/agentMode');
      const preservedMode = getAgentMode();
      const commands: Record<string, string[]> = {
        ask: ['/plan off', '/governor on', '/diff-approval on'],
        auto: ['/plan off', '/governor on', '/diff-approval off'],
        plan: ['/plan on'],
        full: ['/plan off', '/governor off', '/diff-approval off'],
      };
      for (const command of autonomy ? commands[autonomy] ?? [] : []) await session.dispatch(command);
      // /plan on|off emits the legacy mode_change event for the TUI. Re-apply the behavioral mode
      // afterwards so Code/Beast/Explore/Sketch never visually collapse to General, and their
      // governor gate remains the final authority for combinations such as Explore + Full auto.
      if (mode || autonomy) await session.dispatch(`/mode ${mode ?? preservedMode}`);
      if (tier) await session.dispatch(`/tier ${tier}`);
    },
    onConfigGet: configSubset,
    onConfigSet: async (patch) => {
      const safe: Record<string, any> = {};
      for (const k of CONFIG_WIRE_KEYS) if (patch[k] !== undefined) safe[k] = patch[k];
      if (Object.keys(safe).length > 0) {
        await saveConfig(safe as any);
        cliEvents.emit('config_changed'); // re-snapshot + notify every attached front-end
      }
      return configSubset();
    },
  });

  // Liveness heartbeat for the supervising front-end (desktop): a `health` line every few seconds
  // carrying event-loop responsiveness, memory, and whether a turn is executing. The desktop uses
  // the stream (not its content) to detect a wedged engine — and `activeTurn` to avoid mistaking
  // legitimate long work for a hang. BIMAX_HEARTBEAT_MS tunes the cadence; 0 disables.
  const heartbeatMs = Number(process.env.BIMAX_HEARTBEAT_MS ?? 3000);
  let stopHeartbeat: (() => void) | null = null;
  if (heartbeatMs > 0) {
    const { monitorEventLoopDelay } = require('node:perf_hooks') as typeof import('node:perf_hooks');
    const loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();
    const emitHeartbeat = () => {
      const mem = process.memoryUsage();
      const msg = {
        t: 'health' as const,
        uptimeMs: Math.round(process.uptime() * 1000),
        rssMb: Math.round(mem.rss / (1024 * 1024)),
        heapMb: Math.round(mem.heapUsed / (1024 * 1024)),
        eventLoopDelayMs: Math.round(loopDelay.percentile(99) / 1e6),
        activeTurn: session.isBusy,
        phase: 'ready' as const,
      };
      loopDelay.reset();
      try { process.stdout.write(JSON.stringify(msg) + '\n'); } catch { /* parent gone */ }
    };
    // Establish liveness before optional background services (MCP/code-memory/headroom) get their
    // first timer turn. The supervisor can now detect and recover a connector that wedges startup.
    emitHeartbeat();
    const timer = setInterval(emitHeartbeat, heartbeatMs);
    timer.unref(); // the heartbeat must never keep a shutting-down engine alive
    stopHeartbeat = () => { clearInterval(timer); loopDelay.disable(); };
  }

  // Register the inline diff-approval gate over the protocol (Ink registers its own in FullScreen).
  // When the user enables /diff-approval, mutating tools surface their diff and wait for a reply.
  const { registerDiffApprover } = require('../cli/diffApproval');
  registerDiffApprover((summary: string, diff: string) => new Promise<boolean>((resolve) => {
    cliEvents.emit('diff_prompt', summary, diff, (answer: string) => resolve(/^(a|y|approve|accept)/i.test(answer)));
  }));

  // Goal mutations land on a separate emitter; FullScreen bridges it to cliEvents for Ink, so the
  // headless path must too — otherwise the footer goal counter (refreshed by ui_snapshot on
  // goals_changed) never updates out-of-process.
  const onGoals = () => cliEvents.emit('goals_changed');
  goalEvents.on('goals_changed', onGoals);

  // Push footer + map-panel + token-meter state the Go front-end can't read from engine singletons.
  startUiSnapshot(graphStore, toolRegistry);

  // Launch-grade first run: an empty key pool opens the real provider picker automatically. The
  // selected provider then uses the protocol's masked input request, saves the key globally, applies
  // it to the live adapter, and opens model discovery — no shell exports or restart required.
  // Delay until the ready handshake is on the wire; if a user turn wins the race, defer instead of
  // interrupting it. BIMAX_SKIP_KEY_ONBOARDING=1 is available for hermetic embeds/tests.
  if (process.env.BIMAX_SKIP_KEY_ONBOARDING !== '1') {
    try {
      const { buildKeyPool } = require('../cli/provider') as typeof import('../cli/provider');
      if (buildKeyPool().length === 0) {
        const offerKeys = (attempt = 0) => {
          if (session.isBusy && attempt < 20) {
            const timer = setTimeout(() => offerKeys(attempt + 1), 500);
            timer.unref?.();
            return;
          }
          if (!session.isBusy) void session.dispatch('/keys');
        };
        const timer = setTimeout(() => offerKeys(), 350);
        timer.unref?.();
      }
    } catch { /* onboarding must never block engine readiness */ }
  }

  // Mind layer wake-up: one QUICK drives measurement at boot (cheap signals only — a grep and a
  // git status, strictly sequential, never builds/tests) so the footer's 🧠 strip and the DRIVES
  // prompt section reflect reality from the first turn instead of waiting for a manual
  // /drives check. Fire-and-forget; re-snapshots when done. BIMAX_DRIVES_BOOT=0 disables.
  if (process.env.BIMAX_DRIVES_BOOT !== '0' && isCodebase(process.cwd())) {
    void (async () => {
      try {
        const { getDrivesEngine } = require('../mind/drives.engine');
        await getDrivesEngine().check({ quick: true });
        cliEvents.emit('mind_changed');
      } catch { /* best-effort */ }
    })();
  }

  // Self-heal a stale/invalid model pin (e.g. config.json points at a model from a different
  // provider) so the first turn doesn't 400. Non-blocking — runs concurrently with `ready` so it
  // never delays startup; if the user's first turn beats it, the agent loop's model-404 message
  // covers that one turn. Persists the switch so the next launch is already correct.
  void (async () => {
    try {
      const healed = await llmAdapter.healModel();
      if (healed) {
        try { saveConfig({ model: healed.to } as any); } catch { /* persistence optional */ }
        cliEvents.emit('message', {
          id: `heal-${Date.now()}`, role: 'system', level: 'info',
          content: `Model "${healed.from}" isn't available on your provider — switched to "${healed.to}". Use /model to choose another.`,
          timestamp: new Date(),
        } as MessageEntry);
        cliEvents.emit('config_changed');
      }
    } catch { /* best-effort */ }
  })();

  // First-run onboarding (parity with Ink's FullScreen): inside a real project with no map yet,
  // offer to build the AST index; once it exists, offer the AI (semantic) layer. Each offer is a
  // menu the front-end renders; selecting an option dispatches the matching slash command. Both are
  // gated on config.onboardingComplete so we never nag twice. Off entirely outside a codebase, so a
  // scratch dir (~ / Desktop) never indexes hundreds of thousands of junk nodes.
  const uiMenu = (title: string, options: any[]): MessageEntry => ({
    id: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: 'system', uiComponent: 'menu', payload: { title, options }, content: '', timestamp: new Date(),
  });
  let aiOffered = false;
  const onboardingDone = () => { try { return !!getConfig().onboardingComplete; } catch { return false; } };
  const nodeCount = () => { try { return summarizeGraph(graphStore).nodeCount; } catch { return 0; } };

  // After a map is built, offer the AI graph once (the indexer emits graph_changed on completion).
  cliEvents.on('graph_changed', () => {
    if (aiOffered || onboardingDone()) return;
    let s; try { s = summarizeGraph(graphStore); } catch { return; }
    if (s.nodeCount > 0 && !s.aiGraphBuilt) {
      aiOffered = true;
      try { saveConfig({ onboardingComplete: true } as any); } catch { /* best-effort */ }
      cliEvents.emit('message', uiMenu('Add the AI graph? (semantic layer: purpose + risk per symbol)', [
        { label: '[ Build AI graph ]', value: '/index-ai force', desc: 'Makes API calls — richer impact analysis' },
        { label: '[ Skip ]', value: '', desc: 'You can run /index-ai later' },
      ]));
    }
  });

  // BIMAX_AUTO_INDEX=0: a supervising front-end sheds background indexing on memory-constrained
  // machines (capability `autoIndex`). Config keeps working for everyone else.
  const autoIndexEnabled = () => {
    if (process.env.BIMAX_AUTO_INDEX === '0') return false;
    try { return getConfig().autoIndex !== false; } catch { return true; }
  };

  if (isCodebase(process.cwd()) && nodeCount() === 0) {
    if (autoIndexEnabled()) {
      // autoIndex: true → build the graph in the background automatically (idempotent: autoIndex()
      // no-ops if a graph already exists on disk). THIS is what unlocks the repo map + GraphContext/
      // GraphQuery tools without the user clicking a menu or running /index. Previously "autoIndex"
      // only flipped an enabled flag and nothing ever called it, so the graph stayed empty.
      cliEvents.emit('status', 'Indexing codebase for symbol-level navigation…');
      void codebaseIndexer.autoIndex(false, false).catch(() => { /* best-effort; /index retries */ });
    } else if (!onboardingDone()) {
      // autoIndex off → ask before building (the original onboarding menu).
      setTimeout(() => {
        if (nodeCount() !== 0 || onboardingDone()) return;
        cliEvents.emit('message', uiMenu('New codebase detected — build the map graph?', [
          { label: '[ Build map graph ]', value: '/index force', desc: 'AST index so I navigate to the exact symbol (skips node_modules, .git, build dirs)' },
          { label: '[ Skip ]', value: '', desc: 'You can run /index later' },
        ]));
      }, 600);
    }
  }

  await new Promise<void>((resolve) => {
    let done = false;
    const shutdown = () => {
      if (done) return;
      done = true;
      // Signals/stdin loss do not necessarily travel through cliEvents. Flush every durable
      // thread domain directly so the latest assignment/evidence cannot vanish on terminal close.
      try { outcomeManager.shutdown(); } catch { /* best-effort */ }
      try { reviewManager.shutdown(); } catch { /* best-effort */ }
      try { sessionRecorder.shutdown(); } catch { /* best-effort */ }
      stopHeartbeat?.();
      if (recoveryTimer) clearTimeout(recoveryTimer);
      if (continuationTimer) clearTimeout(continuationTimer);
      cliEvents.off('agent_recovery_available', onAgentRecoveryAvailable);
      cliEvents.off('outcome_continuation_requested', onOutcomeContinuation);
      cliEvents.off('session_changed', onContinuationSessionChanged);
      goalEvents.off('goals_changed', onGoals);
      dispose();
      resolve();
    };
    cliEvents.once('shutdown', shutdown);
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    // If the front-end (our stdin) goes away, the parent process is gone — exit cleanly.
    process.stdin.once('end', shutdown);
    process.stdin.once('close', shutdown);
  });
}

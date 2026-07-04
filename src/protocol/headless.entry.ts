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

  const personas = buildPersonas(toolRegistry, llmAdapter);
  const session = new HeadlessSession({
    personas,
    options,
    graphStore,
    codebaseIndexer,
  });

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

  const dispose = startStdioHost({
    emitter: cliEvents,
    onInput: (text) => { void session.dispatch(text); },
    onInterrupt: () => session.interrupt(),
    onQuery: (text) => completeInput(text, graphStore, process.cwd()),
    onMenuSelect: (id, value) => session.selectMenu(id, value),
  });

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
  startUiSnapshot(graphStore);

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

  const autoIndexEnabled = () => { try { return getConfig().autoIndex !== false; } catch { return true; } };

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
    const shutdown = () => { if (done) return; done = true; goalEvents.off('goals_changed', onGoals); dispose(); resolve(); };
    cliEvents.once('shutdown', shutdown);
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    // If the front-end (our stdin) goes away, the parent process is gone — exit cleanly.
    process.stdin.once('end', shutdown);
    process.stdin.once('close', shutdown);
  });
}

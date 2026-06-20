import { cliEvents } from '../cli/events';
import { buildPersonas } from '../cli/personas/factory';
import { HeadlessSession } from './headless.session';
import { startStdioHost } from './stdio.host';
import { startUiSnapshot } from './ui.snapshot';
import { completeInput } from './completions';

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

  const session = new HeadlessSession({
    personas: buildPersonas(toolRegistry, llmAdapter),
    options,
    graphStore,
    codebaseIndexer,
  });

  const dispose = startStdioHost({
    emitter: cliEvents,
    onInput: (text) => { void session.dispatch(text); },
    onInterrupt: () => { /* TODO: cancel the in-flight turn once persona.execute is cancelable */ },
    onQuery: (text) => completeInput(text, graphStore, process.cwd()),
  });

  // Push footer state (model names, goal count) the Go front-end can't read from engine singletons.
  startUiSnapshot();

  await new Promise<void>((resolve) => {
    let done = false;
    const shutdown = () => { if (done) return; done = true; dispose(); resolve(); };
    cliEvents.once('shutdown', shutdown);
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    // If the front-end (our stdin) goes away, the parent process is gone — exit cleanly.
    process.stdin.once('end', shutdown);
    process.stdin.once('close', shutdown);
  });
}

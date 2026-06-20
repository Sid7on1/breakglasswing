#!/usr/bin/env node
// Buffer boot logs so they don't fight Ink's stdout
const bootLogs: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

function startBootCapture() {
  console.log = (...args: any[]) => { bootLogs.push(args.join(' ')); };
  console.warn = (...args: any[]) => { bootLogs.push(`[WARN] ${args.join(' ')}`); };
  console.error = (...args: any[]) => { bootLogs.push(`[ERROR] ${args.join(' ')}`); };
}

// Start capturing IMMEDIATELY before imports trigger prints
startBootCapture();

import * as fs from 'fs';
import dotenv from 'dotenv';
import { loadGlobalEnv } from './cli/env.loader';
loadGlobalEnv();
dotenv.config();
import { Command } from 'commander';
import { createContainer } from './core/container';
import { resolveTheme } from './cli/themes';
import { loadConfig, getConfig } from './cli/config';
import { setCustomRoutingRules } from './cli/agentRouter';
import { cliEvents } from './cli/events';
import { setGlobalPatternStore, GenomePatternStore } from './genome/pattern.store';
import { setGlobalRecipeLoader, RecipeLoader } from './recipes/recipe.loader';
import { setContextManagerGraphStore } from './memory/context.manager';

const program = new Command();

program
  .name('bimax')
  .description('BiMax — Autonomous AI agent for your terminal')
  .version('1.0.0')
  .argument('[prompt]', 'Prompt to run in non-interactive mode')
  .option('-p, --print', 'Non-interactive mode: print response and exit')
  .option('-m, --model <model>', 'Model override (e.g. gpt-4, claude-opus)')
  .option('-t, --theme <theme>', 'Color theme: dark, light, dark-ansi, light-ansi, dark-daltonized, light-daltonized, auto', 'auto')
  .option('-a, --agent <agent>', 'Agent persona: bimax, hermes, opencode, openclaw', 'bimax')
  .option('-v, --verbose', 'Verbose output')
  .option('-o, --output-format <format>', 'Output format: text, json, stream-json', 'text')
  .option('-y, --yes', 'Skip all permission prompts')
  .option('--print-with-tools', 'Include tool call output in print mode')
  .option('--dangerously-skip-permissions', 'Skip all permission prompts');

program.parse(process.argv);

const cliFlags = program.opts();
const prompt = program.args[0];

// Boot log capture moved to top of file

function replayBootLogs() {
  // Give Ink a moment to mount and take over console
  setTimeout(() => {
    for (const msg of bootLogs) {
      cliEvents.emit('log', { id: 0, level: 'info', text: msg, timestamp: new Date() });
    }
    bootLogs.length = 0;
  }, 100);
}

// 4. Graceful Boot Error Handling (API-006)
process.on('uncaughtException', (err) => {
  const msg = `[FATAL] Uncaught Exception: ${err.message}\n${err.stack}`;
  fs.appendFileSync('fatal-crash.log', new Date().toISOString() + ' ' + msg + '\n');
  
  if (bootLogs.length > 0) {
    originalConsoleError(msg);
  } else {
    cliEvents.emit('message', { id: `crash-${Date.now()}`, role: 'assistant', content: `❌ **CRITICAL CRASH:** ${err.message}`, timestamp: new Date() });
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  const msg = `[FATAL] Unhandled Rejection at: ${promise}, reason: ${reason}`;
  fs.appendFileSync('fatal-crash.log', new Date().toISOString() + ' ' + msg + '\n');
  if (bootLogs.length > 0) {
    originalConsoleError(msg);
  } else {
    cliEvents.emit('message', { id: `crash-${Date.now()}`, role: 'assistant', content: `❌ **UNHANDLED REJECTION:** ${reason}`, timestamp: new Date() });
  }
});

async function main() {
  // `bimax mcp` — serve the project's code graph over MCP stdio (A4). Must intercept before
  // any other boot so "mcp" isn't treated as a prompt, and before normal logging starts.
  if (program.args[0] === 'mcp') {
    const { runGraphMcpStdioServer } = await import('./mcp/server');
    await runGraphMcpStdioServer(process.cwd());
    return;
  }

  const config = await loadConfig();
  if (config.customRoutingRules.length > 0) {
    setCustomRoutingRules(config.customRoutingRules);
  }

  const effectiveAgent = cliFlags.agent || config.defaultAgent;
  const effectiveModel = cliFlags.model || config.model;
  const effectiveVerbose = cliFlags.verbose || config.verbose;
  const effectiveTheme = resolveTheme(cliFlags.theme === 'auto' ? config.theme : cliFlags.theme);
  const effectiveSkipPerms = cliFlags.dangerouslySkipPermissions || cliFlags.yes || config.dangerouslySkipPermissions;

  const container = await createContainer(config);
  const { toolRegistry, llmAdapter, governor, codebaseIndexer, taskPipeline, graphStore } = container;
  governor.mode = effectiveSkipPerms ? 'bypass' : 'interactive';

  // Wire genome pattern store, recipe loader, and graph store for context injection
  setGlobalPatternStore(new GenomePatternStore(process.cwd()));
  setGlobalRecipeLoader(new RecipeLoader(process.cwd()));
  if (graphStore) setContextManagerGraphStore(graphStore);

  if (prompt && cliFlags.print) {
    const { executePrintMode } = await import('./cli/print');
    await executePrintMode(prompt, {
      agent: effectiveAgent,
      model: effectiveModel,
      theme: effectiveTheme,
      verbose: effectiveVerbose,
      outputFormat: cliFlags.outputFormat,
      ...container,
    });
    process.exit(0);
  }

  // Headless mode — drive the engine over an NDJSON stdio protocol instead of mounting Ink.
  // This is the process an out-of-process front-end (the Go / Bubble Tea TUI) spawns. Forked here:
  // after the container is wired, before Ink would take the TTY. The Ink path below is untouched.
  if (process.env.BIMAX_HEADLESS === '1' || cliFlags.headless) {
    const { startHeadless } = await import('./protocol/headless.entry');
    await startHeadless(container, config);
    process.exit(0);
  }

  // Restore console — no Ink to fight for stdout anymore.
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;

  // The interactive TUI is now the `bimax` binary (Go / Bubble Tea), which spawns this engine
  // headless (BIMAX_HEADLESS=1) and drives it over the NDJSON stdio protocol. The old in-process
  // Ink frontend has been retired (archived under ~/Desktop/ink-bimax). Reaching here means the
  // engine was launched directly without a front-end, so there's nothing to render.
  originalConsoleError(
    'BiMax engine started with no front-end.\n' +
    '  • Interactive use:   run the `bimax` binary (the Go/Bubble Tea TUI).\n' +
    '  • One-shot use:      bimax -p "<prompt>"\n' +
    '  • Embed a front-end: spawn this with BIMAX_HEADLESS=1 and speak the stdio protocol.',
  );
  process.exit(0);
}

main().catch((e) => {
  // Restore console in case of crash
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
  console.error('Fatal error:', e);
  process.exit(1);
});


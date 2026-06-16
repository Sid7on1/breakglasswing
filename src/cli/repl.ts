import React from 'react';
import { render } from 'ink';
import { TaskPipeline } from '../task';
import { CodebaseIndexer } from '../graph/indexer';
import { GraphStore } from '../graph/graph.store';
import { GlobalPrompter } from './prompter';
import { FullScreen } from './screens/FullScreen';
import { setInkInstance } from './inkInstance';
import { ThemeName } from './themes';
import { ToolRegistry } from '../tools/tool.registry';
import { LlmAdapter } from '../core/llm.adapter';
import { Governor } from '../governor/governor';
import { progress } from './notify';

export interface ReplOptions {
  agent: string;
  model?: string;
  theme: ThemeName;
  verbose: boolean;
  dangerouslySkipPermissions: boolean;
  toolRegistry: ToolRegistry;
  llmAdapter: LlmAdapter;
  governor: Governor;
  notificationBell?: boolean;
  maxToolIterations?: number;
  persona: any;
}

export async function startRepl(
  taskPipeline: TaskPipeline,
  codebaseIndexer: CodebaseIndexer,
  graphStore: GraphStore,
  options: ReplOptions,
) {
  GlobalPrompter.register();

  // Open clean and full-screen, like Claude Code: wipe the terminal AND its scrollback so bimax
  // starts at the top of an empty screen instead of below whatever was already in the terminal.
  try { process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); } catch { /* non-TTY: nothing to clear */ }

  const instance = render(
    React.createElement(FullScreen, {
      taskPipeline,
      codebaseIndexer,
      graphStore,
      options,
    }),
  );
  // Expose the instance so the resize handler can reset Ink's frame tracking (kills resize ghosts).
  setInkInstance(instance);

  // Make sure any lingering OSC 9;4 terminal progress indicator is cleared on exit.
  process.once('exit', () => { try { progress(null); } catch { /* stdout may be gone */ } });
}

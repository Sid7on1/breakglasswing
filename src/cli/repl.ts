import React from 'react';
import { render } from 'ink';
import { TaskPipeline } from '../task';
import { CodebaseIndexer } from '../graph/indexer';
import { GraphStore } from '../graph/graph.store';
import { GlobalPrompter } from './prompter';
import { FullScreen } from './screens/FullScreen';
import { ThemeName } from './themes';
import { ToolRegistry } from '../tools/tool.registry';
import { LlmAdapter } from '../core/llm.adapter';
import { Governor } from '../governor/governor';

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

  render(
    React.createElement(FullScreen, {
      taskPipeline,
      codebaseIndexer,
      graphStore,
      options,
    }),
  );
}

import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as path from 'path';
import { Box, Text, useInput, useApp } from 'ink';
import { SkillLoader, DynamicPersona } from '../skills.loader';
import { SimpleInput } from '../components/SimpleInput';
import { cliEvents, LogEntry, MessageEntry } from '../events';
import { AgentSpinner } from '../components/AgentSpinner';
import { GlobalPrompter } from '../prompter';
import { globalCommandRegistry, CommandResult, CommandContext } from '../commands/registry';
import '../commands'; 
import { Footer } from '../components/Footer';
import { PermissionDialog } from '../components/PermissionDialog';
import { Transcript } from '../components/Transcript';
import { StatusLine } from '../components/StatusLine';
import { Markdown } from '../components/Markdown';
import { LogView } from '../components/LogView';
import { DiffView } from '../components/DiffView';
import { SearchHighlight } from '../components/SearchHighlight';
import { ThinkingText } from '../components/ThinkingText';
import { InteractiveMenu, MenuOption } from '../components/InteractiveMenu';
import { InteractivePrompt } from '../components/InteractivePrompt';
import { getTheme, ThemeName } from '../themes';
import { useAltScreen } from '../hooks/useAltScreen';
import { TaskPipeline } from '../../task';
import { CodebaseIndexer } from '../../graph/indexer';
import { GraphStore } from '../../graph/graph.store';
import { ToolRegistry } from '../../tools/tool.registry';
import { LlmAdapter } from '../../core/llm.adapter';
import { Governor } from '../../governor/governor';
import { BiMaxPersona, HermesPersona, OpenCodePersona, OpenClawPersona } from '../personas/implementations';
import { AgentPersona } from '../personas/base.persona';
import { SessionStore } from '../session';
import { routeQuery } from '../agentRouter';
import { getGitStatus, gitLog, gitDiff } from '../git';
import { writeWithBackup, undoLast, previewDiff, editFileLines, getBackups } from '../fileEditor';
import { runTypeCheck, runLint, formatErrors } from '../lintFixLoop';
import { getCustomRules, addCustomRule, removeCustomRule, getKnownAgents, registerAgent } from '../agentRouter';
import { getProviders, getProvider, setProvider, getCurrentProvider, buildKeyPool } from '../provider';
import { saveConfig } from '../config';
import { saveApiKeyToEnv } from '../env.loader';
import { globalSubAgentManager } from '../../core/subagent.manager';

interface FullScreenProps {
  taskPipeline: TaskPipeline;
  codebaseIndexer: CodebaseIndexer;
  graphStore: GraphStore;
  options: {
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
    autoAgentDecisions?: boolean;
    persona: AgentPersona;
  };
}

export function FullScreen({ taskPipeline, codebaseIndexer, graphStore, options }: FullScreenProps) {
  const { exit } = useApp();
  const theme = getTheme(options.theme);

  options.governor.mode = options.dangerouslySkipPermissions ? 'bypass' : 'interactive';

  useAltScreen();

  const personasRef = React.useRef<Record<string, AgentPersona> | null>(null);
  if (!personasRef.current) {
    const { toolRegistry, llmAdapter } = options;
    personasRef.current = {
      bimax: new BiMaxPersona(toolRegistry, llmAdapter),
      hermes: new HermesPersona(toolRegistry, llmAdapter),
      opencode: new OpenCodePersona(toolRegistry, llmAdapter),
      openclaw: new OpenClawPersona(toolRegistry, llmAdapter),
    };
    
    // Load dynamic skills
    const loadedSkills = SkillLoader.loadSkills();
    for (const [id, config] of Object.entries(loadedSkills)) {
      personasRef.current[id] = new DynamicPersona(config, toolRegistry, llmAdapter);
    }
  }

  const defaultAgent = options.agent;

  const sessionRef = React.useRef<SessionStore | null>(null);

  useEffect(() => {
    return () => {
      globalSubAgentManager.killAll();
    };
  }, []);

  useEffect(() => {
    sessionRef.current = new SessionStore();
    sessionRef.current.init()
      .then((prev) => {
        if (prev.length > 0) setMessages(prev);
      })
      .catch((e: Error) => {
        addLog('error', `Session init failed: ${e.message}`);
      });
      
    // Startup check for API keys
    const pool = buildKeyPool();
    if (pool.length === 0) {
      setTimeout(() => {
        const providers = getProviders();
        setActiveMenu({
          type: 'keys',
          title: 'Select Provider (Mandatory API Key Required)',
          options: providers.map(p => ({ label: p.name, value: p.name })),
        });
        addLog('warn', 'No API keys configured. An API key is required to use BiMax.');
      }, 500);
    }
  }, []);

  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 0, level: 'info', text: 'BreakGlassWing initialized. Waiting for command...', timestamp: new Date() },
  ]);
  const logCounterRef = useRef(1);
  const [input, setInput] = useState('');
  const [stashedInput, setStashedInput] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [vetoQuestion, setVetoQuestion] = useState<string | null>(null);
  const [vetoOptions, setVetoOptions] = useState<string[]>([]);
  const [vetoResolver, setVetoResolver] = useState<((answer: string) => void) | null>(null);
  const [messages, setMessages] = useState<MessageEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);
  const [streamingText, setStreamingText] = useState('');
  const [streamingToolCalls, setStreamingToolCalls] = useState<import('../events').ToolCallEntry[]>([]);
  const [streamMeta, setStreamMeta] = useState({ elapsed: 0, chars: 0 });
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [activeMenu, setActiveMenu] = useState<{ type: string, options: MenuOption[], title: string, onSelect?: (opt: MenuOption) => void | Promise<void> } | null>(null);
  const [activePrompt, setActivePrompt] = useState<{ title: string, placeholder?: string, isMasked?: boolean, onResolve: (val: string) => void } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const COMMAND_REGISTRY: [string, string][] = [
    ['/help', 'Show help'],
    ['/sessions', 'List saved sessions'],
    ['/resume', 'Resume a session'],
    ['/clear', 'Clear screen'],
    ['/config', 'Show / set config'],
    ['/keys', 'Show / add API keys'],
    ['/model', 'Show / set model'],
    ['/provider', 'Switch AI provider'],
    ['/agents', 'List known agents'],
    ['/check', 'Typecheck project'],
    ['/lint', 'Lint project'],
    ['/edit', 'Search & replace in file'],
    ['/write', 'Write file to disk'],
    ['/undo', 'Undo last edit'],
    ['/diff', 'Git diff'],
    ['/diff-file', 'Diff file vs backup'],
    ['/log', 'Git log'],
    ['/git', 'Git status'],
    ['/backups', 'List backups'],
    ['/routes', 'Routing rules'],
    ['/cost', 'Session cost'],
    ['/context', 'Session context'],
    ['/governor', 'Toggle Governor (on/off)'],
    ['/index', 'Build local AST codebase index'],
    ['/index-ai', 'Run Semantic AI index (Costs API credits)'],
    ['/exit', 'Exit'],
  ];

  const updateSuggestions = useCallback((value: string) => {
    if (value.startsWith('/') && !value.includes(' ')) {
      const partial = value.toLowerCase();
      const matches = COMMAND_REGISTRY
        .filter(([cmd]) => cmd.startsWith(partial))
        .map(([cmd, desc]) => `${cmd}  ${desc}`);
      setSuggestions(matches);
      setSuggestionIndex(matches.length > 0 ? 0 : -1);
    } else {
      setSuggestions([]);
      setSuggestionIndex(-1);
    }
  }, []);

  const addLog = useCallback((level: LogEntry['level'], text: string) => {
    const id = logCounterRef.current++;
    setLogs((prev) => [...prev, { id, level, text, timestamp: new Date() }]);
  }, []);

  const toggleView = useCallback(() => {
    setShowTranscript((v) => !v);
  }, []);

  useInput((char, key) => {
    if (vetoQuestion || activeMenu) return;

    if (isSearching) {
      if (key.return || key.escape) {
        setIsSearching(false);
        setSearchQuery('');
        cliEvents.emit('status', '');
        return;
      }
      return;
    }

    if (key.escape) {
      if (input.trim()) {
        setStashedInput(input);
        setInput('');
        cliEvents.emit('status', 'Prompt stashed');
      }
      return;
    }

    if (key.upArrow) {
      if (suggestions.length > 0) {
        setSuggestionIndex((i) => (i > 0 ? i - 1 : suggestions.length - 1));
      } else if (history.length > 0 && historyIndex < history.length - 1) {
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        setInput(history[history.length - 1 - nextIndex]);
      }
      return;
    }

    if (key.downArrow) {
      if (suggestions.length > 0) {
        setSuggestionIndex((i) => (i < suggestions.length - 1 ? i + 1 : 0));
      } else if (historyIndex > 0) {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        setInput(history[history.length - 1 - nextIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
      return;
    }

    if (char === 'r' && key.ctrl && stashedInput) {
      setInput(stashedInput);
      setStashedInput(null);
      cliEvents.emit('status', 'Stashed prompt resumed');
      return;
    }

    if (char === 'f' && key.ctrl) {
      setIsSearching(true);
      setSearchQuery('');
      cliEvents.emit('status', 'Search: type to filter logs');
      return;
    }

    if (char === 'o' && key.ctrl) {
      toggleView();
      cliEvents.emit('status', showTranscript ? 'Showing logs' : 'Showing transcript');
      return;
    }

    if (char === 'l' && key.ctrl) {
      return;
    }

    if ((char === 'c' && key.ctrl) || (char === 'd' && key.ctrl)) {
      cliEvents.emit('shutdown');
      exit();
      process.exit(0);
    }
  });

  useEffect(() => {
    const handleLog = (entry: LogEntry) => {
      const id = logCounterRef.current++;
      setLogs((prev) => [...prev, { ...entry, id }]);
    };

    const handleMessage = (msg: MessageEntry) => {
      setMessages((prev) => [...prev, msg]);
      sessionRef.current?.append(msg);
    };

    const handleVeto = (question: string, opts: string[], resolver: (answer: string) => void, isAskPrompt: boolean = false) => {
      if (!isAskPrompt && options.dangerouslySkipPermissions) {
        resolver((opts && opts[0]) || 'yes');
        return;
      }
      setVetoQuestion(question);
      setVetoOptions(opts && opts.length > 0 ? opts : ['Yes', 'No', 'Always']);
      setVetoResolver(() => resolver);
    };

    const handleDiff = (diff: string) => setDiffText(diff);

    cliEvents.on('log', handleLog);
    cliEvents.on('message', handleMessage);
    cliEvents.on('veto_prompt', handleVeto);
    cliEvents.on('diff', handleDiff);

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args) => {
      setTimeout(() => cliEvents.emit('log', { id: 0, level: 'info', text: args.join(' '), timestamp: new Date() } as LogEntry), 0);
    };
    console.warn = (...args) => {
      setTimeout(() => cliEvents.emit('log', { id: 0, level: 'warn', text: args.join(' '), timestamp: new Date() } as LogEntry), 0);
    };
    console.error = (...args) => {
      setTimeout(() => cliEvents.emit('log', { id: 0, level: 'error', text: args.join(' '), timestamp: new Date() } as LogEntry), 0);
    };

    return () => {
      cliEvents.off('log', handleLog);
      cliEvents.off('message', handleMessage);
      cliEvents.off('veto_prompt', handleVeto);
      cliEvents.off('diff', handleDiff);
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, [options.dangerouslySkipPermissions]);

  const addSystemMessage = useCallback((level: 'info' | 'error' | 'success' | 'warn', text: string) => {
    let prefix = '';
    if (level === 'error') prefix = '✖ ';
    if (level === 'success') prefix = '✓ ';
    if (level === 'warn') prefix = '⚠ ';
    if (level === 'info') prefix = 'ℹ ';
    
    cliEvents.emit('message', {
      id: `sys-${Date.now()}-${Math.random()}`,
      role: 'system',
      level,
      content: `${prefix}${text}`,
      timestamp: new Date()
    } as MessageEntry);
  }, []);

  const handleSubmit = async (rawQuery: string) => {
    let query = rawQuery;
    
    // Process suggestion selection if active
    if (suggestions.length > 0 && suggestionIndex >= 0) {
      const selected = suggestions[suggestionIndex].split('  ')[0];
      const autoExecute = COMMAND_REGISTRY.map(cmd => cmd[0]);
      
      setSuggestions([]);
      setSuggestionIndex(-1);

      if (autoExecute.includes(selected) && rawQuery !== selected) {
        setInput('');
        query = selected; // Override query with the selected suggestion and fall through
      } else if (rawQuery !== selected) {
        setInput(selected + ' ');
        return;
      }
    }

    setSuggestions([]);
    setSuggestionIndex(-1);
    if (!query.trim()) return;

    if (query === '/clear') {
      setActiveMenu({
        type: 'clear',
        title: 'Clear Screen?',
        options: [
          { label: '[ Clear Everything ]', value: 'yes', desc: 'Wipes chat history and logs' },
          { label: '[ Cancel ]', value: 'no', desc: 'Keep history' }
        ]
      });
      setInput('');
      return;
    }
    
    if (query === '/clear force') {
      setLogs([]);
      setMessages([]);
      setInput('');
      setStreamingText('');
      setStreamingToolCalls([]);
      setStreamMeta({ elapsed: 0, chars: 0 });
      setVetoQuestion(null);
      setVetoOptions([]);
      setVetoResolver(null);
      setDiffText(null);
    }

    if (['/exit', '/quit', 'exit', 'quit'].includes(query.toLowerCase())) {
      cliEvents.emit('shutdown');
      exit();
      process.exit(0);
    }

    if (query.startsWith('/')) {
      try {
        const context: CommandContext = {
          cwd: process.cwd(),
          options,
          codebaseIndexer,
          saveConfig,
          addSystemMessage,
          setActiveMenu,
          setActivePrompt,
          executeCommand: handleSubmit
        };
        
        const result = await globalCommandRegistry.execute(query, context);
        
        if (result.type === 'message') {
          addSystemMessage(result.level, result.content);
        } else if (result.type === 'menu') {
          setActiveMenu(result);
        } else if (result.type === 'prompt') {
          setActivePrompt(result);
        } else if (result.type === 'redirect') {
          handleSubmit(result.command);
        }
      } catch (err: any) {
        if (!err.message.includes('Unknown command')) {
          addSystemMessage('error', err.message);
        }
      }
      setInput('');
      return;
    }

    setHistory((prev) => [...prev, query]);
    setHistoryIndex(-1);

    addLog('info', `❯ ${query}`);
    setInput('');

    const promptUser = (question: string, opts: string[]): Promise<string> =>
      new Promise((resolve) => { cliEvents.emit('veto_prompt', question, opts, resolve); });

    const INSTALL_PATTERNS = [
      { re: /curl\s+.+\|\s*(?:bash|sh|zsh)/i, type: 'curl-pipe' },
      { re: /(?:npm|pnpm|yarn)\s+(?:install|add)\s+-g\s+/i, type: 'npm-global' },
      { re: /brew\s+(?:install|tap)\s+/i, type: 'brew' },
      { re: /pip\d?\s+install\s+/i, type: 'pip' },
      { re: /cargo\s+install\s+/i, type: 'cargo' },
      { re: /go\s+install\s+/i, type: 'go' },
      { re: /gem\s+install\s+/i, type: 'gem' },
      { re: /scoop\s+install\s+/i, type: 'scoop' },
    ];

    const matchedInstall = INSTALL_PATTERNS.find(({ re }) => re.test(query));
    if (matchedInstall) {
      const answer = await promptUser(
        `This looks like a CLI install command. Register the installed tool as a new agent persona?`,
        ['Yes, register agent', 'No, just run normally']
      );
      if (answer.startsWith('Yes')) {
        let agentName = 'custom-cli';
        const npmMatch = query.match(/(?:npm|pnpm|yarn)\s+(?:install|add)\s+-g\s+(\S+)/i);
        const brewMatch = query.match(/brew\s+(?:install|tap)\s+(\S+)/i);
        const pipMatch = query.match(/pip\d?\s+install\s+(\S+)/i);
        const cargoMatch = query.match(/cargo\s+install\s+(\S+)/i);
        if (npmMatch) agentName = npmMatch[1].toLowerCase().replace(/@.*/, '');
        else if (brewMatch) agentName = brewMatch[1].toLowerCase();
        else if (pipMatch) agentName = pipMatch[1].toLowerCase().replace(/[^a-z0-9-]/g, '-');
        else if (cargoMatch) agentName = cargoMatch[1].toLowerCase();
        registerAgent(agentName);
        addCustomRule(`${agentName}|${matchedInstall.type}`, agentName);
        addLog('success', `Auto-registered "${agentName}" agent. Queries about it will route there.`);
      }
    }

    const msgId = `msg-${Date.now()}`;
    cliEvents.emit('message', { id: msgId, role: 'user', content: query, timestamp: new Date() } as MessageEntry);
    const routedAgent = routeQuery(query);
    const active = personasRef.current![routedAgent] || personasRef.current!.bimax;

    cliEvents.emit('spinner_state', 'responding', `Generating...`);
    if (routedAgent !== defaultAgent) {
      addLog('info', `Routing to ${routedAgent} (${routedAgent === 'hermes' ? 'read/search' : routedAgent === 'opencode' ? 'coding' : 'OS'})`);
    }
    setStreamingText('');
    setStreamingToolCalls([]);
    setIsProcessing(true);
    setStreamMeta({ elapsed: 0, chars: 0 });
    const streamStart = Date.now();
    let totalChars = 0;
    const metaTimer = setInterval(() => {
      setStreamMeta((prev) => ({ ...prev, elapsed: Math.floor((Date.now() - streamStart) / 1000) }));
    }, 1000);

    let currentToolCalls: import('../events').ToolCallEntry[] = [];
    const onToolCall = (tc: import('../events').ToolCallEntry) => {
      currentToolCalls.push(tc);
      setStreamingToolCalls([...currentToolCalls]);
    };
    const onToolCallResult = (tc: import('../events').ToolCallEntry) => {
      const idx = currentToolCalls.findIndex(t => t.id === tc.id);
      if (idx !== -1) currentToolCalls[idx] = tc;
      setStreamingToolCalls([...currentToolCalls]);
    };
    cliEvents.on('tool_call', onToolCall);
    cliEvents.on('tool_call_result', onToolCallResult);

    let tokenBuffer = '';
    let lastRenderTime = Date.now();

    try {
      await active.execute(query, (token: string) => {
        totalChars += token.length;
        tokenBuffer += token;
        
        const now = Date.now();
        if (now - lastRenderTime > 50) {
          setStreamingText((prev) => prev + tokenBuffer);
          setStreamMeta((m) => ({ ...m, chars: totalChars }));
          tokenBuffer = '';
          lastRenderTime = now;
        }
      }, { maxIterations: options.maxToolIterations });

      if (tokenBuffer) {
        setStreamingText((prev) => prev + tokenBuffer);
        setStreamMeta((m) => ({ ...m, chars: totalChars }));
      }

      clearInterval(metaTimer);
      cliEvents.emit('cost_update', totalChars);
      cliEvents.off('tool_call', onToolCall);
      cliEvents.off('tool_call_result', onToolCallResult);

      const msgs = active.messages;
      const lastResp = [...msgs].reverse().find((m: any) => m.role === 'assistant');
      if (lastResp) {
        let cleanedContent = lastResp.content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
        cleanedContent = cleanedContent.replace(/<tool_call>[\s\S]*/, '').trim();

        cliEvents.emit('message', {
          id: `msg-${Date.now()}-resp`,
          role: 'assistant',
          content: cleanedContent,
          toolCalls: currentToolCalls,
          timestamp: new Date(),
        } as import('../events').MessageEntry);
      }

      setStreamingText('');
      setStreamingToolCalls([]);
      setIsProcessing(false);
      cliEvents.emit('spinner_state', 'idle', 'Awaiting orders...');
      if (options.notificationBell !== false && totalChars > 0) {
        process.stdout.write('\x07');
      }
    } catch (e: any) {
      clearInterval(metaTimer);
      cliEvents.off('tool_call', onToolCall);
      cliEvents.off('tool_call_result', onToolCallResult);
      setStreamingText('');
      setStreamingToolCalls([]);
      setIsProcessing(false);
      addLog('error', `Agent error: ${e.message}`);
      cliEvents.emit('spinner_state', 'idle', 'Awaiting orders...');
    }
  };
  const handleMenuSelect = async (option: MenuOption) => {
    const currentMenu = activeMenu;
    setActiveMenu(null);
    if (!currentMenu) return;

    if (currentMenu.onSelect) {
      await currentMenu.onSelect(option);
      return;
    }

    const menuType = currentMenu.type;
    
    if (menuType === 'provider') {
      const found = setProvider(option.value);
      if (found) {
        addSystemMessage('success', `Switched to ${found.name} (${found.baseURL})`);
        addSystemMessage('info', `Set ${found.apiKeyEnv} env var for API key`);
        saveApiKeyToEnv('BGW_PROVIDER', option.value);
      }
    } else if (menuType === 'session') {
      handleSubmit(`/resume ${option.value}`);
    } else if (menuType === 'help' || menuType === 'context') {
      if (option.value.startsWith('/')) {
        handleSubmit(option.value);
      }
    } else if (menuType === 'routes') {
      if (option.value === 'add_rule') {
        setActivePrompt({
          title: 'Enter Regex Pattern',
          onResolve: (regexStr) => {
            if (!regexStr.trim()) return;
            setActivePrompt({
              title: 'Enter Target Agent',
              onResolve: (agentStr) => {
                if (agentStr.trim()) {
                  handleSubmit(`/routes add ${regexStr.trim()} ${agentStr.trim()}`);
                }
              }
            });
          }
        });
      } else if (option.value.startsWith('delete:')) {
        const id = parseInt(option.value.split(':')[1], 10);
        handleSubmit(`/routes rm ${id}`);
      }
    } else if (['index', 'index-ai', 'check', 'lint'].includes(menuType)) {
      if (option.value !== 'cancel') {
        handleSubmit(option.value);
      }
    } else if (menuType === 'clear') {
      if (option.value === 'yes') {
        handleSubmit('/clear force');
      }
    } else if (menuType === 'undo') {
      handleSubmit(`/undo ${option.value}`);
    } else if (menuType === 'agent') {
      options.agent = option.value;
      saveConfig({ defaultAgent: option.value }).then(() => {
        addSystemMessage('success', `Agent persona switched to ${option.value}`);
      });
    } else if (menuType === 'backup') {
      handleSubmit(`/diff-file ${option.value}`);
    } else if (menuType === 'model') {
      await saveConfig({ model: option.value });
      addSystemMessage('success', `Switched model to ${option.value}`);
    } else if (menuType === 'keys') {
      const providerName = option.value;
      setActiveMenu(null);
      setActivePrompt({
        title: `Enter API Key for ${providerName}`,
        isMasked: true,
        onResolve: (keyStr) => {
          if (!keyStr.trim()) {
            if (buildKeyPool().length === 0) {
              addSystemMessage('error', 'API Key is mandatory. Please select a provider and enter a key.');
              const providers = getProviders();
              setActiveMenu({
                type: 'keys',
                title: 'Select Provider (Mandatory API Key Required)',
                options: providers.map(p => ({ label: p.name, value: p.name })),
              });
            } else {
              addSystemMessage('warn', 'Key input cancelled.');
            }
            return;
          }
          const providers = getProviders();
          const match = providers.find(p => p.name === providerName);
          if (match) {
            try {
              saveApiKeyToEnv(match.apiKeyEnv, keyStr.trim());
              process.env[match.apiKeyEnv] = keyStr.trim();
              addSystemMessage('success', `${match.apiKeyEnv} saved to ~/.breakglass/.env!`);
            } catch (e: any) {
              addSystemMessage('error', `Failed to save key: ${e.message}`);
            }
          }
        }
      });
      return;
    } else if (menuType === 'config') {
      // Just populate the input box so they can type the value
      setInput(`/config set ${option.value} `);
    } else if (menuType === 'governor') {
      const isBypass = option.value === 'off';
      options.governor.mode = isBypass ? 'bypass' : 'interactive';
      addSystemMessage('success', isBypass ? 'Governor bypassed. All actions will be auto-approved.' : 'Governor is active. Constraints and vetoes will apply.');
    } else if (menuType === 'agent-decisions') {
      const isAuto = option.value === 'on';
      options.autoAgentDecisions = isAuto;
      saveConfig({ autoAgentDecisions: isAuto });
      addSystemMessage('success', isAuto ? 'Auto Agent Decisions ENABLED. Ambiguities will be auto-resolved.' : 'Auto Agent Decisions DISABLED.');
    }
  };

  const handleMenuCancel = () => {
    if (activeMenu?.type === 'keys' && buildKeyPool().length === 0) {
      addSystemMessage('warn', 'API Key is mandatory to use BiMax. Please select a provider.');
      return;
    }
    setActiveMenu(null);
  };

  const handleVetoSubmit = (answer: string) => {
    if (vetoResolver) {
      vetoResolver(answer);
      setVetoQuestion(null);
      setVetoOptions([]);
      setVetoResolver(null);
    }
  };

  const handleVetoCancel = () => {
    if (vetoResolver) {
      vetoResolver('');
      setVetoQuestion(null);
      setVetoOptions([]);
      setVetoResolver(null);
    }
  };

  const filteredLogs = isSearching && searchQuery
    ? logs.filter((l) => l.text.toLowerCase().includes(searchQuery.toLowerCase()))
    : logs;

  return (
    <>
      <Box flexDirection="column" width="100%" height="100%" padding={1}>
        <StatusLine
          theme={theme}
          model={options.model || 'default'}
          governorBypassed={options.governor.mode === 'bypass'}
          streamMeta={streamingText || streamingToolCalls.length > 0 ? streamMeta : undefined}
        />

        {showTranscript ? (
          <Transcript messages={messages} theme={theme} searchQuery={isSearching ? searchQuery : ''} />
        ) : (
          <LogView logs={filteredLogs} theme={theme} searchQuery={isSearching ? searchQuery : ''} />
        )}

        <Box flexDirection="column" paddingX={1} marginTop={1} minHeight={1}>
          {(isProcessing || streamingText || streamingToolCalls.length > 0) ? (
            <Box flexDirection="column" width="100%">
              <Text bold color={theme.accent}>Assistant</Text>
              
              {isProcessing && !streamingText.trim() && (
                <Box marginTop={1}>
                  <ThinkingText theme={theme} />
                </Box>
              )}

              {streamingText.trim() ? (
                <Box marginTop={1}>
                  <Markdown theme={theme}>{streamingText}</Markdown>
                </Box>
              ) : null}
              
              {streamingToolCalls.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                  {streamingToolCalls.map(call => {
                    const isError = call.status === 'error';
                    const isRunning = call.status !== 'success' && !isError;
                    const statusColor = call.status === 'success' ? theme.success
                      : isError ? theme.error
                      : theme.warning;

                    let displayCommand = '';
                    try {
                      const parsed = JSON.parse(call.input);
                      if (call.toolName === 'BashTool' && parsed.command) {
                        displayCommand = parsed.command;
                      } else if ((call.toolName === 'WriteFileTool' || call.toolName === 'ReadFileTool') && parsed.filePath) {
                        displayCommand = parsed.filePath.split('/').pop() || parsed.filePath;
                      } else {
                        displayCommand = call.input.substring(0, 60).replace(/\n/g, ' ');
                      }
                    } catch {
                      displayCommand = call.input.substring(0, 60).replace(/\n/g, ' ');
                    }

                    const icon = call.toolName === 'BashTool' ? '⚡'
                      : call.toolName === 'WriteFileTool' ? '📝'
                      : call.toolName === 'ReadFileTool' ? '👀'
                      : '🔧';

                    return (
                      <Box key={call.id} flexDirection="column" marginLeft={2}>
                        <Box>
                          <Text color={statusColor} bold>
                            {'  ⎿ '}{icon} {call.toolName.replace('Tool', '')}
                          </Text>
                          <Text color={theme.subtle}>
                            {' '}· {displayCommand}
                          </Text>
                          <Text color={theme.inactive}>
                            {' '}{call.status === 'success' ? '✓' : isError ? '✗' : '...'}
                          </Text>
                          {isRunning && (
                            <Box marginLeft={1}>
                              <AgentSpinner theme={theme} />
                            </Box>
                          )}
                        </Box>
                        {isError && Boolean(call.output) && (
                          <Box marginLeft={4} borderStyle="round" borderColor={theme.error} paddingX={1}>
                            <Text color={theme.error}>{call.output.substring(0, 200)}</Text>
                          </Box>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          ) : (
            <Box minHeight={1}>
              <Text color={theme.subtle}> </Text>
            </Box>
          )}
        </Box>

        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={theme.border}>
          {Boolean(vetoQuestion) && (
            <PermissionDialog
              theme={theme}
              question={vetoQuestion as string}
              options={Array.isArray(vetoOptions) && vetoOptions.length > 0 ? vetoOptions : ['Yes', 'No', 'Always']}
              onSubmit={handleVetoSubmit}
              onCancel={handleVetoCancel}
            />
          )}

          <Box flexDirection="column" paddingX={1} marginTop={1}>
            {suggestions.length > 0 && (
              <Box 
                flexDirection="column" 
                marginBottom={1} 
                borderStyle="round" 
                borderColor={theme.borderFocus}
                paddingX={1}
                width={70}
              >
                <Text color={theme.subtle} bold>Command Palette [↑/↓ to navigate, Enter to select]</Text>
                <Box marginBottom={1}>
                  <Text color={theme.subtle}>{'—'.repeat(65)}</Text>
                </Box>
                {(() => {
                  const windowSize = 6;
                  let startIdx = 0;
                  if (suggestions.length > windowSize) {
                    if (suggestionIndex < windowSize / 2) {
                      startIdx = 0;
                    } else if (suggestionIndex >= suggestions.length - windowSize / 2) {
                      startIdx = suggestions.length - windowSize;
                    } else {
                      startIdx = Math.max(0, suggestionIndex - Math.floor(windowSize / 2));
                    }
                  }
                  return suggestions.slice(startIdx, startIdx + windowSize).map((s, idx) => {
                    const actualIdx = startIdx + idx;
                    const parts = s.split('  ');
                    const cmd = parts[0];
                    const desc = parts.slice(1).join('  ');
                    return (
                      <Box key={cmd} flexDirection="row">
                        <Box width={2}>
                          <Text color={actualIdx === suggestionIndex ? theme.accent : theme.subtle}>{actualIdx === suggestionIndex ? '❯' : ' '}</Text>
                        </Box>
                        <Box width={15}>
                          <Text color={theme.accent} bold={actualIdx === suggestionIndex}>{cmd}</Text>
                        </Box>
                        <Box flexGrow={1}>
                          <Text color={theme.subtle}>{desc}</Text>
                        </Box>
                      </Box>
                    );
                  });
                })()}
              </Box>
            )}
            
            {Boolean(stashedInput) && (
              <Box>
                <Text color={theme.subtle}>
                  [Stashed] Press Ctrl+R to resume
                </Text>
              </Box>
            )}
            {activeMenu ? (
              <InteractiveMenu
                theme={theme}
                title={activeMenu.title}
                options={activeMenu.options}
                onSelect={handleMenuSelect}
                onCancel={handleMenuCancel}
                enableSearch={activeMenu.type === 'help'}
              />
            ) : activePrompt ? (
              <InteractivePrompt
                theme={theme}
                title={activePrompt.title}
                placeholder={activePrompt.placeholder}
                onSubmit={(val) => { activePrompt.onResolve(val); setInput(''); setActivePrompt(null); }}
                onCancel={() => {  
                  if (buildKeyPool().length === 0) {
                    addSystemMessage('error', 'API Key is mandatory. Please select a provider and enter a key.');
                    const providers = getProviders();
                    setActivePrompt(null);
                    setActiveMenu({
                      type: 'keys',
                      title: 'Select Provider (Mandatory API Key Required)',
                      options: providers.map(p => ({ label: p.name, value: p.name })),
                    });
                    return;
                  }
                  setInput(''); 
                  setActivePrompt(null); 
                  addSystemMessage('warn', 'Prompt cancelled'); 
                }}
                isMasked={activePrompt.isMasked}
              />
            ) : (
              <Box flexDirection="row">
                {!vetoQuestion && !isSearching && (
                  <Box marginRight={1}>
                    <Text color={theme.accent}>❯</Text>
                  </Box>
                )}
                <SimpleInput
                  value={isSearching ? searchQuery : input}
                  onChange={isSearching ? setSearchQuery : (val: string) => { setInput(val); updateSuggestions(val); }}
                  onSubmit={isSearching ? () => { setIsSearching(false); setSearchQuery(''); } : handleSubmit}
                  focus={!vetoQuestion && !activeMenu && !activePrompt}
                />
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      <Footer
        theme={theme}
        model={options.model}
        agent={options.agent}
        verbose={options.verbose}
      />
    </>
  );
}

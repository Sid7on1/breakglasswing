import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Box, Static, Text, useInput, useApp, useStdout } from 'ink';
import { SkillLoader, DynamicPersona } from '../skills.loader';
import { SimpleInput } from '../components/SimpleInput';
import { cliEvents, LogEntry, MessageEntry } from '../events';
import { ToolCallLine } from '../components/ToolCallLine';
import { WelcomeBanner } from '../components/WelcomeBanner';
import { GlobalPrompter } from '../prompter';
import { globalCommandRegistry, CommandResult, CommandContext } from '../commands/registry';
import '../commands';
import { loadCustomCommands } from '../commands/custom.loader';
import { loadHooksConfig } from '../../tools/hooks.loader';
import { registerPostHook } from '../../tools/hooks';
import { setGitAutoCommitEnabled, gitAutoCommitHook, GIT_AUTOCOMMIT_TOOLS } from '../../tools/git.autocommit';
import { setVerifyEnabled, verifyHook, registerVerifyGraphStore, VERIFY_TOOLS } from '../../sandbox/verify.loop';
import { setSandboxEnabled } from '../../sandbox/exec.sandbox';
import { Footer } from '../components/Footer';
import { decideTier, applyBrief, Tier } from '../model.router';
import { getInkInstance } from '../inkInstance';
import { PermissionDialog } from '../components/PermissionDialog';
import { MessageRow } from '../components/Transcript';
import { Markdown } from '../components/Markdown';
import { LogView } from '../components/LogView';
import { DiffView } from '../components/DiffView';
import { SearchHighlight } from '../components/SearchHighlight';
import { ThinkingText } from '../components/ThinkingText';
import { WorkingIndicator } from '../components/WorkingIndicator';
import { InteractiveMenu, MenuOption } from '../components/InteractiveMenu';
import { InteractivePrompt } from '../components/InteractivePrompt';
import { getTheme, ThemeName } from '../themes';
import { tailToHeight } from '../streaming.viewport';
import { TaskPipeline } from '../../task';
import { CodebaseIndexer } from '../../graph/indexer';
import { GraphStore } from '../../graph/graph.store';
import { CodebaseMapPanel } from '../components/CodebaseMapPanel';
import { summarizeGraph, isCodebase } from '../../graph/graph.summary';
import { estimateTokens } from '../../graph/context.planner';
import { expandAtMentions, suggestAtSymbols } from '../atMention';
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
import { saveConfig, getConfig } from '../config';
import { registerDiffApprover, setDiffApprovalEnabled } from '../diffApproval';
import { registerBlastConfirmer, registerBlastGraphStore, setBlastGateEnabled } from '../blastGate';
import { setSelfCriticEnabled } from '../selfCritic';
import { globalWatcherManager } from '../watchers';
import { saveApiKeyToEnv } from '../env.loader';
import { globalSubAgentManager } from '../../core/subagent.manager';
import { globalCheckpointManager } from '../../sandbox/checkpoint.manager';

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

const HISTORY_PATH = path.join(os.homedir(), '.breakglass', 'history.json');
const HISTORY_LIMIT = 100;

function loadPromptHistory(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string').slice(-HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function savePromptHistory(history: string[]) {
  try {
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history.slice(-HISTORY_LIMIT), null, 2));
  } catch { /* history persistence is best-effort */ }
}

export function FullScreen({ taskPipeline, codebaseIndexer, graphStore, options }: FullScreenProps) {
  const { exit } = useApp();
  const theme = getTheme(options.theme);

  // Initialize the governor mode ONCE from the launch flag. Doing this in the component body
  // unconditionally (as before) reset the mode on every render, so toggling bypass via /governor
  // never stuck — the next re-render forced it back to 'interactive'. Guard it to first mount.
  const governorInitRef = React.useRef(false);
  if (!governorInitRef.current) {
    governorInitRef.current = true;
    options.governor.mode = options.dangerouslySkipPermissions ? 'bypass' : 'interactive';
  }

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
      globalWatcherManager.stopAll();
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
  // Pasted multi-line blobs are collapsed to a short "[Pasted text #N +L lines]" chip in the
  // visible input (Claude-Code style) and expanded back to the real text on submit.
  const pastesRef = useRef<Map<string, string>>(new Map());
  const pasteCounterRef = useRef(0);
  const [pasteCount, setPasteCount] = useState(0);
  const handlePaste = useCallback((text: string): string => {
    const id = ++pasteCounterRef.current;
    const lines = text.split('\n').length;
    const placeholder = `[Pasted text #${id} +${lines} lines]`;
    pastesRef.current.set(placeholder, text);
    setPasteCount(pastesRef.current.size);
    return placeholder;
  }, []);
  const expandPastes = useCallback((s: string): string => {
    if (pastesRef.current.size === 0) return s;
    let out = s;
    for (const [ph, real] of pastesRef.current.entries()) out = out.split(ph).join(real);
    return out;
  }, []);
  const clearPastes = useCallback(() => {
    if (pastesRef.current.size === 0 && pasteCounterRef.current === 0) return;
    pastesRef.current.clear();
    pasteCounterRef.current = 0;
    setPasteCount(0);
  }, []);
  const [stashedInput, setStashedInput] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadPromptHistory());
  const [historyIndex, setHistoryIndex] = useState(-1);
  const lastCtrlC = useRef<number>(0);
  // Manual model-routing override: null = auto (lite decides + escalates), else pinned to a tier.
  // A ref so the async submit handler always reads the current value (no stale closure).
  const pinnedTierRef = useRef<Tier | null>(null);
  const [vetoQuestion, setVetoQuestion] = useState<string | null>(null);
  const [vetoOptions, setVetoOptions] = useState<string[]>([]);
  const [vetoResolver, setVetoResolver] = useState<((answer: string) => void) | null>(null);
  const { stdout } = useStdout();
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
  // Mirror the suggestion state in refs so handleSubmit always reads the *current* values.
  // handleSubmit is handed to menus as `context.executeCommand`; that closure can be invoked
  // long after it was captured, when the stale `suggestions`/`suggestionIndex` it closed over
  // would otherwise hijack the command (e.g. selecting "Provider" in /config ran "/config"
  // again because the captured closure still saw the "/config" suggestion).
  const suggestionsRef = useRef<string[]>([]);
  const suggestionIndexRef = useRef(-1);
  useEffect(() => {
    suggestionsRef.current = suggestions;
    suggestionIndexRef.current = suggestionIndex;
  }, [suggestions, suggestionIndex]);
  const [activeMenu, setActiveMenu] = useState<{ type: string, options: MenuOption[], title: string, onSelect?: (opt: MenuOption) => void | Promise<void> } | null>(null);
  const [activePrompt, setActivePrompt] = useState<{ title: string, placeholder?: string, isMasked?: boolean, onResolve: (val: string) => void } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);
  // Bumped by /clear: remounts the <Static> region so it forgets printed items
  const [clearEpoch, setClearEpoch] = useState(0);

  // Codebase-map panel + live token meter, driven by config and toggled from /config.
  const readFlag = (k: 'showMapPanel' | 'showTokenMeter') => {
    try { return getConfig()[k] !== false; } catch { return true; }
  };
  const [showMapPanel, setShowMapPanel] = useState(() => readFlag('showMapPanel'));
  const [showTokenMeter, setShowTokenMeter] = useState(() => readFlag('showTokenMeter'));
  // Bumped whenever the graph is (re)built so the map summary recomputes.
  const [graphVersion, setGraphVersion] = useState(0);
  const graphSummary = useMemo(() => summarizeGraph(graphStore), [graphStore, graphVersion]);
  // Live "tokens that will be sent" = system prompt + conversation history + current draft.
  const [systemPromptTokens, setSystemPromptTokens] = useState(0);
  const [historyTokens, setHistoryTokens] = useState(0);
  const onboardingStartedRef = useRef(false);

  // Ink 3 leaves ghost box-frames after a terminal resize: it erases the previous live frame
  // using the OLD width, so wrapped lines don't line up. On resize we (1) reset Ink's own frame
  // tracking via instance.clear() — without this Ink still believes the stale frame is on screen
  // and erases the wrong lines on its next paint, which is the real source of the ghost — then
  // (2) wipe the terminal + scrollback and (3) remount <Static> (via clearEpoch) so the whole
  // transcript re-prints cleanly at the new width. Debounced to the trailing edge so a
  // drag-resize repaints once it settles rather than on every intermediate size.
  useEffect(() => {
    const out = process.stdout;
    if (!out.isTTY) return;
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { getInkInstance()?.clear(); } catch { /* instance optional */ }
        out.write('\x1b[2J\x1b[3J\x1b[H');
        setClearEpoch((e) => e + 1);
      }, 80);
    };
    out.on('resize', onResize);
    return () => {
      clearTimeout(timer);
      out.off('resize', onResize);
    };
  }, []);

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
    ['/plan', 'Read-only plan mode (propose, don\'t change)'],
    ['/checkpoint', 'Snapshot the working tree'],
    ['/rewind', 'Restore an earlier checkpoint'],
    ['/swarm', 'Parallel worktree sub-agent swarm'],
    ['/impact', 'Blast-radius preview for a symbol'],
    ['/map', 'Top-level codebase map overview'],
    ['/ask', 'Ask the architecture (graph-backed)'],
    ['/replay', 'Export this session as markdown'],
    ['/diff-approval', 'Review agent edits before they apply'],
    ['/autocommit', 'Auto-commit each agent edit (on/off)'],
    ['/remember', 'Save a durable project memory'],
    ['/self-critic', 'Agent reviews & fixes its own work'],
    ['/heal', 'Run tests; auto-fix failures in a worktree'],
    ['/watch', 'Watch a file/schedule and wake the agent'],
    ['/council', 'Run a task across multiple AI CLIs; keep winner'],
    ['/speculate', 'Try distinct approaches in parallel; compare'],
    ['/evolve', 'Gated self-evolution of BiMax\'s own source'],
    ['/index', 'Build local AST codebase index'],
    ['/index-ai', 'Run Semantic AI index (Costs API credits)'],
    ['/mcp', 'List / add / remove MCP servers'],
    ['/skills', 'List / create Agent Skills'],
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
      return;
    }
    // @symbol autocomplete: complete the `@<partial>` token currently being typed from
    // graph node names (G4). Resolves symbols, not files — more precise than @file.
    const atMatch = value.match(/(?:^|\s)@([A-Za-z0-9_.]*)$/);
    if (atMatch) {
      const matches = suggestAtSymbols(graphStore, atMatch[1]).map(n => `@${n}  symbol`);
      setSuggestions(matches);
      setSuggestionIndex(matches.length > 0 ? 0 : -1);
      return;
    }
    setSuggestions([]);
    setSuggestionIndex(-1);
  }, [graphStore]);

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
      setShowTranscript(false); // search operates on the logs panel
      cliEvents.emit('status', 'Search: type to filter logs');
      return;
    }

    if (char === 'p' && key.ctrl) {
      // Preview the full text behind the "[Pasted text #N …]" chips in the current input.
      if (pastesRef.current.size === 0) {
        cliEvents.emit('status', 'No pasted text to preview');
      } else {
        for (const [ph, real] of pastesRef.current.entries()) {
          addSystemMessage('info', `${ph}\n${real}`);
        }
      }
      return;
    }

    if (char === 'o' && key.ctrl) {
      toggleView();
      cliEvents.emit('status', showTranscript ? 'Logs panel shown' : 'Logs panel hidden');
      return;
    }

    if (char === 'l' && key.ctrl) {
      return;
    }

    if (char === 't' && key.ctrl) {
      // Cycle the routing pointer: auto → pin lite → pin heavy → auto.
      const next: Tier | null = pinnedTierRef.current === null ? 'lite' : pinnedTierRef.current === 'lite' ? 'heavy' : null;
      pinnedTierRef.current = next;
      cliEvents.emit('model_tier', { tier: next ?? 'lite', pinned: next });
      cliEvents.emit('status', next === null ? 'Routing → auto (lite decides, escalates as needed)' : `Routing pinned → ${next} model`);
      return;
    }

    if (char === 'd' && key.ctrl) {
      cliEvents.emit('shutdown');
      exit();
      process.exit(0);
    }

    if (char === 'c' && key.ctrl) {
      // Require a double-press so a stray Ctrl+C doesn't kill a running task
      const now = Date.now();
      if (now - lastCtrlC.current < 2500) {
        cliEvents.emit('shutdown');
        exit();
        process.exit(0);
      }
      lastCtrlC.current = now;
      cliEvents.emit('status', 'Press Ctrl+C again to exit');
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

    // Inline diff approval: show the proposed change and gate the write on Accept/Reject.
    try { setDiffApprovalEnabled(!!getConfig().diffApproval); setSelfCriticEnabled(!!getConfig().selfCritic); } catch { /* config not loaded */ }
    registerDiffApprover((summary, diff) => new Promise<boolean>((resolve) => {
      setDiffText(diff);
      cliEvents.emit('veto_prompt', `Apply change? (${summary})`, ['Accept', 'Reject'], (ans: string) => {
        setDiffText(null);
        resolve(/^(accept|y)/i.test((ans || '').trim()));
      });
    }));

    // Blast-radius gate (G5): confirm edits that touch HIGH/CRITICAL symbols. Off by default;
    // the graph store powers the impact calculation. Only registered in this interactive UI,
    // so workers/print mode auto-allow.
    try { setBlastGateEnabled(!!getConfig().blastGate); } catch { /* config not loaded */ }
    registerBlastGraphStore(graphStore);
    registerBlastConfirmer((message) => new Promise<boolean>((resolve) => {
      cliEvents.emit('veto_prompt', message, ['Proceed', 'Cancel'], (ans: string) => {
        resolve(/^(proceed|y)/i.test((ans || '').trim()));
      });
    }));

    // Load user-defined slash commands from .bimax/commands/*.md (project + home). A1.
    try {
      const custom = loadCustomCommands();
      if (custom.length > 0) addLog('info', `Loaded ${custom.length} custom command(s): ${custom.join(' ')}`);
    } catch { /* custom commands are best-effort */ }

    // Load shell hooks from .bimax/hooks.json (A2). Best-effort.
    try {
      const nHooks = loadHooksConfig();
      if (nHooks > 0) addLog('info', `Loaded ${nHooks} tool hook(s) from .bimax/hooks.json`);
    } catch { /* hooks are best-effort */ }

    // Git auto-commit (B1): a built-in PostToolUse hook on edit tools, gated on the live flag
    // (off by default). Interactive only — registered here, so workers/print never auto-commit.
    try { setGitAutoCommitEnabled(!!getConfig().gitAutoCommit); } catch { /* config not loaded */ }
    registerPostHook(GIT_AUTOCOMMIT_TOOLS, gitAutoCommitHook);

    // Auto edit→verify→fix loop (B2): typecheck edited files and feed failures back. Off by
    // default; graph store scopes which files are worth checking. Interactive only.
    try { setVerifyEnabled(!!getConfig().autoVerify); } catch { /* config not loaded */ }
    registerVerifyGraphStore(graphStore);
    registerPostHook(VERIFY_TOOLS, verifyHook);

    // Bash sandbox (B3): restrict shell file-writes to the workspace when enabled. Off by default.
    try { setSandboxEnabled(!!getConfig().sandboxBash); } catch { /* config not loaded */ }

    // Background watchers: wake the agent on file change / schedule. Skip while a turn
    // is already running, and use the budget governor as a circuit breaker.
    globalWatcherManager.registerNotifier((msg) => addSystemMessage('info', msg));
    globalWatcherManager.setCircuitBreaker(async () => {
      try { await options.governor.budget.checkVeto(0); return true; } catch { return false; }
    });
    globalWatcherManager.registerRunner((action) => {
      if (isProcessingRef.current) {
        addSystemMessage('info', `👁️ Watcher action skipped (agent busy): ${action}`);
        return;
      }
      handleSubmit(action);
    });

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
      registerDiffApprover(null);
      registerBlastConfirmer(null);
      registerBlastGraphStore(null);
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

  // Re-read the map-panel / token-meter flags when a /config toggle fires (saveConfig only
  // updates the cache; this is how the live UI reflects the change without a restart).
  useEffect(() => {
    const onConfigChanged = () => {
      setShowMapPanel(readFlag('showMapPanel'));
      setShowTokenMeter(readFlag('showTokenMeter'));
    };
    const onGraphChanged = () => setGraphVersion((v) => v + 1);
    // When the agent cd's into another project, reload that project's graph so the map panel
    // reflects the NEW location (empty if it was never indexed) instead of the launch-dir graph.
    const onCwdChanged = async (newCwd: string) => {
      try {
        graphStore.setStoragePath(path.join(newCwd, '.breakglass/graph', 'playground.json'));
        graphStore.clear();
        await graphStore.loadFromDisk();
        try { codebaseIndexer?.setProjectRoot?.(newCwd); } catch { /* indexer reroot best-effort */ }
        setGraphVersion((v) => v + 1);
      } catch { /* best-effort: never let a cd break the UI */ }
    };
    cliEvents.on('config_changed', onConfigChanged);
    cliEvents.on('graph_changed', onGraphChanged);
    cliEvents.on('cwd_changed', onCwdChanged);
    return () => {
      cliEvents.off('config_changed', onConfigChanged);
      cliEvents.off('graph_changed', onGraphChanged);
      cliEvents.off('cwd_changed', onCwdChanged);
    };
  }, []);

  // Token meter: "tokens that will be sent" = the system-prompt TEXT (built for the ACTIVE context
  // mode) + the tool-schema JSON actually put on the wire — that schema payload is the main thing
  // Smart vs Full changes, so it must be counted or the meter looks identical between modes.
  // Recomputed on agent / plan-mode change AND on any /config toggle (so switching Smart↔Full moves it).
  useEffect(() => {
    const recompute = () => {
      try {
        const mode = ((getConfig().contextMode as 'smart' | 'full') || 'smart');
        const persona = personasRef.current?.[defaultAgent] || personasRef.current?.bimax;
        const sys = persona?.getSystemPrompt({ planMode: options.governor.mode === 'plan', contextMode: mode }) || '';
        let toolTokens = 0;
        try { toolTokens = estimateTokens(JSON.stringify(options.toolRegistry.getSchemas({ mode }))); } catch { /* registry optional */ }
        setSystemPromptTokens(estimateTokens(sys) + toolTokens);
      } catch { /* best-effort */ }
    };
    recompute();
    cliEvents.on('config_changed', recompute);
    return () => { cliEvents.off('config_changed', recompute); };
  }, [defaultAgent, options.governor.mode]);

  useEffect(() => {
    let sum = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') sum += estimateTokens(m.content);
    }
    setHistoryTokens(sum);
  }, [messages]);

  // First-run onboarding: when launched inside a real codebase with no map graph yet, offer to
  // build the map graph, then the AI graph — and nudge toward minimal feature use. Driven through
  // the Ink menu infra (never readline). Gated on API keys existing (the AI graph needs them).
  const finishOnboarding = useCallback(() => {
    saveConfig({ onboardingComplete: true }).catch(() => { /* best-effort */ });
    addSystemMessage('info', 'Tip: heavy features (/swarm, /council, /speculate, /evolve) cost API credits — enable them only when needed from /config. Use @symbol mentions and /impact to keep me grounded in the real code instead of guessing.');
  }, [addSystemMessage]);

  const offerAiGraph = useCallback(() => {
    const nodeCount = graphStore.getGraph().nodes.size;
    setActiveMenu({
      type: 'onboarding',
      title: 'Add the AI graph? (semantic layer: purpose + risk per symbol)',
      options: [
        { label: '[ Build AI graph ]', value: 'build', desc: `Makes ~${nodeCount} API calls — richer impact analysis` },
        { label: '[ Skip ]', value: 'skip', desc: 'You can run /index-ai later' },
      ],
      onSelect: async (opt: MenuOption) => {
        setActiveMenu(null);
        if (opt.value === 'build') {
          addSystemMessage('info', 'Building AI graph (semantic ingestion)…');
          try {
            await codebaseIndexer.buildSemanticIndex();
            cliEvents.emit('graph_changed');
            addSystemMessage('success', 'AI graph built — the map now carries purpose + risk metadata.');
          } catch (e: any) {
            addSystemMessage('error', `AI indexing failed: ${e.message}`);
          }
        }
        finishOnboarding();
      },
    });
  }, [addSystemMessage, finishOnboarding, graphStore]);

  const startOnboarding = useCallback(() => {
    setActiveMenu({
      type: 'onboarding',
      title: 'New codebase detected — build the map graph?',
      options: [
        { label: '[ Build map graph ]', value: 'build', desc: 'AST index so I navigate to the exact symbol instead of guessing' },
        { label: '[ Skip ]', value: 'skip', desc: 'You can run /index later' },
      ],
      onSelect: async (opt: MenuOption) => {
        setActiveMenu(null);
        if (opt.value === 'build') {
          addSystemMessage('info', 'Building map graph (AST index)…');
          try {
            const count = await codebaseIndexer.buildAstIndex();
            cliEvents.emit('graph_changed');
            addSystemMessage('success', `Map graph built — ${count} nodes indexed.`);
            offerAiGraph();
            return;
          } catch (e: any) {
            addSystemMessage('error', `Indexing failed: ${e.message}`);
          }
        } else {
          addSystemMessage('info', 'Skipped the map graph. Build it anytime: /config → Build map graph (or run /index). The agent works without it, just less precisely.');
        }
        finishOnboarding();
      },
    });
  }, [addSystemMessage, finishOnboarding, offerAiGraph]);

  useEffect(() => {
    // Manual re-run from /config onboard — re-offer regardless of the saved flag.
    const onRerun = () => {
      if (buildKeyPool().length === 0) {
        addSystemMessage('warn', 'Add an API key first (/keys), then re-run onboarding.');
        return;
      }
      onboardingStartedRef.current = true;
      startOnboarding();
    };
    cliEvents.on('rerun_onboarding', onRerun);

    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const shouldAutoOffer = (() => {
      if (onboardingStartedRef.current) return false;
      try { if (getConfig().onboardingComplete) return false; } catch { return false; }
      if (!isCodebase(process.cwd())) return false;
      return graphStore.getGraph().nodes.size === 0;
    })();
    if (shouldAutoOffer) {
      timer = setTimeout(() => {
        // Defer so the mandatory-API-key menu (fired at 500ms) takes precedence; the AI-graph
        // step needs keys anyway. If keys are still missing, leave onboarding for next launch.
        if (done || onboardingStartedRef.current) return;
        if (buildKeyPool().length === 0) return;
        onboardingStartedRef.current = true;
        startOnboarding();
      }, 900);
    }
    return () => { done = true; if (timer) clearTimeout(timer); cliEvents.off('rerun_onboarding', onRerun); };
  }, [startOnboarding, graphStore, addSystemMessage]);

  const handleSubmit = async (rawQuery: string) => {
    // Expand any "[Pasted text #N …]" chips back into the real pasted content before processing.
    let query = expandPastes(rawQuery);

    // Process suggestion selection if active. Read from refs (not the closed-over state) so a
    // stale handleSubmit captured by a menu's executeCommand can't resurrect an old suggestion.
    const curSuggestions = suggestionsRef.current;
    const curSuggestionIndex = suggestionIndexRef.current;
    if (curSuggestions.length > 0 && curSuggestionIndex >= 0) {
      const selected = curSuggestions[curSuggestionIndex].split('  ')[0];
      const autoExecute = COMMAND_REGISTRY.map(cmd => cmd[0]);

      setSuggestions([]);
      setSuggestionIndex(-1);

      // @symbol completion: replace the trailing `@<partial>` with the chosen symbol and
      // keep editing (never auto-submit on an @ pick).
      if (selected.startsWith('@')) {
        setInput(rawQuery.replace(/@[A-Za-z0-9_.]*$/, selected + ' '));
        return;
      }

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
    // Committed to submit — the pasted blobs are now baked into `query`; reset the chip store.
    clearPastes();

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
      // Wipe the terminal (incl. scrollback) since Static content lives there
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      setClearEpoch((e) => e + 1);
      // Reset each agent's LLM conversation memory too — otherwise old turns (e.g. earlier
      // MCP experiments) keep bleeding into new requests, making the agent "resume" stale tasks.
      if (personasRef.current) {
        for (const p of Object.values(personasRef.current)) p.messages = [];
      }
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
          // Inject the live active persona so commands like /context can read the real system
          // prompt (options.persona is null at startup; the actual instances live in personasRef).
          // Mutate the SHARED options object (don't spread a copy) so commands that set primitives
          // like options.model persist — a spread copy silently dropped those (stale /model display).
          options: Object.assign(options, { persona: personasRef.current?.[defaultAgent] || personasRef.current?.bimax }),
          codebaseIndexer,
          graphStore,
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

    setHistory((prev) => {
      const next = [...prev.filter((h) => h !== query), query].slice(-HISTORY_LIMIT);
      savePromptHistory(next);
      return next;
    });
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

    // Time Machine: auto-snapshot the working tree before each turn so any change
    // the agent makes this turn can be rewound with /rewind. Best-effort, git-only.
    if (options.governor.mode !== 'plan') {
      try {
        const snap = query.length > 50 ? query.slice(0, 50) + '…' : query;
        globalCheckpointManager.create(`before: ${snap}`, true);
      } catch { /* checkpointing is best-effort */ }
    }

    const msgId = `msg-${Date.now()}`;
    cliEvents.emit('message', { id: msgId, role: 'user', content: query, timestamp: new Date() } as MessageEntry);
    const routedAgent = routeQuery(query);
    const active = personasRef.current![routedAgent] || personasRef.current!.bimax;
    const msgCountBefore = active.messages.length;

    cliEvents.emit('thinking_clear');
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

    const currentToolCalls: import('../events').ToolCallEntry[] = [];
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

    // Measure reasoning time for the "Thought for Ns" line: clock starts at the first thinking
    // token and stops at the first visible answer token (or the next tool call).
    let thinkingStart = 0;
    let thoughtMs = 0;
    const stopThinkingClock = () => { if (thinkingStart && !thoughtMs) thoughtMs = Date.now() - thinkingStart; };
    const onThinking = () => { if (!thinkingStart) thinkingStart = Date.now(); };
    cliEvents.on('thinking', onThinking);

    let tokenBuffer = '';
    let lastRenderTime = Date.now();

    // Expand any @symbol mentions into appended source before handing off to the agent.
    // The displayed message/history keep the user's original text; the agent sees the
    // expanded prompt. Best-effort — fall back to the raw query on any failure.
    let agentQuery = query;
    try {
      const expansion = await expandAtMentions(query, graphStore, process.cwd());
      agentQuery = expansion.text;
      if (expansion.resolved.length > 0) {
        addLog('info', `Injected ${expansion.resolved.length} @symbol${expansion.resolved.length > 1 ? 's' : ''}: ${expansion.resolved.map(t => '@' + t).join(', ')}`);
        if (expansion.unresolved.length > 0) {
          addLog('warn', `Unresolved @mention(s): ${expansion.unresolved.map(t => '@' + t).join(', ')} — not in the graph (try /index).`);
        }
      }
    } catch { /* @-expansion is best-effort */ }

    // Model-tier routing: the lite model is the default responder; escalate to the heavy coding
    // model only when the turn needs it. A manual pin (Ctrl+T) overrides the decision. The footer
    // pointer flips to whichever model will actually receive this request.
    let useLite = true;
    try {
      const decision = await decideTier(options.llmAdapter, query, pinnedTierRef.current);
      useLite = decision.tier === 'lite';
      cliEvents.emit('model_tier', { tier: decision.tier, pinned: pinnedTierRef.current });
      if (!useLite) {
        agentQuery = applyBrief(agentQuery, decision.brief);
        let heavyName = '';
        try { heavyName = (getConfig().model || '').split('/').pop() || ''; } catch { /* best-effort */ }
        addLog('info', `→ heavy model${heavyName ? ` (${heavyName})` : ''}${decision.via === 'pinned' ? ' [pinned]' : ''}${decision.brief ? `: ${decision.brief}` : ''}`);
      }
    } catch { /* routing is best-effort; fall back to lite */ }

    try {
      await active.execute(agentQuery, (token: string) => {
        stopThinkingClock(); // first visible token ends the reasoning phase
        totalChars += token.length;
        tokenBuffer += token;

        const now = Date.now();
        if (now - lastRenderTime > 50) {
          setStreamingText((prev) => prev + tokenBuffer);
          setStreamMeta((m) => ({ ...m, chars: totalChars }));
          tokenBuffer = '';
          lastRenderTime = now;
        }
      }, { maxIterations: options.maxToolIterations, planMode: options.governor.mode === 'plan', useLite });

      if (tokenBuffer) {
        setStreamingText((prev) => prev + tokenBuffer);
        setStreamMeta((m) => ({ ...m, chars: totalChars }));
      }

      stopThinkingClock();
      clearInterval(metaTimer);
      cliEvents.emit('cost_update', totalChars);
      cliEvents.off('tool_call', onToolCall);
      cliEvents.off('tool_call_result', onToolCallResult);
      cliEvents.off('thinking', onThinking);
      cliEvents.emit('thinking_clear');

      // Collect every assistant segment from this turn (multi-step tool loops
      // produce several), so nothing the model said gets dropped.
      const turnContent = active.messages
        .slice(msgCountBefore)
        .filter((m: any) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim())
        .map((m: any) => m.content.trim())
        .join('\n\n')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/^[\s\S]*?<\/think>/, '') // opener-less reasoning (step-3.5/minimax on NIM)
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .replace(/<tool_call>[\s\S]*/, '')
        .trim();

      if (turnContent || currentToolCalls.length > 0) {
        cliEvents.emit('message', {
          id: `msg-${Date.now()}-resp`,
          role: 'assistant',
          content: turnContent,
          toolCalls: currentToolCalls,
          thoughtMs,
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
      cliEvents.off('thinking', onThinking);
      cliEvents.emit('thinking_clear');
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
    } else if (typeof option.value === 'string' && option.value.startsWith('/')) {
      // Command-result menus (type 'menu') whose options are slash commands — e.g. the
      // /config hub routing to /model, /governor, /autocommit — run the chosen command.
      handleSubmit(option.value);
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

  const staticItems: Array<{ kind: 'welcome'; id: string } | { kind: 'msg'; id: string; msg: MessageEntry }> = [
    { kind: 'welcome', id: '__welcome__' },
    ...messages.map((m) => ({ kind: 'msg' as const, id: m.id, msg: m })),
  ];

  // Pre-send token estimate (system prompt + history + current draft). Cheap: the heavy parts
  // are memoized; only the draft is re-measured per keystroke.
  const tokenEstimate = systemPromptTokens + historyTokens + estimateTokens(input);
  const mapPanelVisible = showMapPanel && graphSummary.nodeCount > 0;

  return (
    <>
      {/* Completed content is printed once into scrollback and never redrawn —
          this is what prevents ghost frames on resize/overflow. */}
      <Static key={`epoch-${clearEpoch}`} items={staticItems}>
        {(item) => item.kind === 'welcome' ? (
          <WelcomeBanner
            key={item.id}
            theme={theme}
            model={options.model || 'default'}
            agent={options.agent}
            governorBypassed={options.governor.mode === 'bypass'}
          />
        ) : (
          <MessageRow key={item.id} msg={item.msg} theme={theme} />
        )}
      </Static>

      <Box flexDirection="column" width="100%" paddingX={1}>
        {!showTranscript && (
          <LogView logs={filteredLogs.slice(-12)} theme={theme} searchQuery={isSearching ? searchQuery : ''} />
        )}

        <Box flexDirection="column" paddingX={1} marginTop={1} minHeight={1}>
          {(isProcessing || streamingText || streamingToolCalls.length > 0) ? (
            <Box flexDirection="column" width="100%">
              {streamingToolCalls.length > 0 && (
                <Box flexDirection="column" marginBottom={1}>
                  {streamingToolCalls.map(call => (
                    <ToolCallLine key={call.id} call={call} theme={theme} />
                  ))}
                </Box>
              )}

              {streamingText.trim() ? (() => {
                // Keep the live preview shorter than the viewport so Ink can always
                // redraw it in place; the full formatted answer is committed to
                // <Static> when the turn completes. Reserve rows for the tool-call
                // lines, prompt, footer and surrounding margins.
                const rows = stdout?.rows || 24;
                const cols = stdout?.columns || 80;
                const reserved = 11 + streamingToolCalls.length // +1 for the always-on model line
                  + (mapPanelVisible ? 9 : 0) + (showTokenMeter ? 1 : 0);
                const budget = Math.max(4, rows - reserved);
                const { text: preview, truncated } = tailToHeight(streamingText, budget, cols - 4);
                return (
                  <Box flexDirection="column">
                    {truncated && (
                      <Text color={theme.subtle}>… (streaming — full reply appears when complete)</Text>
                    )}
                    <Box flexDirection="row">
                      <Text color={theme.accent}>● </Text>
                      <Box flexDirection="column" flexGrow={1}>
                        <Markdown theme={theme}>{preview}</Markdown>
                      </Box>
                    </Box>
                    {isProcessing && (
                      <Box marginTop={1}>
                        <WorkingIndicator theme={theme} />
                      </Box>
                    )}
                  </Box>
                );
              })() : null}

              {isProcessing && !streamingText.trim() && (
                <ThinkingText theme={theme} />
              )}
            </Box>
          ) : (
            <Box minHeight={1}>
              <Text color={theme.subtle}> </Text>
            </Box>
          )}
        </Box>

        {Boolean(diffText) && (
          <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.promptBorder} paddingX={1}>
            <Text color={theme.subtle}>Proposed change:</Text>
            <DiffView diffText={diffText as string} theme={theme} />
          </Box>
        )}

        {Boolean(vetoQuestion) && (
          <PermissionDialog
            theme={theme}
            question={vetoQuestion as string}
            options={Array.isArray(vetoOptions) && vetoOptions.length > 0 ? vetoOptions : ['Yes', 'No', 'Always']}
            onSubmit={handleVetoSubmit}
            onCancel={handleVetoCancel}
          />
        )}

        {mapPanelVisible && (
          <CodebaseMapPanel theme={theme} summary={graphSummary} />
        )}

        {/* Always-on status line above the input: current coding model (so a /model change is
            instantly visible here), the lite model, and the live token estimate. */}
        <Box justifyContent="flex-end" paddingX={1}>
          <Text color={theme.subtle}>
            {(options.model || 'default').split('/').pop()}
            {(() => { try { const l = getConfig().liteModel; return l ? ` (lite: ${l.split('/').pop()})` : ''; } catch { return ''; } })()}
            {showTokenMeter ? ` · ~${tokenEstimate.toLocaleString()} tok` : ''}
          </Text>
        </Box>

        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.promptBorder}>
          <Box flexDirection="column" paddingX={1}>
            {suggestions.length > 0 && (
              <Box flexDirection="column" marginBottom={1}>
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
                    const selected = actualIdx === suggestionIndex;
                    const parts = s.split('  ');
                    const cmd = parts[0];
                    const desc = parts.slice(1).join('  ');
                    return (
                      <Box key={cmd} flexDirection="row">
                        <Box width={2}>
                          <Text color={theme.accent}>{selected ? '❯' : ' '}</Text>
                        </Box>
                        <Box width={15}>
                          <Text color={selected ? theme.accent : theme.inactive} bold={selected}>{cmd}</Text>
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
            {pasteCount > 0 && !isSearching && (
              <Box>
                <Text color={theme.subtle}>
                  ⎘ {pasteCount} pasted block{pasteCount > 1 ? 's' : ''} · Ctrl+P to preview · expands on send
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
                enableSearch={activeMenu.type === 'help' || activeMenu.type === 'menu'}
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
                  onChange={isSearching ? setSearchQuery : (val: string) => {
                    setInput(val);
                    updateSuggestions(val);
                    // If the user deleted all paste chips, drop the stored blobs + hint.
                    if (pastesRef.current.size > 0 && ![...pastesRef.current.keys()].some(ph => val.includes(ph))) {
                      clearPastes();
                    }
                  }}
                  onSubmit={isSearching ? () => { setIsSearching(false); setSearchQuery(''); } : handleSubmit}
                  focus={!vetoQuestion && !activeMenu && !activePrompt}
                  onPaste={isSearching ? undefined : handlePaste}
                />
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      <Footer
        theme={theme}
        model={options.model}
        liteModel={(() => { try { return getConfig().liteModel; } catch { return undefined; } })()}
        agent={options.agent}
        verbose={options.verbose}
        streamMeta={isProcessing || streamingText ? streamMeta : undefined}
      />
    </>
  );
}

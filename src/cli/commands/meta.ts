import { globalCommandRegistry } from './registry';
import { getCustomRules, addCustomRule, removeCustomRule, getKnownAgents } from '../agentRouter';
import { getCurrentProvider } from '../provider';
import { globalMcpManager } from '../../mcp/manager';
import { globalSkillService } from '../../skills/skill.service';
import { getConfig } from '../config';
import { encode } from 'gpt-tokenizer';

globalCommandRegistry.register({
  name: '/routes',
  description: 'List/add/remove routes',
  category: 'Configuration',
  execute: async (args, context) => {
    if (args[0] === 'add' && args.length >= 3) {
      const re = args[1];
      const agent = args.slice(2).join(' ');
      addCustomRule(re, agent);
      await context.saveConfig({ customRoutingRules: getCustomRules() });
      return { type: 'message', level: 'success', content: `Rule added: /${re}/ → ${agent}` };
    } else if (args[0] === 'remove' && args[1]) {
      const idx = parseInt(args[1]);
      const rules = getCustomRules();
      if (idx >= 0 && idx < rules.length) {
        removeCustomRule(idx);
        await context.saveConfig({ customRoutingRules: getCustomRules() });
        return { type: 'message', level: 'success', content: `Rule ${idx} removed` };
      } else {
        return { type: 'message', level: 'error', content: `Index ${idx} out of range. Use /routes to list rules.` };
      }
    } else {
      const rules = getCustomRules();
      return {
        type: 'menu',
        title: 'Routing Rules',
        options: [
          { label: '[+] Add New Rule', value: 'add_rule', desc: 'Create a new regex to agent mapping' },
          ...rules.map((r, i) => ({
            label: `/${r[0]}/`,
            value: i.toString(),
            desc: `→ ${r[1]} (Select to delete)`
          }))
        ]
      };
    }
  }
});

globalCommandRegistry.register({
  name: '/agents',
  description: 'List agent personas',
  category: 'Configuration',
  execute: async (args, context) => {
    return {
      type: 'menu',
      title: 'Select an Agent Persona',
      options: getKnownAgents().map(a => ({
        label: a,
        value: a,
        description: 'Specialized model preset'
      }))
    };
  }
});

globalCommandRegistry.register({
  name: '/model',
  description: 'Show current model',
  category: 'Configuration',
  execute: async (args, context) => {
    // Apply a model selection live: update the running adapter, the session options (for the
    // status bar), and persist to config. Used by the picker's onSelect and `/model <id>`.
    const applyModel = (model: string) => {
      try { context.options.llmAdapter?.applyConfig({ model }); } catch { /* adapter optional */ }
      context.options.model = model;
      context.saveConfig({ model });
      context.addSystemMessage('success', `Model switched to ${model}`);
    };

    if (args.length >= 1) {
      // `/model <id>` direct set.
      applyModel(args.join(' ').trim());
      return { type: 'none' };
    }

    // Open a masked-free prompt so the user can type any model id their provider supports.
    const promptCustomModel = () => {
      context.setActivePrompt({
        title: 'Enter a model id (e.g. provider/model-name)',
        onResolve: (val: string) => {
          const id = (val || '').trim();
          if (id) applyModel(id);
          else context.addSystemMessage('info', 'No model id entered — nothing changed.');
        },
      });
    };

    const current = context.options.model || 'default';
    return {
      type: 'menu',
      title: `Select Model (current: ${current})`,
      options: [
        { label: 'MiniMax M3 (Nvidia)', value: 'minimaxai/minimax-m3', desc: 'Default — strong reasoning' },
        { label: 'Llama 3.1 70B (Nvidia)', value: 'meta/llama-3.1-70b-instruct', desc: 'Fast, reliable tool calls' },
        { label: 'Llama 3.3 70B (Nvidia)', value: 'meta/llama-3.3-70b-instruct', desc: 'Newer Llama' },
        { label: 'GPT-4o (OpenAI)', value: 'gpt-4o', desc: 'Needs OPENAI_API_KEY' },
        { label: 'Claude 3.5 Sonnet (Anthropic)', value: 'claude-3-5-sonnet-20241022', desc: 'Needs ANTHROPIC_API_KEY' },
        { label: 'Gemini 2.0 Flash (Google)', value: 'gemini-2.0-flash', desc: 'Needs Google key' },
        { label: 'DeepSeek Chat', value: 'deepseek-chat' },
        { label: 'MiniMax 2.7', value: 'minimax/minimax-m2.7' },
        { label: '✎ Custom model id…', value: '__custom__', desc: 'Type any model your provider supports' },
      ],
      onSelect: (opt: any) => (opt.value === '__custom__' ? promptCustomModel() : applyModel(opt.value)),
    };
  }
});

globalCommandRegistry.register({
  name: '/context',
  description: 'Show current context',
  category: 'Session & Context',
  execute: async (args, context) => {
    // Live readout of the smart-context engine: which mode we're in, how the system prompt splits
    // into a cached static prefix vs a per-turn dynamic suffix, how many tool schemas are actually
    // on the wire vs deferred, and which compaction layers are active.
    const mode = (() => { try { return getConfig().contextMode || 'smart'; } catch { return 'smart'; } })();
    const tok = (s: string) => { try { return encode(s).length; } catch { return Math.ceil(s.length / 4); } };

    let promptDesc = 'could not read the active agent — try again after sending one message';
    let toolsDesc = 'could not read the tool list';
    try {
      const registry = context.options.toolRegistry;
      const persona = context.options.persona;
      if (persona && typeof persona.getSystemPromptParts === 'function') {
        const planMode = context.options.governor?.mode === 'plan';
        const { staticPrefix, dynamicSuffix } = persona.getSystemPromptParts({ planMode, contextMode: mode });
        const total = tok(staticPrefix) + tok(dynamicSuffix);
        promptDesc = `~${total.toLocaleString()} tokens of instructions sent each turn (${tok(staticPrefix).toLocaleString()} fixed + ${tok(dynamicSuffix).toLocaleString()} that change)`;
      }
      if (registry) {
        const sent = registry.getSchemas({ mode }).length;
        const names = registry.getToolNames();
        const deferredTotal = names.filter((n: string) => registry.isDeferred(n)).length;
        const loaded = names.filter((n: string) => registry.isDeferred(n) && registry.isDiscovered(n)).length;
        toolsDesc = mode === 'full'
          ? `Full — all ${sent} tools sent every turn`
          : `Smart — ${sent} ready now · ${deferredTotal} load only when needed (${loaded} loaded so far)`;
      }
    } catch { /* best-effort readout */ }

    const window = (() => { try { return getConfig().contextWindowTokens || 0; } catch { return 0; } })();
    const windowDesc = window > 0
      ? `model can hold ~${window.toLocaleString()} tokens — we start trimming around ${Math.round(window * 0.7).toLocaleString()}`
      : `~128,000 tokens (default) — set yours via the Context window row or /context-window`;
    const compactionDesc = mode === 'full'
      ? "off until you run out of room — full history is sent until the model says it's too long, then it's trimmed"
      : 'auto-trims old chat so you never run out of room: shrinks big tool outputs, drops stale ones, then summarizes the oldest if still full';

    return {
      type: 'menu',
      title: 'Current Context',
      options: [
        // — Context engine (the smart-sending machinery), in plain words. "Tools sent now" already
        //   states the mode (Full/Smart), so there's no separate "How tools are sent" row here —
        //   change the mode from the / settings hub. —
        { label: 'Tools sent now', value: '/context-mode', desc: toolsDesc, category: 'Context Engine' },
        { label: 'Instructions size', value: '/context-mode', desc: promptDesc, category: 'Context Engine' },
        { label: 'Memory limit (context window)', value: '/context-window', desc: windowDesc, category: 'Context Engine' },
        { label: 'History trimming (compaction)', value: '/context-mode', desc: compactionDesc, category: 'Context Engine' },

        // — Session —
        { label: 'Workspace', value: 'workspace', desc: context.cwd, category: 'Session' },
        { label: 'Model', value: '/model', desc: context.options.model || 'default', category: 'Session' },
        { label: 'Agent', value: '/agents', desc: context.options.agent, category: 'Session' },
        { label: 'Provider', value: '/provider', desc: String(getCurrentProvider().name), category: 'Session' },
        { label: 'Theme', value: '/config theme', desc: context.options.theme, category: 'Session' },
        { label: 'Verbose Logging', value: '/config verbose', desc: context.options.verbose ? 'On' : 'Off', category: 'Session' },
        { label: 'Permissions', value: '/config skipPerms', desc: context.options.governor?.mode === 'bypass' ? 'Bypassed' : 'Strict', category: 'Session' },
        { label: 'MCP servers', value: '/mcp', desc: `${globalMcpManager.list().length} connected`, category: 'Session' },
        { label: 'Agent skills', value: '/skills', desc: `${globalSkillService.list().length} installed`, category: 'Session' },
      ],
      onSelect: (opt: any) => { if (typeof opt.value === 'string' && opt.value.startsWith('/')) context.executeCommand(opt.value); },
    };
  }
});

globalCommandRegistry.register({
  name: '/cost',
  description: 'Show session cost & usage',
  category: 'Session & Context',
  execute: async (args, context) => {
    return {
      type: 'message',
      level: 'info',
      content: 'Cost tracking is being migrated to StatsDashboard.'
    };
  }
});

globalCommandRegistry.register({
  name: '/clear',
  description: 'Clear screen',
  category: 'Session & Context',
  execute: async (args, context) => {
    // Return a redirect to the legacy clear handler in FullScreen if we need it
    // Or just a message since clear logic (setting history to []) is in FullScreen
    return { type: 'redirect', command: 'clear_screen' }; 
  }
});

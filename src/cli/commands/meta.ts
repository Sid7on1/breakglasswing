import { globalCommandRegistry } from './registry';
import { getCustomRules, addCustomRule, removeCustomRule, getKnownAgents } from '../agentRouter';
import { getCurrentProvider } from '../provider';
import { cliEvents, getSessionTokenEstimate } from '../events';
import { globalMcpManager } from '../../mcp/manager';
import { globalSkillService } from '../../skills/skill.service';
import { getConfig } from '../config';
import { modelMenuOptions } from '../models';
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
        ],
        // "Add New Rule" prompts for the regex then the target agent (chained), then re-runs the
        // command to apply it. Picking an existing rule deletes it by index. Without this onSelect
        // the menu was inert — selecting a row did nothing.
        onSelect: (opt: any) => {
          if (opt.value === 'add_rule') {
            context.setActivePrompt({
              title: 'Enter regex pattern (matched against your prompt)',
              onResolve: (re: string) => {
                if (!re.trim()) return;
                context.setActivePrompt({
                  title: 'Route matching prompts to which agent?',
                  onResolve: (agent: string) => {
                    if (agent.trim()) context.executeCommand(`/routes add ${re.trim()} ${agent.trim()}`);
                  },
                });
              },
            });
          } else {
            context.executeCommand(`/routes remove ${opt.value}`);
          }
        },
      };
    }
  }
});

globalCommandRegistry.register({
  name: '/agents',
  description: 'List agent personas',
  category: 'Configuration',
  execute: async (args, context) => {
    // /agents <name> sets the persona directly; bare /agents shows a picker.
    const apply = (name: string) => {
      context.options.agent = name;
      context.saveConfig({ defaultAgent: name });
      context.addSystemMessage('success', `Agent persona switched to ${name}`);
    };
    const picked = args.join(' ').trim();
    const known = getKnownAgents();
    if (picked) {
      if (!known.includes(picked)) return { type: 'message', level: 'error', content: `Unknown agent "${picked}". Known: ${known.join(', ')}` };
      apply(picked);
      return { type: 'none' };
    }
    return {
      type: 'menu',
      title: 'Select an Agent Persona',
      options: known.map(a => ({
        label: a,
        value: a,
        description: 'Specialized model preset'
      })),
      // Without this, selecting a persona did nothing (the registry menu reports type 'menu', so the
      // legacy 'agent' branch in FullScreen never fired). Apply the pick directly.
      onSelect: (opt: any) => apply(opt.value),
    };
  }
});

globalCommandRegistry.register({
  name: '/model',
  description: 'Show current model',
  category: 'Configuration',
  execute: async (args, context) => {
    // Two slots: CODING (the main agent loop) and LITE (cheap aux calls — summaries, self-critic).
    const applyCoding = (model: string) => {
      try { context.options.llmAdapter?.applyConfig({ model }); } catch { /* adapter optional */ }
      context.options.model = model;
      context.saveConfig({ model });
      cliEvents.emit('config_changed'); // refresh the live UI (token meter + model display)
      context.addSystemMessage('success', `Coding model → ${model}`);
    };
    const applyLite = (model: string) => {
      try { context.options.llmAdapter?.applyConfig({ liteModel: model }); } catch { /* adapter optional */ }
      (context.options as any).liteModel = model;
      context.saveConfig({ liteModel: model });
      cliEvents.emit('config_changed');
      context.addSystemMessage('success', `Lite model → ${model}`);
    };
    const promptCustom = (apply: (m: string) => void) => {
      context.setActivePrompt({
        title: 'Enter a model id (e.g. provider/model-name)',
        onResolve: (val: string) => {
          const id = (val || '').trim();
          if (id) apply(id); else context.addSystemMessage('info', 'No model id entered — nothing changed.');
        },
      });
    };
    const liteOf = () => { try { return getConfig().liteModel; } catch { return ''; } };

    // /model lite [id]  |  /model coding [id]
    const slot = (args[0] || '').toLowerCase();
    if (slot === 'lite' || slot === 'coding') {
      const apply = slot === 'lite' ? applyLite : applyCoding;
      const rest = args.slice(1).join(' ').trim();
      if (rest) { rest === '__custom__' ? promptCustom(apply) : apply(rest); return { type: 'none' }; }
      const cur = slot === 'lite' ? (liteOf() || '(uses coding model)') : (context.options.model || 'default');
      return {
        type: 'menu',
        title: `Select ${slot === 'lite' ? 'LITE (fast/cheap)' : 'CODING (primary)'} model — current: ${cur}`,
        options: [...modelMenuOptions(cur), { label: '✎ Custom model id…', value: '__custom__', desc: 'Type any model your provider supports', category: 'Other providers (own key)' }],
        onSelect: (opt: any) => (opt.value === '__custom__' ? promptCustom(apply) : apply(opt.value)),
      };
    }

    // /model <id>  → set the coding model directly.
    if (args.length >= 1) { applyCoding(args.join(' ').trim()); return { type: 'none' }; }

    // /model  → coding picker, with a jump to the lite slot at the top.
    const current = context.options.model || 'default';
    return {
      type: 'menu',
      title: `Models — Coding: ${current}  ·  Lite: ${liteOf() || '(uses coding)'}`,
      options: [
        { label: '⚙ Set LITE model…', value: '/model lite', desc: `Fast model for summaries / self-critic / ask-user (current: ${liteOf() || 'uses coding'})`, category: 'Slots' },
        ...modelMenuOptions(current),
        { label: '✎ Custom model id…', value: '__custom__', desc: 'Type any model your provider supports', category: 'Other providers (own key)' },
      ],
      onSelect: (opt: any) =>
        opt.value === '/model lite' ? context.executeCommand('/model lite')
        : opt.value === '__custom__' ? promptCustom(applyCoding)
        : applyCoding(opt.value),
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
        { label: 'Coding model', value: '/model', desc: context.options.model || 'default', category: 'Session' },
        { label: 'Lite model', value: '/model lite', desc: (() => { try { return getConfig().liteModel || 'uses coding model'; } catch { return 'uses coding model'; } })(), category: 'Session' },
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
    // Live token usage is tracked per turn (footer shows it in verbose mode). Report the running
    // session estimate here plus the model in use, so /cost is a real readout — not a dead stub.
    const model = context.options?.model || 'default';
    let liteModel = '';
    try { liteModel = getConfig().liteModel || ''; } catch { /* config optional */ }
    const sessionTokens = (() => { try { return getSessionTokenEstimate(); } catch { return 0; } })();
    const lines = [
      `Model: ${model}${liteModel ? `  ·  Lite: ${liteModel}` : ''}`,
      sessionTokens > 0
        ? `Session usage: ~${sessionTokens.toLocaleString()} tokens streamed so far.`
        : 'Session usage: no output streamed yet this session.',
      'Live per-turn token rate shows in the footer — enable verbose (/config verbose) for the running total.',
      'Exact billed cost depends on your provider\'s pricing for the model above (BiMax is model-agnostic and does not set prices).',
    ];
    return { type: 'message', level: 'info', content: lines.join('\n') };
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

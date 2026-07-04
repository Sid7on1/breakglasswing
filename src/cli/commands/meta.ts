import { globalCommandRegistry } from './registry';
import { getCustomRules, addCustomRule, removeCustomRule, getKnownAgents } from '../agentRouter';
import { getCurrentProvider } from '../provider';
import { cliEvents, getSessionTokenEstimate } from '../events';
import { globalMcpManager } from '../../mcp/manager';
import { globalSkillService } from '../../skills/skill.service';
import { getTaintTracker } from '../../mind/taint';
import { getConfig } from '../config';
import { modelMenuOptions, liveModelMenuOptions } from '../models';
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
  description: 'Model & routing — id · lite · coding · tier · provider',
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

    // The picker offers the IDs the provider actually serves (root fix for "400 — invalid model").
    // Falls back to the static catalog when the provider has no /models endpoint or we're offline.
    const pickerOptions = async (cur?: string) => {
      try {
        const live = await context.options.llmAdapter?.listProviderModels();
        if (live && live.length) return liveModelMenuOptions(live, cur);
      } catch { /* fall back to static catalog */ }
      return modelMenuOptions(cur);
    };

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
        options: [...(await pickerOptions(cur)), { label: '✎ Custom model id…', value: '__custom__', desc: 'Type any model your provider supports', category: 'Other providers (own key)' }],
        onSelect: (opt: any) => (opt.value === '__custom__' ? promptCustom(apply) : apply(opt.value)),
      };
    }

    // Consolidated routing sub-verbs (Phase D): /model tier|provider|reasoning|routes|arms dispatch
    // to the dedicated (now palette-hidden) command, so the whole model/routing surface lives under
    // one primary verb. This also stops `/model tier` from being misread as "set coding model = tier".
    const ROUTING_SUBS: Record<string, string> = {
      tier: '/tier', provider: '/provider', reasoning: '/reasoning', routes: '/routes', arms: '/arms',
    };
    if (ROUTING_SUBS[slot]) {
      return { type: 'redirect', command: [ROUTING_SUBS[slot], ...args.slice(1)].join(' ').trim() };
    }

    // /model <id>  → set the coding model directly.
    if (args.length >= 1) { applyCoding(args.join(' ').trim()); return { type: 'none' }; }

    // /model  → coding picker, with a jump to the lite slot at the top.
    const current = context.options.model || 'default';
    return {
      type: 'menu',
      title: `Models — Coding: ${current}  ·  Lite: ${liteOf() || '(uses coding)'}`,
      options: [
        { label: '⚙ Set CODING model…', value: '/model coding', desc: `Primary agent model — the heavy/coding slot (current: ${current})`, category: 'Slots' },
        { label: '⚙ Set LITE model…', value: '/model lite', desc: `Fast model for summaries / self-critic / ask-user (current: ${liteOf() || 'uses coding'})`, category: 'Slots' },
        ...(await pickerOptions(current)),
        { label: '✎ Custom model id…', value: '__custom__', desc: 'Type any model your provider supports', category: 'Other providers (own key)' },
      ],
      onSelect: (opt: any) =>
        opt.value === '/model coding' ? context.executeCommand('/model coding')
        : opt.value === '/model lite' ? context.executeCommand('/model lite')
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
    const model = context.options?.model || 'default';
    let liteModel = '';
    try { liteModel = getConfig().liteModel || ''; } catch { /* config optional */ }
    const sessionTokens = (() => { try { return getSessionTokenEstimate(); } catch { return 0; } })();

    const tok = (s: string) => { try { return encode(s).length; } catch { return Math.ceil(s.length / 4); } };
    const textOf = (c: any): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => p.text || '').join('') : JSON.stringify(c);

    // Token category breakdown from live message history.
    let breakdownLines: string[] = [];
    try {
      const msgs: any[] = context.getMessages?.() || [];
      if (msgs.length > 0) {
        let systemTokens = 0, conversationTokens = 0, toolTokens = 0;
        for (const m of msgs) {
          const t = tok(textOf(m.content));
          if (m.role === 'system') systemTokens += t;
          else if (m.role === 'tool') toolTokens += t;
          else conversationTokens += t;  // user + assistant
        }
        const total = systemTokens + conversationTokens + toolTokens;
        const pct = (n: number) => total > 0 ? ` (${Math.round(n / total * 100)}%)` : '';
        breakdownLines = [
          `Token breakdown (${total.toLocaleString()} total in context):`,
          `  System / instructions : ${systemTokens.toLocaleString()}${pct(systemTokens)}`,
          `  Conversation history  : ${conversationTokens.toLocaleString()}${pct(conversationTokens)}`,
          `  Tool results          : ${toolTokens.toLocaleString()}${pct(toolTokens)}`,
        ];
      }
    } catch { /* best-effort */ }

    const lines = [
      `Model: ${model}${liteModel ? `  ·  Lite: ${liteModel}` : ''}`,
      sessionTokens > 0
        ? `Streamed output this session: ~${sessionTokens.toLocaleString()} tokens.`
        : 'Streamed output: none yet this session.',
      ...breakdownLines,
      'Exact billed cost depends on your provider\'s pricing (BiMax is model-agnostic and does not set prices).',
    ];
    return { type: 'message', level: 'info', content: lines.join('\n') };
  }
});

globalCommandRegistry.register({
  name: '/clear',
  description: 'Clear the screen and conversation history',
  category: 'Session & Context',
  execute: async (args, context) => {
    // Ink's FullScreen used to intercept /clear and show a confirm; that's gone (Ink retired), so do
    // the work here. `/clear force` resets the conversation history and emits the `clear` event the Go
    // TUI consumes to wipe its transcript; bare `/clear` asks first.
    if ((args[0] || '').toLowerCase() === 'force') {
      try { context.restoreMessages?.([]); } catch { /* best-effort */ }
      // The untrusted content leaves the window with the history — taint lifts with it.
      try { getTaintTracker().clear('conversation cleared'); } catch { /* best-effort */ }
      cliEvents.emit('clear');
      return { type: 'message', level: 'success', content: 'Conversation cleared.' };
    }
    return {
      type: 'menu',
      title: 'Clear the conversation and screen?',
      options: [
        { label: 'Yes, clear it', value: '/clear force', desc: 'Wipe the transcript and reset the conversation history' },
        { label: 'Cancel', value: '', desc: 'Keep everything' },
      ],
    };
  }
});

globalCommandRegistry.register({
  name: '/headroom',
  description: 'Headroom compression savings report (tokens saved, by model)',
  category: 'Session & Context',
  execute: async () => {
    const { getHeadroomReport } = require('../../memory/headroom.compress');
    let proxyLive = false;
    try { proxyLive = require('../../memory/headroomProxy').isHeadroomReady(); } catch { /* optional */ }
    const r = getHeadroomReport();
    if (r.totalSaved <= 0) {
      return {
        type: 'dashboard' as const,
        uiComponent: 'StatsDashboard',
        payload: {
          type: 'stats',
          title: '⚡ Headroom — context compression',
          items: [
            { label: 'Engine', value: proxyLive ? 'Kompress proxy live (chopratejas/kompress-v2-base, ONNX)' : 'starting (provisioning Kompress proxy…)' },
            { label: 'Tokens saved', value: '0 (nothing compressed yet)' },
            { label: 'How it works', value: 'the real Kompress ML model compresses tool outputs ~30-40% once the context is under token pressure; errors/signal lines are kept' },
          ],
        },
      };
    }
    const fmt = (n: number) => n.toLocaleString();
    const pct = Math.round((1 - r.ratio) * 100);
    // Engine line reflects CURRENT proxy readiness, not just the last recorded pass — otherwise a single
    // cold-start native pass (fired while the proxy was still provisioning) would keep it pinned to
    // "native" forever even after Kompress comes live.
    const engineVal = proxyLive
      ? 'Kompress proxy (chopratejas/kompress-v2-base, ONNX ML) — live'
      : 'native heuristic (Kompress proxy still provisioning)';
    const hadColdStart = proxyLive && r.byModel.length > 0 && r.engine === 'native';
    const items: { label: string; value: string }[] = [
      { label: 'Engine', value: engineVal },
      ...(hadColdStart ? [{ label: 'Note', value: 'early pass(es) used the native fallback while the proxy was warming up; new compactions use Kompress' }] : []),
      { label: 'Tokens saved (session)', value: `${fmt(r.totalSaved)} tok` },
      { label: 'Compaction passes', value: `${fmt(r.compressions)}` },
      { label: 'Avg compression', value: `${pct}% smaller (${fmt(r.totalBefore)} → ${fmt(r.totalAfter)} tok)` },
    ];
    if (r.byModel.length) {
      items.push({ label: '— by model —', value: '' });
      for (const m of r.byModel) {
        items.push({ label: m.model, value: `${fmt(m.saved)} tok saved · ${fmt(m.count)} pass(es)` });
      }
    }
    return {
      type: 'dashboard' as const,
      uiComponent: 'StatsDashboard',
      payload: { type: 'stats', title: '⚡ Headroom — context compression savings', items },
    };
  },
});

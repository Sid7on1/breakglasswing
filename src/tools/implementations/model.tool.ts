import { buildTool, BuiltTool } from '../tool.factory';
import { IGovernor } from '../../core/interfaces';
import { LlmAdapter } from '../../core/llm.adapter';
import { saveConfig, getConfig } from '../../cli/config';
import { getProviders, getCurrentProvider, setProvider } from '../../cli/provider';
import { MODEL_CATALOG } from '../../cli/models';
import { saveApiKeyToEnv } from '../../cli/env.loader';
import { cliEvents } from '../../cli/events';

/**
 * Gives the AGENT self-service over its own model API — the brain it runs on — instead of that being
 * a human-only `/model` / `/provider` command. The agent can list the models its provider actually
 * serves, switch the CODING model (main loop) or the LITE model (cheap aux calls: summaries,
 * self-critic), or switch provider. Changes apply LIVE to the running adapter and persist to config.
 *
 * Creative use: the agent right-sizes its own brain to the task — drop to a fast/cheap model for
 * boilerplate, jump to a stronger model for hard reasoning, all without the user intervening.
 */
export function createModelManageTool(governor: IGovernor, llmAdapter: LlmAdapter): BuiltTool {
  return buildTool({
    name: 'ModelManageTool',
    description: `Inspect and switch the LLM you (the agent) run on. Two slots: CODING (the main agent loop — your reasoning/tool-calling brain) and LITE (cheap auxiliary calls: summaries, self-critic, classification). Changes take effect immediately and persist.

# Actions
- list: show the current coding + lite models, the active provider, and the model ids your provider actually serves (so you don't pick one that 400s).
- use: switch a model. { slot: "coding" | "lite", model: "<id>" }. Use a model id from "list" (or a known catalog id). Switching the coding model changes the brain for subsequent turns.
- provider: switch LLM provider. { provider: "<name>" } from the providers list (each needs its own API key in env). Resets which model namespace is valid — set a model afterward.

# When to use
- A task needs a stronger/cheaper brain than the current one (right-size to the work).
- The user asks to change model/provider, or you hit repeated "invalid model" errors and need to pick a served id.

# Caution
- Only switch the CODING model when it clearly helps — it changes your own behaviour mid-task. Prefer the LITE slot for routine speed-ups. Always pick an id that "list" confirms the provider serves.`,
    isDestructive: false,
    isConcurrencySafe: false,
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'use', 'provider'], description: 'What to do.' },
        slot: { type: 'string', enum: ['coding', 'lite'], description: 'For use: which model slot to change.' },
        model: { type: 'string', description: 'For use: the model id to switch to (from list).' },
        provider: { type: 'string', description: 'For provider: the provider name to switch to.' },
      },
      required: ['action'],
    },
    execute: async (args: { action: string; slot?: string; model?: string; provider?: string }) => {
      const cfg = () => { try { return getConfig(); } catch { return {} as any; } };

      if (args.action === 'list') {
        const c = cfg();
        const prov = getCurrentProvider();
        let live: string[] = [];
        try { live = (await llmAdapter.listProviderModels()) || []; } catch { /* offline / no endpoint */ }
        const served = live.length
          ? live.slice(0, 40).join(', ') + (live.length > 40 ? `, … (${live.length} total)` : '')
          : MODEL_CATALOG.map(m => m.value).join(', ') + '  (static catalog — provider has no /models endpoint)';
        const providers = getProviders().map(p => p.name).join(', ');
        return [
          `Active provider: ${prov.name}  (available: ${providers})`,
          `Coding model: ${c.model || '(default)'}`,
          `Lite model:   ${c.liteModel || '(default)'}`,
          ``,
          `Models your provider serves: ${served}`,
        ].join('\n');
      }

      if (args.action === 'use') {
        if (!args.model) return 'use requires "model" (an id from action="list").';
        const slot = args.slot === 'lite' ? 'lite' : 'coding';
        if (slot === 'coding') {
          llmAdapter.applyConfig({ model: args.model });
          await saveConfig({ model: args.model });
        } else {
          llmAdapter.applyConfig({ liteModel: args.model });
          await saveConfig({ liteModel: args.model });
        }
        try { cliEvents.emit('config_changed'); } catch { /* UI refresh best-effort */ }
        return `Switched ${slot} model → ${args.model} (live + saved).`;
      }

      if (args.action === 'provider') {
        if (!args.provider) return `provider requires "provider". Available: ${getProviders().map(p => p.name).join(', ')}.`;
        const found = setProvider(args.provider);
        if (!found) return `Unknown provider "${args.provider}". Available: ${getProviders().map(p => p.name).join(', ')}.`;
        try { saveApiKeyToEnv('BGW_PROVIDER', found.name); } catch { /* persistence optional */ }
        const hasKey = !!process.env[found.apiKeyEnv];
        try { cliEvents.emit('config_changed'); } catch { /* best-effort */ }
        return `Switched provider → ${found.name}.${hasKey ? '' : ` ⚠ No ${found.apiKeyEnv} set — add the key or calls will fail.`} ` +
          `Now set a served model with action="use" (default: ${found.defaultModel}).`;
      }

      return `Unknown action "${args.action}". Use "list", "use", or "provider".`;
    },
  }, governor);
}

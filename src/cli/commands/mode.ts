import { globalCommandRegistry } from './registry';
import { cliEvents } from '../events';
import { getAgentMode, setAgentMode, AgentMode, setExploreEngagedGate, didExploreEngageGate } from '../agentMode';

/**
 * /mode — switch the agent's behavioral specialization (UPGRADE-PLAN 5.2).
 *
 * /mode explore   → read-only reconnaissance (writes blocked via the governor's plan gate)
 * /mode code      → execution focus (minimal reads, surgical edits, verify after)
 * /mode general   → default behaviour (no specialization)
 * /mode           → show the current mode + a picker
 *
 * This sits above the brand persona (/agents) and shapes the system prompt. Explore additionally
 * flips the governor into plan mode so the read-only guarantee is actually enforced, not just
 * suggested; switching to code/general restores normal write permissions.
 */
// Restore write permissions ONLY if explore mode is what engaged the plan gate. If the user turned
// on plan mode themselves via `/plan`, leave it alone — `/mode` must not silently cancel it.
function restoreWritePermissionsIfOurs(context: any): void {
  const governor = context.options.governor;
  if (governor && governor.mode === 'plan' && didExploreEngageGate()) {
    governor.mode = context.options.dangerouslySkipPermissions ? 'bypass' : 'interactive';
  }
  setExploreEngagedGate(false);
}

function applyMode(mode: AgentMode, context: any): { type: 'message'; level: 'success'; content: string } {
  const governor = context.options.governor;
  setAgentMode(mode);

  if (mode === 'explore') {
    // Only flip the gate (and remember we did) if it wasn't already engaged by `/plan`.
    if (governor && governor.mode !== 'plan') {
      governor.mode = 'plan'; // reuse the proven write-gate for read-only enforcement
      setExploreEngagedGate(true);
    }
    cliEvents.emit('mode_change', 'EXPLORE');
    return { type: 'message', level: 'success', content: 'Explore mode ON — read-only reconnaissance. The agent maps the codebase with graph/search/read tools; all writes are blocked. Switch to /mode code or /mode general to make changes again.' };
  }

  restoreWritePermissionsIfOurs(context);
  if (mode === 'code') {
    cliEvents.emit('mode_change', 'CODE');
    return { type: 'message', level: 'success', content: 'Code mode ON — execution focus. The agent minimizes redundant reads, makes surgical edits, and verifies with build/tests. Writes are allowed.' };
  }

  cliEvents.emit('mode_change', '');
  return { type: 'message', level: 'success', content: 'General mode ON — default behaviour, no specialization. Writes are allowed.' };
}

globalCommandRegistry.register({
  name: '/mode',
  description: 'Switch agent behavioral mode — explore (read-only) · code (execution) · general',
  category: 'General',
  execute: async (args, context) => {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'explore' || sub === 'code' || sub === 'general') {
      return applyMode(sub as AgentMode, context);
    }

    if (sub) {
      return { type: 'message', level: 'error', content: `Unknown mode "${sub}". Valid: explore, code, general.` };
    }

    const current = getAgentMode();
    return {
      type: 'menu',
      title: `Agent mode (current: ${current})`,
      options: [
        { label: 'explore', value: 'explore', desc: 'Read-only reconnaissance — map the codebase, writes blocked', category: 'Modes' },
        { label: 'code', value: 'code', desc: 'Execution focus — minimal reads, surgical edits, verify after', category: 'Modes' },
        { label: 'general', value: 'general', desc: 'Default behaviour — no specialization', category: 'Modes' },
      ],
      onSelect: (opt: any) => {
        const msg = applyMode(opt.value as AgentMode, context);
        context.addSystemMessage(msg.level, msg.content);
      },
    };
  },
});

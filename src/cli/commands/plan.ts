import { globalCommandRegistry } from './registry';
import { cliEvents } from '../events';

/**
 * /plan — Research-only mode. The Governor blocks every mutating action while
 * active, so the agent investigates and proposes a plan without touching the
 * workspace. `/plan off` returns to interactive mode so the plan can be executed.
 */
globalCommandRegistry.register({
  name: '/plan',
  description: 'Enter read-only plan mode (propose, don\'t change)',
  category: 'General',
  execute: async (args, context) => {
    const governor = context.options.governor;
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'off' || sub === 'exit') {
      governor.mode = context.options.dangerouslySkipPermissions ? 'bypass' : 'interactive';
      cliEvents.emit('mode_change', '');
      return { type: 'message', level: 'success', content: 'Plan mode OFF — the agent can make changes again. Ask it to execute the plan.' };
    }

    if (sub === '' || sub === 'on') {
      if (governor.mode === 'plan') {
        return { type: 'message', level: 'info', content: 'Already in plan mode. Use /plan off to allow changes.' };
      }
      governor.mode = 'plan';
      cliEvents.emit('mode_change', 'PLAN');
      return {
        type: 'message',
        level: 'success',
        content: 'Plan mode ON 🗺️ — read-only. The agent will research and propose a plan; all writes and shell mutations are blocked. Run /plan off to approve and execute.'
      };
    }

    return { type: 'message', level: 'error', content: 'Usage: /plan [on|off]' };
  }
});

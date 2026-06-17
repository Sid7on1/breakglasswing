import { globalCommandRegistry } from './registry';
import { cliEvents } from '../events';

// /tier — manual model-tier control, the discoverable twin of the Ctrl+T chord. BiMax routes each
// turn to the LITE model and auto-escalates to the HEAVY coding model when a turn needs it. This
// pins that choice: `/tier heavy` forces every turn onto the coding model, `/tier lite` forces the
// fast model, `/tier auto` restores automatic routing. Drives the same pin Ctrl+T toggles, via the
// `set_tier` event handled in FullScreen.
const VALID = new Set(['auto', 'lite', 'heavy']);

globalCommandRegistry.register({
  name: '/tier',
  aliases: ['/model-tier', '/route'],
  category: 'Configuration',
  description: 'Pin the model tier — auto (default) · lite · heavy (also: Ctrl+T)',
  execute: async (args, context) => {
    const sub = (args[0] || '').toLowerCase();

    if (VALID.has(sub)) {
      cliEvents.emit('set_tier', sub as 'auto' | 'lite' | 'heavy');
      const msg = sub === 'auto'
        ? 'Routing → auto (lite decides, escalates to the coding model as needed).'
        : `Routing pinned → ${sub} model. Every turn now uses the ${sub === 'heavy' ? 'coding' : 'lite'} model until you /tier auto.`;
      return { type: 'message', level: 'success', content: msg };
    }

    return {
      type: 'menu',
      title: 'Model tier — which model handles your turns',
      options: [
        { label: 'Auto', value: '/tier auto', desc: 'Lite answers; escalates to the coding model when a turn needs it (default)' },
        { label: 'Lite', value: '/tier lite', desc: 'Pin the fast lite model for every turn' },
        { label: 'Heavy', value: '/tier heavy', desc: 'Pin the coding model for every turn' },
      ],
      onSelect: (opt: any) => context.executeCommand(opt.value),
    };
  },
});

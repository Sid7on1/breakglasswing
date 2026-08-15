import { EventEmitter } from 'node:events';

/** Desktop-owned lifecycle/event bus. Provider stderr remains protocol-safe. */
export const capabilityEvents = new EventEmitter();
capabilityEvents.on('status', (message: unknown) => {
  if (process.env.BIMAX_MAC_PROVIDER_LOG === '1') process.stderr.write(`[mac-capability] ${String(message)}\n`);
});


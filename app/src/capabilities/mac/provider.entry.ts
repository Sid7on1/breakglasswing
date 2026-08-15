import { runMacCapabilityProvider } from './server';

void runMacCapabilityProvider().catch(error => {
  process.stderr.write(`[mac-capability] fatal: ${String(error?.stack || error)}\n`);
  process.exitCode = 1;
});


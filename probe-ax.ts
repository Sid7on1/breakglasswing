import { BimaxComputerRuntime } from './src/computer/desktop.runtime';

/**
 * Why did an observation report `semantic: null` while the screenshot plainly showed 216,174?
 * Dump what the AX/visual layer actually returns for Calculator after a computation, twice, so
 * run-to-run variance is visible rather than averaged away.
 */
async function once(runtime: BimaxComputerRuntime, label: string) {
  await runtime.run({ action: 'key', combo: 'escape' });
  await runtime.run({ action: 'key', combo: 'escape' });
  await runtime.run({ action: 'type', text: '1271*170+104' });
  await runtime.run({ action: 'key', combo: 'return' });
  await new Promise(r => setTimeout(r, 600));
  const obs = await runtime.run({ action: 'observe', maxElements: 500 });
  const els = (obs.elements || []) as any[];
  const hit = els.find(e => String(e?.value ?? e?.label ?? '').replace(/[^0-9-]/g, '') === '216174');
  console.error(`AX [${label}] ok=${obs.ok} degraded=${obs.degraded} elements=${els.length} match=${hit ? JSON.stringify(hit) : 'NONE'}`);
  const digity = els
    .filter(e => /\d/.test(String(e?.value ?? '') + String(e?.label ?? '')))
    .slice(0, 12)
    .map(e => ({ role: e.role, label: e.label, value: e.value }));
  console.error(`AX [${label}] digit-bearing elements: ${JSON.stringify(digity)}`);
  console.error(`AX [${label}] roles seen: ${JSON.stringify([...new Set(els.map(e => e.role))].slice(0, 15))}`);
}

(async () => {
  const runtime = new BimaxComputerRuntime();
  try {
    await runtime.run({ action: 'open', app: 'Calculator', bundleId: 'com.apple.calculator' });
    await runtime.run({ action: 'observe', maxElements: 500 });
    await once(runtime, 'run1');
    await once(runtime, 'run2');
  } finally {
    await runtime.run({ action: 'quit_app' });
    await runtime.dispose();
  }
})().catch(e => { console.error('AX ERROR ' + (e?.message || e)); process.exitCode = 1; });

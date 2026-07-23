import * as fs from 'fs';
import * as path from 'path';
import { BimaxComputerRuntime } from '../src/computer/desktop.runtime';

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('continuous PiP smoke is macOS-only');
  const root = path.resolve(__dirname, '..');
  process.env.BIMAX_COMPUTER_PIP = '1';
  process.env.BIMAX_COMPUTER_USE_DRIVER ||= path.join(root, 'tui', 'embed', 'bimax-computer-use');
  process.env.BIMAX_LIVE_PIP_HELPER ||= path.join(root, 'tui', 'embed', 'bimax-live-pip');
  for (const variable of ['BIMAX_COMPUTER_USE_DRIVER', 'BIMAX_LIVE_PIP_HELPER']) {
    const file = process.env[variable]!;
    if (!fs.existsSync(file)) throw new Error(`${variable} does not exist: ${file}`);
  }

  const runtime = new BimaxComputerRuntime();
  try {
    const opened = await runtime.run(
      { action: 'open', app: 'Calculator', deliveryMode: 'foreground' },
      { cwd: root },
    );
    if (!opened.ok) throw new Error(opened.error || opened.summary);

    const deadline = Date.now() + 15_000;
    let status = await runtime.pipStatus();
    while ((status.frames || 0) < 15 && !status.error && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
      status = await runtime.pipStatus();
    }
    if (status.error) throw new Error(status.error);
    if (!status.running || (status.frames || 0) < 15) {
      throw new Error(`PiP did not deliver 15 continuous frames: ${JSON.stringify(status)}`);
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      continuous: status.continuous,
      frames: status.frames,
      captureSafe: status.captureSafe,
      surface: status.surface,
    })}\n`);

    const closed = await runtime.run({ action: 'close' }, { cwd: root });
    if (!closed.ok) process.stderr.write(`cleanup warning: ${closed.error || closed.summary}\n`);
  } finally {
    await runtime.dispose();
  }
}

main().catch(error => {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exitCode = 1;
});

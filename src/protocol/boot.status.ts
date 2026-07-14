import { BootMsg } from './protocol';

/**
 * Startup-phase reporting for supervised (headless) launches. The protocol host only attaches at
 * the END of boot — everything before that (config load, graph load, tool wiring) used to be
 * silence on the wire, which is why the desktop could only show "Engine starting…" forever. These
 * writes go straight to stdout as NDJSON, safely: in headless mode stdout carries ONLY protocol
 * lines (boot logs are captured/diverted in index.ts), and each write is a single short line.
 *
 * No-op outside headless mode so the CLI/print paths never see protocol JSON on their stdout.
 */

function headless(): boolean {
  return process.env.BIMAX_HEADLESS === '1' || process.argv.includes('--headless');
}

export function reportBootPhase(phase: BootMsg['phase'], detail?: string): void {
  if (!headless()) return;
  const msg: BootMsg = { t: 'boot', phase, pid: process.pid, ...(detail ? { detail } : {}) };
  try { process.stdout.write(JSON.stringify(msg) + '\n'); } catch { /* stdout gone — parent exited */ }
}

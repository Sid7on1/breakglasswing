import { spawn, ChildProcess } from 'child_process';
import { Logger } from '../utils';

export class Watchdog {
  private child: ChildProcess | null = null;
  private restarts: number[] = [];
  private stabilityTimer: NodeJS.Timeout | null = null;
  
  private readonly WATCHDOG_MAX_RESTARTS = 5;
  private readonly WATCHDOG_WINDOW_MS = 60000; // 1 minute
  private readonly WATCHDOG_BASE_DELAY_MS = 1000;
  private readonly WATCHDOG_STABILITY_MS = 5 * 60 * 1000; // 5 minutes of clean uptime resets counter

  constructor(private readonly agentEntryPath: string) {
    Logger.info(`[Watchdog] Booting resilience layer for ${agentEntryPath}`);
  }

  public start() {
    this.spawnAgent();
  }

  private spawnAgent() {
    const now = Date.now();
    
    // Prune old restarts outside the window
    this.restarts = this.restarts.filter(t => now - t <= this.WATCHDOG_WINDOW_MS);

    if (this.restarts.length >= this.WATCHDOG_MAX_RESTARTS) {
      Logger.error(`[Watchdog] ❌ CRASH LOOP DETECTED. ${this.restarts.length} restarts in the last minute. Shutting down system permanently.`);
      process.exit(1);
    }

    Logger.info(`[Watchdog] 🚀 Spawning Agent Process...`);
    
    this.child = spawn('npx', ['tsx', this.agentEntryPath], {
      stdio: 'inherit',
      env: process.env
    });

    // Start stability observation timer (TEL-002)
    // If process survives this long without crashing, reset the counter
    if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
    this.stabilityTimer = setTimeout(() => {
      if (this.restarts.length > 0) {
        Logger.info(`[Watchdog] ✅ Process stable for ${this.WATCHDOG_STABILITY_MS / 1000}s. Resetting restart counter.`);
        this.restarts = [];
      }
    }, this.WATCHDOG_STABILITY_MS);

    this.child.on('exit', (code, signal) => {
      // Cancel stability timer on crash
      if (this.stabilityTimer) {
        clearTimeout(this.stabilityTimer);
        this.stabilityTimer = null;
      }

      const reason = code === 137 ? "OOM-Killed" : `Exit Code ${code}`;
      Logger.warn(`[Watchdog] ⚠ Agent crashed (${reason}). Initiating auto-resurrection protocol.`);
      
      this.restarts.push(Date.now());
      
      const nRestarts = this.restarts.length;
      // Exponential backoff: Base * 2^(restarts - 1)
      const delayMs = Math.min(this.WATCHDOG_BASE_DELAY_MS * Math.pow(2, nRestarts - 1), 60000);

      Logger.warn(`[Watchdog] Restart ${nRestarts}/${this.WATCHDOG_MAX_RESTARTS}. Sleeping for ${delayMs}ms before resurrection.`);
      
      setTimeout(() => {
        this.spawnAgent();
      }, delayMs);
    });
  }

  public kill() {
    if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
    if (this.child) {
      this.child.kill('SIGTERM');
    }
  }
}


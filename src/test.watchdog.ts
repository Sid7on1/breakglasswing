import { Watchdog } from './telemetry/watchdog';
import { MemoryMonitor } from './telemetry/memory.monitor';
import { Logger } from './utils';

const isChild = process.env.IS_CHILD_AGENT === 'true';

if (!isChild) {
  // --- PARENT WATCHDOG PROCESS ---
  Logger.info('--- Initializing Advanced Watchdog Test ---');
  
  // Point the watchdog to run THIS VERY SCRIPT again, but with an env variable to trigger child logic
  process.env.IS_CHILD_AGENT = 'true';
  const watchdog = new Watchdog(__filename);
  watchdog.start();
  
  // For the test, we kill the watchdog after 10 seconds
  setTimeout(() => {
    Logger.info('[Watchdog] Test complete. Shutting down.');
    watchdog.kill();
    process.exit(0);
  }, 10000);
  
} else {
  // --- CHILD AGENT PROCESS ---
  Logger.info('[Agent] Booted successfully inside Watchdog.');
  
  // Lower the threshold for testing so it OOMs quickly (250MB)
  const monitor = new MemoryMonitor(100, 250); 
  monitor.start(100); // Check every 100ms
  
  Logger.info('[Agent] Simulating massive memory leak...');
  
  // Create a massive array to trigger OOM
  const leak: any[] = [];
  const leakLoop = setInterval(() => {
    const rss = monitor.getMemoryMB();
    Logger.info(`[Agent] Current Mem: ${rss}MB. Allocating 50MB...`);
    
    const junk = Buffer.alloc(50 * 1024 * 1024, 'x'); 
    leak.push(junk);
  }, 300);
}

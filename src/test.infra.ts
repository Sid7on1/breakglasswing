import { EnvValidator } from './config/env.validator';
import { Logger } from './utils/logger';
import { TelemetryEngine } from './telemetry/metrics';
import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  Logger.info('--- Initializing Robust Infrastructure Suite Test ---');

  // 1. Test EnvValidator (Zod)
  Logger.info('\n[Test 1] Testing Strict Env Validation...');
  const validator = new EnvValidator();
  
  // Set fake process.env for test
  process.env.OPENAI_API_KEY = "sk-mock-1234567890abcdefghij";
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
  process.env.AGENT_PORT = "8080";
  
  const isValid = validator.loadAndValidate();
  if (isValid) {
    Logger.info(`[Test 1] ✅ Zod Validation Succeeded!`);
  } else {
    throw new Error('Zod validation failed unexpectedly.');
  }

  // Set bad port
  process.env.AGENT_PORT = "badport";
  Logger.info(`[Test 1] Testing rejection of bad data...`);
  const isInvalid = validator.loadAndValidate();
  if (!isInvalid) {
    Logger.info(`[Test 1] ✅ Zod correctly rejected bad data!`);
  } else {
    throw new Error('Zod validation passed bad data!');
  }


  // 2. Test Persistent Disk Logger
  Logger.info('\n[Test 2] Testing Persistent Disk Logger...');
  Logger.warn('This is a test warning to verify disk flush.');
  
  // Wait 100ms for async append
  await new Promise(r => setTimeout(r, 100));

  const logFile = path.join(process.cwd(), '.breakglass_logs', 'agent.log');
  const logContent = await fs.readFile(logFile, 'utf-8');
  
  if (logContent.includes('This is a test warning to verify disk flush.')) {
    Logger.info(`[Test 2] ✅ Logger successfully flushed JSON stream to physical disk!`);
  } else {
    throw new Error('Logger failed to write to physical disk.');
  }


  // 3. Test Persistent Telemetry Flush
  Logger.info('\n[Test 3] Testing Persistent Telemetry Sync...');
  const engine = new TelemetryEngine();
  
  const mockKeys = [
    { total_ok: 10, total_fail: 0, consecutive_429: 0 }
  ];
  
  await engine.flushTelemetry(128.5, mockKeys);

  const metricsFile = path.join(process.cwd(), '.breakglass_telemetry', 'metrics.json');
  const metricsContent = await fs.readFile(metricsFile, 'utf-8');
  const parsed = JSON.parse(metricsContent);

  if (parsed.metrics.memory_mb === 128.5) {
    Logger.info(`[Test 3] ✅ Telemetry successfully wrote complete JSON dump to physical disk!`);
  } else {
    throw new Error('Telemetry engine failed to write valid JSON to physical disk.');
  }

  Logger.info('\n--- All Infrastructure Suite Tests Passed ---');
  process.exit(0);
}

main().catch(console.error);

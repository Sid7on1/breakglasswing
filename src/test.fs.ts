import { FileSystemAdapter } from './sandbox/fs.adapter';
import { Logger } from './utils';

async function main() {
  Logger.info('--- Initializing Path Traversal Jail Test ---');
  
  // Set the sandbox to a specific local directory
  const adapter = new FileSystemAdapter('./.breakglass_sandbox');

  try {
    // Attempt a directory traversal attack to read the root config file
    Logger.info('[Test] Attempting malicious read of ../package.json');
    await adapter.readFile('../package.json');
    Logger.error('[Test] FAILED: The agent successfully broke out of the sandbox!');
  } catch (error: any) {
    if (error.message.includes('Path Traversal Attack Blocked')) {
      Logger.info(`[Test] SUCCESS: Sandbox physically intercepted the path traversal exploit.`);
      Logger.info(`[Test] Original Error: ${error.message}`);
    } else {
      Logger.error(`[Test] FAILED: Unexpected error: ${error.message}`);
    }
  }
}

main().catch(console.error);

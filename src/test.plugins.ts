import { PluginManager } from './plugins';
import { Logger } from './utils';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

async function main() {
  Logger.info('--- Initializing Robust Plugin Engine Test ---');
  
  // Create a local dummy "remote" repo to clone
  const remoteRepoPath = path.join(__dirname, 'dummy_remote_repo');
  await fs.mkdir(remoteRepoPath, { recursive: true });
  
  // package.json with test script
  const pkgJson = {
    name: "dummy-calculator",
    version: "1.0.0",
    description: "A super advanced calculator",
    keywords: ["math", "logging"],
    scripts: {
      "test": "node test.js"
    }
  };
  await fs.writeFile(path.join(remoteRepoPath, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf-8');
  
  // Passing test file
  const testJs = `
    const assert = require('assert');
    assert.strictEqual(1 + 1, 2);
    console.log("Tests passed!");
  `;
  await fs.writeFile(path.join(remoteRepoPath, 'test.js'), testJs, 'utf-8');

  // Initialize git repo
  await execAsync(`git init`, { cwd: remoteRepoPath });
  await execAsync(`git checkout -b main`, { cwd: remoteRepoPath });
  await execAsync(`git add .`, { cwd: remoteRepoPath });
  await execAsync(`git commit -m "Initial commit"`, { cwd: remoteRepoPath });

  const manager = new PluginManager();
  
  Logger.info('\n[Test] Attempting to install dummy repository via physical clone & test...');
  // The url will literally be the file:// path
  const success = await manager.installFromGithub(`file://${remoteRepoPath}`);
  
  if (success) {
    Logger.info(`[Test] ✅ Plugin Pipeline fully executed successfully.`);
    const caps = manager.registry.getCapabilities();
    Logger.info(`[Test] System now possesses physical capabilities: ${caps.join(', ')}`);
  } else {
    Logger.error(`[Test] ❌ Plugin Pipeline failed.`);
  }

  // Cleanup
  await fs.rm(remoteRepoPath, { recursive: true, force: true });
  await fs.rm(path.join(process.cwd(), '.breakglass_plugins_staging'), { recursive: true, force: true });
  Logger.info('\n--- All Plugin Tests Complete ---');
}

main().catch(console.error);

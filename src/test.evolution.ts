import { ArchitectureGuardian } from './genome/guardian';
import { EvolutionPointerSwap } from './sandbox/pointer.swap';
import { GenomeRepository } from './genome/genome.repository';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from './utils';

async function main() {
  Logger.info('--- Initializing Evolution Cycle Simulation ---');
  const projectRoot = process.cwd();
  const sandboxDir = path.join(projectRoot, 'src', 'sandbox', 'evolution_workspace');
  
  const genomeRepo = new GenomeRepository(projectRoot);
  await genomeRepo.reload();
  
  const guardian = new ArchitectureGuardian(projectRoot, genomeRepo);
  const swapper = new EvolutionPointerSwap(projectRoot, guardian);

  // 1. Simulate an Agent creating a broken V2
  Logger.info(`\n[Agent] Evolving CognitiveLoop (V2) with a broken contract...`);
  const brokenV2Code = `
import { Logger } from '../utils/logger';
export class CognitiveLoop {
  async processTask(payload: any) {
    Logger.info("Processing task but forgetting to emit TASK_FAILED on error...");
    throw new Error("Broken");
  }
}
  `;
  const brokenPath = path.join(sandboxDir, 'cognitive.loop.broken.ts');
  await fs.writeFile(brokenPath, brokenV2Code.trim());

  Logger.info(`[System] Attempting Pointer Swap with broken V2...`);
  const brokenResult = await swapper.swap('CognitiveLoop', 'src/sandbox/evolution_workspace/cognitive.loop.broken.ts', 'src/core/cognitive.loop.ts');
  
  if (!brokenResult) {
    Logger.info(`[System] ✅ Success! The Architecture Guardian successfully blocked the broken evolution.`);
  } else {
    Logger.error(`[System] ❌ Failure! The Guardian allowed a broken evolution.`);
  }

  // 2. Simulate an Agent creating a valid V2
  Logger.info(`\n[Agent] Evolving CognitiveLoop (V2) with a VALID contract...`);
  const validV2Code = `
import { Logger } from '../utils/logger';
import { IEventBus } from './interfaces';

export class CognitiveLoop {
  constructor(private eventBus: IEventBus) {}
  
  async processTask(payload: any) {
    Logger.info("Processing task successfully. I am V2!");
    try {
      // New feature logic here
    } catch(e: any) {
      this.eventBus.emit('TASK_FAILED', { reason: e.message });
    }
  }
}
  `;
  const validPath = path.join(sandboxDir, 'cognitive.loop.valid.ts');
  await fs.writeFile(validPath, validV2Code.trim());

  Logger.info(`[System] Attempting Pointer Swap with VALID V2...`);
  // Note: We won't actually overwrite the real cognitive.loop.ts so we don't break the actual project for real.
  // We'll target a dummy file.
  const dummyTargetPath = path.join(projectRoot, 'src', 'core', 'cognitive.loop.dummy.ts');
  await fs.writeFile(dummyTargetPath, `export class CognitiveLoop {}`); // dummy initial state

  const validResult = await swapper.swap('CognitiveLoop', 'src/sandbox/evolution_workspace/cognitive.loop.valid.ts', 'src/core/cognitive.loop.dummy.ts');
  
  if (validResult) {
    Logger.info(`[System] ✅ Success! The Architecture Guardian approved and swapped the valid evolution.`);
  } else {
    Logger.error(`[System] ❌ Failure! The Guardian blocked a valid evolution.`);
  }

  Logger.info('\n--- Evolution Cycle Simulation Complete ---');
}

main().catch(console.error);

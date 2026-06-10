import { createContainer } from './core/container';

async function main() {
  const { orchestrator, bootloader } = createContainer();
  await bootloader.ignite();
  await orchestrator.run();
}

main().catch(console.error);

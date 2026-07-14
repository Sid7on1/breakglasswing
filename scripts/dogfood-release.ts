import { DogfoodEngine } from '../src/mind/dogfood.engine';

async function main(): Promise<void> {
  const engine = new DogfoodEngine(process.cwd());
  const { results, reportPath } = await engine.run((level, message) => console.log(`[${level}] ${message}`));
  for (const result of results) {
    const state = !result.ran ? 'SKIP' : result.passed ? 'PASS' : 'FAIL';
    console.log(`${state.padEnd(4)} ${result.id}: ${result.summary}`);
  }
  const failures = results.filter(result => result.ran && result.passed === false);
  if (reportPath) console.error(`Dogfood report: ${reportPath}`);
  if (failures.length) process.exitCode = 1;
}

void main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

import { GithubReader } from './github.reader';
import { GithubAnalyzer } from './github.analyzer';
import { PluginEvaluator } from './plugin.evaluator';
import { PluginSandbox } from './plugin.sandbox';
import { PluginIntegrator } from './plugin.integrator';
import { PluginRegistry } from './registry';

export class PluginManager {
  private reader = new GithubReader();
  private analyzer = new GithubAnalyzer();
  private evaluator = new PluginEvaluator();
  private sandbox = new PluginSandbox();
  public registry = new PluginRegistry();
  private integrator = new PluginIntegrator(this.registry);

  async installFromGithub(url: string): Promise<boolean> {
    console.log(`\n--- Starting Plugin Pipeline for ${url} ---`);
    
    // 1. Fetch
    const tempDir = await this.reader.fetchRepo(url);

    // 2. Analyze
    const analysis = await this.analyzer.analyzeCodebase(tempDir);

    // 3. Evaluate
    const evaluation = this.evaluator.evaluate(analysis);
    if (!evaluation.approved) {
      console.log(`[Pipeline] Discarding plugin. Reason: ${evaluation.reason}`);
      return false;
    }

    // 4. Sandbox Test
    const sandboxPassed = await this.sandbox.testPlugin(tempDir);
    if (!sandboxPassed) {
      console.log(`[Pipeline] Discarding plugin. Reason: Failed isolated sandbox tests.`);
      return false;
    }

    // 5. Integrate
    await this.integrator.integrate(analysis, tempDir);
    
    return true;
  }
}

export * from './registry';

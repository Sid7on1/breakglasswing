import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { getTrainLauncher } from '../../training/train.launcher';
import { getTrainMonitor } from '../../training/train.monitor';

interface TrainLaunchArgs {
  action: 'launch' | 'status' | 'stop' | 'list';
  run?: string;
  dir?: string;
  smoke?: boolean;
  script?: string;
  wait_for_ready?: boolean;
  timeout_ms?: number;
}

/**
 * TrainLaunchTool — actually launches a built LLM-training scaffold. Spawns `python3 train.py` (the
 * script BlueprintCompiler emits) in the build dir as a detached background process, captures its log,
 * and auto-wires TrainMonitorTool to the metrics.jsonl it writes. This is the "Build → run it" step for
 * the LLM domain; it spawns compute, so it's a beast-mode (write-enabled) action, not a sketch one.
 */
export const createTrainLaunchTool = (governor: IGovernor) => buildTool({
  name: 'TrainLaunchTool',
  description: `Launch (and manage) a generated LLM training run from a built Blueprint scaffold. Runs the emitted train.py as a background process and auto-wires monitoring.

# Actions
- **launch**: Start a run. Pass run (a name, usually the Blueprint slug) and dir (the build dir, e.g. .bimax/builds/<slug>). Optional script — "train.py" (default) to train, or "eval.py" to run the eval harness (perplexity / lm-eval-harness benchmarks → eval_results.json). Set smoke=true for a dependency-free offline dry run that proves the pipeline without torch/data/GPU; omit it for the real run. Set wait_for_ready=true to wait for fresh metrics/results from this exact launch (timeout_ms defaults to 30000). Training launches auto-register with TrainMonitorTool.
- **status**: Process + progress for a run. Pass run. Shows pid, running/stopped, metric steps written (train) or eval_results.json (eval), and the tail of the run log.
- **stop**: Terminate a running launch (SIGTERM). Pass run.
- **list**: List launched runs.

# When to use
After BlueprintTool build emits an LLM scaffold: launch smoke=true first to confirm the pipeline writes metrics, then launch (no smoke) for the real run. To verify quality, launch script="eval.py" and read eval_results.json via status. Poll TrainMonitorTool status for loss/grad/throughput. Set BIMAX_PYTHON to pick a specific interpreter.`,
  isDestructive: true,
  isConcurrencySafe: false,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['launch', 'status', 'stop', 'list'] },
      run: { type: 'string', description: 'Run name / Blueprint slug (required for launch/status/stop).' },
      dir: { type: 'string', description: 'Build dir containing the script, e.g. .bimax/builds/<slug> (required for launch).' },
      smoke: { type: 'boolean', description: 'Dependency-free offline dry run (optional; default false = real run).' },
      script: { type: 'string', enum: ['train.py', 'eval.py'], description: 'Which entrypoint to run (optional; default train.py). Use eval.py for the eval harness.' },
      wait_for_ready: { type: 'boolean', description: 'Wait for fresh metrics/results from this launch before returning (optional; default false).' },
      timeout_ms: { type: 'number', minimum: 100, maximum: 300000, description: 'Readiness timeout in milliseconds when wait_for_ready=true (default 30000).' },
    },
    required: ['action'],
  },
  execute: async (args: TrainLaunchArgs) => {
    const launcher = getTrainLauncher();
    if (!launcher) return 'Error: TrainLauncher not initialized in this context.';
    switch (args.action) {
      case 'launch': {
        if (!args.run || !args.dir) return 'Error: run and dir are required for "launch".';
        const r = launcher.launch(args.run, args.dir, { smoke: args.smoke, script: args.script });
        if ('error' in r) return `Error: ${r.error}`;
        const isEval = /eval/.test(r.script);
        // Auto-wire monitoring for training runs so Verify is live the moment train.py writes a step.
        const mon = getTrainMonitor();
        let wired = '';
        if (mon && !isEval) { mon.watch(r.run, r.metrics); wired = `\nMonitoring auto-wired → TrainMonitorTool status run="${r.run}".`; }
        const out = isEval ? `eval_results.json (read it via status)` : `metrics: ${r.metrics}`;
        let readiness = '';
        if (args.wait_for_ready) {
          const result = await launcher.waitUntilReady(r.run, { timeoutMs: args.timeout_ms });
          if ('error' in result) return `Error: ${result.error}`;
          readiness = result.ready
            ? `\nReady: ${result.reason}.`
            : `\nNot ready: ${result.reason}\n${launcher.format(result.status)}`;
        }
        return `Launched "${r.run}" (${r.script}, pid ${r.pid})${r.smoke ? ' [smoke / dep-free]' : ''}.\n  ${r.cmd}\n  log: ${r.log}\n  ${out}${wired}${readiness}\nPoll progress: TrainLaunchTool status run="${r.run}".`;
      }
      case 'status': {
        if (!args.run) return 'Error: run is required for "status".';
        const s = launcher.status(args.run);
        return 'error' in s ? `Error: ${s.error}` : launcher.format(s);
      }
      case 'stop': {
        if (!args.run) return 'Error: run is required for "stop".';
        const r = launcher.stop(args.run);
        return typeof r === 'string' ? r : `Error: ${r.error}`;
      }
      case 'list': {
        const all = launcher.list();
        return all.length ? `Launched runs (${all.length}):\n${all.map(s => `• ${s.run} (pid ${s.pid})${s.smoke ? ' [smoke]' : ''} ← ${s.dir}`).join('\n')}` : 'No runs launched yet. Start one with action "launch".';
      }
      default:
        return 'Error: unknown action. Valid: launch, status, stop, list.';
    }
  },
}, governor);

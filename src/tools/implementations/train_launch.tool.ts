import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { getTrainLauncher } from '../../training/train.launcher';
import { getTrainMonitor } from '../../training/train.monitor';

interface TrainLaunchArgs {
  action: 'launch' | 'status' | 'stop' | 'list';
  run?: string;
  dir?: string;
  smoke?: boolean;
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
- **launch**: Start a run. Pass run (a name, usually the Blueprint slug) and dir (the build dir, e.g. .bimax/builds/<slug>). Set smoke=true for a dependency-free offline dry run that proves the launch → metrics → monitoring pipeline without torch/data/GPU; omit it for real training (needs requirements.txt installed + a dataset). Auto-registers the run with TrainMonitorTool.
- **status**: Process + progress for a run. Pass run. Shows pid, running/stopped, how many metric steps have been written, and the tail of train.log.
- **stop**: Terminate a running launch (SIGTERM). Pass run.
- **list**: List launched runs.

# When to use
After BlueprintTool build emits an LLM scaffold: launch smoke=true first to confirm the pipeline writes metrics, then launch (no smoke) for the real run. Poll status here and TrainMonitorTool status for loss/grad/throughput. Set BIMAX_PYTHON to pick a specific interpreter.`,
  isDestructive: true,
  isConcurrencySafe: false,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['launch', 'status', 'stop', 'list'] },
      run: { type: 'string', description: 'Run name / Blueprint slug (required for launch/status/stop).' },
      dir: { type: 'string', description: 'Build dir containing train.py, e.g. .bimax/builds/<slug> (required for launch).' },
      smoke: { type: 'boolean', description: 'Dependency-free offline dry run that still writes metrics.jsonl (optional; default false = real training).' },
    },
    required: ['action'],
  },
  execute: async (args: TrainLaunchArgs) => {
    const launcher = getTrainLauncher();
    if (!launcher) return 'Error: TrainLauncher not initialized in this context.';
    switch (args.action) {
      case 'launch': {
        if (!args.run || !args.dir) return 'Error: run and dir are required for "launch".';
        const r = launcher.launch(args.run, args.dir, { smoke: args.smoke });
        if ('error' in r) return `Error: ${r.error}`;
        // Auto-wire monitoring so Verify is live the moment train.py writes its first step.
        const mon = getTrainMonitor();
        let wired = '';
        if (mon) { mon.watch(r.run, r.metrics); wired = `\nMonitoring auto-wired → TrainMonitorTool status run="${r.run}".`; }
        return `Launched "${r.run}" (pid ${r.pid})${r.smoke ? ' [smoke / dep-free]' : ''}.\n  ${r.cmd}\n  log: ${r.log}\n  metrics: ${r.metrics}${wired}\nPoll progress: TrainLaunchTool status run="${r.run}".`;
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

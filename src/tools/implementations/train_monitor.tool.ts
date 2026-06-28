import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { getTrainMonitor } from '../../training/train.monitor';

interface TrainMonitorArgs {
  action: 'watch' | 'status' | 'list' | 'stop';
  run?: string;
  source?: string;
  last_n?: number;
}

/**
 * TrainMonitorTool — real monitoring for an LLM-training Blueprint's Verify stage. Registers a run's
 * metrics source (a JSONL file the training loop appends to, or a W&B run) and reads it back with
 * trend analysis + anomaly alerts (loss divergence/plateau, grad explosion, throughput drops).
 */
export const createTrainMonitorTool = (governor: IGovernor) => buildTool({
  name: 'TrainMonitorTool',
  description: `Monitor a live (or finished) LLM training run: loss, grad-norm, throughput, LR — with trend analysis and anomaly alerts. This is the LLM-domain Verify stage; wire it whenever you launch or scaffold a training run.

# Actions
- **watch**: Register a run. Pass run (a name) and source. Source is either a JSONL metrics file path (the training loop appends one JSON object per step: {step, loss, grad_norm, tokens_per_sec, lr}) or "wandb:entity/project/run_id" (polled via the W&B API; needs WANDB_API_KEY).
- **status**: Read a run's metrics. Pass run, optional last_n (window size, default 50). Returns the latest point, loss trend, avg throughput, and alerts (divergence, plateau, exploding grads, throughput drop).
- **list**: List watched runs.
- **stop**: Unregister a run. Pass run.

# When to use
When a training-domain Blueprint is built, register its metrics source with "watch", then poll "status" to verify the run is healthy. Surface any alerts to the user.`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['watch', 'status', 'list', 'stop'] },
      run: { type: 'string', description: 'Run name (required for watch/status/stop).' },
      source: { type: 'string', description: 'JSONL metrics file path, or "wandb:entity/project/run_id" (required for watch).' },
      last_n: { type: 'number', description: 'Window size for trend analysis (optional, default 50).' },
    },
    required: ['action'],
  },
  execute: async (args: TrainMonitorArgs) => {
    const mon = getTrainMonitor();
    if (!mon) return 'Error: TrainMonitor not initialized in this context.';
    switch (args.action) {
      case 'watch': {
        if (!args.run || !args.source) return 'Error: run and source are required for "watch".';
        mon.watch(args.run, args.source);
        return `Monitoring "${args.run}" ← ${args.source}. Poll with action "status" to check loss/grad/throughput and get alerts.`;
      }
      case 'status': {
        if (!args.run) return 'Error: run is required for "status".';
        const s = await mon.status(args.run, args.last_n);
        return 'error' in s ? `Error: ${s.error}` : mon.format(s);
      }
      case 'list': {
        const all = mon.list();
        return all.length ? `Watched runs (${all.length}):\n${all.map(s => `• ${s.run} ← ${s.source}`).join('\n')}` : 'No runs being monitored. Start one with action "watch".';
      }
      case 'stop': {
        if (!args.run) return 'Error: run is required for "stop".';
        return mon.stop(args.run) ? `Stopped monitoring "${args.run}".` : `Error: no monitor "${args.run}".`;
      }
      default:
        return 'Error: unknown action. Valid: watch, status, list, stop.';
    }
  },
}, governor);

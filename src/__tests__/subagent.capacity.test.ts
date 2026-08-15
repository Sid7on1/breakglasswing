import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MAX_CONCURRENT_SUBAGENTS,
  runtimeConcurrentSubagentLimit,
  SubAgentCapacityCoordinator,
  SubAgentCapacityError,
} from '../core/subagent.capacity';

describe('SubAgentCapacityCoordinator', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-capacity-'));
    file = path.join(dir, 'capacity.json');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('enforces one four-agent limit across independent coordinator instances', () => {
    const leases = Array.from({ length: MAX_CONCURRENT_SUBAGENTS }, (_, index) =>
      new SubAgentCapacityCoordinator(file).acquire({ taskId: `task-${index}`, runId: 'root' })
    );
    expect(() => new SubAgentCapacityCoordinator(file).acquire({ taskId: 'fifth', runId: 'nested' }))
      .toThrow(SubAgentCapacityError);

    new SubAgentCapacityCoordinator(file).release(leases[0].id);
    expect(new SubAgentCapacityCoordinator(file).acquire({ taskId: 'replacement', runId: 'nested' }).taskId)
      .toBe('replacement');
  });

  it('release is idempotent and heartbeat renews a lease', () => {
    const coordinator = new SubAgentCapacityCoordinator(file, 4, 1000);
    const lease = coordinator.acquire({ taskId: 'task', runId: 'run' });
    expect(coordinator.heartbeat(lease.id)).toBe(true);
    expect(coordinator.active()).toHaveLength(1);
    coordinator.release(lease.id);
    coordinator.release(lease.id);
    expect(coordinator.active()).toHaveLength(0);
  });

  it('prunes an expired lease even while its shared process pid is alive', () => {
    const coordinator = new SubAgentCapacityCoordinator(file, 1, 10);
    coordinator.acquire({ taskId: 'stale-worker-thread', runId: 'run' });
    const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
    ledger.leases[0].expiresAt = Date.now() - 1;
    fs.writeFileSync(file, JSON.stringify(ledger));

    expect(coordinator.acquire({ taskId: 'new', runId: 'run' }).taskId).toBe('new');
  });

  it('fails closed on a corrupt ledger', () => {
    fs.writeFileSync(file, '{broken');
    expect(() => new SubAgentCapacityCoordinator(file).acquire({ taskId: 'unsafe', runId: 'run' }))
      .toThrow(/corrupt.*denied safely/i);
  });

  it('lets Desktop constrain concurrency without ever widening the hard cap', () => {
    expect(runtimeConcurrentSubagentLimit({ BIMAX_MAX_CONCURRENT_SUBAGENTS: '1' } as NodeJS.ProcessEnv)).toBe(1);
    expect(runtimeConcurrentSubagentLimit({ BIMAX_MAX_CONCURRENT_SUBAGENTS: '3' } as NodeJS.ProcessEnv)).toBe(3);
    expect(runtimeConcurrentSubagentLimit({ BIMAX_MAX_CONCURRENT_SUBAGENTS: '99' } as NodeJS.ProcessEnv))
      .toBe(MAX_CONCURRENT_SUBAGENTS);
    expect(runtimeConcurrentSubagentLimit({ BIMAX_MAX_CONCURRENT_SUBAGENTS: 'invalid' } as NodeJS.ProcessEnv))
      .toBe(MAX_CONCURRENT_SUBAGENTS);
    expect(runtimeConcurrentSubagentLimit({ BIMAX_MAX_CONCURRENT_SUBAGENTS: '0' } as NodeJS.ProcessEnv)).toBe(1);
  });
});

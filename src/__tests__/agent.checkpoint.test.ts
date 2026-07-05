import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  saveCheckpoint, loadCrashedAgents, resumeConfigFor, clearCheckpoint, CheckpointedAgent,
} from '../core/agent.checkpoint';

function agent(status: 'running' | 'done' | 'failed', prompt = 'refactor the auth flow'): CheckpointedAgent {
  return {
    claim: {
      taskId: `subagent-${status}-1`, agentType: 'BiMax', scope: 'src/auth', prompt: prompt.slice(0, 120),
      status, startedAt: Date.now() - 5000, toolCalls: 7,
    },
    config: { agentType: 'BiMax', prompt, cwd: '/tmp/proj', parentMode: 'default', scope: 'src/auth' },
  };
}

describe('agent-tree checkpointing', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-ckpt-'));
    file = path.join(dir, 'agent-tree.json');
    process.env.BIMAX_AGENT_TREE_PATH = file;
  });

  afterEach(() => {
    delete process.env.BIMAX_AGENT_TREE_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('persists the tree and clears the file when everything settled', () => {
    saveCheckpoint([agent('running')]);
    expect(fs.existsSync(file)).toBe(true);
    const snap = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(snap.pid).toBe(process.pid);
    expect(snap.agents).toHaveLength(1);

    saveCheckpoint([]); // empty tree ⇒ file removed, no stale "crash" evidence
    expect(fs.existsSync(file)).toBe(false);
  });

  it('ignores a checkpoint owned by a live process (including our own)', () => {
    saveCheckpoint([agent('running')]);
    // The file's pid is OUR pid — a live session's swarm, not a crash.
    expect(loadCrashedAgents()).toHaveLength(0);
  });

  it('recovers only still-running agents from a dead pid', () => {
    saveCheckpoint([agent('running'), agent('done'), agent('failed')]);
    // Rewrite the pid to one that cannot be alive (kill(pid,0) throws for it).
    const snap = JSON.parse(fs.readFileSync(file, 'utf-8'));
    snap.pid = 999999999;
    fs.writeFileSync(file, JSON.stringify(snap));

    const crashed = loadCrashedAgents();
    expect(crashed).toHaveLength(1);
    expect(crashed[0].claim.status).toBe('running');
  });

  it('resumeConfigFor prefixes the prompt with crash context and progress', () => {
    const cfg = resumeConfigFor(agent('running'));
    expect(cfg.prompt).toContain('[RESUMED AFTER CRASH]');
    expect(cfg.prompt).toContain('7 tool call(s)');
    expect(cfg.prompt).toContain('refactor the auth flow');
    expect(cfg.agentType).toBe('BiMax');
    expect(cfg.scope).toBe('src/auth');
  });

  it('clearCheckpoint removes the file', () => {
    saveCheckpoint([agent('running')]);
    clearCheckpoint();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('tolerates a corrupt checkpoint file', () => {
    fs.writeFileSync(file, '{not json');
    expect(loadCrashedAgents()).toEqual([]);
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { EpisodeWriter, RecordingProvider } from '../mind/episode.recorder';
import { harvestHistoryTasks, replayHistoryTask } from '../mind/history.replay';
import { LLMProvider, Message, ChatOptions, ChatEvent } from '../core/llm.provider';

function scripted(streams: ChatEvent[][]): LLMProvider {
  let call = 0;
  return {
    async *chat(): AsyncGenerator<ChatEvent> {
      for (const ev of streams[call++] || [{ type: 'done' } as ChatEvent]) yield ev;
    },
  };
}

async function drain(gen: AsyncGenerator<ChatEvent>): Promise<void> {
  for await (const _ of gen) { /* consume */ }
}

/** Git repo + one recorded episode: user task → evidence run (jest) → final answer. */
async function fixtureWithEpisode(): Promise<{ root: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-hist-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'calc.ts'), 'export const one = 1;\n');
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '-q']);
  git(['config', 'user.email', 'dream@bimax.test']);
  git(['config', 'user.name', 'bimax-dream']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'fixture']);

  const writer = new EpisodeWriter(root);
  const rec = new RecordingProvider(scripted([
    [
      { type: 'tool_call', id: 'b1', name: 'BashTool', args: '{"command":"npx jest src/calc.test.ts --coverage=false"}' },
      { type: 'done' },
    ],
    [{ type: 'token', text: 'Done — tests pass.' }, { type: 'done' }],
  ]), writer);
  const opts: ChatOptions = { system: 'you are bimax' };
  const msgs1: Message[] = [{ role: 'user', content: 'add negative-number support to calc' }];
  await drain(rec.chat(msgs1, opts));
  await drain(rec.chat([
    ...msgs1,
    { role: 'assistant', tool_calls: [{ id: 'b1', type: 'function', function: { name: 'BashTool', arguments: '{"command":"npx jest src/calc.test.ts --coverage=false"}' } }] },
    { role: 'tool', tool_call_id: 'b1', content: 'PASS src/calc.test.ts' },
  ], opts));
  return { root };
}

describe('History replay (dream v2 generator #4 — real tasks, objective re-verification)', () => {
  const cleanups: string[] = [];
  afterAll(() => { for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true }); });

  it('harvests only episodes with a commit, a user task, and an evidence command', async () => {
    const { root } = await fixtureWithEpisode();
    cleanups.push(root);
    const tasks = harvestHistoryTasks(root);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].userTask).toBe('add negative-number support to calc');
    expect(tasks[0].evidenceCommand).toContain('jest src/calc.test.ts');
    expect(tasks[0].commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('re-attempts the task in a worktree at the recorded commit and grades with the recorded evidence', async () => {
    const { root } = await fixtureWithEpisode();
    cleanups.push(root);

    let promptSeen = '';
    let evidenceCwd = '';
    const report = await replayHistoryTask(root, {
      seed: 5,
      attemptFix: async (worktree, prompt) => {
        promptSeen = prompt;
        fs.writeFileSync(path.join(worktree, 'src', 'calc.ts'), 'export const one = 1;\nexport const neg = -1;\n');
      },
      runEvidence: (worktree) => {
        evidenceCwd = worktree;
        const ok = fs.readFileSync(path.join(worktree, 'src', 'calc.ts'), 'utf-8').includes('neg');
        return { ok, output: ok ? 'PASS' : 'FAIL' };
      },
    });

    expect(report.attempted).toBe(true);
    expect(report.fixed).toBe(true);
    expect(promptSeen).toContain('add negative-number support');
    expect(promptSeen).toContain('npx jest src/calc.test.ts');
    expect(evidenceCwd).toContain('.evolution_worktrees');
    // Never merged: the practice branch must be gone afterwards.
    const branches = execFileSync('git', ['branch', '--list', 'dream/hist-*'], { cwd: root, encoding: 'utf-8' });
    expect(branches.trim()).toBe('');
  });

  it('a failed re-attempt grades ✗ honestly', async () => {
    const { root } = await fixtureWithEpisode();
    cleanups.push(root);
    const report = await replayHistoryTask(root, {
      seed: 5,
      attemptFix: async () => { /* agent flails */ },
      runEvidence: () => ({ ok: false, output: 'FAIL' }),
    });
    expect(report.attempted).toBe(true);
    expect(report.fixed).toBe(false);
  });

  it('reports honestly when nothing is harvestable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-hist-empty-'));
    cleanups.push(root);
    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'pipe' });
    const report = await replayHistoryTask(root, { seed: 1 });
    expect(report.attempted).toBe(false);
    expect(report.note).toContain('no harvestable episode');
  });
});

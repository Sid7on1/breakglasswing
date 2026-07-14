import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createEditFileTool, closestRegion } from '../tools/implementations/edit.tool';
import { createMultiEditTool } from '../tools/implementations/multiedit.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

// MiniMax (and similar) struggle to reproduce deeply-indented multi-line blocks verbatim — the #1
// cause of the failed-edit loop. MultiEdit used to be exact-match-only, so one wrong space aborted
// the whole batch. It now shares EditFileTool's fuzzy chain, and a true miss reports the closest
// region so the model can self-correct instead of re-sending the same near-miss.
describe('edit fuzzy recovery + actionable miss hint', () => {
  let dir: string;
  beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bimax-fuzzy-')); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  const indented = [
    'class Rule {',
    '  evaluate() {',
    '                                verdicts.push({',
    '                                  kind: "JWT",',
    '                                  evidence: count,',
    '                                });',
    '  }',
    '}',
    '',
  ].join('\n');

  it('MultiEdit recovers an edit whose indentation drifted (was exact-only → aborted the batch)', async () => {
    const file = path.join(dir, 'rule.ts');
    await fs.writeFile(file, indented, 'utf8');
    // Model emits the block with collapsed indentation — must still match via IndentationFlexible.
    const res = await createMultiEditTool(governor).execute(
      {
        edits: [{
          path: file,
          oldString: 'verdicts.push({\n  kind: "JWT",\n  evidence: count,\n});',
          newString: 'verdicts.push({\n  kind: "JWT",\n  evidence: count,\n  severity: severityFromEvidenceCount(count),\n});',
        }],
      } as any,
      { cwd: dir },
    );
    expect(String(res)).not.toMatch(/not found/i);
    expect(await fs.readFile(file, 'utf8')).toContain('severityFromEvidenceCount(count)');
  });

  it('a genuine miss returns the closest region (line-numbered) instead of a bare "not found"', async () => {
    const file = path.join(dir, 'rule.ts');
    await fs.writeFile(file, indented, 'utf8');
    // Near-miss the fuzzy chain genuinely can't resolve (different first + last lines, so BlockAnchor
    // and ContextAware both fail), yet a middle line ("evidence: count,") matches the file exactly —
    // so the hint should still surface the real region.
    const res = String(await createEditFileTool(governor).execute(
      {
        path: file,
        oldString: 'verdicts.append({\n  evidence: count,\n  weight: 9,\n})',
        newString: 'x',
      } as any,
      { cwd: dir },
    ));
    expect(res).toMatch(/not found/i);
    expect(res).toMatch(/closest region/i);
    expect(res).toMatch(/verdicts\.push/); // shows the real nearby text with a line number
  });

  it('shows a multiline near-miss when the requested oldString was flattened to one line', async () => {
    const file = path.join(dir, 'ledger.mjs');
    const content = [
      'export function buildBalances(transactions) {',
      '  const balances = new Map();',
      '',
      '  for (const transaction of transactions) {',
      '    balances.set(transaction.account, transaction.cents);',
      '  }',
      '',
      '  return balances;',
      '}',
      '',
    ].join('\n');
    await fs.writeFile(file, content, 'utf8');

    const res = String(await createEditFileTool(governor).execute(
      {
        path: file,
        oldString: content.replace(/\s+/g, ' ').trim(),
        newString: 'replacement',
      } as any,
      { cwd: dir },
    ));

    expect(res).toMatch(/not found/i);
    expect(res).toMatch(/closest region/i);
    expect(res).toContain('export function buildBalances(transactions) {');
    expect(res).toMatch(/Copy oldString VERBATIM/);
  });

  it('explains the approximate region when Edit Shield rejects a fuzzy block match', async () => {
    const file = path.join(dir, 'ledger.mjs');
    const content = [
      'export function buildBalances(transactions) {',
      '  const balances = new Map();',
      '',
      '  for (const transaction of transactions) {',
      '    balances.set(',
      '      transaction.account,',
      '      (balances.get(transaction.account) ?? 0) + transaction.cents,',
      '    );',
      '  }',
      '',
      '  return balances;',
      '}',
      '',
    ].join('\n');
    const oldString = content.split('\n').filter(line => line !== '').join('\n').trimEnd();
    const newString = [
      'export function buildBalances(transactions) {',
      '  const balances = new Map();',
      '  const seen = new Set();',
      '  for (const transaction of transactions) {',
      '    if (seen.has(transaction.id)) continue;',
      '    seen.add(transaction.id);',
      '    balances.set(transaction.account, transaction.cents);',
      '  }',
      '  return balances;',
      '}',
    ].join('\n');
    await fs.writeFile(file, content, 'utf8');

    const res = String(await createEditFileTool(governor).execute(
      { path: file, oldString, newString } as any,
      { cwd: dir },
    ));

    expect(res).toContain('Edit Shield');
    expect(res).toContain('oldString was not an exact match');
    expect(res).toContain('via BlockAnchor');
    expect(res).toContain('wrong or incomplete region');
    expect(res).toContain('do not switch write mechanisms');
    expect(await fs.readFile(file, 'utf8')).toBe(content);
  });

  it('closestRegion returns null when nothing in the file resembles oldString', () => {
    expect(closestRegion('const a = 1;\nconst b = 2;\n', 'completely unrelated zzzzz qqqqq')).toBeNull();
  });
});

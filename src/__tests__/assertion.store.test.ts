import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UserModel } from '../mind/user.model';

describe('preference assertions (v2 §3.5.2) — Beta lifecycle, consequence, contradiction', () => {
  let dir: string;
  let um: UserModel;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-assert-'));
    um = new UserModel(dir);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('a correction becomes a CANDIDATE at 0.5; chit-chat never does', () => {
    um.observeUserMessage("don't use multiple shells, my mac heats up");
    um.observeUserMessage('hi how are you');
    const all = um.assertions();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('candidate');
    expect(all[0].polarity).toBe('dont');
    expect(all[0].confidence).toBeCloseTo(0.5, 1);
    expect(um.getPromptBlock()).toContain('multiple shells'); // candidates stay ACTIVE — that's how they earn consequence evidence
  });

  it('restating strengthens: count, alpha, and the (said N×) rendering', () => {
    um.observeUserMessage('always run the build after edits');
    um.observeUserMessage('always run the build after edits');
    const a = um.assertions()[0];
    expect(a.count).toBe(2);
    expect(a.alpha).toBe(2);
    expect(um.getPromptBlock()).toContain('(said 2×)');
  });

  it('confirmed by CONSEQUENCE: active turns without correction accumulate weak positives until promotion', () => {
    um.observeUserMessage("don't add code comments unless asked");
    for (let i = 0; i < 12; i++) {
      um.getPromptBlock();                                  // assertion is active in the prompt…
      um.observeUserMessage(`please refactor module ${i}`); // …and the user does not correct it
    }
    const a = um.assertions()[0];
    expect(a.alpha).toBeGreaterThan(2);
    expect(a.status).toBe('confirmed');
    expect(um.getPromptBlock()).toContain('confirmed');
  });

  it('consequence evidence only applies to assertions that were actually injected', () => {
    um.observeUserMessage('always run the build after edits');
    // No getPromptBlock() call — the assertion was never active in any prompt.
    um.observeUserMessage('please refactor the parser');
    expect(um.assertions()[0].alpha).toBe(1);
  });

  it('an opposite-polarity lookalike CONTRADICTS an evidenced assertion: strong negative, pair surfaced to resolve', () => {
    um.observeUserMessage('always add tests for every change');
    um.observeUserMessage('always add tests for every change'); // evidenced — worth surfacing, not silently dropping
    um.getPromptBlock();
    um.observeUserMessage('stop adding tests for every change');
    const all = um.assertions();
    const oldOne = all.find(a => a.polarity === 'do')!;
    const newOne = all.find(a => a.polarity === 'dont')!;
    expect(oldOne.status).toBe('contradicted');
    expect(oldOne.beta).toBeGreaterThan(1);
    expect(newOne.status).toBe('candidate');
    const block = um.getPromptBlock();
    expect(block).toContain('Conflicting guidance');
    expect(block).toContain('stop adding tests'); // the newer side still steers
  });

  it('contradicting a ONCE-stated candidate retires it silently — the user just changed their mind', () => {
    um.observeUserMessage('always add tests for every change');
    um.observeUserMessage('stop adding tests for every change');
    expect(um.assertions().find(a => a.polarity === 'do')!.status).toBe('retired');
    expect(um.getPromptBlock()).not.toContain('Conflicting guidance');
  });

  it('restating one side RESOLVES the contradiction: winner confirmed, loser retired', () => {
    um.observeUserMessage('always add tests for every change');
    um.observeUserMessage('stop adding tests for every change');
    um.observeUserMessage('stop adding tests for every change'); // the user doubles down
    const all = um.assertions();
    expect(all.find(a => a.polarity === 'dont')!.status).toBe('confirmed');
    expect(all.find(a => a.polarity === 'do')!.status).toBe('retired');
    expect(um.getPromptBlock()).not.toContain('Conflicting guidance');
  });

  it('learnAssertion is the critic-pass entry point and dedupes against the regex path', () => {
    um.observeUserMessage('always run the build after edits');
    um.learnAssertion('always run the build after edits', 'do', 'critic');
    const all = um.assertions();
    expect(all).toHaveLength(1); // restatement, not a duplicate
    expect(all[0].count).toBe(2);
  });

  it('v2 files migrate: prefs import as candidates with repeats as positive evidence', () => {
    fs.mkdirSync(path.join(dir, '.bimax'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.bimax', 'user-model.json'), JSON.stringify({
      version: 2, features: {}, decisions: { accepts: 0, rejects: 0 }, history: [],
      prefs: [{ text: "don't use multiple shells", count: 3, lastSeen: new Date().toISOString() }],
    }), 'utf-8');
    const fresh = new UserModel(dir);
    const a = fresh.assertions()[0];
    expect(a.text).toContain('multiple shells');
    expect(a.polarity).toBe('dont');
    expect(a.alpha).toBe(3); // 1 + (count-1)
    expect(fresh.getPromptBlock()).toContain('(said 3×)');
  });

  it('decay: an un-evidenced candidate drifts toward the prior; a 3×-stated one is durable', () => {
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    fs.mkdirSync(path.join(dir, '.bimax'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.bimax', 'user-model.json'), JSON.stringify({
      version: 3, features: {}, decisions: { accepts: 0, rejects: 0 }, history: [],
      assertions: [
        { text: 'never force-push to main branches', polarity: 'dont', alpha: 6, beta: 1, count: 1, lastSeen: old, embedding: [], status: 'confirmed', source: 'regex' },
        { text: 'always build the tui after go edits', polarity: 'do', alpha: 6, beta: 1, count: 3, lastSeen: old, embedding: [], status: 'confirmed', source: 'regex' },
      ],
    }), 'utf-8');
    const fresh = new UserModel(dir);
    const byText = Object.fromEntries(fresh.assertions().map(a => [a.text, a.confidence]));
    expect(byText['never force-push to main branches']).toBeLessThan(0.6);       // decayed toward 0.5
    expect(byText['always build the tui after go edits']).toBeCloseTo(6 / 7, 2); // durable, undecayed
  });
});

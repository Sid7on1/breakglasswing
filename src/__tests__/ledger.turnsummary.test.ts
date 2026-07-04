import { ledgerTurnSummary } from '../protocol/headless.session';

// Confidence-in-margin (turn-end form): the ledger delta across a turn decides what, if anything, to
// say about verification. Verified work is confirmed; unchecked edits are nudged; a turn that changed
// nothing the ledger tracks stays silent.
describe('ledgerTurnSummary', () => {
  it('is silent with no baseline snapshot', () => {
    expect(ledgerTurnSummary(null, { resolved: 3, open: 1 })).toBeNull();
  });

  it('is silent when nothing changed', () => {
    expect(ledgerTurnSummary({ resolved: 2, open: 1 }, { resolved: 2, open: 1 })).toBeNull();
  });

  it('nudges when edits opened claims but nothing verified them', () => {
    const r = ledgerTurnSummary({ resolved: 0, open: 0 }, { resolved: 0, open: 2 });
    expect(r?.level).toBe('info');
    expect(r?.text).toContain('2 changes unverified');
  });

  it('confirms when a build/test run resolved claims this turn', () => {
    const r = ledgerTurnSummary({ resolved: 1, open: 3 }, { resolved: 4, open: 0 });
    expect(r?.level).toBe('success');
    expect(r?.text).toContain('verified 3 changes');
  });

  it('prefers the verified message over the unverified nudge', () => {
    // Some claims resolved AND some new ones opened in the same turn → celebrate the verification.
    const r = ledgerTurnSummary({ resolved: 0, open: 0 }, { resolved: 1, open: 2 });
    expect(r?.level).toBe('success');
  });

  it('uses singular wording for a single change', () => {
    expect(ledgerTurnSummary({ resolved: 0, open: 0 }, { resolved: 0, open: 1 })?.text).toContain('1 change unverified');
  });
});

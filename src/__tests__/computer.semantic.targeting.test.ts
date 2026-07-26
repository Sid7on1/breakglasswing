import { rankSemanticTargets } from '../computer/semantic.targeting';

const button = (elementIndex: number, label: string, x: number, extra: Record<string, unknown> = {}) => ({
  elementIndex, label, role: 'AXButton', frame: { x, y: 10, w: 30, h: 30 }, ...extra,
});

describe('universal semantic target ranking', () => {
  it('combines safe affordance synonyms with a role hint', () => {
    const ranked = rankSemanticTargets('submit button', [
      button(1, 'Cancel', 10),
      button(2, 'Send', 50),
    ]);
    expect(ranked.confidence).toBe('high');
    expect(ranked.ranked[0].element.elementIndex).toBe(2);
    expect(ranked.ranked[0].reasons).toEqual(expect.arrayContaining(['role matched']));
  });

  it('handles a small label typo without turning weak resemblance into confidence', () => {
    const ranked = rankSemanticTargets('notifcations', [
      button(1, 'Notifications', 10),
      button(2, 'Network', 50),
    ]);
    expect(ranked.confidence).toMatch(/high|medium/);
    expect(ranked.ranked[0].element.elementIndex).toBe(1);
  });

  it('resolves an explicit ordinal geometrically across otherwise unlabeled controls', () => {
    const ranked = rankSemanticTargets('second button from left', [
      button(10, '', 300), button(11, '', 100), button(12, '', 200),
    ]);
    expect(ranked.confidence).toBe('medium');
    expect(ranked.ranked[0].element.elementIndex).toBe(12);
  });

  it('keeps duplicate real controls ambiguous', () => {
    const ranked = rankSemanticTargets('Chats', [button(1, 'Chats', 10), button(2, 'Chats', 50)]);
    expect(ranked.ambiguous).toBe(true);
    expect(ranked.confidence).toBe('low');
  });

  it('never ranks a disabled exact match above an enabled alternative', () => {
    const ranked = rankSemanticTargets('Continue button', [
      button(1, 'Continue', 10, { enabled: false }),
      button(2, 'Next', 50),
    ]);
    expect(ranked.ranked[0].element.elementIndex).toBe(2);
  });

  it('does not invent a target from a role-only vague query', () => {
    const ranked = rankSemanticTargets('click the button', [button(1, 'Delete account', 10)]);
    expect(ranked.confidence).toBe('none');
    expect(ranked.ranked).toHaveLength(0);
  });
});

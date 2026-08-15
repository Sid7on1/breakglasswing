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

  it('does not read an ordinal word out of a control\'s own name', () => {
    // Live failure: macOS names the document body "First Text View", so the query was parsed as
    // "the 1st match", the real text area took the non-ordinal penalty, and the +35 position bonus
    // went to whatever sorted first in space — a click meant for the document landed on the font
    // control. Same family as the bare-number case ("Mom 2"), one step further up.
    const textArea = {
      elementIndex: 1, label: 'First Text View', role: 'AXTextArea',
      frame: { x: 0, y: 200, w: 1172, h: 764 },
    };
    const fontSize = {
      elementIndex: 26, label: 'font size', role: 'AXComboBox',
      frame: { x: 300, y: 100, w: 60, h: 20 },
    };
    const ranked = rankSemanticTargets('First Text View', [fontSize, textArea]);
    expect(ranked.ranked[0].element.elementIndex).toBe(1);
    expect(ranked.ranked[0].reasons).not.toContain('position matched');
    expect(ranked.confidence).toMatch(/high|medium/);
  });

  it('does not let a one-character label match a long query by containment', () => {
    // A degraded frame exposes single glyphs as VisualText. Every one of "I", "S" and "V" is a
    // substring of "first text view", so symmetric containment scored them all 84 and the real
    // target tied with window furniture at margin 0 — the resolver then refused its own frame.
    const glyph = (elementIndex: number, label: string, x: number) => ({
      elementIndex, label, role: 'AXStaticText', frame: { x, y: 10, w: 8, h: 12 },
    });
    const ranked = rankSemanticTargets('First Text View', [glyph(1, 'I', 10), glyph(2, 'S', 20), glyph(3, 'V', 30)]);
    expect(ranked.ranked).toHaveLength(0);
    expect(ranked.confidence).toBe('none');
  });

  it('still credits a label that CONTAINS the whole query', () => {
    // The asymmetry must not cost the legitimate direction: naming the specific thing while the
    // element's label says more is exactly how real controls are addressed.
    const ranked = rankSemanticTargets('Send', [button(1, 'Send Message', 10), button(2, 'Cancel', 50)]);
    expect(ranked.ranked[0].element.elementIndex).toBe(1);
    expect(ranked.confidence).toMatch(/high|medium/);
  });

  it('refuses a target that matched no part of a naming query', () => {
    // Winning on role or position bonuses alone is not an identification. Acting on it is how a
    // confident click reaches a control the caller never asked for.
    const ranked = rankSemanticTargets('Preferences', [button(1, '', 10), button(2, '', 50)]);
    expect(ranked.confidence).toMatch(/low|none/);
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

/**
 * Both defects below were measured live against Messages, where clicking a named recipient landed on
 * the window's title button instead of the conversation row. The row's label was the query character
 * for character and still lost, 96 to 100.
 */
describe('a better text match is never overturned by role or by a number in a name', () => {
  const row = {
    elementIndex: 5, role: 'AXStaticText', enabled: true, frame: { x: 19, y: 248, w: 518, h: 87 },
    label: 'Mom 2, ey mom, I ordered everything you asked for, Friday',
  };
  const titleButton = {
    elementIndex: 1, role: 'AXButton', label: 'Mom 2', enabled: true,
    frame: { x: 1020, y: 47, w: 77, h: 30 },
  };
  const windowTitle = {
    elementIndex: 0, role: 'AXWindow', label: 'Mom 2', enabled: true,
    frame: { x: 0, y: 0, w: 1568, h: 893 },
  };

  it('ranks the element whose whole label IS the query above a control matching only its prefix', () => {
    const ranked = rankSemanticTargets(row.label, [titleButton, windowTitle, row]);
    expect(ranked.ranked[0].element.elementIndex).toBe(5);
    expect(ranked.ambiguous).toBe(false);
  });

  it('still prefers the control when a heading and a control carry the same text', () => {
    // The role bonus must survive as a tie-break; only its ability to climb text tiers is removed.
    const ranked = rankSemanticTargets('Send', [
      { elementIndex: 1, role: 'AXStaticText', label: 'Send', enabled: true, frame: { x: 10, y: 10, w: 40, h: 20 } },
      { elementIndex: 2, role: 'AXButton', label: 'Send', enabled: true, frame: { x: 10, y: 60, w: 40, h: 20 } },
    ]);
    expect(ranked.ranked[0].element.elementIndex).toBe(2);
  });

  it('does not read the numeric suffix of a duplicate contact name as a position', () => {
    // "Mom 2" is how an address book disambiguates two people, not a request for the 2nd match.
    const ranked = rankSemanticTargets('Mom 2', [
      button(7, 'Unrelated', 10), titleButton, row,
    ]);
    expect(ranked.ranked.every(candidate => !candidate.reasons.includes('position matched'))).toBe(true);
    expect(ranked.ranked[0].element.elementIndex).toBe(1);
  });

  it('still honours an explicitly written ordinal', () => {
    const ranked = rankSemanticTargets('2nd button from left', [
      button(10, '', 300), button(11, '', 100), button(12, '', 200),
    ]);
    expect(ranked.ranked[0].element.elementIndex).toBe(12);
  });

  it('prefers the published element over its OCR twin carrying the same text', () => {
    // Measured on a Notes list row: vision re-read the row's text, and the resulting VisualText
    // outranked the AXCell whose label was exactly the query. The click was then refused by
    // preflight — "expected VisualText, live point resolves to AXStaticText" — so a perfectly
    // targetable row looked unclickable.
    const ranked = rankSemanticTargets('Flexon MR', [
      { elementIndex: 1, role: 'VisualText', label: 'Flexon MR', visualOnly: true, enabled: true, frame: { x: 30, y: 600, w: 270, h: 20 } },
      { elementIndex: 2, role: 'AXCell', label: 'Flexon MR', enabled: true, frame: { x: 29, y: 607, w: 278, h: 103 } },
    ]);
    expect(ranked.ranked[0].element.elementIndex).toBe(2);
  });

  it('still targets a vision-only element when the tree published nothing to compete with it', () => {
    // The penalty must not make an AX-opaque window untargetable — vision is the only candidate
    // there, and it has to stay above the confidence floor.
    const ranked = rankSemanticTargets('Continue', [
      { elementIndex: 1, role: 'VisualText', label: 'Continue', visualOnly: true, enabled: true, frame: { x: 10, y: 10, w: 80, h: 20 } },
    ]);
    expect(ranked.ranked.length).toBe(1);
    expect(ranked.confidence).not.toBe('none');
  });

  it('does not read a colour word out of a control\'s own name', () => {
    // Measured live in Finder on 2026-08-06. "red" was stripped as a description of how the icon
    // LOOKS, so all three queries collapsed to "select txt": every sibling scored 88, the exact
    // match tied with the two wrong ones at margin 0, and the resolver refused all of them. The
    // colour hint had removed the only token that distinguished the target.
    const files = ['red-select.txt', 'green-select.txt', 'blue-select.txt', 'control-unselected.txt']
      .map((label, index) => ({
        elementIndex: index, role: 'AXImage', label, enabled: true,
        frame: { x: 100 + index * 200, y: 120, w: 117, h: 117 },
      }));
    for (const wanted of ['red-select.txt', 'green-select.txt', 'blue-select.txt']) {
      const ranked = rankSemanticTargets(wanted, files);
      expect(ranked.ranked[0].element.label).toBe(wanted);
      expect(ranked.ambiguous).toBe(false);
      expect(ranked.confidence).toBe('high');
    }
  });

  it('still reads a colour as a colour when no candidate is named for one', () => {
    // The guard keys on the candidates, so a genuine appearance hint has to keep working: here
    // nothing publishes "blue" in its label, so it stays a description and refines the target.
    const ranked = rankSemanticTargets('blue Send button', [
      { elementIndex: 1, role: 'AXButton', label: 'Send', enabled: true, frame: { x: 10, y: 10, w: 60, h: 24 }, visual: { colorName: 'blue', confidence: 0.9 } },
      { elementIndex: 2, role: 'AXButton', label: 'Cancel', enabled: true, frame: { x: 80, y: 10, w: 60, h: 24 } },
    ]);
    expect(ranked.ranked[0].element.label).toBe('Send');
  });
});

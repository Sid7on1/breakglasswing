import { parseTreeNodes, textByElementIndex, foldTreeTextIntoElements } from '../tree.text';
import { rankSemanticTargets } from '../semantic.targeting';
import { accessibilityEventInvalidatesObservation } from '../desktop.runtime';

// Captured verbatim from a live Notes observation. The awkward parts are the point: AX action lists
// are emitted with embedded newlines, so one logical node spans several physical lines, and the note
// rows carry the class name `ICMNoteListCell` as their label while the words a human reads sit in
// unaddressable AXStaticText children.
const NOTES_TREE = [
  '- [0] AXWindow "Notes – 194 notes" [id=_NS:6 actions=[raise]]',
  '    - AXTable (My Notes as List)',
  '          - AXStaticText = "Today"',
  '      - [1] AXRow [actions=[name:pin',
  'target:0x0',
  'selector:(null),name:trash',
  'target:0x0',
  'selector:(null)]]',
  '        - [2] AXCell [actions=[showmenu]]',
  '          - [3] AXCell [id=ICMNoteListCell help="Perform press or select Return to open note." actions=[showmenu]]',
  '            - AXStaticText = "New Note"',
  '            - AXStaticText = "No additional text"',
  '            - AXStaticText = "5:36 PM"',
  '      - [4] AXRow [actions=[showmenu]]',
  '        - [5] AXCell [id=ICMNoteListCell actions=[showmenu]]',
  '          - AXStaticText = "Potatoes 1kg"',
  '          - AXStaticText = "Tomato 2kg"',
  '          - AXStaticText = "6/30/26"',
].join('\n');

const cell = (elementIndex: number, label?: string) => ({
  element_index: elementIndex, role: 'AXCell', ...(label === undefined ? {} : { label }),
});

describe('accessibility tree text recovery', () => {
  it('joins multi-line action lists back onto their own node', () => {
    const nodes = parseTreeNodes(NOTES_TREE);
    // The four `target:0x0` / `selector:(null)` fragments must not become nodes of their own.
    expect(nodes.map(node => node.role)).toEqual([
      'AXWindow', 'AXTable', 'AXStaticText', 'AXRow', 'AXCell', 'AXCell',
      'AXStaticText', 'AXStaticText', 'AXStaticText',
      'AXRow', 'AXCell', 'AXStaticText', 'AXStaticText', 'AXStaticText',
    ]);
    expect(nodes[0]).toMatchObject({ index: 0, label: 'Notes – 194 notes', id: '_NS:6' });
  });

  it('reads a quoted label without being confused by a quoted help attribute', () => {
    const node = parseTreeNodes(NOTES_TREE).find(candidate => candidate.index === 3)!;
    expect(node.id).toBe('ICMNoteListCell');
    expect(node.label).toBeUndefined();
  });

  it('attributes text to the nearest indexed ancestor, not to every ancestor', () => {
    const text = textByElementIndex(NOTES_TREE);
    expect(text.get(3)).toEqual(['New Note', 'No additional text', '5:36 PM']);
    expect(text.get(5)).toEqual(['Potatoes 1kg', 'Tomato 2kg', '6/30/26']);
    // Naming the enclosing row and cell too would make three elements score identically, which the
    // resolver reports as ambiguous and refuses — the same failure in a smaller number.
    expect(text.has(1)).toBe(false);
    expect(text.has(2)).toBe(false);
    expect(text.has(4)).toBe(false);
  });

  it('replaces an AX identifier label with the visible title and keeps the identifier', () => {
    const [folded] = foldTreeTextIntoElements([cell(5, 'ICMNoteListCell')], NOTES_TREE);
    expect(folded).toMatchObject({
      label: 'Potatoes 1kg',
      original_label: 'ICMNoteListCell',
      label_source: 'tree_text',
      value: 'Tomato 2kg — 6/30/26',
    });
  });

  it('never overwrites a name the application actually published', () => {
    const [folded] = foldTreeTextIntoElements([cell(5, 'Shopping list')], NOTES_TREE);
    expect(folded.label).toBe('Shopping list');
    expect(folded.label_source).toBeUndefined();
    // The inner words still ride along so the row remains findable by what it contains.
    expect(folded.value).toBe('Potatoes 1kg — Tomato 2kg — 6/30/26');
  });

  it('names an anonymous container from the text inside it', () => {
    const [folded] = foldTreeTextIntoElements([cell(3)], NOTES_TREE);
    expect(folded).toMatchObject({ label: 'New Note', label_source: 'tree_text' });
    expect(folded.original_label).toBeUndefined();
  });

  it('leaves elements alone when the tree offers nothing', () => {
    const elements = [cell(5, 'ICMNoteListCell')];
    expect(foldTreeTextIntoElements(elements, '')).toBe(elements);
  });

  it('turns an unresolvable query into a high-confidence hit', () => {
    // Before folding, every note row is the same string, so the resolver sees a tie and refuses.
    const raw = [cell(3, 'ICMNoteListCell'), cell(5, 'ICMNoteListCell')]
      .map(element => ({ label: element.label, role: element.role, elementIndex: element.element_index }));
    expect(rankSemanticTargets('Potatoes 1kg', raw).confidence).toBe('none');

    const folded = foldTreeTextIntoElements([cell(3, 'ICMNoteListCell'), cell(5, 'ICMNoteListCell')], NOTES_TREE)
      .map((element: any) => ({ label: element.label, role: element.role, elementIndex: element.element_index }));
    const ranked = rankSemanticTargets('Potatoes 1kg', folded);
    expect(ranked.confidence).toBe('high');
    expect(ranked.ranked[0].element.elementIndex).toBe(5);
  });
});

describe('accessibilityEventInvalidatesObservation', () => {
  const created = (frame: any) => ({
    notification: 'AXWindowCreated',
    element: { role: 'AXWindow', frame },
  }) as any;

  it('ignores a decorative window too small to hold a control', () => {
    // Measured in Notes: a 66x20 AXWindow (subrole AXDialog, title "Window") is created while the
    // list settles. Honouring it invalidated the just-captured frame, and every click was then
    // refused with "the element you named is no longer in the tree".
    expect(accessibilityEventInvalidatesObservation(created({ x: 16, y: 49, w: 66, h: 20 }))).toBe(false);
  });

  it('still invalidates on a real dialog', () => {
    expect(accessibilityEventInvalidatesObservation(created({ x: 100, y: 100, w: 320, h: 180 }))).toBe(true);
  });

  it('ignores an app-level notification that names no surface', () => {
    expect(accessibilityEventInvalidatesObservation(created(undefined))).toBe(false);
    expect(accessibilityEventInvalidatesObservation(created({ w: 0, h: 0 }))).toBe(false);
  });

  it('leaves every other notification invalidating', () => {
    expect(accessibilityEventInvalidatesObservation({ notification: 'AXValueChanged', element: {} } as any)).toBe(true);
  });
});

// Captured verbatim from a live WhatsApp observation on 2026-08-05. WhatsApp writes a control's name
// in PARENTHESES after the role — and after the `= "…"` value when there is one — where Notes writes
// it in quotes. Recognising only the quoted form parsed this entire tree to bare roles: every node
// lost its label AND its value, the text map came back empty, and folding was a silent no-op.
const WHATSAPP_TREE = [
  '- [0] AXWindow "‎WhatsApp" [id=SceneWindow actions=[raise]]',
  '  - [1] AXButton (‎Chats) [actions=[press,scrolltovisible,cancel,showmenu]]',
  '  - [13] AXButton [actions=[press,scrolltovisible,cancel,showmenu]]',
  '  - [16] AXStaticText = "‎message, Which sacchai baba, 4:58 PM, ‎Received from Mom 2" (Mom 2)'
    + ' [help="‎Double tap to open chat" actions=[press,scrolltovisible,cancel,showmenu,name:‎unread',
  'target:0x0',
  'selector:(null),name:‎pin',
  'target:0x0',
  'selector:(null)]]',
].join('\n');

describe('parenthesised names and published actions', () => {
  it('reads a name written in parentheses, with or without a value', () => {
    const byIndex = new Map(parseTreeNodes(WHATSAPP_TREE).map(node => [node.index, node]));
    expect(byIndex.get(1)?.label).toBe('‎Chats');
    // Both halves of `= "value" (label)` survive; neither eats the other.
    expect(byIndex.get(16)?.label).toBe('Mom 2');
    expect(byIndex.get(16)?.value).toContain('Which sacchai baba');
    // A node with no name at all still has none invented for it.
    expect(byIndex.get(13)?.label).toBeUndefined();
  });

  it('keeps reading the quoted form Notes uses', () => {
    const byIndex = new Map(parseTreeNodes(NOTES_TREE).map(node => [node.index, node]));
    expect(byIndex.get(0)?.label).toBe('Notes – 194 notes');
    expect(byIndex.get(3)?.id).toBe('ICMNoteListCell');
  });

  it('collects the actions a control publishes, and tells silence apart from none', () => {
    const byIndex = new Map(parseTreeNodes(WHATSAPP_TREE).map(node => [node.index, node]));
    expect(byIndex.get(16)?.actions).toEqual(
      expect.arrayContaining(['press', 'showmenu', '‎unread', '‎pin']),
    );
    // A custom action is identified by its title, not by the literal key "name".
    expect(byIndex.get(16)?.actions).not.toContain('name');

    const notes = new Map(parseTreeNodes(NOTES_TREE).map(node => [node.index, node]));
    // The Notes row that -25206 comes from: it publishes showmenu and nothing else.
    expect(notes.get(5)?.actions).toEqual(['showmenu']);
    expect(notes.get(5)?.actions).not.toContain('press');
    // Said nothing at all — which is not the same as saying "none".
    expect(parseTreeNodes('- [9] AXButton "Bare"')[0].actions).toBeUndefined();
  });

  it('folds the published actions onto the elements the caller acts from', () => {
    const folded = foldTreeTextIntoElements(
      [cell(5, 'ICMNoteListCell'), cell(16)],
      `${NOTES_TREE}\n${WHATSAPP_TREE}`,
    );
    expect(folded.find(element => element.element_index === 5).ax_actions).toEqual(['showmenu']);
    expect(folded.find(element => element.element_index === 16).ax_actions).toContain('press');
  });
});

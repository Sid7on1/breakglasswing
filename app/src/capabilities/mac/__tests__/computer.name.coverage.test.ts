import { describe, expect, it } from '@jest/globals';
import {
  describeUnlabeledControls,
  thinTreeNotice,
  windowPreparationNotice,
} from '../desktop.runtime';

/**
 * `original_label` is NOT "the name the app supplied" — it is "the name the app supplied BEFORE this
 * runtime rewrote it", and it therefore exists only on the elements a rewrite touched. Both notices
 * below read its absence as "this control has no name", which is exactly inverted: a control the app
 * named plainly, and which nothing needed to rewrite, carries no `original_label` at all.
 *
 * Measured live on WhatsApp 2026-08-05: 31 actionable controls, of which exactly 2 had been rewritten
 * by enrichControlLabels ("More — Chats", "More — Search"). The notice reported "29 of 31 controls
 * have no name of their own" — while the map in the same payload held Heman, Dad, Mom 2, Park+,
 * Shiprocket, Send and Compose message, every one of them addressable by name. The advice it then
 * gave ("Do not keep re-querying for a control by a name you expect — it is not in the map") is the
 * opposite of the truth and pushes the model off names and onto raw pixels.
 */
describe('nameless-control accounting', () => {
  const button = (index: number, label: string, extra: Record<string, unknown> = {}) => ({
    element_index: index, role: 'AXButton', label,
    frame: { x: 40, y: 40 + index * 40, w: 200, h: 32 }, ...extra,
  });

  /** The shape measured live: the app names nearly everything, two controls needed enrichment. */
  const whatsAppShaped = () => {
    const rows = ['Heman', 'Dad', 'Mom 2', 'Park+', 'Shiprocket', 'Instagram', 'Critical thinking A513']
      .map((name, i) => button(i + 1, name));
    const chrome = ['Chats', 'Calls', 'Updates', 'Archived', 'Starred', 'Settings', 'New Chat',
      'Send', 'Compose message', 'Emoji picker', 'Share media']
      .map((name, i) => button(i + 20, name));
    // The only two the app left nameless, which enrichControlLabels renamed from their context.
    const enriched = [
      button(90, 'More — Chats', { original_label: 'More', context_label: 'Chats' }),
      button(91, 'More — Search', { original_label: 'More', context_label: 'Search' }),
    ];
    return [...rows, ...chrome, ...enriched];
  };

  it('does not call an app-named control nameless just because nothing rewrote it', () => {
    const elements = whatsAppShaped();
    // Every one of these is addressable by the name the app itself published.
    expect(elements.every(element => String(element.label).trim())).toBe(true);
    expect(thinTreeNotice(elements)).toBeNull();
  });

  it('still reports a genuinely nameless app, and counts only the synthesized names', () => {
    // Nine blank buttons — no label, no value, nothing. This is the shape the notice exists for.
    const blanks = Array.from({ length: 9 }, (_, i) => ({
      element_index: i + 1, role: 'AXButton',
      frame: { x: 20 + i * 30, y: 20, w: 24, h: 24 },
    }));
    const window = { element_index: 0, role: 'AXWindow', label: 'Shell', frame: { x: 0, y: 0, w: 600, h: 400 } };
    const described = describeUnlabeledControls([window, ...blanks]);
    // describeUnlabeledControls invents a positional name so the controls stay distinguishable.
    expect(described.filter(element => /^unlabeled /.test(String(element.label || ''))).length).toBe(9);

    const notice = thinTreeNotice(described);
    expect(notice).toContain('9 of 9');
    expect(notice).toContain('little accessibility text');
  });

  it('counts a name folded out of the tree as a real name', () => {
    // foldTreeTextIntoElements names a row from the text rendered inside it. That is a name the user
    // can see and say, so it must not be counted as nameless.
    const folded = Array.from({ length: 8 }, (_, i) => button(i + 1, `Note ${i + 1}`, { label_source: 'tree_text' }));
    expect(thinTreeNotice(folded)).toBeNull();
  });

  it('window-preparation advice uses the same honest count', () => {
    // A small window full of app-named controls is not an unlabeled-control problem.
    const elements = whatsAppShaped();
    expect(windowPreparationNotice(elements, 500, 400)).toBeNull();
  });
});

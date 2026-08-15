import { DESKTOP_HELPER_SOURCE, DESKTOP_HELPER_VERSION } from '../helper.source';
import { compareKeyboardFocus, matchHitElement, sameNativeElement } from '../action.receipt';

describe('computer Action Receipts', () => {
  const expected = {
    role: 'AXButton', label: 'Send', originalLabel: 'Send',
    frame: { x: 100, y: 200, w: 80, h: 32 },
  };

  it('matches the intended control through a child-to-parent native hit chain', () => {
    const receipt = matchHitElement(expected, [
      { pid: 42, role: 'AXStaticText', title: 'Send', frame: { x: 115, y: 205, w: 40, h: 20 } },
      { pid: 42, role: 'AXButton', title: 'Send', frame: { x: 100, y: 200, w: 80, h: 32 }, enabled: true },
    ]);
    expect(receipt).toEqual(expect.objectContaining({ matched: true, confidence: 'high' }));
    expect(receipt.recipient?.role).toBe('AXButton');
  });

  it('refuses contradictory live semantics even at the same rectangle', () => {
    const receipt = matchHitElement(expected, [
      { pid: 42, role: 'AXButton', title: 'Delete', frame: { x: 100, y: 200, w: 80, h: 32 }, enabled: true },
    ]);
    expect(receipt.matched).toBe(false);
    expect(receipt.reason).toMatch(/label contradicted/);
  });

  it('does not mistake a private AX identifier for a contradictory visible label', () => {
    const receipt = matchHitElement(
      { role: 'AXTextField', label: 'alpha beta gamma', frame: { x: 100, y: 200, w: 180, h: 24 } },
      [{
        pid: 42, role: 'AXTextField', identifier: '_NS:123', editable: true,
        frame: { x: 100, y: 200, w: 180, h: 24 }, enabled: true,
      }],
    );
    expect(receipt).toEqual(expect.objectContaining({ matched: true, confidence: 'high' }));
    expect(receipt.reason).toMatch(/role \+ frame/);
    expect(receipt.reason).not.toMatch(/label contradicted/);
  });

  it('can identify an unlabeled control from independent role and geometry evidence', () => {
    const receipt = matchHitElement(
      { role: 'AXButton', frame: { x: 100, y: 200, w: 30, h: 30 } },
      [{ pid: 42, role: 'AXButton', frame: { x: 101, y: 200, w: 30, h: 30 }, enabled: true }],
    );
    expect(receipt.matched).toBe(true);
  });

  it('detects element replacement or motion between preflight probes', () => {
    const before = { pid: 42, role: 'AXButton', title: 'Send', frame: { x: 100, y: 200, w: 80, h: 32 } };
    const moved = { ...before, frame: { x: 240, y: 200, w: 80, h: 32 } };
    expect(sameNativeElement(before, before)).toBe(true);
    expect(sameNativeElement(before, moved)).toBe(false);
  });

  it('proves literal input through value-length or caret movement without field contents', () => {
    const before = {
      pid: 42, role: 'AXTextArea', identifier: 'composer', editable: true,
      valueLength: 4, selectedRange: { location: 4, length: 0 },
    };
    const after = { ...before, valueLength: 9, selectedRange: { location: 9, length: 0 } };
    const receipt = compareKeyboardFocus(42, before, after);
    expect(receipt).toEqual(expect.objectContaining({
      recipientMatched: true, editableBefore: true, sameElement: true, inputObserved: true,
    }));
    expect(JSON.stringify(receipt)).not.toContain('hello');
  });

  it('refuses wrong-process and noneditable keyboard ownership', () => {
    expect(compareKeyboardFocus(42, { pid: 99, role: 'AXTextField', editable: true }, undefined))
      .toEqual(expect.objectContaining({ recipientMatched: false, inputObserved: false }));
    expect(compareKeyboardFocus(42, { pid: 42, role: 'AXButton', editable: false }, { pid: 42, role: 'AXButton', editable: false }).reason)
      .toMatch(/not editable/);
  });

  it('pins the native privacy and parent-chain contracts', () => {
    expect(DESKTOP_HELPER_VERSION).toBeGreaterThanOrEqual(19);
    expect(DESKTOP_HELPER_SOURCE).toContain('func axElementChain');
    expect(DESKTOP_HELPER_SOURCE).toContain('case "focused-element":');
    expect(DESKTOP_HELPER_SOURCE).toContain('Do not emit the value itself');
    expect(DESKTOP_HELPER_SOURCE).not.toContain('object["value"] = text');
  });
});

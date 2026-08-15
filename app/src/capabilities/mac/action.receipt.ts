/** Pure scoring for the prepare → preflight → commit → receipt lifecycle. */

export interface ReceiptFrame { x: number; y: number; w: number; h: number }

export interface NativeElementReceipt {
  pid: number;
  role?: string;
  subrole?: string;
  title?: string;
  description?: string;
  identifier?: string;
  frame?: ReceiptFrame;
  enabled?: boolean;
  focused?: boolean;
  editable?: boolean;
  valueLength?: number;
  selectedRange?: { location: number; length: number };
  actions?: string[];
}

export interface ExpectedReceiptElement {
  role?: unknown;
  label?: unknown;
  originalLabel?: unknown;
  contextLabel?: unknown;
  description?: unknown;
  frame?: unknown;
}

export interface ElementMatchReceipt {
  matched: boolean;
  confidence: 'high' | 'medium' | 'none';
  score: number;
  reason: string;
  recipient?: NativeElementReceipt;
}

export interface KeyboardReceipt {
  targetPid: number;
  recipientMatched: boolean;
  editableBefore: boolean | null;
  sameElement: boolean | null;
  inputObserved: boolean;
  reason: string;
  before?: NativeElementReceipt;
  after?: NativeElementReceipt;
}

const normalize = (value: unknown): string => String(value || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

const frameOf = (value: unknown): ReceiptFrame | null => {
  const raw = value as any;
  if (!raw) return null;
  const frame = { x: Number(raw.x), y: Number(raw.y), w: Number(raw.w), h: Number(raw.h) };
  return Object.values(frame).every(Number.isFinite) && frame.w > 0 && frame.h > 0 ? frame : null;
};

const intersectionOverUnion = (a: ReceiptFrame, b: ReceiptFrame): number => {
  const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w), bottom = Math.min(a.y + a.h, b.y + b.h);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / Math.max(1, a.w * a.h + b.w * b.h - intersection);
};

/** Match the observed AX target against any element in the hit-test parent chain. */
export function matchHitElement(
  expected: ExpectedReceiptElement,
  chain: NativeElementReceipt[],
  liveExpectedFrame?: ReceiptFrame | null,
): ElementMatchReceipt {
  if (!chain.length) return { matched: false, confidence: 'none', score: 0, reason: 'native hit test returned no element identity' };
  const role = String(expected.role || '');
  const labels = [expected.originalLabel, expected.label, expected.contextLabel, expected.description]
    .map(normalize).filter(Boolean);
  const expectedFrame = liveExpectedFrame || frameOf(expected.frame);
  const ranked = chain.map(recipient => {
    let score = 0;
    const reasons: string[] = [];
    if (role && recipient.role === role) { score += 40; reasons.push('role'); }
    // AXIdentifier is an implementation identity, not necessarily user-visible semantics. AppKit
    // commonly returns a private identifier for text fields while the observation labels that same
    // field from its current value. A non-matching identifier is therefore neutral; only an actual
    // title/description can contradict the observed label. The identifier still counts positively
    // when an app deliberately makes it meaningful (for example `search-field`).
    const identifier = normalize(recipient.identifier);
    const semanticLabels = [recipient.title, recipient.description].map(normalize).filter(Boolean);
    const matchingLabels = [identifier, ...semanticLabels].filter(Boolean);
    if (labels.length && matchingLabels.length) {
      if (matchingLabels.some(actual => labels.some(wanted => actual === wanted || actual.includes(wanted) || wanted.includes(actual)))) {
        score += 35; reasons.push('label');
      } else if (semanticLabels.length) {
        // A changed real label at the same rectangle is precisely the stale-layout case preflight
        // exists to catch. Geometry cannot outvote contradictory semantic evidence.
        score -= 45; reasons.push('label contradicted');
      }
    }
    const actualFrame = frameOf(recipient.frame);
    if (expectedFrame && actualFrame) {
      const overlap = intersectionOverUnion(expectedFrame, actualFrame);
      if (overlap >= 0.72) { score += 40; reasons.push('frame'); }
      else if (overlap >= 0.35) { score += 25; reasons.push('partial frame'); }
    }
    if (recipient.enabled === false) score -= 50;
    return { recipient, score, reasons };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const matched = best.score >= 65;
  const confidence: ElementMatchReceipt['confidence'] = matched && best.score >= 75 ? 'high' : matched ? 'medium' : 'none';
  return {
    matched, confidence, score: best.score, recipient: best.recipient,
    reason: matched
      ? `recipient matched by ${best.reasons.join(' + ')}`
      : `best native recipient matched only ${best.reasons.join(' + ') || 'no independent signals'} (score ${best.score})`,
  };
}

export function sameNativeElement(a?: NativeElementReceipt, b?: NativeElementReceipt): boolean | null {
  if (!a || !b) return null;
  if (a.pid !== b.pid) return false;
  if (a.identifier && b.identifier) return a.identifier === b.identifier;
  const af = frameOf(a.frame), bf = frameOf(b.frame);
  return a.role === b.role && (!af || !bf || intersectionOverUnion(af, bf) >= 0.72);
}

/** Prove literal text affected the same focused editable element without exposing its contents. */
export function compareKeyboardFocus(
  targetPid: number,
  before?: NativeElementReceipt,
  after?: NativeElementReceipt,
): KeyboardReceipt {
  const recipientMatched = !!before && before.pid === targetPid && (!after || after.pid === targetPid);
  const editableBefore = before?.editable == null ? null : before.editable;
  const sameElement = sameNativeElement(before, after);
  const lengthChanged = before?.valueLength != null && after?.valueLength != null
    && before.valueLength !== after.valueLength;
  const caretChanged = before?.selectedRange?.location != null && after?.selectedRange?.location != null
    && (before.selectedRange.location !== after.selectedRange.location
      || before.selectedRange.length !== after.selectedRange.length);
  const inputObserved = recipientMatched && sameElement !== false && (lengthChanged || caretChanged);
  const reason = !before
    ? 'the native helper could not identify the focused element'
    : before.pid !== targetPid
      ? `keyboard focus belonged to pid ${before.pid}, not target pid ${targetPid}`
      : editableBefore === false
        ? `${before.role || 'focused element'} is not editable`
        : sameElement === false
          ? 'keyboard focus moved to a different element during delivery'
          : inputObserved
            ? `the same focused field reported ${lengthChanged ? 'a value-length change' : 'caret movement'}`
            : 'delivery stayed in the target app, but the field exposed no value/caret change';
  return { targetPid, recipientMatched, editableBefore, sameElement, inputObserved, reason, before, after };
}

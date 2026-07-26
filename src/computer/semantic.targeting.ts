/**
 * Universal semantic target ranking for native accessibility trees.
 *
 * Native applications rarely agree on labels: one exposes "Send", another "Submit", a third only
 * publishes "Button right of Type a message".  This resolver combines text, role, state, ordinal,
 * and geometry without carrying app-specific workflows.  It intentionally returns confidence and
 * a margin instead of silently turning every fuzzy resemblance into a click.
 */

export interface SemanticFrame { x: number; y: number; w: number; h: number }

export interface SemanticElement {
  label?: string;
  originalLabel?: string;
  contextLabel?: string;
  value?: string;
  description?: string;
  role?: string;
  enabled?: boolean;
  focused?: boolean;
  frame?: unknown;
  elementToken?: string;
  elementIndex?: number;
  visual?: { colorName?: string; confidence?: number };
}

export interface RankedSemanticTarget<T extends SemanticElement = SemanticElement> {
  element: T;
  score: number;
  reasons: string[];
}

export interface SemanticTargetRanking<T extends SemanticElement = SemanticElement> {
  ranked: Array<RankedSemanticTarget<T>>;
  confidence: 'high' | 'medium' | 'low' | 'none';
  margin: number;
  ambiguous: boolean;
}

const ACTIONABLE = new Set([
  'AXButton', 'AXCheckBox', 'AXComboBox', 'AXDisclosureTriangle', 'AXLink', 'AXMenuButton',
  'AXPopUpButton', 'AXRadioButton', 'AXSearchField', 'AXSlider', 'AXSwitch', 'AXTab',
  'AXTextArea', 'AXTextField',
]);

const ROLE_WORDS: Array<{ words: string[]; roles: Set<string> }> = [
  { words: ['button'], roles: new Set(['AXButton', 'AXMenuButton', 'AXPopUpButton', 'AXDisclosureTriangle']) },
  { words: ['checkbox', 'check box', 'tick box'], roles: new Set(['AXCheckBox']) },
  { words: ['toggle', 'switch'], roles: new Set(['AXSwitch', 'AXCheckBox']) },
  { words: ['field', 'input', 'textbox', 'text box', 'composer'], roles: new Set(['AXTextField', 'AXTextArea', 'AXSearchField']) },
  { words: ['search'], roles: new Set(['AXSearchField']) },
  { words: ['tab'], roles: new Set(['AXTab']) },
  { words: ['link'], roles: new Set(['AXLink']) },
  { words: ['slider'], roles: new Set(['AXSlider']) },
  { words: ['menu'], roles: new Set(['AXMenuButton', 'AXPopUpButton']) },
];

// Conservative equivalence groups: these describe common control affordances, not app workflows.
const SYNONYM_GROUPS = [
  ['send', 'submit', 'post'],
  ['attach', 'attachment', 'upload', 'paperclip'],
  ['delete', 'remove', 'trash'],
  ['more', 'ellipsis', 'options'],
  ['search', 'find'],
  ['next', 'continue', 'forward'],
  ['previous', 'back'],
  ['fullscreen', 'full screen'],
  ['maximize', 'enlarge'],
];

const SYNONYM = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  const canonical = group[0];
  for (const word of group) SYNONYM.set(word.replace(/\s+/g, ''), canonical);
}

const STOP = new Set([
  'the', 'a', 'an', 'this', 'that', 'one', 'control', 'please', 'click', 'press', 'choose', 'select',
  'button', 'field', 'input', 'textbox', 'composer', 'tab', 'link', 'slider', 'toggle', 'switch', 'menu', 'checkbox',
]);

const COLOR_ALIASES = new Map<string, string>([
  ['red', 'red'], ['orange', 'orange'], ['yellow', 'yellow'], ['green', 'green'],
  ['cyan', 'cyan'], ['teal', 'cyan'], ['blue', 'blue'], ['purple', 'purple'],
  ['violet', 'purple'], ['magenta', 'magenta'], ['pink', 'magenta'],
  ['gray', 'gray'], ['grey', 'gray'], ['black', 'black'], ['white', 'white'],
]);

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: unknown): string[] {
  return normalize(value).split(' ').filter(token => token && !STOP.has(token))
    .map(token => SYNONYM.get(token) || token);
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function textScore(query: string, value: unknown): number {
  const q = normalize(query), v = normalize(value);
  if (!q || !v) return 0;
  if (q === v) return 100;
  if (v.startsWith(q) || q.startsWith(v)) return 92;
  if (v.includes(q) || q.includes(v)) return 84;
  const qt = tokens(q), vt = tokens(v);
  if (!qt.length || !vt.length) return 0;
  const overlap = qt.filter(token => vt.includes(token)).length;
  const recall = overlap / qt.length;
  const precision = overlap / vt.length;
  if (recall === 1) return 78 + Math.round(8 * precision);
  if (recall >= 0.66) return 62 + Math.round(12 * precision);
  if (qt.length === 1) {
    const closest = Math.min(...vt.map(token => editDistance(qt[0], token)));
    const allowance = Math.max(1, Math.floor(qt[0].length * 0.2));
    if (closest <= allowance) return 65 - closest * 5;
  }
  return 0;
}

function frameOf(element: SemanticElement): SemanticFrame | null {
  const f = element.frame as any;
  if (!f) return null;
  const frame = { x: Number(f.x), y: Number(f.y), w: Number(f.w), h: Number(f.h) };
  return Object.values(frame).every(Number.isFinite) && frame.w > 0 && frame.h > 0 ? frame : null;
}

function ordinalFrom(query: string): number | 'last' | null {
  const q = normalize(query);
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  for (const [word, ordinal] of Object.entries(words)) if (new RegExp(`\\b${word}\\b`).test(q)) return ordinal;
  const numbered = q.match(/\b(\d+)(?:st|nd|rd|th)?\b/);
  if (numbered) return Math.max(1, Number(numbered[1]));
  return /\blast\b/.test(q) ? 'last' : null;
}

function hintedRoles(query: string): Set<string> | null {
  const q = normalize(query);
  for (const hint of ROLE_WORDS) if (hint.words.some(word => q.includes(word))) return hint.roles;
  return null;
}

function hintedColor(query: string): string | null {
  for (const token of normalize(query).split(' ')) {
    const color = COLOR_ALIASES.get(token);
    if (color) return color;
  }
  return null;
}

function withoutColorHint(query: string): string {
  return normalize(query).split(' ').filter(token => !COLOR_ALIASES.has(token)).join(' ');
}

function spatialOrder<T extends SemanticElement>(elements: T[], query: string): T[] {
  const q = normalize(query);
  const horizontal = /\b(?:left|right)\b/.test(q) || /\bfrom left\b/.test(q);
  const reverse = /\b(?:rightmost|bottommost)\b/.test(q) || /\bfrom right\b/.test(q);
  return [...elements].sort((a, b) => {
    const af = frameOf(a), bf = frameOf(b);
    if (!af || !bf) return Number(a.elementIndex || 0) - Number(b.elementIndex || 0);
    const av = horizontal ? af.x + af.w / 2 : af.y + af.h / 2;
    const bv = horizontal ? bf.x + bf.w / 2 : bf.y + bf.h / 2;
    return reverse ? bv - av : av - bv;
  });
}

export function rankSemanticTargets<T extends SemanticElement>(query: string, elements: T[]): SemanticTargetRanking<T> {
  const q = normalize(query);
  if (!q) return { ranked: [], confidence: 'none', margin: 0, ambiguous: false };
  const roles = hintedRoles(q);
  const color = hintedColor(q);
  // A colour adjective refines the semantic target; it must not prevent the remaining label from
  // matching ("blue Send button" should still match "Send"). Colour alone remains below the
  // resolver's acceptance threshold, so "click the blue thing" cannot invent a click target.
  const textQuery = withoutColorHint(q);
  const ordinal = ordinalFrom(q);
  const usable = elements.filter(element => element.enabled !== false);
  const ordered = ordinal ? spatialOrder(usable.filter(element => !roles || roles.has(String(element.role || ''))), q) : [];
  const ordinalElement = ordinal === 'last' ? ordered[ordered.length - 1] : ordinal ? ordered[ordinal - 1] : undefined;

  const ranked = usable.map(element => {
    const fields: Array<[unknown, string, number]> = [
      [element.contextLabel, 'context', 5],
      [element.label, 'label', 4],
      [element.originalLabel, 'native label', 3],
      [element.value, 'value', 2],
      [element.description, 'description', 1],
    ];
    let best = 0, source = '';
    for (const [value, name, bonus] of fields) {
      const score = textScore(textQuery, value) + bonus;
      if (score > best) { best = score; source = name; }
    }
    const reasons: string[] = [];
    let score = best;
    if (best > 0) reasons.push(`${source} matched`);
    const role = String(element.role || '');
    if (roles) {
      if (roles.has(role)) { score += 12; reasons.push('role matched'); }
      else score -= 18;
    } else if (ACTIONABLE.has(role)) {
      // When a heading and a button carry the same text, the control is the useful target. Twelve
      // points produces a decisive margin while duplicate controls still tie and are refused.
      score += 12;
    }
    if (ordinalElement === element) { score += 35; reasons.push('position matched'); }
    else if (ordinal) score -= 8;
    if (color && element.visual?.colorName && Number(element.visual.confidence || 0) >= 0.55) {
      const actual = COLOR_ALIASES.get(normalize(element.visual.colorName)) || normalize(element.visual.colorName);
      if (actual === color) { score += 18; reasons.push('sRGB colour matched'); }
      else { score -= 12; reasons.push(`colour was ${actual || 'unknown'}, not ${color}`); }
    }
    if (element.focused) { score += 2; reasons.push('focused'); }
    return { element, score, reasons };
  }).filter(candidate => candidate.score >= 45)
    .sort((a, b) => b.score - a.score || Number(a.element.elementIndex || 0) - Number(b.element.elementIndex || 0));

  if (!ranked.length) return { ranked, confidence: 'none', margin: 0, ambiguous: false };
  const margin = ranked.length > 1 ? ranked[0].score - ranked[1].score : ranked[0].score;
  const ambiguous = ranked.length > 1 && margin < 8;
  const confidence = ambiguous ? 'low'
    : ranked[0].score >= 90 && margin >= 10 ? 'high'
      : ranked[0].score >= 45 && margin >= 8 ? 'medium'
        : 'low';
  return { ranked, confidence, margin, ambiguous };
}

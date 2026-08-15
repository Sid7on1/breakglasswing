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
  /** Discovered from screenshot pixels (OCR), not published by the accessibility tree. */
  visualOnly?: boolean;
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
  'AXMenuItem', 'AXPopUpButton', 'AXRadioButton', 'AXSearchField', 'AXSlider', 'AXSwitch', 'AXTab',
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
  // Before the bare 'menu' entry: first match wins, so "menu item" must be read as the command
  // inside an open menu rather than as the control that opens one.
  { words: ['menu item', 'menu entry', 'menu command', 'context menu'], roles: new Set(['AXMenuItem']) },
  // A bare "menu" is genuinely ambiguous once open menus are visible — "click the Share menu" can
  // mean the popup button or the entry now showing in the open menu — so it admits both rather than
  // penalising whichever the caller meant.
  { words: ['menu'], roles: new Set(['AXMenuButton', 'AXPopUpButton', 'AXMenuItem']) },
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
  // Containment is NOT symmetric evidence, and treating it as such is why a degraded frame ranked
  // the single letters "I", "S" and "V" at 80+ against the query "First Text View": every one of
  // them is a substring of it, so every one scored as a near-exact match and the real target tied
  // with window furniture at margin 0.
  //
  // A value that CONTAINS the whole query is strong: the caller named the specific thing and the
  // element's label merely says more ("Send" inside "Send Message"). A value that is merely a
  // FRAGMENT of the query is weak, and weak in proportion to how little of the query it accounts
  // for — one character out of fifteen is not a match, it is a coincidence.
  if (v.startsWith(q)) return 92;
  if (v.includes(q)) return 84;
  // Coverage is measured against the query's CONTENT, not its raw length: role and filler words
  // ("send button", "the Continue link") are how callers speak, and counting them in the
  // denominator would punish a label that matches every meaningful word the caller said.
  const qCore = tokens(q).join(' ') || q;
  const coverage = v.length / Math.max(qCore.length, 1);
  if (q.startsWith(v)) return coverage >= 0.6 ? 92 : Math.round(70 * coverage);
  if (q.includes(v)) return coverage >= 0.6 ? 84 : Math.round(60 * coverage);
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

/** Does any candidate carry this word inside its OWN name? Then it is a name, not a position. */
function wordIsPartOfAName(word: string, elements: SemanticElement[]): boolean {
  return elements.some(element => [element.label, element.contextLabel, element.originalLabel]
    .some(field => normalize(field).split(' ').includes(word)));
}

function ordinalFrom(query: string, elements: SemanticElement[] = []): number | 'last' | null {
  const q = normalize(query);
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  for (const [word, ordinal] of Object.entries(words)) {
    if (!new RegExp(`\\b${word}\\b`).test(q)) continue;
    // Same failure as the bare-number case below, one step further up: macOS names real controls
    // with ordinal words. AXTextArea's standard label IS "First Text View", so "First Text View"
    // was read as "the 1st match", every genuine candidate took the non-ordinal penalty, and the
    // +35 went to whatever happened to sort first in space. Measured live: it is how a click on
    // the document body landed on the font-size control instead.
    if (wordIsPartOfAName(word, elements)) continue;
    return ordinal;
  }
  // The ordinal suffix is REQUIRED. A bare number inside a query is far more often part of a name
  // than a position — duplicate contact labels ("Mom 2", "John 3") are exactly how address books
  // disambiguate people, and reading that "2" as "the 2nd match" made every real candidate take the
  // non-ordinal penalty while the bonus went to whichever element happened to be second in spatial
  // order. Measured live: it is why clicking a named recipient landed on window chrome instead.
  const numbered = q.match(/\b(\d+)(?:st|nd|rd|th)\b/);
  if (numbered) return Math.max(1, Number(numbered[1]));
  return /\blast\b/.test(q) ? 'last' : null;
}

function hintedRoles(query: string): Set<string> | null {
  const q = normalize(query);
  for (const hint of ROLE_WORDS) if (hint.words.some(word => q.includes(word))) return hint.roles;
  return null;
}

/**
 * A colour word is only a colour when it is not somebody's NAME.
 *
 * "red-select.txt", "Blue Origin", "Green Room", "Redline" — when a candidate publishes the word
 * inside its own label, the caller is naming the thing, not describing how it looks. Treating it as
 * a description strips the one token that distinguishes the target: three files named red/green/
 * blue-select.txt all became the query "select txt", scored 88 apiece, and the exact match tied with
 * its two siblings at margin 0 — so the resolver refused every one of them as ambiguous.
 *
 * This is the same mistake ordinals already guard against with {@link wordIsPartOfAName} ("Mom 2"
 * read as "the 2nd Mom"), applied to the other query hint that rewrites what the caller said.
 */
function hintedColor(query: string, elements: SemanticElement[] = []): string | null {
  for (const token of normalize(query).split(' ')) {
    const color = COLOR_ALIASES.get(token);
    if (color && !wordIsPartOfAName(token, elements)) return color;
  }
  return null;
}

function withoutColorHint(query: string, elements: SemanticElement[] = []): string {
  return normalize(query).split(' ')
    .filter(token => !COLOR_ALIASES.has(token) || wordIsPartOfAName(token, elements))
    .join(' ');
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
  const usable = elements.filter(element => element.enabled !== false);
  // Both colour helpers consult the candidates, so a colour word that is part of a candidate's own
  // name stays in the query instead of being read as a description of it.
  const color = hintedColor(q, usable);
  // A colour adjective refines the semantic target; it must not prevent the remaining label from
  // matching ("blue Send button" should still match "Send"). Colour alone remains below the
  // resolver's acceptance threshold, so "click the blue thing" cannot invent a click target.
  const textQuery = withoutColorHint(q, usable);
  const ordinal = ordinalFrom(q, usable);
  const ordered = ordinal ? spatialOrder(usable.filter(element => !roles || roles.has(String(element.role || ''))), q) : [];
  const ordinalElement = ordinal === 'last' ? ordered[ordered.length - 1] : ordinal ? ordered[ordinal - 1] : undefined;

  const scored = usable.map(element => {
    const fields: Array<[unknown, string, number]> = [
      [element.contextLabel, 'context', 5],
      [element.label, 'label', 4],
      [element.originalLabel, 'native label', 3],
      [element.value, 'value', 2],
      [element.description, 'description', 1],
    ];
    let best = 0, text = 0, source = '';
    for (const [value, name, bonus] of fields) {
      const raw = textScore(textQuery, value);
      if (raw + bonus > best) { best = raw + bonus; text = raw; source = name; }
    }
    return { element, best, text, source };
  });
  // How well the query matched ANY candidate's text. The role bonus below is a tie-break within this
  // tier, never a way to climb out of a worse one.
  const bestTextScore = Math.max(0, ...scored.map(candidate => candidate.text));

  const ranked = scored.map(({ element, best, text, source }) => {
    const reasons: string[] = [];
    let score = best;
    if (best > 0) reasons.push(`${source} matched`);
    const role = String(element.role || '');
    if (roles) {
      if (roles.has(role)) { score += 12; reasons.push('role matched'); }
      else score -= 18;
    } else if (ACTIONABLE.has(role) && text >= bestTextScore) {
      // When a heading and a button carry the SAME text, the control is the useful target. Twelve
      // points produces a decisive margin while duplicate controls still tie and are refused.
      //
      // Gated on matching the best text in the frame, because otherwise it overturns strictly better
      // text: a toolbar title button matching the query only as a prefix (92) outscored the list row
      // whose label WAS the query character for character (100), and every click on that recipient
      // landed in window chrome. A role preference must break ties, not decide them.
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
    // An OCR-derived candidate is a PROPOSAL about pixels; a tree element is the app telling us what
    // it actually published. When both carry the same text the native one must win, because only it
    // has a role, a press action and an identity the hit-test can confirm — the vision twin fails
    // preflight ("expected VisualText, live point resolves to AXStaticText") and the click is
    // refused, which reads to the caller as "the element it can plainly see is unclickable".
    //
    // Measured on a Notes list row: OCR "Flexon MR" outranked the AXCell whose enriched label was
    // exactly "Flexon MR", so a correct target was refused. Deliberately a penalty rather than an
    // exclusion — where the tree is empty, vision is the only candidate and 100-15 still clears the
    // 45 floor, so an AX-opaque window stays targetable.
    if (element.visualOnly) { score -= 15; reasons.push('vision-only proposal, not a published element'); }
    return { element, score, reasons, text };
  }).filter(candidate => candidate.score >= 45)
    .sort((a, b) => b.score - a.score || Number(a.element.elementIndex || 0) - Number(b.element.elementIndex || 0));

  if (!ranked.length) return { ranked, confidence: 'none', margin: 0, ambiguous: false };
  const margin = ranked.length > 1 ? ranked[0].score - ranked[1].score : ranked[0].score;
  const ambiguous = ranked.length > 1 && margin < 8;
  // A query that names something must be answered by something that carries that name. When the
  // caller supplied content words and the winner matched NONE of them textually — it won on the
  // ordinal bonus, the role bonus, or colour alone — that is not an identification, and reporting
  // it as medium confidence is how a click gets delivered, confidently, to the wrong control.
  // Purely positional queries ("the third row") legitimately have no content words and keep their
  // confidence, because there the position IS the identification.
  // Ordinal and spatial words describe WHERE, not WHAT, so they are not content. Erring toward
  // treating a word as positional only ever makes this guard more permissive, which is the safe
  // direction: it must never suppress a query it does not actually understand.
  const POSITION_WORDS = new Set([
    'first', 'second', 'third', 'fourth', 'fifth', 'last',
    'from', 'left', 'right', 'top', 'bottom', 'leftmost', 'rightmost', 'topmost', 'bottommost',
    'upper', 'lower', 'middle', 'center', 'centre',
  ]);
  const contentTokens = tokens(textQuery).filter(token => !POSITION_WORDS.has(token));
  const namedButUnmatched = contentTokens.length > 0 && ranked[0].text <= 0;
  const confidence = ambiguous || namedButUnmatched ? 'low'
    : ranked[0].score >= 90 && margin >= 10 ? 'high'
      : ranked[0].score >= 45 && margin >= 8 ? 'medium'
        : 'low';
  return { ranked, confidence, margin, ambiguous };
}

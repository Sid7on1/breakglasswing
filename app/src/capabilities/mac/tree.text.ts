/**
 * Recover the text that NAMES a control from the accessibility tree, and fold it onto the element
 * the model can actually address.
 *
 * The driver reports two views of a window that do not carry the same information. `elements` is the
 * addressable set — every entry has an `element_index`/`element_token` an action can name — while
 * `tree_markdown` is the full walk, including the leaf `AXStaticText` nodes that hold the visible
 * words. Text leaves are not addressable, so they appear ONLY in the tree; addressable containers are
 * frequently anonymous, or carry an AX *identifier* in place of a name.
 *
 * Measured in Notes: 46 note rows arrived as `AXCell "ICMNoteListCell"` — the same class name 46
 * times — while the tree held "soak cycle 225", "New Note" and the rest as children of those cells.
 * Every note was therefore addressable but indistinguishable, and a `query` naming a note matched all
 * 46 equally. That is the failure the semantic resolver reports as ambiguity and refuses; from the
 * outside it reads as "computer use can't click the thing I named".
 *
 * The correction is the one macos-use makes in `_desktop_correction`: for a container, descend to the
 * static text beneath it and use that as the container's name. Here the descent reads the tree the
 * driver already returned rather than issuing fresh AX queries, so it costs nothing per observation.
 *
 * Text is attributed to the NEAREST indexed ancestor only, never to every ancestor. A note's words
 * sit under row → cell → cell, and naming all three "soak cycle 225" would make them score
 * identically — trading 46 indistinguishable elements for 3, which the resolver still refuses. The
 * innermost container is also the correct press target, so the nearest ancestor is both the
 * unambiguous choice and the right one.
 */

/** Roles whose value is the visible wording of whatever contains them. */
const TEXT_ROLES = new Set(['AXStaticText', 'AXHeading', 'AXLabel']);

/**
 * A node line, e.g. `      - [1] AXRow [actions=[…]]` or `    - AXStaticText = "Today"`.
 *
 * The role is REQUIRED to match `AX…` so that continuation lines are not mistaken for nodes. The
 * driver emits AX action lists verbatim, and those contain embedded newlines — a single logical node
 * routinely spans several physical lines (`target:0x0`, `selector:(null),name:share`). Those
 * fragments carry no `- ` marker, but demanding a real role as well keeps a fragment that happens to
 * begin with one from opening a bogus node and stealing the following text.
 */
const NODE_LINE = /^(\s*)- (?:\[(\d+)\]\s+)?(AX[A-Za-z0-9]+)(.*)$/;

export interface TreeNode {
  /** Indentation width — the tree's only nesting signal. */
  depth: number;
  /** `element_index` when the node is addressable; absent for text leaves and structural nodes. */
  index?: number;
  role: string;
  /** Quoted name that followed the role. */
  label?: string;
  /** Value after `=`, which is where a text leaf carries its words. */
  value?: string;
  /** AX identifier (`id=…`), which is a class name far more often than a name. */
  id?: string;
  /** Lower-cased AX action names the control publishes (`actions=[press,showmenu]`).
   *
   * Absent means the tree said nothing; an EMPTY array means the tree said "none". The two are not
   * the same, and only the second is evidence that background delivery cannot activate the control. */
  actions?: string[];
}

/** Pull `actions=[…]` out of an attribute list, counting brackets so the nested per-action entries
 * (`name:unread\ntarget:0x0\nselector:(null)`) cannot end the list early. */
function parseActionList(rest: string): string[] | undefined {
  const start = rest.indexOf('actions=[');
  if (start === -1) return undefined;
  let depth = 0;
  let end = -1;
  for (let i = start + 'actions='.length; i < rest.length; i += 1) {
    if (rest[i] === '[') depth += 1;
    else if (rest[i] === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return undefined;
  return rest.slice(start + 'actions=['.length, end)
    .split(',')
    .map(entry => {
      // A custom action arrives as `name:<title>` followed by its target/selector on further lines.
      // Its identity is the title — calling every one of them "name" would collapse a row's distinct
      // swipe actions (unread, pin, archive) into one repeated token.
      const custom = entry.match(/^\s*name:\s*([^\n]*)/);
      if (custom) return custom[1].trim().toLocaleLowerCase();
      return entry.split(':')[0].split('\n')[0].trim().toLocaleLowerCase();
    })
    .filter(Boolean);
}

/** Parse `tree_markdown` into nodes, joining the multi-line action lists back onto their node. */
export function parseTreeNodes(treeMarkdown: string): TreeNode[] {
  const nodes: TreeNode[] = [];
  let pendingRest: string | null = null;
  const flush = () => {
    if (pendingRest === null || nodes.length === 0) return;
    const node = nodes[nodes.length - 1];
    const rest = pendingRest;
    pendingRest = null;
    const id = rest.match(/\bid=([^\s\]]+)/);
    if (id) node.id = id[1];
    const actions = parseActionList(rest);
    if (actions) node.actions = actions;
    // `= "…"` is a value (text leaves); a name follows as either a quoted string or a PARENTHESISED
    // one. Both forms are real: Notes writes `AXCell "ICMNoteListCell"`, while WhatsApp writes
    // `AXButton = "…" (Heman, 1 unread message)`. Recognising only the quoted form left every node of
    // a parenthesised tree with no label AND no value — measured 2026-08-05, WhatsApp's whole tree
    // parsed to bare roles and the text map came back empty, so folding was a silent no-op there.
    //
    // Each form is anchored to the start of the remainder and must be followed by the next section,
    // so a quoted `help="…"` or a `selector:(null)` inside the attribute list cannot be mistaken for
    // a name.
    let remainder = rest;
    const consume = (match: RegExpMatchArray | null): string | null => {
      if (!match) return null;
      remainder = remainder.slice(match[0].length);
      return match[1];
    };
    const value = consume(remainder.match(/^\s*=\s*"([\s\S]*?)"(?=\s*(?:\(|\[|$))/));
    if (value !== null) node.value = value;
    else {
      const quoted = consume(remainder.match(/^\s*"([\s\S]*?)"(?=\s*(?:\(|\[|$))/));
      if (quoted !== null) node.label = quoted;
    }
    if (node.label === undefined) {
      const parenthesised = consume(remainder.match(/^\s*\(([\s\S]*?)\)(?=\s*(?:\[|$))/));
      if (parenthesised !== null) node.label = parenthesised;
    }
  };

  for (const line of String(treeMarkdown || '').split('\n')) {
    const match = line.match(NODE_LINE);
    if (!match) {
      // Continuation of the current node's attribute list.
      if (pendingRest !== null) pendingRest += `\n${line}`;
      continue;
    }
    flush();
    nodes.push({
      depth: match[1].length,
      index: match[2] !== undefined ? Number(match[2]) : undefined,
      role: match[3],
    });
    pendingRest = match[4] ?? '';
  }
  flush();
  return nodes;
}

/**
 * Map `element_index` → the visible text found beneath it, nearest-ancestor wins.
 *
 * Exported so the mapping can be asserted directly against a captured tree, without a live desktop.
 */
export function textByElementIndex(treeMarkdown: string): Map<number, string[]> {
  const nodes = parseTreeNodes(treeMarkdown);
  const collected = new Map<number, string[]>();
  // Indexed ancestors currently open, innermost last.
  const ancestors: Array<{ depth: number; index: number }> = [];

  for (const node of nodes) {
    while (ancestors.length && ancestors[ancestors.length - 1].depth >= node.depth) ancestors.pop();
    if (!TEXT_ROLES.has(node.role)) {
      if (node.index !== undefined) ancestors.push({ depth: node.depth, index: node.index });
      continue;
    }
    const text = String(node.value ?? node.label ?? '').trim();
    if (!text) continue;
    // A text leaf that is ITSELF addressable names only itself.
    const owner = node.index !== undefined ? node.index : ancestors[ancestors.length - 1]?.index;
    if (owner === undefined) continue;
    const bucket = collected.get(owner) || [];
    if (!bucket.includes(text)) bucket.push(text);
    collected.set(owner, bucket);
  }
  return collected;
}

/**
 * Is this label the app's AX identifier rather than a human name?
 *
 * Decided by EVIDENCE, not by guessing at naming conventions: the tree reports the identifier
 * separately (`id=ICMNoteListCell`), so a label equal to it demonstrably came from the identifier.
 * Pattern-matching CamelCase instead would eventually demote a real name — plenty of buttons are
 * legitimately called "AirDrop" or "FaceTime".
 */
function labelIsIdentifier(label: string, id: string | undefined): boolean {
  return !!id && !!label && label.trim() === id.trim();
}

/**
 * Give every addressable element the words that appear inside it.
 *
 * Only fills what the app left empty or answered with an identifier — a real name the app published
 * is always kept, and the identifier is preserved on `original_label` so nothing is silently lost.
 * The first text beneath a container is its title (macos-use stops at the first static text for the
 * same reason); the remainder becomes `value`, which the resolver also scores, so a note is findable
 * by its preview line or its date as well as by its title.
 */
export function foldTreeTextIntoElements(elements: any[], treeMarkdown: string): any[] {
  if (!Array.isArray(elements) || elements.length === 0) return elements;
  const text = textByElementIndex(treeMarkdown);
  const idByIndex = new Map<number, string>();
  const actionsByIndex = new Map<number, string[]>();
  for (const node of parseTreeNodes(treeMarkdown)) {
    if (node.index === undefined) continue;
    if (node.id) idByIndex.set(node.index, node.id);
    // The tree is the ONLY place the driver reports what a control can actually do — `elements` omits
    // it — and it is what lets a caller be told up front that a row cannot be pressed, instead of
    // discovering it from a raw -25206 after the attempt.
    if (node.actions) actionsByIndex.set(node.index, node.actions);
  }
  if (text.size === 0 && actionsByIndex.size === 0) return elements;

  return elements.map(element => {
    const index = element?.element_index;
    if (index === undefined || index === null) return element;
    const publishedActions = actionsByIndex.get(Number(index));
    // Carried on every element the tree described, whether or not it also needed naming.
    if (publishedActions) element = { ...element, ax_actions: publishedActions };
    const texts = text.get(Number(index));
    if (!texts || texts.length === 0) return element;
    const label = String(element?.label ?? '');
    const identifier = labelIsIdentifier(label, idByIndex.get(Number(index)));
    if (label.trim() && !identifier) {
      // Named by the app. Keep the name, but still surface the inner words when nothing else does,
      // so a row titled "Message" is still findable by the message it contains.
      if (String(element?.value ?? '').trim()) return element;
      return { ...element, value: texts.join(' — ') };
    }
    const [title, ...rest] = texts;
    const folded: Record<string, unknown> = { ...element, label: title, label_source: 'tree_text' };
    if (identifier) folded.original_label = label;
    if (rest.length && !String(element?.value ?? '').trim()) folded.value = rest.join(' — ');
    return folded;
  });
}

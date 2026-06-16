import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IGraphStore } from '../graph/models';
import { resolveNodeId } from '../graph/node.search';
import { readSymbolSource } from '../graph/symbol.source';

// G4 — `@symbol` mentions. Typing `@handlePayment` in the prompt resolves the symbol via the
// graph and injects ONLY that symbol's source into the turn (symbol-precise, cheaper than
// `@file`). Parsing is kept pure and unit-tested here; the async expansion layers the graph
// lookup + file read on top (mirrors the tailToHeight extraction pattern).

// An @mention is `@` (not preceded by a word char or another `@`, so emails like `a@b` and
// `@@` don't match) followed by an identifier that may include dots for methods (`@Foo.bar`).
const AT_MENTION_RE = /(?<![A-Za-z0-9_@])@([A-Za-z_][A-Za-z0-9_.]*)/g;

/** Pure: extract the unique `@symbol` tokens (without the `@`), in first-seen order. */
export function parseAtMentions(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  AT_MENTION_RE.lastIndex = 0;
  while ((m = AT_MENTION_RE.exec(text)) !== null) {
    const tok = m[1].replace(/\.+$/, ''); // trailing dot is sentence punctuation, not a method
    if (tok && !seen.has(tok)) { seen.add(tok); out.push(tok); }
  }
  return out;
}

export interface AtExpansion {
  text: string;          // original text, plus appended source for any resolved mentions
  resolved: string[];    // tokens that resolved to a symbol and were injected
  unresolved: string[];  // tokens that did not resolve (left as plain text)
}

/**
 * Expand `@symbol` mentions: the user's text is preserved verbatim, and each resolved
 * symbol's source is appended in a clearly-labelled context block so the model sees exactly
 * those symbols. Plain text with no (resolvable) mentions is returned unchanged.
 */
export async function expandAtMentions(
  text: string,
  store: IGraphStore,
  cwd: string
): Promise<AtExpansion> {
  const tokens = parseAtMentions(text);
  if (tokens.length === 0 || store.getGraph().nodes.size === 0) {
    return { text, resolved: [], unresolved: tokens };
  }

  const blocks: string[] = [];
  const resolved: string[] = [];
  const unresolved: string[] = [];

  for (const tok of tokens) {
    const r = resolveNodeId(store, tok);
    if (!r.id) { unresolved.push(tok); continue; }
    const node = store.getNode(r.id)!;
    const { text: src } = await readSymbolSource(node, cwd);
    if (src == null) { unresolved.push(tok); continue; }
    resolved.push(tok);
    blocks.push(`// @${tok} → ${node.type} ${node.name} (${node.filePath}:${node.startLine}-${node.endLine})\n${src}`);
  }

  if (blocks.length === 0) return { text, resolved, unresolved };
  const appended = `${text}\n\n--- Referenced symbols (from @mentions) ---\n${blocks.join('\n\n')}`;
  return { text: appended, resolved, unresolved };
}

/**
 * A `@<token>` is treated as a filesystem path (rather than a symbol) when it looks like one:
 * starts with `./`, `../`, `/`, `~`, or contains a slash. Used to route @-completion.
 */
export function looksLikePath(token: string): boolean {
  return token.startsWith('./') || token.startsWith('../') || token.startsWith('/')
    || token.startsWith('~') || token.includes('/');
}

/**
 * Filesystem completions for a `@<path>` token being typed (`@./src/`, `@~/notes`, `@/etc/`).
 * Returns full `@<dir><entry>` strings (dirs suffixed with `/`) so the accept step can replace
 * the whole token. Pure-ish (reads the FS); failures resolve to an empty list.
 */
export function suggestPaths(token: string, cwd: string, limit = 10): string[] {
  try {
    let dirPart: string, prefix: string;
    if (token.endsWith('/')) { dirPart = token; prefix = ''; }
    else { const i = token.lastIndexOf('/'); dirPart = i >= 0 ? token.slice(0, i + 1) : ''; prefix = i >= 0 ? token.slice(i + 1) : token; }

    let baseDir: string;
    if (dirPart.startsWith('~')) baseDir = path.join(os.homedir(), dirPart.slice(1));
    else if (path.isAbsolute(dirPart)) baseDir = dirPart || '/';
    else baseDir = path.join(cwd, dirPart);

    const lc = prefix.toLowerCase();
    return fs.readdirSync(baseDir, { withFileTypes: true })
      .filter((e) => (lc ? e.name.toLowerCase().startsWith(lc) : !e.name.startsWith('.')))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((e) => `@${dirPart}${e.name}${e.isDirectory() ? '/' : ''}  ${e.isDirectory() ? 'dir' : 'file'}`);
  } catch {
    return [];
  }
}

/** Symbol-name completions for the `@<partial>` being typed (pure; for the autocomplete UI). */
export function suggestAtSymbols(store: IGraphStore, partial: string, limit = 8): string[] {
  const kw = partial.toLowerCase();
  const seen = new Set<string>();
  const named: string[] = [];
  for (const node of store.getGraph().nodes.values()) {
    if (node.type !== 'FUNCTION' && node.type !== 'CLASS' && node.type !== 'INTERFACE') continue;
    if (!node.name || seen.has(node.name)) continue;
    if (kw && !node.name.toLowerCase().startsWith(kw)) continue;
    seen.add(node.name);
    named.push(node.name);
    if (named.length >= limit) break;
  }
  return named;
}

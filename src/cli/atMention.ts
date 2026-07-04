import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { IGraphStore } from '../graph/models';
import { resolveNodeId } from '../graph/node.search';
import { readSymbolSource } from '../graph/symbol.source';
import { readIdeSelection, formatSelectionBlock } from './ideSelection';

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

export interface FileAtExpansion {
  text: string;         // query text with @file/@diff/@staged tokens replaced by content
  injected: string[];   // labels for what was injected (for the status bar)
}

/**
 * Expand file-level @-references before symbol @-mentions are resolved.
 * Handles three patterns:
 *   @diff          → git diff HEAD (unstaged+staged changes)
 *   @staged        → git diff --staged (only staged changes)
 *   @./rel/path    → file content (relative path starting with ./ or ../)
 *   @~/abs/path    → file content (home-dir path)
 *   @folder/path   → directory listing when token contains / and is a directory
 *
 * Injected content is appended as clearly-labelled blocks; the original @token
 * in the text is replaced with a short placeholder so the symbol resolver
 * (expandAtMentions) doesn't attempt to resolve "diff" or "staged" as symbols.
 */
// Compiled once — avoids re-parsing the regex on every keystroke / expansion call.
// Matches @url <https://...>, @diff, @staged, @selection/@sel, and @path-like tokens
const FILE_AT_RE = /(?<![A-Za-z0-9_@])@(diff|staged|selection|sel|(?:\.\.?\/|~\/|\/)[^\s,;"'`()[\]{}]*|[A-Za-z0-9_./-]+\/[^\s,;"'`()[\]{}]*)/g;
// URL pattern matched separately (fetch is async and the URL contains non-path chars)
const URL_AT_RE = /(?<![A-Za-z0-9_@])@url\s+(https?:\/\/\S+)/gi;

async function fetchUrlContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 40_000); // cap at 40k to avoid blowing the context window
  } catch {
    return null;
  }
}

export async function expandFileAtMentions(text: string, cwd: string): Promise<FileAtExpansion> {

  const injected: string[] = [];
  const blocks: string[] = [];
  let replacedText = text;

  // --- @url expansion (async fetch, handled before path/diff tokens) ---
  const urlMatches = [...text.matchAll(URL_AT_RE)];
  for (const m of urlMatches) {
    const url = m[1];
    const content = await fetchUrlContent(url);
    if (content) {
      blocks.push(`--- @url ${url} ---\n${content}`);
      injected.push(`@url ${url}`);
      replacedText = replacedText.replace(m[0], `[url:${url}]`);
    }
  }

  const matches: { full: string; token: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  FILE_AT_RE.lastIndex = 0; // must reset the global regex before each scan
  while ((m = FILE_AT_RE.exec(text)) !== null) {
    matches.push({ full: m[0], token: m[1], index: m.index });
  }

  for (const { full, token } of matches) {
    try {
      if (token === 'diff') {
        const output = execSync('git diff HEAD', { cwd, encoding: 'utf8', maxBuffer: 200 * 1024 }).trim();
        if (output) {
          blocks.push(`--- @diff (git diff HEAD) ---\n${output}`);
          injected.push('@diff');
          replacedText = replacedText.replace(full, '[diff attached]');
        }
      } else if (token === 'staged') {
        const output = execSync('git diff --staged', { cwd, encoding: 'utf8', maxBuffer: 200 * 1024 }).trim();
        if (output) {
          blocks.push(`--- @staged (git diff --staged) ---\n${output}`);
          injected.push('@staged');
          replacedText = replacedText.replace(full, '[staged diff attached]');
        }
      } else if (token === 'selection' || token === 'sel') {
        // IDE selection bridge — inject the exact range the user has selected in their editor.
        const sel = readIdeSelection(cwd);
        if (sel) {
          blocks.push(formatSelectionBlock(sel, cwd));
          injected.push('@selection');
          const rel = path.relative(cwd, sel.file) || path.basename(sel.file);
          replacedText = replacedText.replace(full, `[selection ${rel}:${sel.startLine}-${sel.endLine}]`);
        }
      } else {
        // File or folder path
        const absPath = token.startsWith('~')
          ? path.join(os.homedir(), token.slice(1))
          : path.resolve(cwd, token);

        const stat = await fsAsync.stat(absPath).catch(() => null);
        if (!stat) continue;

        if (stat.isDirectory()) {
          const entries = await fsAsync.readdir(absPath, { withFileTypes: true }).catch(() => null);
          if (!entries) continue;
          const listing = entries
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
            .slice(0, 80)
            .map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}${e.isDirectory() ? '/' : ''}`)
            .join('\n');
          const rel = path.relative(cwd, absPath) || '.';
          blocks.push(`--- @${token} (directory listing of ${rel}/) ---\n${listing}`);
          injected.push(`@${token}`);
          replacedText = replacedText.replace(full, `[dir:${path.basename(absPath)}/]`);
        } else {
          // File — read up to 100KB
          const MAX = 100 * 1024;
          if (stat.size > MAX) continue;
          const content = await fsAsync.readFile(absPath, 'utf8').catch(() => null);
          if (content === null) continue;
          const rel = path.relative(cwd, absPath) || path.basename(absPath);
          blocks.push(`--- @${token} (${rel}) ---\n${content}`);
          injected.push(`@${token}`);
          replacedText = replacedText.replace(full, `[file:${path.basename(absPath)}]`);
        }
      }
    } catch {
      // best-effort — leave token as-is
    }
  }

  if (blocks.length === 0) return { text, injected: [] };

  const expanded = `${replacedText}\n\n--- File/diff context (from @mentions) ---\n${blocks.join('\n\n')}`;
  return { text: expanded, injected };
}

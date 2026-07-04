import * as ts from 'typescript';
import * as path from 'path';
import { execFileSync } from 'child_process';

const CHECKABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

/**
 * External syntax gates for non-JS languages, using toolchains already on the machine —
 * no new dependencies. Go was the self-model's measured weak spot, and it had NO shield.
 *   .go → `gofmt -e` (stdin; prints every syntax error as file:line:col)
 *   .py → `python3 -c "ast.parse(...)"` (stdin; first syntax error)
 * Availability is probed once and cached; missing toolchains simply skip the gate.
 */
const EXTERNAL_CHECKERS: Record<string, { bin: string; args: string[]; countErrors: (stderr: string) => number }> = {
  '.go': {
    bin: 'gofmt',
    args: ['-e'],
    countErrors: (stderr) => (stderr.match(/:\d+:\d+:/g) || []).length || (stderr.trim() ? 1 : 0),
  },
  '.py': {
    bin: 'python3',
    args: ['-c', 'import sys, ast; ast.parse(sys.stdin.read())'],
    countErrors: (stderr) => (stderr.trim() ? 1 : 0),
  },
};

const checkerAvailable = new Map<string, boolean>();

function hasChecker(ext: string): boolean {
  const def = EXTERNAL_CHECKERS[ext];
  if (!def) return false;
  const cached = checkerAvailable.get(ext);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [def.bin], { stdio: 'pipe', timeout: 3000 });
    ok = true;
  } catch { /* checker not installed — stays false */ }
  checkerAvailable.set(ext, ok);
  return ok;
}

/** Error count + first messages from an external checker ([0, []] when clean). */
function externalSyntaxErrors(ext: string, content: string): { count: number; messages: string[] } {
  const def = EXTERNAL_CHECKERS[ext];
  if (!def || !hasChecker(ext)) return { count: 0, messages: [] };
  try {
    execFileSync(def.bin, def.args, { input: content, stdio: 'pipe', timeout: 10_000 });
    return { count: 0, messages: [] };
  } catch (e: any) {
    const stderr = String(e?.stderr || '');
    const count = def.countErrors(stderr);
    const messages = stderr.split('\n').filter(Boolean).slice(0, 3)
      // stdin paths render as "<standard input>:12:3:" — strip to the line info.
      .map(l => l.replace(/^<standard input>|^-:|^<unknown>/, '').replace(/^[:\s]+/, '  line '));
    return { count, messages };
  }
}

/**
 * Fast SYNTAX-only check of a single edited file — no project load, no type-checking — using the
 * TypeScript parser. It catches structurally-broken edits (orphaned braces, unterminated blocks,
 * stray tokens) the MOMENT they happen, so the model fixes them in its next step instead of moving
 * on and leaving the file uncompilable (the "orphaned } left invalid TS" failure). Deliberately does
 * NOT report type errors — those need the whole program and aren't the edit's fault.
 *
 * Returns a short warning to append to the tool result, or null when clean / not a JS-TS file.
 * Best-effort: never throws (a checker bug must never block a write).
 */
/** Syntax-error diagnostics for one file's content ([] when clean or not a JS/TS file). */
function syntaxErrors(filePath: string, content: string): ts.Diagnostic[] {
  const ext = path.extname(filePath).toLowerCase();
  if (!CHECKABLE.has(ext)) return [];
  const compilerOptions: ts.CompilerOptions = { noEmit: true, allowJs: true, target: ts.ScriptTarget.Latest, isolatedModules: true };
  if (ext.endsWith('x')) compilerOptions.jsx = ts.JsxEmit.Preserve;
  const result = ts.transpileModule(content, { reportDiagnostics: true, fileName: filePath, compilerOptions });
  return (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
}

function formatDiagnostics(errors: ts.Diagnostic[], max = 3): string {
  return errors.slice(0, max).map(d => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    if (d.file && d.start != null) {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start);
      return `  line ${line + 1}: ${msg}`;
    }
    return `  ${msg}`;
  }).join('\n');
}

/**
 * Edit Shield — the PRE-write gate. Returns a rejection message when the proposed content has MORE
 * syntax errors than the current content (i.e. this edit is what breaks the file); null means write.
 * Comparing counts (not requiring zero) keeps already-broken files editable — an agent mid-repair
 * isn't blocked because the file still has other, pre-existing errors. Best-effort: never throws,
 * and BIMAX_EDIT_SHIELD=0 disables it entirely.
 */
export function shieldEdit(filePath: string, before: string, after: string): string | null {
  try {
    if (process.env.BIMAX_EDIT_SHIELD === '0') return null;
    const ext = path.extname(filePath).toLowerCase();

    // Non-JS languages: gate via the native toolchain when present (Go/Python). Same
    // count-delta contract — an already-broken file stays editable mid-repair.
    if (EXTERNAL_CHECKERS[ext]) {
      const afterErr = externalSyntaxErrors(ext, after);
      if (afterErr.count === 0) return null;
      const beforeErr = externalSyntaxErrors(ext, before);
      if (afterErr.count <= beforeErr.count) return null;
      return `it would INTRODUCE ${afterErr.count - beforeErr.count} syntax error(s) into ${path.basename(filePath)} (${beforeErr.count} → ${afterErr.count}):\n${afterErr.messages.join('\n')}\nNothing was written. Fix the replacement text (check braces/parens/quotes) and retry.`;
    }

    const afterErrors = syntaxErrors(filePath, after);
    if (afterErrors.length === 0) return null;
    const beforeCount = syntaxErrors(filePath, before).length;
    if (afterErrors.length <= beforeCount) return null; // not this edit's fault — post-write warning still fires
    return `it would INTRODUCE ${afterErrors.length - beforeCount} syntax error(s) into ${path.basename(filePath)} (${beforeCount} → ${afterErrors.length}):\n${formatDiagnostics(afterErrors)}\nNothing was written. Fix the replacement text (check braces/parens/quotes) and retry.`;
  } catch {
    return null;
  }
}

export function checkEditSyntax(filePath: string, content: string): string | null {
  try {
    const ext = path.extname(filePath).toLowerCase();
    // Non-JS languages: post-write warning via the native toolchain when present.
    if (EXTERNAL_CHECKERS[ext]) {
      const r = externalSyntaxErrors(ext, content);
      if (r.count === 0) return null;
      return `\n\n⚠ SYNTAX CHECK FAILED — your edit left ${path.basename(filePath)} with ${r.count} syntax error(s). FIX this now before continuing (re-read the file and correct the structure):\n${r.messages.join('\n')}`;
    }
    if (!CHECKABLE.has(ext)) return null;

    const compilerOptions: ts.CompilerOptions = { noEmit: true, allowJs: true, target: ts.ScriptTarget.Latest, isolatedModules: true };
    if (ext.endsWith('x')) compilerOptions.jsx = ts.JsxEmit.Preserve; // only JSX files take the --jsx option
    const result = ts.transpileModule(content, { reportDiagnostics: true, fileName: filePath, compilerOptions });
    const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    if (errors.length === 0) return null;

    const shown = errors.slice(0, 3).map(d => {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      if (d.file && d.start != null) {
        const { line } = d.file.getLineAndCharacterOfPosition(d.start);
        return `  line ${line + 1}: ${msg}`;
      }
      return `  ${msg}`;
    });
    return `\n\n⚠ SYNTAX CHECK FAILED — your edit left ${path.basename(filePath)} with ${errors.length} syntax error(s). FIX this now before continuing (re-read the file and correct the structure):\n${shown.join('\n')}`;
  } catch {
    return null;
  }
}

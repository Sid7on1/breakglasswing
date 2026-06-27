import * as ts from 'typescript';
import * as path from 'path';

const CHECKABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);

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
export function checkEditSyntax(filePath: string, content: string): string | null {
  try {
    const ext = path.extname(filePath).toLowerCase();
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

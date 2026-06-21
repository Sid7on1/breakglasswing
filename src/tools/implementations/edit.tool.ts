import * as fs from 'fs/promises';
import * as path from 'path';
import { resolvePath, countOccurrences } from '../path.util';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { backupFile, unifiedDiff, compactDiff, capDiff } from '../../cli/fileEditor';
import { checkEditSyntax } from '../syntax.check';
import { requestDiffApproval } from '../../cli/diffApproval';
import { checkBlastRadius } from '../../cli/blastGate';
import { detectCorruptWrite } from '../write-guard';
import { fileStateCache } from '../../memory/file-state-cache';
import { globalTransactionManager } from '../../core/transaction.manager';

interface FallbackMatch {
  resolvedOld: string; // the actual text in the file that will be replaced
  method: string;      // which of the 9 steps succeeded (shown in diff-approval + result)
}

/**
 * 9-step fuzzy edit fallback chain (KiloCode-style).
 * Called only when exact match fails. Each step applies a progressively looser
 * normalization, finds a unique match in the file content, then returns the
 * ACTUAL text from the file (resolvedOld) so the replacement is exact on disk.
 *
 * Steps:
 *   2. TrimmedBoundary     — strip leading/trailing blank lines from oldString
 *   3. LineTrimmed         — trim trailing whitespace from each line
 *   4. WhitespaceNormalized — collapse internal whitespace runs per line
 *   5. IndentationFlexible — strip leading whitespace from each line
 *   6. EscapeNormalized    — resolve \\n, \\t literals in oldString
 *   7. BlockAnchor         — match by first + last non-empty line
 *   8. ContextAware        — anchor on the most distinctive line, extract expected-length block
 *   9. MultiOccurrence     — take the first match when multiple exist (last resort)
 */
function findFuzzyMatch(content: string, oldString: string): FallbackMatch | null {
  // Try: transform oldString into something that appears verbatim in content (character-level)
  const tryCharTransform = (transform: (s: string) => string, method: string): FallbackMatch | null => {
    const t = transform(oldString);
    if (t === oldString) return null; // transform produced no change
    const n = countOccurrences(content, t);
    if (n === 1) return { resolvedOld: t, method };
    return null;
  };

  // Try: normalize each line of oldString and content, sliding-window match, map back to original
  const tryLineNorm = (normLine: (l: string) => string, method: string): FallbackMatch | null => {
    const oldLines = oldString.split('\n');
    const contentLines = content.split('\n');
    const normOld = oldLines.map(normLine);
    const normContent = contentLines.map(normLine);

    if (normOld.every((l, i) => l === oldLines[i])) return null; // no change from normalization

    const target = normOld.join('\n');
    const n = normOld.length;
    const hits: number[] = [];

    for (let i = 0; i <= normContent.length - n; i++) {
      if (normContent.slice(i, i + n).join('\n') === target) hits.push(i);
    }

    if (hits.length === 1) {
      return { resolvedOld: contentLines.slice(hits[0], hits[0] + n).join('\n'), method };
    }
    if (hits.length > 1) {
      // Multiple matches — take first, note it (Step 9 handles this intentionally)
      return {
        resolvedOld: contentLines.slice(hits[0], hits[0] + n).join('\n'),
        method: `${method} (${hits.length} matches, first used)`,
      };
    }
    return null;
  };

  // Step 2: TrimmedBoundary
  const s2 = tryCharTransform(s => s.replace(/^\n+/, '').replace(/\n+$/, ''), 'TrimmedBoundary');
  if (s2) return s2;

  // Step 3: LineTrimmed
  const s3 = tryLineNorm(l => l.trimEnd(), 'LineTrimmed');
  if (s3) return s3;

  // Step 4: WhitespaceNormalized
  const s4 = tryLineNorm(l => l.replace(/[ \t]+/g, ' ').trimEnd(), 'WhitespaceNormalized');
  if (s4) return s4;

  // Step 5: IndentationFlexible
  const s5 = tryLineNorm(l => l.trimStart(), 'IndentationFlexible');
  if (s5) return s5;

  // Step 6: EscapeNormalized
  const s6 = tryCharTransform(
    s => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\'),
    'EscapeNormalized'
  );
  if (s6) return s6;

  // Step 7: BlockAnchor — match by first + last non-empty lines
  {
    const oldLines = oldString.split('\n');
    const nonEmpty = oldLines.filter(l => l.trim().length > 0);
    if (nonEmpty.length >= 2) {
      const firstTrim = nonEmpty[0].trim();
      const lastTrim = nonEmpty[nonEmpty.length - 1].trim();
      const cLines = content.split('\n');
      const expectedLen = oldLines.length;
      for (let i = 0; i < cLines.length; i++) {
        if (cLines[i].trim() !== firstTrim) continue;
        const maxJ = Math.min(cLines.length - 1, i + expectedLen + 3);
        for (let j = i + 1; j <= maxJ; j++) {
          if (cLines[j].trim() === lastTrim) {
            return { resolvedOld: cLines.slice(i, j + 1).join('\n'), method: 'BlockAnchor' };
          }
        }
      }
    }
  }

  // Step 8: ContextAware — anchor on the most distinctive line, extract expected-length block
  {
    const oldLines = oldString.split('\n');
    const anchor = oldLines
      .map((l, i) => ({ trimmed: l.trim(), idx: i }))
      .filter(x => x.trimmed.length > 15)
      .sort((a, b) => b.trimmed.length - a.trimmed.length)[0];

    if (anchor) {
      const cLines = content.split('\n');
      for (let ci = 0; ci < cLines.length; ci++) {
        if (cLines[ci].trim() !== anchor.trimmed) continue;
        const blockStart = ci - anchor.idx;
        if (blockStart >= 0 && blockStart + oldLines.length <= cLines.length) {
          return {
            resolvedOld: cLines.slice(blockStart, blockStart + oldLines.length).join('\n'),
            method: 'ContextAware',
          };
        }
      }
    }
  }

  // Step 9: MultiOccurrence — WhitespaceNormalized allowing multiple matches (last resort)
  {
    const s9 = tryLineNorm(l => l.replace(/[ \t]+/g, ' ').trimEnd(), 'MultiOccurrence');
    if (s9) return s9;
  }

  return null;
}

/** Render a compact unified-style preview of the change for the transcript. */

interface EditArgs {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export const createEditFileTool = (governor: IGovernor) => buildTool({
  name: 'EditFileTool',
  description: `Performs an exact string replacement inside an existing file. This is the correct tool for modifying code: it is surgical, reviewable, and never rewrites the rest of the file. Prefer it over WriteFileTool (full overwrite) and over \`sed\` via BashTool.

# Instructions
- **oldString** must match the file content EXACTLY, including indentation and line breaks.
- **oldString must be unique** in the file, or the edit fails — include more surrounding lines to disambiguate. Alternatively pass \`replaceAll: true\` to replace every occurrence.
- **newString** must differ from oldString.
- The file must already exist; use WriteFileTool to create new files.`,
  isDestructive: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit (supports ~/ for home dir).' },
      oldString: { type: 'string', description: 'The exact text to replace (must match the file verbatim).' },
      newString: { type: 'string', description: 'The replacement text.' },
      replaceAll: { type: 'boolean', description: 'Replace every occurrence instead of requiring uniqueness (default false).' },
    },
    required: ['path', 'oldString', 'newString'],
  },
  execute: async (rawArgs: any, context?: any) => {
    // Accept Claude-Code-style snake_case keys (file_path / old_string / new_string / replace_all)
    // as well as our camelCase schema — many models emit the former.
    const args: EditArgs = {
      path: rawArgs.path ?? rawArgs.file_path ?? rawArgs.filePath,
      oldString: rawArgs.oldString ?? rawArgs.old_string,
      newString: rawArgs.newString ?? rawArgs.new_string,
      replaceAll: rawArgs.replaceAll ?? rawArgs.replace_all,
    };
    const cwd = context?.cwd || process.cwd();
    const fullPath = resolvePath(args.path, cwd);

    if (args.oldString === args.newString) {
      return 'Error: newString must be different from oldString.';
    }
    if (!args.oldString) {
      return 'Error: oldString cannot be empty. To create a file, use WriteFileTool.';
    }

    let content: string;
    try {
      content = await fs.readFile(fullPath, 'utf8');
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return `Error: File not found: ${args.path}. Use WriteFileTool to create new files.`;
      }
      throw e;
    }

    // When a transaction is open, ANY failure after we've committed to attempting this edit must
    // roll the whole transaction back — that is the atomicity guarantee /tx promises. Outside a
    // transaction this just returns the message unchanged.
    const fail = async (msg: string, reason: string): Promise<string> => {
      if (globalTransactionManager.isOpen()) {
        const rbMsg = await globalTransactionManager.autoRollback(args.path, reason);
        return rbMsg ? `${msg}\n\n${rbMsg}` : msg;
      }
      return msg;
    };

    const occurrences = countOccurrences(content, args.oldString);

    // Resolve the old text to replace: prefer exact match, fall back to 9-step fuzzy chain.
    let resolvedOld = args.oldString;
    let matchMethod: string | null = null;

    if (occurrences === 0) {
      const fuzzy = findFuzzyMatch(content, args.oldString);
      if (!fuzzy) {
        return fail(
          `Error: oldString not found in ${args.path}. ` +
          `9-step fuzzy fallback also failed (TrimmedBoundary → LineTrimmed → WhitespaceNormalized → ` +
          `IndentationFlexible → EscapeNormalized → BlockAnchor → ContextAware → MultiOccurrence). ` +
          `Make sure oldString matches the file verbatim (including whitespace and indentation).`,
          'oldString not found',
        );
      }
      resolvedOld = fuzzy.resolvedOld;
      matchMethod = fuzzy.method;
    }

    const resolvedCount = countOccurrences(content, resolvedOld);
    if (resolvedCount > 1 && !args.replaceAll) {
      return fail(
        `Error: oldString appears ${resolvedCount} times in ${args.path}${matchMethod ? ` (matched via ${matchMethod})` : ''}. Add more surrounding context to make it unique, or pass replaceAll: true.`,
        'ambiguous oldString',
      );
    }

    const updated = args.replaceAll
      ? content.split(resolvedOld).join(args.newString)
      : content.replace(resolvedOld, args.newString);

    // Guard against the "flattened file" corruption (e.g. a whole-file oldString replaced by a
    // newline-stripped newString). Refuse before touching disk.
    const flat = detectCorruptWrite(content, updated, fullPath);
    if (flat) {
      return fail(
        `Edit to ${args.path} refused: ${flat}. No changes were made. ` +
        `Make a smaller, surgical edit and keep newline characters intact in newString.`,
        'corrupt-write refused',
      );
    }

    // Blast-radius gate (no-op unless enabled + interactive + the file owns a HIGH/CRITICAL symbol).
    if (!(await checkBlastRadius(fullPath))) {
      return fail(`Edit to ${args.path} cancelled — declined at the blast-radius gate. No changes were made.`, 'blast-radius declined');
    }

    // Inline diff approval. When a fuzzy match was used, surface the match method in the summary
    // so the user can see exactly how the approximate match was resolved before approving.
    const approvalSummary = matchMethod
      ? `Edit ${args.path} [APPROXIMATE MATCH via ${matchMethod}]`
      : `Edit ${args.path}`;
    const approved = await requestDiffApproval(approvalSummary, unifiedDiff(content, updated, args.path));
    if (!approved) return fail(`Edit to ${args.path} rejected by user. No changes were made.`, 'rejected by user');

    // Track original content for atomic rollback before touching disk.
    await globalTransactionManager.trackEdit(fullPath);
    // Snapshot first so /undo and /diff-file work on every agent edit.
    await backupFile(fullPath);
    try {
      await fs.writeFile(fullPath, updated, 'utf8');
    } catch (e: any) {
      return fail(`Edit to ${args.path} failed while writing: ${e.message}. No changes were applied.`, `write failed: ${e.message}`);
    }
    // Invalidate the read cache so post-compact restoration doesn't re-inject stale content.
    fileStateCache.invalidate(fullPath);

    const n = args.replaceAll ? resolvedCount : 1;
    const matchNote = matchMethod ? ` [matched via ${matchMethod}]` : '';
    const syntaxWarn = checkEditSyntax(fullPath, updated) || '';
    return `Edited ${args.path} (${n} replacement${n === 1 ? '' : 's'}${matchNote}):\n${capDiff(compactDiff(content, updated, args.path))}${syntaxWarn}`;
  },
}, governor);

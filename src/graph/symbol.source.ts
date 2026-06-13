import * as fs from 'fs/promises';
import * as path from 'path';
import { GraphNode } from './models';
import { sliceLineRange } from '../tools/file-range';

// Single source of truth for "read just this symbol's source from disk". Used by the
// READ_SYMBOL verb, the context planner, and @symbol mentions so the file-read + line-slice
// path exists exactly once (no duplication).

/**
 * Read the on-disk source for a single graph node, sliced to its recorded line range and
 * numbered. `filePath` may be absolute or relative to `cwd`. Returns `{ error }` when the
 * node lacks a range/path or the file can't be read — callers decide how to surface it.
 */
export async function readSymbolSource(
  node: GraphNode,
  cwd: string
): Promise<{ text?: string; error?: string }> {
  if (!node.filePath) return { error: `${node.id} has no file path on record.` };
  if (node.startLine == null || node.endLine == null) {
    return { error: `${node.id} has no recorded line range — re-run /index to populate symbol ranges.` };
  }
  const full = path.isAbsolute(node.filePath) ? node.filePath : path.resolve(cwd, node.filePath);
  try {
    const content = await fs.readFile(full, 'utf8');
    return sliceLineRange(content, node.startLine, node.endLine);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return { error: `file not found at ${node.filePath} — the graph may be stale, re-run /index.` };
    }
    return { error: e.message };
  }
}

import * as fs from 'fs';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { resolvePath } from '../path.util';

// Jupyter notebook editing — .ipynb files are JSON, so the plain Edit/Write tools would force the
// model to hand-splice a large JSON document (brittle, easy to corrupt outputs/metadata). This tool
// operates on CELLS by index instead: read the notebook's structure, then edit / insert / delete a
// cell while preserving every other cell's outputs and metadata. (Parity with Claude Code's
// NotebookEditTool.) Cell source is stored as a string[] of lines per the nbformat spec.

interface NbCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string[] | string;
  metadata?: any;
  outputs?: any[];
  execution_count?: number | null;
}
interface Notebook { cells: NbCell[]; metadata?: any; nbformat?: number; nbformat_minor?: number; }

/** nbformat stores source as an array of lines (each with its trailing \n) OR a single string. */
function cellText(c: NbCell): string {
  return Array.isArray(c.source) ? c.source.join('') : (c.source || '');
}
/** Split a source string back into the array-of-lines form nbformat expects (newlines retained). */
function toSourceLines(src: string): string[] {
  if (src === '') return [];
  const parts = src.split('\n');
  return parts.map((p, i) => (i < parts.length - 1 ? p + '\n' : p)).filter((_, i) => !(i === parts.length - 1 && parts[i] === ''));
}

function newCell(cellType: 'code' | 'markdown', src: string): NbCell {
  const base: NbCell = { cell_type: cellType, source: toSourceLines(src), metadata: {} };
  if (cellType === 'code') { base.outputs = []; base.execution_count = null; }
  return base;
}

export const createNotebookEditTool = (governor: IGovernor) => buildTool({
  name: 'NotebookEditTool',
  description: `Edit a Jupyter notebook (.ipynb) by CELL, preserving other cells' outputs and metadata. Prefer this over Edit/Write for notebooks — hand-splicing the JSON corrupts outputs.

# Actions (pass as \`action\`)
- \`read\` — list every cell: index, type (code/markdown), and a source preview.
- \`edit\` — replace cell \`cellIndex\`'s source with \`source\`. Clears that cell's stale outputs.
- \`insert\` — insert a new \`cellType\` (code|markdown) cell with \`source\` at \`cellIndex\` (default: end).
- \`delete\` — remove the cell at \`cellIndex\`.`,
  isDestructive: true, // edit/insert/delete rewrite the file — gate like any other write
  isConcurrencySafe: false,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['read', 'edit', 'insert', 'delete'], description: 'read | edit | insert | delete' },
      path: { type: 'string', description: 'Path to the .ipynb notebook file.' },
      cellIndex: { type: 'number', description: '0-based cell index. Required for edit/delete; optional for insert (defaults to appending at the end).' },
      source: { type: 'string', description: 'New cell source (for edit/insert).' },
      cellType: { type: 'string', enum: ['code', 'markdown'], description: 'Cell type for insert (default: code).' },
    },
    required: ['action', 'path'],
  },
  execute: async (args: { action: string; path: string; cellIndex?: number; source?: string; cellType?: 'code' | 'markdown' }, context?: any) => {
    const abs = resolvePath(args.path, context?.cwd || process.cwd());
    if (!fs.existsSync(abs)) return `Error: notebook not found: ${args.path}`;

    let nb: Notebook;
    try {
      nb = JSON.parse(fs.readFileSync(abs, 'utf-8'));
    } catch (e: any) {
      return `Error: ${args.path} is not valid JSON (a Jupyter notebook must be): ${e.message}`;
    }
    if (!Array.isArray(nb.cells)) return `Error: ${args.path} has no "cells" array — not a Jupyter notebook.`;

    const action = (args.action || '').toLowerCase();
    const n = nb.cells.length;

    if (action === 'read') {
      if (n === 0) return `${args.path}: empty notebook (0 cells).`;
      const rows = nb.cells.map((c, i) => {
        const text = cellText(c).replace(/\n/g, '⏎');
        const preview = text.length > 100 ? text.slice(0, 100) + '…' : text;
        return `[${i}] ${c.cell_type.padEnd(8)} ${preview}`;
      });
      return `${args.path} — ${n} cell(s):\n\n${rows.join('\n')}`;
    }

    const save = () => fs.writeFileSync(abs, JSON.stringify(nb, null, 1) + '\n', 'utf-8');
    const idx = args.cellIndex;

    if (action === 'edit') {
      if (idx == null || idx < 0 || idx >= n) return `Error: edit needs a valid cellIndex 0..${n - 1} (got ${idx}). Run \`read\` first.`;
      if (args.source == null) return 'Error: edit needs a `source` (the new cell contents).';
      nb.cells[idx].source = toSourceLines(args.source);
      if (nb.cells[idx].cell_type === 'code') { nb.cells[idx].outputs = []; nb.cells[idx].execution_count = null; }
      save();
      return `Edited cell [${idx}] of ${args.path} (its stale outputs were cleared).`;
    }

    if (action === 'insert') {
      const at = idx == null ? n : Math.max(0, Math.min(idx, n));
      const cell = newCell(args.cellType || 'code', args.source || '');
      nb.cells.splice(at, 0, cell);
      save();
      return `Inserted a ${cell.cell_type} cell at [${at}] of ${args.path} (now ${nb.cells.length} cells).`;
    }

    if (action === 'delete') {
      if (idx == null || idx < 0 || idx >= n) return `Error: delete needs a valid cellIndex 0..${n - 1} (got ${idx}).`;
      const removed = nb.cells.splice(idx, 1)[0];
      save();
      return `Deleted ${removed.cell_type} cell [${idx}] of ${args.path} (now ${nb.cells.length} cells).`;
    }

    return `Error: unknown action "${args.action}". Use one of: read, edit, insert, delete.`;
  },
}, governor);

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import wrapAnsi from 'wrap-ansi';
import { ThemeColors } from '../themes';

// Markdown table rendering, ported from Claude Code's src/components/MarkdownTable.tsx
// and adapted to Bimax's stock-Ink stack (CC's version depends on its custom Ink
// internals — Ansi/stringWidth/wrapAnsi/formatToken/padAligned/useTheme). The column
// sizing algorithm, box-drawing borders, and narrow-terminal vertical fallback are faithful.

/** Parent indentation + resize race headroom. Without it the table can overflow its
 *  layout box and Ink's clip truncates differently on alternating frames → flicker. */
const SAFETY_MARGIN = 6;
/** Minimum column width to prevent degenerate layouts. */
const MIN_COLUMN_WIDTH = 3;
/** Rows taller than this switch to the vertical (key: value) format. */
const MAX_ROW_LINES = 4;

type Align = 'left' | 'center' | 'right' | null;

interface TableCell { text: string; tokens?: any[]; }
export interface MarkedTableToken {
  type: 'table';
  header: TableCell[];
  rows: TableCell[][];
  align?: Align[];
}

/** Pad `text` to `width` columns honoring alignment. Width is string-width aware. */
function padAligned(text: string, width: number, align: Align): string {
  const w = stringWidth(text);
  if (w >= width) return text;
  const pad = width - w;
  if (align === 'right') return ' '.repeat(pad) + text;
  if (align === 'center') {
    const left = Math.floor(pad / 2);
    return ' '.repeat(left) + text + ' '.repeat(pad - left);
  }
  return text + ' '.repeat(pad);
}

/** Wrap to `width`, returning lines. `hard` breaks words longer than the column. */
function wrapText(text: string, width: number, hard = false): string[] {
  if (width <= 0) return [text];
  const wrapped = wrapAnsi(text.trimEnd(), width, { hard, trim: false, wordWrap: true });
  const lines = wrapped.split('\n').filter((l) => l.length > 0);
  return lines.length > 0 ? lines : [''];
}

const plain = (cell: TableCell | undefined): string => stripAnsi(cell?.text ?? '').replace(/\n+/g, ' ').trim();

function minWidthOf(cell: TableCell | undefined): number {
  const words = plain(cell).split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return MIN_COLUMN_WIDTH;
  return Math.max(...words.map((w) => stringWidth(w)), MIN_COLUMN_WIDTH);
}
const idealWidthOf = (cell: TableCell | undefined): number =>
  Math.max(stringWidth(plain(cell)), MIN_COLUMN_WIDTH);

interface Props {
  token: MarkedTableToken;
  theme: ThemeColors;
  /** Override terminal width (testing). */
  forceWidth?: number;
}

export function MarkdownTable({ token, theme, forceWidth }: Props) {
  const { stdout } = useStdout();
  const terminalWidth = forceWidth ?? stdout?.columns ?? 80;

  const numCols = token.header.length;
  if (numCols === 0) return null;

  // Step 1: per-column minimum (longest word) and ideal (full content) widths.
  const minWidths = token.header.map((h, c) => {
    let m = minWidthOf(h);
    for (const row of token.rows) m = Math.max(m, minWidthOf(row[c]));
    return m;
  });
  const idealWidths = token.header.map((h, c) => {
    let m = idealWidthOf(h);
    for (const row of token.rows) m = Math.max(m, idealWidthOf(row[c]));
    return m;
  });

  // Step 2: available content width after border overhead (│ + 2 pad + 1 border per col).
  const borderOverhead = 1 + numCols * 3;
  const availableWidth = Math.max(
    terminalWidth - borderOverhead - SAFETY_MARGIN,
    numCols * MIN_COLUMN_WIDTH,
  );

  // Step 3: distribute — perfect fit, proportional shrink, or proportional hard-wrap.
  const totalMin = minWidths.reduce((s, w) => s + w, 0);
  const totalIdeal = idealWidths.reduce((s, w) => s + w, 0);
  let needsHardWrap = false;
  let columnWidths: number[];
  if (totalIdeal <= availableWidth) {
    columnWidths = idealWidths;
  } else if (totalMin <= availableWidth) {
    const extraSpace = availableWidth - totalMin;
    const overflows = idealWidths.map((ideal, i) => ideal - minWidths[i]);
    const totalOverflow = overflows.reduce((s, o) => s + o, 0);
    columnWidths = minWidths.map((min, i) =>
      totalOverflow === 0 ? min : min + Math.floor((overflows[i] / totalOverflow) * extraSpace),
    );
  } else {
    needsHardWrap = true;
    const scale = availableWidth / totalMin;
    columnWidths = minWidths.map((w) => Math.max(Math.floor(w * scale), MIN_COLUMN_WIDTH));
  }

  // Step 4: if any row would wrap taller than MAX_ROW_LINES, fall back to vertical format.
  const maxRowLines = (() => {
    let max = 1;
    for (let i = 0; i < token.header.length; i++) {
      max = Math.max(max, wrapText(plain(token.header[i]), columnWidths[i], needsHardWrap).length);
    }
    for (const row of token.rows) {
      for (let i = 0; i < row.length; i++) {
        max = Math.max(max, wrapText(plain(row[i]), columnWidths[i], needsHardWrap).length);
      }
    }
    return max;
  })();

  const renderRowLines = (cells: TableCell[], isHeader: boolean): string[] => {
    const cellLines = cells.map((cell, c) => wrapText(plain(cell), columnWidths[c], needsHardWrap));
    const maxLines = Math.max(...cellLines.map((l) => l.length), 1);
    const offsets = cellLines.map((l) => Math.floor((maxLines - l.length) / 2));
    const result: string[] = [];
    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      let line = '│';
      for (let c = 0; c < cells.length; c++) {
        const idx = lineIdx - offsets[c];
        const text = idx >= 0 && idx < cellLines[c].length ? cellLines[c][idx] : '';
        const align: Align = isHeader ? 'center' : token.align?.[c] ?? 'left';
        line += ' ' + padAligned(text, columnWidths[c], align) + ' │';
      }
      result.push(line);
    }
    return result;
  };

  const renderBorderLine = (type: 'top' | 'middle' | 'bottom'): string => {
    const [left, mid, cross, right] = {
      top: ['┌', '─', '┬', '┐'],
      middle: ['├', '─', '┼', '┤'],
      bottom: ['└', '─', '┴', '┘'],
    }[type];
    let line = left;
    columnWidths.forEach((w, c) => {
      line += mid.repeat(w + 2);
      line += c < columnWidths.length - 1 ? cross : right;
    });
    return line;
  };

  const renderVerticalFormat = (): string => {
    const lines: string[] = [];
    const headers = token.header.map((h) => plain(h));
    const sep = '─'.repeat(Math.min(terminalWidth - 1, 40));
    token.rows.forEach((row, rowIndex) => {
      if (rowIndex > 0) lines.push(sep);
      row.forEach((cell, c) => {
        const label = headers[c] || `Column ${c + 1}`;
        const value = plain(cell);
        const firstLineWidth = Math.max(terminalWidth - stringWidth(label) - 3, 10);
        const wrapped = wrapText(value, firstLineWidth);
        lines.push(`${label}: ${wrapped[0] || ''}`);
        for (let i = 1; i < wrapped.length; i++) {
          if (wrapped[i].trim()) lines.push(`  ${wrapped[i]}`);
        }
      });
    });
    return lines.join('\n');
  };

  // Each line is rendered as its own non-wrapping <Text> so Ink never re-wraps mid-row.
  const block = (text: string, color = theme.subtle) => (
    <Text color={color} wrap="truncate-end">{text}</Text>
  );

  if (maxRowLines > MAX_ROW_LINES) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        {renderVerticalFormat().split('\n').map((l, i) => (
          <Text key={i} color={theme.text} wrap="truncate-end">{l}</Text>
        ))}
      </Box>
    );
  }

  const headerLines = renderRowLines(token.header, true);
  const rowBlocks = token.rows.map((row) => renderRowLines(row, false));

  // Safety: if computed lines still exceed the terminal width (resize race), go vertical.
  const allLines = [renderBorderLine('top'), ...headerLines, renderBorderLine('middle'),
    ...rowBlocks.flat(), renderBorderLine('bottom')];
  const maxLineWidth = Math.max(...allLines.map((l) => stringWidth(stripAnsi(l))));
  if (maxLineWidth > terminalWidth - SAFETY_MARGIN) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        {renderVerticalFormat().split('\n').map((l, i) => (
          <Text key={i} color={theme.text} wrap="truncate-end">{l}</Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {block(renderBorderLine('top'))}
      {headerLines.map((l, i) => <Text key={`h${i}`} color={theme.accent} bold wrap="truncate-end">{l}</Text>)}
      {block(renderBorderLine('middle'))}
      {rowBlocks.map((lines, r) => (
        <React.Fragment key={`r${r}`}>
          {lines.map((l, i) => <Text key={i} color={theme.text} wrap="truncate-end">{l}</Text>)}
          {r < rowBlocks.length - 1 && block(renderBorderLine('middle'))}
        </React.Fragment>
      ))}
      {block(renderBorderLine('bottom'))}
    </Box>
  );
}

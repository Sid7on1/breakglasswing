import React from 'react';
import { cn } from '../lib/cn';

/**
 * Unified-diff renderer for the Review panel. Word-level emphasis follows the TUI's approach:
 * paired removed/added lines (equal-length runs inside a hunk) get their common prefix/suffix
 * trimmed and only the differing middle painted at full strength.
 */

type Row =
  | { kind: 'hunk'; text: string }
  | { kind: 'ctx' | 'add' | 'del'; oldNo: number | null; newNo: number | null; text: string; hi?: [number, number] };

function commonAffix(a: string, b: string): [number, number] {
  let pre = 0;
  const max = Math.min(a.length, b.length);
  while (pre < max && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < max - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return [pre, suf];
}

export function parseDiff(diff: string): Row[] {
  const rows: Row[] = [];
  let oldNo = 0;
  let newNo = 0;
  // Buffered -/+ runs per hunk section so equal-length runs can be word-paired.
  let dels: Row[] = [];
  let adds: Row[] = [];

  const flush = (): void => {
    if (dels.length === adds.length && dels.length > 0) {
      for (let i = 0; i < dels.length; i++) {
        const [pre, suf] = commonAffix(dels[i].text as string, adds[i].text as string);
        if (pre + suf > 0) {
          (dels[i] as Row & { hi?: [number, number] }).hi = [pre, (dels[i].text as string).length - suf];
          (adds[i] as Row & { hi?: [number, number] }).hi = [pre, (adds[i].text as string).length - suf];
        }
      }
    }
    rows.push(...dels, ...adds);
    dels = [];
    adds = [];
  };

  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      flush();
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
        rows.push({ kind: 'hunk', text: m[3].trim() });
      }
      continue;
    }
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ')
      || line.startsWith('+++ ') || line.startsWith('new file') || line.startsWith('deleted file')
      || line.startsWith('similarity ') || line.startsWith('rename ') || line.startsWith('Binary files')
      || line.startsWith('old mode') || line.startsWith('new mode') || line.startsWith('\\')) {
      if (line.startsWith('Binary files')) { flush(); rows.push({ kind: 'hunk', text: 'binary file' }); }
      continue;
    }
    if (line.startsWith('-')) { dels.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: line.slice(1) }); continue; }
    if (line.startsWith('+')) { adds.push({ kind: 'add', oldNo: null, newNo: newNo++, text: line.slice(1) }); continue; }
    flush();
    if (line.startsWith(' ') || line === '') {
      rows.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
  }
  flush();
  return rows;
}

function LineText({ text, hi, strong }: { text: string; hi?: [number, number]; strong: string }): React.ReactElement {
  if (!hi || hi[0] >= hi[1]) return <>{text || ' '}</>;
  return (
    <>
      {text.slice(0, hi[0])}
      <span className={strong}>{text.slice(hi[0], hi[1])}</span>
      {text.slice(hi[1])}
    </>
  );
}

export function DiffView({ diff }: { diff: string }): React.ReactElement {
  const rows = parseDiff(diff);
  if (rows.length === 0) {
    return <div className="p-4 text-xs text-faint">No changes.</div>;
  }
  const additions = rows.filter((row) => row.kind === 'add').length;
  const deletions = rows.filter((row) => row.kind === 'del').length;
  const hunks = rows.filter((row) => row.kind === 'hunk').length;
  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-well">
      <div className="flex items-center gap-3 border-b border-line bg-raise/70 px-3 py-2 text-[10.5px]">
        <span className="font-medium text-dim">{hunks} hunk{hunks === 1 ? '' : 's'}</span>
        <span className="font-mono text-moss">+{additions}</span>
        <span className="font-mono text-rust">−{deletions}</span>
        <span className="ml-auto text-faint">Word-level changes highlighted</span>
      </div>
      <div className="overflow-x-auto font-mono text-[11.5px] leading-[1.7]">
      <table className="w-max min-w-full border-collapse">
        <tbody>
          {rows.map((r, i) =>
            r.kind === 'hunk' ? (
              <tr key={i}>
                <td colSpan={3} className="bg-raise px-3 py-0.5 text-[10.5px] text-faint select-none">
                  ⋯ {r.text}
                </td>
              </tr>
            ) : (
              <tr
                key={i}
                className={cn(
                  r.kind === 'add' && 'bg-moss/10',
                  r.kind === 'del' && 'bg-rust/10',
                )}
              >
                <td className="w-9 min-w-9 pr-1 text-right align-top text-[10px] text-faint tabular-nums select-none">
                  {r.oldNo ?? ''}
                </td>
                <td className="w-9 min-w-9 border-r border-line pr-1.5 text-right align-top text-[10px] text-faint tabular-nums select-none">
                  {r.newNo ?? ''}
                </td>
                <td className={cn(
                  'py-0 pr-3 pl-2 whitespace-pre',
                  r.kind === 'add' && 'text-moss',
                  r.kind === 'del' && 'text-rust',
                  r.kind === 'ctx' && 'text-dim',
                )}>
                  <span className="mr-1.5 select-none">{r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}</span>
                  <LineText
                    text={r.text}
                    hi={r.hi}
                    strong={r.kind === 'add' ? 'rounded-[2px] bg-moss/25' : 'rounded-[2px] bg-rust/25'}
                  />
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

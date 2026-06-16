import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ToolCallEntry } from '../events';
import { ThemeColors } from '../themes';
import { formatDuration, toolDurationMs } from '../format';

const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function InlineSpinner({ color }: { color: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % SPIN_FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return <Text color={color}>{SPIN_FRAMES[frame]}</Text>;
}

// Short display names so tool lines read like actions, not class names
const TOOL_LABELS: Record<string, string> = {
  BashTool: 'Bash',
  ReadFileTool: 'Read',
  WriteFileTool: 'Write',
  EditFileTool: 'Edit',
  MultiEditTool: 'MultiEdit',
  DeleteTool: 'Delete',
  CreateDirectoryTool: 'mkdir',
  ChangeDirectoryTool: 'cd',
  GrepTool: 'Grep',
  GlobTool: 'Glob',
  WebFetchTool: 'Fetch',
  TodoWriteTool: 'Todo',
  GraphQueryTool: 'Graph',
  MemoryQueryTool: 'Memory',
  SpawnSubagentTool: 'Subagent',
  RegisterAgentTool: 'RegisterAgent',
  AskUserTool: 'Ask',
  SkillTool: 'Skill',
  McpManageTool: 'MCP',
};

function summarizeInput(call: ToolCallEntry): string {
  try {
    const parsed = JSON.parse(call.input);
    const candidate = parsed.command || parsed.filePath || parsed.path || parsed.pattern || parsed.glob || parsed.url || parsed.query || parsed.question || parsed.directory || parsed.name || parsed.action;
    if (typeof candidate === 'string') {
      return candidate.length > 70 ? candidate.slice(0, 67) + '…' : candidate;
    }
    const compact = JSON.stringify(parsed);
    return compact === '{}' ? '' : compact.slice(0, 70);
  } catch {
    return call.input.slice(0, 70).replace(/\n/g, ' ');
  }
}

function summarizeOutput(call: ToolCallEntry): string {
  const out = (call.toolName === 'BashTool' ? bashText(call) : (call.output || '').trim());
  if (!out) return call.status === 'success' ? 'Done' : '';
  const firstLine = out.split('\n')[0];
  const lineCount = out.split('\n').length;
  const preview = firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine;
  return lineCount > 1 ? `${preview} (+${lineCount - 1} lines)` : preview;
}

/**
 * Claude-Code-style "Added N lines, removed M lines" summary for edit/write tools, computed from
 * the call's arguments (oldString/newString or content). Returns null for non-edit tools so the
 * generic output summary is used instead.
 */
function editStats(call: ToolCallEntry): string | null {
  const lines = (s: any) => (typeof s === 'string' && s.length ? s.split('\n').length : 0);
  let added = 0;
  let removed = 0;
  try {
    const p = JSON.parse(call.input);
    if (call.toolName === 'EditFileTool') {
      added = lines(p.newString); removed = lines(p.oldString);
    } else if (call.toolName === 'WriteFileTool') {
      added = lines(p.content);
    } else if (call.toolName === 'MultiEditTool' && Array.isArray(p.edits)) {
      for (const e of p.edits) { added += lines(e.newString); removed += lines(e.oldString); }
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (added === 0 && removed === 0) return null;
  const parts: string[] = [];
  if (added) parts.push(`Added ${added} line${added === 1 ? '' : 's'}`);
  if (removed) parts.push(`removed ${removed} line${removed === 1 ? '' : 's'}`);
  return parts.join(', ');
}

const DIFF_TOOLS = new Set(['EditFileTool', 'WriteFileTool', 'MultiEditTool']);
const OUTPUT_BLOCK_TOOLS = new Set(['BashTool', 'GrepTool', 'GlobTool']);
const MAX_DIFF_LINES = 40;
const MAX_OUTPUT_LINES = 14;
const trunc = (s: string, n = 116) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

interface DiffRow { kind: 'ctx' | 'add' | 'del'; n: number; text: string; }

/**
 * Parse the compact unified diff the edit/write tools now emit (`@@ -a,b +c,d @@` hunks with
 * ` `/`-`/`+` lines) into rows carrying their ABSOLUTE file line number, so we can render it like
 * Claude Code: dim line numbers, white context, green additions, red removals.
 */
function parseUnifiedDiff(output: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0, newNo = 0, inHunk = false;
  for (const line of output.split('\n')) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { oldNo = parseInt(h[1], 10); newNo = parseInt(h[2], 10); inHunk = true; continue; }
    if (!inHunk || line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    if (line.startsWith('+')) { rows.push({ kind: 'add', n: newNo++, text: line.slice(1) }); }
    else if (line.startsWith('-')) { rows.push({ kind: 'del', n: oldNo++, text: line.slice(1) }); }
    else if (line.startsWith(' ')) { rows.push({ kind: 'ctx', n: newNo++, text: line.slice(1) }); oldNo++; }
    else { inHunk = false; } // left the hunk body (e.g. the "…(N more)" cap line)
  }
  return rows;
}

/** BashTool returns {stdout, stderr} as JSON — show the real output, not the wrapper. */
function bashText(call: ToolCallEntry): string {
  try {
    const o = JSON.parse(call.output);
    if (o && typeof o === 'object' && ('stdout' in o || 'stderr' in o)) {
      const parts: string[] = [];
      if (o.stdout) parts.push(String(o.stdout));
      if (o.stderr) parts.push(String(o.stderr));
      return parts.join('\n').trim();
    }
  } catch { /* not JSON — use raw */ }
  return (call.output || '').trim();
}

interface ToolCallLineProps {
  call: ToolCallEntry;
  theme: ThemeColors;
  /** Compact = header + one summary line (used in the live region to keep height stable).
   *  Full (default) renders the rich diff / output block in the committed transcript. */
  compact?: boolean;
}

export function ToolCallLine({ call, theme, compact = false }: ToolCallLineProps) {
  const isError = call.status === 'error';
  const isRunning = call.status === 'running';
  const dotColor = isError ? theme.error : isRunning ? theme.warning : theme.success;
  const label = TOOL_LABELS[call.toolName] || call.toolName.replace(/Tool$/, '');
  const input = summarizeInput(call);
  // For successful edits, the "Added N / removed M lines" stat is the headline summary.
  const summary = (!isError && editStats(call)) || summarizeOutput(call);

  // Per-tool timing badge (Claude Code style): shown once the call finishes. The
  // duration is already tracked on the entry (startTime/endTime) — we just format it.
  const durMs = toolDurationMs(call);
  const timing = !isRunning && durMs !== null ? formatDuration(durMs) : null;

  const header = (
    <Box>
      <Text color={dotColor}>⏺ </Text>
      <Text color={theme.text} bold>{label}</Text>
      <Text color={theme.subtle}>({input})</Text>
      {isRunning && (
        <Box marginLeft={1}>
          <InlineSpinner color={theme.warning} />
        </Box>
      )}
      {timing && <Text color={theme.subtle}> · {timing}</Text>}
    </Box>
  );

  // Compact / running / error: header + a single summary line (original behavior).
  if (compact || isRunning || isError) {
    return (
      <Box flexDirection="column">
        {header}
        {!isRunning && summary ? (
          <Box marginLeft={2}>
            <Text color={theme.subtle}>⎿ </Text>
            <Text color={isError ? theme.error : theme.inactive}>{summary}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  // Full transcript rendering: line-numbered colored diff for edits, dim output block otherwise.
  if (DIFF_TOOLS.has(call.toolName)) {
    const rows = parseUnifiedDiff(call.output || '');
    const shown = rows.slice(0, MAX_DIFF_LINES);
    const hidden = rows.length - shown.length;
    const numW = Math.max(2, ...shown.map(r => String(r.n).length));
    return (
      <Box flexDirection="column">
        {header}
        <Box marginLeft={2}>
          <Text color={theme.subtle}>⎿ </Text>
          <Text color={theme.inactive}>{summary}</Text>
        </Box>
        {shown.length > 0 && (
          <Box flexDirection="column" marginLeft={4}>
            {shown.map((r, i) => {
              const sign = r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' ';
              const color = r.kind === 'add' ? theme.success : r.kind === 'del' ? theme.error : theme.text;
              return (
                <Box key={i}>
                  <Text color={theme.subtle}>{String(r.n).padStart(numW)} </Text>
                  <Text color={color}>{sign} {trunc(r.text)}</Text>
                </Box>
              );
            })}
            {hidden > 0 && <Text color={theme.subtle}>… {hidden} more line{hidden === 1 ? '' : 's'}</Text>}
          </Box>
        )}
      </Box>
    );
  }

  if (OUTPUT_BLOCK_TOOLS.has(call.toolName) && summary) {
    const text = call.toolName === 'BashTool' ? bashText(call) : (call.output || '').trim();
    const lines = text.split('\n');
    const shown = lines.slice(0, MAX_OUTPUT_LINES);
    const hidden = lines.length - shown.length;
    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection="column" marginLeft={2}>
          {shown.map((l, i) => (
            <Box key={i}>
              <Text color={theme.subtle}>{i === 0 ? '⎿ ' : '  '}</Text>
              <Text color={theme.inactive}>{trunc(l)}</Text>
            </Box>
          ))}
          {hidden > 0 && <Text color={theme.subtle}>  … {hidden} more line{hidden === 1 ? '' : 's'}</Text>}
        </Box>
      </Box>
    );
  }

  // Everything else: header + single summary line.
  return (
    <Box flexDirection="column">
      {header}
      {summary ? (
        <Box marginLeft={2}>
          <Text color={theme.subtle}>⎿ </Text>
          <Text color={theme.inactive}>{summary}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

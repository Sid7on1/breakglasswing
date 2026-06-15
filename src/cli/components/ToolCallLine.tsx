import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ToolCallEntry } from '../events';
import { ThemeColors } from '../themes';

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
  const out = (call.output || '').trim();
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

interface ToolCallLineProps {
  call: ToolCallEntry;
  theme: ThemeColors;
}

export function ToolCallLine({ call, theme }: ToolCallLineProps) {
  const isError = call.status === 'error';
  const isRunning = call.status === 'running';
  const dotColor = isError ? theme.error : isRunning ? theme.warning : theme.success;
  const label = TOOL_LABELS[call.toolName] || call.toolName.replace(/Tool$/, '');
  const input = summarizeInput(call);
  // For successful edits, prefer the "Added N / removed M lines" diff stat (Claude Code style).
  const output = (!isError && editStats(call)) || summarizeOutput(call);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={dotColor}>⏺ </Text>
        <Text color={theme.text} bold>{label}</Text>
        <Text color={theme.subtle}>({input})</Text>
        {isRunning && (
          <Box marginLeft={1}>
            <InlineSpinner color={theme.warning} />
          </Box>
        )}
      </Box>
      {!isRunning && output ? (
        <Box marginLeft={2}>
          <Text color={theme.subtle}>⎿ </Text>
          <Text color={isError ? theme.error : theme.inactive}>{output}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

import React from 'react';
import { Box, Text } from 'ink';
import { ThemeColors } from '../themes';

interface DashboardProps {
  theme: ThemeColors;
  payload?: any;
}

export function HelpDashboard({ theme }: DashboardProps) {
  const sections = [
    {
      title: 'Session & Context',
      color: theme.accent,
      commands: [
        { cmd: '/sessions', desc: 'List saved sessions' },
        { cmd: '/resume', desc: 'Resume a session' },
        { cmd: '/clear', desc: 'Clear screen' },
        { cmd: '/cost', desc: 'Show session cost & usage' },
        { cmd: '/context', desc: 'Show current context' },
      ],
    },
    {
      title: 'Configuration',
      color: theme.warning,
      commands: [
        { cmd: '/config', desc: 'Show/set config' },
        { cmd: '/keys', desc: 'Show/add API keys' },
        { cmd: '/model', desc: 'Show current model' },
        { cmd: '/provider', desc: 'Switch provider' },
        { cmd: '/agents', desc: 'List agent personas' },
        { cmd: '/routes', desc: 'List/add/remove routes' },
        { cmd: '/governor', desc: 'Toggle Governor' },
      ],
    },
    {
      title: 'Code & Intelligence',
      color: theme.success,
      commands: [
        { cmd: '/index', desc: 'Build AST codebase index' },
        { cmd: '/index-ai', desc: 'Run Semantic AI index' },
        { cmd: '/check', desc: 'Type check (tsc)' },
        { cmd: '/lint', desc: 'Run ESLint' },
        { cmd: '/edit', desc: 'Search & replace' },
        { cmd: '/write', desc: 'Write file to disk' },
        { cmd: '/undo', desc: 'Undo last edit' },
        { cmd: '/diff-file', desc: 'Show file diff' },
      ],
    },
    {
      title: 'Source Control',
      color: theme.subtle || theme.inactive,
      commands: [
        { cmd: '/git', desc: 'Git status' },
        { cmd: '/diff', desc: 'Git diff' },
        { cmd: '/log', desc: 'Git log' },
        { cmd: '/backups', desc: 'List backups' },
      ],
    },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} width={80}>
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color={theme.accent}>BiMAX Command Palette</Text>
      </Box>
      <Box flexDirection="row">
        {/* Left Column */}
        <Box flexDirection="column" width="50%" paddingRight={2}>
          {sections.slice(0, 2).map((sec, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text bold color={sec.color}>{sec.title}</Text>
              {sec.commands.map((c, j) => (
                <Box key={j} flexDirection="row">
                  <Box width={14}><Text color={theme.accent}>{c.cmd}</Text></Box>
                  <Text color={theme.inactive}>{c.desc}</Text>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
        {/* Right Column */}
        <Box flexDirection="column" width="50%" paddingRight={2}>
          {sections.slice(2, 4).map((sec, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text bold color={sec.color}>{sec.title}</Text>
              {sec.commands.map((c, j) => (
                <Box key={j} flexDirection="row">
                  <Box width={14}><Text color={theme.accent}>{c.cmd}</Text></Box>
                  <Text color={theme.inactive}>{c.desc}</Text>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
      <Box marginTop={1} paddingTop={1} borderStyle="single" borderColor={theme.border}>
        <Text color={theme.inactive}>
          <Text bold color={theme.warning}>Shortcuts:</Text> ↑/↓ (Navigate), Enter (Select), Esc (Stash), Ctrl+R (Resume), Ctrl+F (Search), Ctrl+O (Toggle logs)
        </Text>
      </Box>
    </Box>
  );
}

export function StatsDashboard({ theme, payload }: DashboardProps) {
  const { type, items } = payload || { type: 'Stats', items: [] };
  
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={2} width={60}>
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color={theme.accent}>{type} Dashboard</Text>
      </Box>
      {items.map((item: any, i: number) => (
        <Box key={i} flexDirection="row" justifyContent="space-between">
          <Text color={theme.text}>{item.label}</Text>
          <Text color={theme.accent} bold>{item.value}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function DataTableDashboard({ theme, payload }: DashboardProps) {
  const { title, headers, rows } = payload || { title: 'Data', headers: [], rows: [] };
  
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      {title && (
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color={theme.accent}>{title}</Text>
        </Box>
      )}
      {headers && headers.length > 0 && (
        <Box flexDirection="row" borderStyle="single" borderColor={theme.border} paddingBottom={1} marginBottom={1}>
          {headers.map((h: string, i: number) => (
            <Box key={i} width={i === 0 ? 15 : 30}>
              <Text bold color={theme.text}>{h}</Text>
            </Box>
          ))}
        </Box>
      )}
      {rows.map((row: string[], i: number) => (
        <Box key={i} flexDirection="row">
          {row.map((cell: string, j: number) => (
            <Box key={j} width={j === 0 ? 15 : 30}>
              <Text color={theme.accent}>{cell}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

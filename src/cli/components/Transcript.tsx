import React from 'react';
import { Box, Text } from 'ink';
import { MessageEntry, ToolCallEntry } from '../events';
import { ThemeColors } from '../themes';
import { SearchHighlight } from './SearchHighlight';
import { Markdown } from './Markdown';

interface TranscriptProps {
  messages: MessageEntry[];
  theme: ThemeColors;
  searchQuery: string;
}

function ToolCallBlock({ call, theme }: { call: ToolCallEntry; theme: ThemeColors }) {
  const isError = call.status === 'error';
  const statusColor = call.status === 'success' ? theme.success
    : isError ? theme.error
    : theme.warning;

  let displayCommand = '';
  try {
    const parsed = JSON.parse(call.input);
    if (call.toolName === 'BashTool' && parsed.command) {
      displayCommand = parsed.command;
    } else if ((call.toolName === 'WriteFileTool' || call.toolName === 'ReadFileTool') && parsed.filePath) {
      displayCommand = parsed.filePath.split('/').pop() || parsed.filePath;
    } else {
      displayCommand = call.input.substring(0, 60).replace(/\n/g, ' ');
    }
  } catch {
    displayCommand = call.input.substring(0, 60).replace(/\n/g, ' ');
  }

  const icon = call.toolName === 'BashTool' ? '⚡'
    : call.toolName === 'WriteFileTool' ? '📝'
    : call.toolName === 'ReadFileTool' ? '👀'
    : '🔧';

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color={statusColor} bold>
          {'  ⎿ '}{icon} {call.toolName.replace('Tool', '')}
        </Text>
        <Text color={theme.subtle}>
          {' '}· {displayCommand}
        </Text>
        <Text color={theme.inactive}>
          {' '}{call.status === 'success' ? '✓' : call.status === 'error' ? '✗' : '...'}
        </Text>
      </Box>
      {isError && call.output && (
        <Box marginLeft={4} borderStyle="round" borderColor={theme.error} paddingX={1}>
          <Text color={theme.error}>{call.output.substring(0, 200)}</Text>
        </Box>
      )}
    </Box>
  );
}

import { HelpDashboard, StatsDashboard, DataTableDashboard } from './Dashboards';

export function Transcript({ messages, theme, searchQuery }: TranscriptProps) {
  if (messages.length === 0) return null;

  return (
    <Box flexDirection="column">
      {messages.map((msg) => (
        <Box
          key={msg.id}
          flexDirection="column"
          marginTop={1}
          paddingX={1}
          paddingY={1}
        >
          {msg.role === 'user' ? (
            <Box paddingX={1} paddingTop={1} flexDirection="column">
              <Markdown theme={theme}>{typeof msg.content === 'string' ? msg.content : ''}</Markdown>
            </Box>
          ) : msg.role === 'assistant' ? (
            <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} paddingBottom={1} width="100%">
              <Text bold color={theme.accent}>Assistant</Text>
              <Box marginTop={1}>
                <Markdown theme={theme}>{typeof msg.content === 'string' ? msg.content : ''}</Markdown>
              </Box>
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                  {msg.toolCalls.map((tc) => (
                    <ToolCallBlock key={tc.id} call={tc} theme={theme} />
                  ))}
                </Box>
              )}
            </Box>
          ) : (
            <Box>
              {msg.uiComponent === 'HelpDashboard' ? (
                <HelpDashboard theme={theme} payload={msg.payload} />
              ) : msg.uiComponent === 'StatsDashboard' ? (
                <StatsDashboard theme={theme} payload={msg.payload} />
              ) : msg.uiComponent === 'DataTableDashboard' ? (
                <DataTableDashboard theme={theme} payload={msg.payload} />
              ) : (
                <Text color={
                  msg.level === 'error' ? theme.error :
                  msg.level === 'success' ? theme.success :
                  msg.level === 'warn' ? theme.warning :
                  msg.level === 'info' ? theme.accent :
                  theme.inactive
                } bold={['error', 'success', 'warn'].includes(msg.level || '')}>
                  <SearchHighlight text={msg.content as string} query={searchQuery} theme={theme} />
                </Text>
              )}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

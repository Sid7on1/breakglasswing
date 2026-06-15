import React from 'react';
import { Box, Text } from 'ink';
import { MessageEntry } from '../events';
import { ThemeColors } from '../themes';
import { SearchHighlight } from './SearchHighlight';
import { Markdown } from './Markdown';
import { ToolCallLine } from './ToolCallLine';
import { HelpDashboard, StatsDashboard, DataTableDashboard } from './Dashboards';

interface TranscriptProps {
  messages: MessageEntry[];
  theme: ThemeColors;
  searchQuery: string;
}

interface MessageRowProps {
  msg: MessageEntry;
  theme: ThemeColors;
  searchQuery?: string;
}

/** Renders one transcript entry. Used inside Ink's <Static> region. */
export function MessageRow({ msg, theme, searchQuery = '' }: MessageRowProps) {
  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      {msg.role === 'user' ? (
        <Box flexDirection="row">
          <Text color={theme.accent} bold>❯ </Text>
          <Text color={theme.inactive}>{typeof msg.content === 'string' ? msg.content : ''}</Text>
        </Box>
      ) : msg.role === 'assistant' ? (
        <Box flexDirection="column">
          {typeof msg.thoughtMs === 'number' && msg.thoughtMs >= 500 && (
            <Text color={theme.subtle}>✻ Thought for {Math.round(msg.thoughtMs / 1000)}s</Text>
          )}
          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              {msg.toolCalls.map((tc) => (
                <ToolCallLine key={tc.id} call={tc} theme={theme} />
              ))}
            </Box>
          )}
          {typeof msg.content === 'string' && msg.content.trim() ? (
            <Box flexDirection="row">
              <Text color={theme.accent}>● </Text>
              <Box flexDirection="column" flexGrow={1}>
                <Markdown theme={theme}>{msg.content}</Markdown>
              </Box>
            </Box>
          ) : null}
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
              msg.level === 'info' ? theme.info :
              theme.inactive
            }>
              <SearchHighlight text={msg.content as string} query={searchQuery} theme={theme} />
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

export function Transcript({ messages, theme, searchQuery }: TranscriptProps) {
  if (messages.length === 0) return null;

  return (
    <Box flexDirection="column">
      {messages.map((msg) => (
        <MessageRow key={msg.id} msg={msg} theme={theme} searchQuery={searchQuery} />
      ))}
    </Box>
  );
}

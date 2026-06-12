import React from 'react';
import { Box, Text } from 'ink';
import { LogEntry } from '../events';
import { ThemeColors } from '../themes';
import { SearchHighlight } from './SearchHighlight';

interface LogViewProps {
  logs: LogEntry[];
  theme: ThemeColors;
  searchQuery?: string;
}

export function LogView({ logs, theme, searchQuery }: LogViewProps) {
  const displayLogs = logs.slice(-50); // Show last 50 logs to prevent memory/render limits

  if (displayLogs.length === 0) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" height={10}>
        <Text color={theme.subtle}>No logs available yet.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={theme.border}>
      <Box flexDirection="row" borderStyle="single" borderColor={theme.subtle} paddingBottom={1} marginBottom={1}>
        <Box width={12}><Text color={theme.accent} bold>TIME</Text></Box>
        <Box width={10}><Text color={theme.accent} bold>LEVEL</Text></Box>
        <Box flexGrow={1}><Text color={theme.accent} bold>MESSAGE</Text></Box>
      </Box>

      {displayLogs.map((log) => {
        const timeStr = typeof log.timestamp === 'string' ? new Date(log.timestamp).toLocaleTimeString() : log.timestamp.toLocaleTimeString();
        const levelColor = log.level === 'error' ? theme.error
          : log.level === 'warn' ? theme.warning
          : log.level === 'success' ? theme.success
          : theme.text;
          
        return (
          <Box key={`${log.id}`} flexDirection="row" marginBottom={1}>
            <Box width={12}>
              <Text color={theme.subtle}>{timeStr}</Text>
            </Box>
            <Box width={10}>
              <Text color={levelColor} bold>{log.level.toUpperCase()}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={levelColor}>
                {searchQuery ? (
                  <SearchHighlight text={log.text} query={searchQuery} theme={theme} />
                ) : (
                  log.text
                )}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

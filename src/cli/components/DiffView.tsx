import React from 'react';
import { Box, Text } from 'ink';
import { ThemeColors } from '../themes';

interface DiffViewProps {
  diffText: string;
  theme: ThemeColors;
}

interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'header' | 'hunk';
  content: string;
}

function parseDiff(diffText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) {
      lines.push({ type: 'header', content: line });
    } else if (line.startsWith('@@')) {
      lines.push({ type: 'hunk', content: line });
    } else if (line.startsWith('+')) {
      lines.push({ type: 'added', content: line });
    } else if (line.startsWith('-')) {
      lines.push({ type: 'removed', content: line });
    } else {
      lines.push({ type: 'context', content: line });
    }
  }
  return lines;
}

export function DiffView({ diffText, theme }: DiffViewProps) {
  const lines = parseDiff(diffText);

  return (
    <Box flexDirection="column" marginLeft={2}>
      {lines.map((line, i) => {
        switch (line.type) {
          case 'header':
            return <Box key={i}><Text color={theme.subtle}>{line.content}</Text></Box>;
          case 'hunk':
            return <Box key={i}><Text color={theme.info}>{line.content}</Text></Box>;
          case 'added':
            return (
              <Box key={i} paddingX={1}>
                <Text color={theme.diffAddedWord} backgroundColor={theme.diffAddedDimmed}>{line.content}</Text>
              </Box>
            );
          case 'removed':
            return (
              <Box key={i} paddingX={1}>
                <Text color={theme.diffRemovedWord} backgroundColor={theme.diffRemovedDimmed}>{line.content}</Text>
              </Box>
            );
          default:
            return <Box key={i} paddingX={1}><Text color={theme.inactive}>{line.content}</Text></Box>;
        }
      })}
    </Box>
  );
}

import React from 'react';
import { Box, Text } from 'ink';
import { ThemeColors } from '../themes';

interface StatusLineProps {
  theme: ThemeColors;
  model: string;
  governorBypassed: boolean;
  streamMeta?: { chars: number; elapsed: number };
}

export function StatusLine({ theme, model, governorBypassed, streamMeta }: StatusLineProps) {
  const cleanModel = model.split('/').pop() || model;
  const governorStatus = governorBypassed ? '⚡ YOLO (Bypassed)' : '🛡️ Governor ON';
  const cwd = process.cwd();

  return (
    <Box flexDirection="row" paddingX={1} paddingBottom={1} width="100%" alignItems="center">
      <Box marginRight={3} flexDirection="column">
        <Text color={theme.accent} bold>▗▄▄▄▖ ▗▄▄▄▖ ▗▖  ▗▖  ▗▄▖  ▗▖  ▗▖</Text>
        <Text color={theme.accent} bold>▐▌  █   █   ▐▛▚▞▜▌ ▐▌ ▐▌  ▝▚▞▘ </Text>
        <Text color={theme.accent} bold>▐▛▀▀▜   █   ▐▌  ▐▌ ▐▛▀▜▌   ▐▌  </Text>
        <Text color={theme.accent} bold>▐▌▄▄▟ ▗▄█▄▖ ▐▌  ▐▌ ▐▌ ▐▌ ▗▞▘▝▚▖</Text>
      </Box>
      
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={theme.accent}>v1.0.0</Text>
          {streamMeta && streamMeta.chars > 0 && (
            <Text color={theme.subtle}>{streamMeta.chars} chars · {streamMeta.elapsed}s</Text>
          )}
        </Box>
        <Text color={theme.subtle}>{cleanModel} · {governorStatus}</Text>
        <Text color={theme.inactive}>{cwd}</Text>
      </Box>
    </Box>
  );
}

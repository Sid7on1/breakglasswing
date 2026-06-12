import React from 'react';
import * as os from 'os';
import { Box, Text } from 'ink';
import { ThemeColors } from '../themes';

interface WelcomeBannerProps {
  theme: ThemeColors;
  model: string;
  agent: string;
  governorBypassed: boolean;
}

const LOGO = [
  '▗▄▄▄▖ ▗▄▄▄▖ ▗▖  ▗▖  ▗▄▖  ▗▖  ▗▖',
  '▐▌  █   █   ▐▛▚▞▜▌ ▐▌ ▐▌  ▝▚▞▘ ',
  '▐▛▀▀▜   █   ▐▌  ▐▌ ▐▛▀▜▌   ▐▌  ',
  '▐▌▄▄▟ ▗▄█▄▖ ▐▌  ▐▌ ▐▌ ▐▌ ▗▞▘▝▚▖',
];

function shortPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

export function WelcomeBanner({ theme, model, agent, governorBypassed }: WelcomeBannerProps) {
  const cleanModel = model.split('/').pop() || model;

  return (
    <Box flexDirection="column" marginTop={1} marginX={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.accent}
        paddingX={2}
        paddingY={1}
        width={64}
      >
        <Box flexDirection="column" marginBottom={1}>
          {LOGO.map((line, i) => (
            <Text key={i} color={i === 1 ? theme.accentShimmer : theme.accent} bold>{line}</Text>
          ))}
        </Box>
        <Box>
          <Text color={theme.text} bold>BiMax </Text>
          <Text color={theme.subtle}>v1.0.0 — autonomous agent for your terminal</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={theme.subtle}>model     </Text>
            <Text color={theme.info}>{cleanModel}</Text>
          </Box>
          <Box>
            <Text color={theme.subtle}>agent     </Text>
            <Text color={theme.text}>{agent}</Text>
          </Box>
          <Box>
            <Text color={theme.subtle}>governor  </Text>
            <Text color={governorBypassed ? theme.warning : theme.success}>
              {governorBypassed ? '⚡ bypassed (YOLO)' : '🛡 active'}
            </Text>
          </Box>
          <Box>
            <Text color={theme.subtle}>cwd       </Text>
            <Text color={theme.text}>{shortPath(process.cwd())}</Text>
          </Box>
        </Box>
      </Box>
      <Box marginTop={1} marginLeft={1} flexDirection="column">
        <Text color={theme.inactive}>Tips for getting started:</Text>
        <Text color={theme.subtle}>  1. Ask anything, or describe a task to run it with tools</Text>
        <Text color={theme.subtle}>  2. /help for commands · /model · /provider · /keys</Text>
        <Text color={theme.subtle}>  3. Ctrl+O toggles logs · Esc stashes your prompt · Ctrl+R restores it</Text>
      </Box>
    </Box>
  );
}

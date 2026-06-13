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

  // Low-chrome, borderless welcome: accent wordmark, a dim metadata block, and a few
  // quiet tips — content-first, lots of breathing room (Claude-Code style).
  return (
    <Box flexDirection="column" marginTop={1} marginX={2}>
      <Box flexDirection="column">
        {LOGO.map((line, i) => (
          <Text key={i} color={i === 1 ? theme.accentShimmer : theme.accent} bold>{line}</Text>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.text} bold>BiMax </Text>
        <Text color={theme.subtle}>v1.0.0 · autonomous agent for your terminal</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={theme.subtle}>model  </Text>
          <Text color={theme.inactive}>{cleanModel}</Text>
        </Box>
        <Box>
          <Text color={theme.subtle}>agent  </Text>
          <Text color={theme.inactive}>{agent}</Text>
        </Box>
        <Box>
          <Text color={theme.subtle}>cwd    </Text>
          <Text color={theme.inactive}>{shortPath(process.cwd())}</Text>
        </Box>
        {governorBypassed && (
          <Box>
            <Text color={theme.subtle}>guard  </Text>
            <Text color={theme.warning}>bypassed (YOLO)</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={theme.subtle}>Ask anything, or describe a task to run it with tools.</Text>
        <Text color={theme.subtle}>/help for commands · Ctrl+O logs · Esc stash · Ctrl+R restore</Text>
      </Box>
    </Box>
  );
}

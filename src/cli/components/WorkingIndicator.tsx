import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ThemeColors } from '../themes';

// A compact animated spinner shown while the model is actively producing output. Unlike
// ThinkingText (which only shows before the first token), this stays alive through the whole
// streaming phase and disappears only when the turn fully completes — so the user always has a
// clear "still working" signal until the response has stopped.

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface WorkingIndicatorProps {
  theme: ThemeColors;
  label?: string;
}

export function WorkingIndicator({ theme, label = 'Generating' }: WorkingIndicatorProps) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const spin = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    const clock = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => { clearInterval(spin); clearInterval(clock); };
  }, []);

  return (
    <Box flexDirection="row">
      <Text color={theme.accentShimmer} bold>{FRAMES[frame]} </Text>
      <Text color={theme.subtle}>{label} · {elapsed.toFixed(1)}s</Text>
    </Box>
  );
}

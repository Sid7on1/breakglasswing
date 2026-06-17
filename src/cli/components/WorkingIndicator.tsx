import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ThemeColors } from '../themes';
import { prefersReducedMotion } from './ShimmerText';

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
  const reduced = prefersReducedMotion();
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    // Reduced motion: keep the elapsed clock (it's information, not animation) but stop the spinner.
    const spin = reduced ? null : setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    const clock = setInterval(() => setElapsed((Date.now() - start) / 1000), reduced ? 250 : 100);
    return () => { if (spin) clearInterval(spin); clearInterval(clock); };
  }, [reduced]);

  return (
    <Box flexDirection="row">
      <Text color={theme.accentShimmer} bold>{reduced ? '•' : FRAMES[frame]} </Text>
      <Text color={theme.subtle}>{label} · {elapsed.toFixed(1)}s</Text>
    </Box>
  );
}

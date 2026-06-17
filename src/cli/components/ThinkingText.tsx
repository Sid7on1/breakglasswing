import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { cliEvents } from '../events';
import { ThemeColors } from '../themes';
import { ShimmerText } from './ShimmerText';

const PHRASES = [
  'Thinking', 'Architecting', 'Brewing', 'Calculating', 'Cogitating',
  'Composing', 'Computing', 'Considering', 'Crafting', 'Crunching',
  'Deciphering', 'Deliberating', 'Forging', 'Hatching', 'Inferring',
  'Mulling', 'Musing', 'Orchestrating', 'Pondering', 'Processing',
  'Puzzling', 'Ruminating', 'Synthesizing', 'Tinkering', 'Wrangling',
];

interface ThinkingTextProps {
  theme: ThemeColors;
}

export function ThinkingText({ theme }: ThinkingTextProps) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * PHRASES.length));
  const [dots, setDots] = useState('');
  const [snippet, setSnippet] = useState('');

  useEffect(() => {
    const phraseTimer = setInterval(() => {
      setIndex((prev) => (prev + 1) % PHRASES.length);
    }, 2500);
    const dotTimer = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 350);
    return () => { clearInterval(phraseTimer); clearInterval(dotTimer); };
  }, []);

  // Show the tail of the model's live reasoning stream, single line
  useEffect(() => {
    let buffer = '';
    const onThinking = (text: string) => {
      buffer = (buffer + text).slice(-300);
      const clean = buffer.replace(/\s+/g, ' ').trim();
      setSnippet(clean.length > 72 ? '…' + clean.slice(-72) : clean);
    };
    const onClear = () => { buffer = ''; setSnippet(''); };
    cliEvents.on('thinking', onThinking);
    cliEvents.on('thinking_clear', onClear);
    return () => {
      cliEvents.off('thinking', onThinking);
      cliEvents.off('thinking_clear', onClear);
    };
  }, []);

  return (
    <Box flexDirection="row">
      <Text color={theme.accentShimmer} bold>✻ </Text>
      <ShimmerText text={PHRASES[index]} theme={theme} />
      <Text color={theme.accentShimmer} bold>{dots.padEnd(3, ' ')}</Text>
      {snippet ? <Text color={theme.subtle} italic> {snippet}</Text> : null}
    </Box>
  );
}

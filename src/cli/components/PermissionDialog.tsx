import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ThemeColors } from '../themes';

interface PermissionDialogProps {
  theme: ThemeColors;
  question: string;
  options: string[];
  onSubmit: (answer: string) => void;
  onCancel: () => void;
}

export function PermissionDialog({ theme, question, options, onSubmit, onCancel }: PermissionDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((char, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => (i > 0 ? i - 1 : options.length - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => (i < options.length - 1 ? i + 1 : 0));
    }
    if (key.return) {
      onSubmit(options[selectedIndex]);
    }
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box>
        <Text color={theme.permission} bold>{'>>'}</Text>
        <Text color={theme.text}> {question.slice(0, 60)}</Text>
      </Box>
      <Box>
        {options.map((opt, i) => (
          <Box key={opt} marginRight={2}>
            <Text color={i === selectedIndex ? theme.permission : theme.subtle}>
              {i === selectedIndex ? '[' : ' '}{opt}{i === selectedIndex ? ']' : ' '}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

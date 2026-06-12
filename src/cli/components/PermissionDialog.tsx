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
    // Number hotkeys: 1..9 select directly
    const num = parseInt(char, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      onSubmit(options[num - 1]);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.permission}
      paddingX={2}
      paddingY={0}
      marginX={1}
    >
      <Box marginTop={1}>
        <Text color={theme.permission} bold>Permission required</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.text}>{question}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {options.map((opt, i) => (
          <Box key={opt}>
            <Text color={i === selectedIndex ? theme.permission : theme.subtle} bold={i === selectedIndex}>
              {i === selectedIndex ? '❯ ' : '  '}{i + 1}. {opt}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginBottom={1}>
        <Text color={theme.subtle}>↑/↓ select · Enter confirm · 1-{options.length} quick pick · Esc cancel</Text>
      </Box>
    </Box>
  );
}

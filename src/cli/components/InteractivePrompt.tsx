import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ThemeColors } from '../themes';

export interface InteractivePromptProps {
  theme: ThemeColors;
  title: string;
  placeholder?: string;
  initialValue?: string;
  isMasked?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function InteractivePrompt({ theme, title, placeholder = 'Type here...', initialValue = '', isMasked, onSubmit, onCancel }: InteractivePromptProps) {
  const [value, setValue] = useState(initialValue);
  const [cursor, setCursor] = useState(initialValue.length);

  useInput((char, key) => {
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue(v => v.slice(0, cursor - 1) + v.slice(cursor));
        setCursor(c => c - 1);
      }
      return;
    }

    if (key.leftArrow) {
      setCursor(c => Math.max(0, c - 1));
      return;
    }
    
    if (key.rightArrow) {
      setCursor(c => Math.min(value.length, c + 1));
      return;
    }

    // Handle normal text input
    if (char && char.length === 1 && !key.ctrl && !key.meta) {
      setValue(v => v.slice(0, cursor) + char + v.slice(cursor));
      setCursor(c => c + 1);
    }
  });

  const rawDisplayValue = value.length > 0 ? value : placeholder;
  const isPlaceholder = value.length === 0;
  const displayValue = isMasked && !isPlaceholder ? '*'.repeat(value.length) : rawDisplayValue;

  return (
    <Box 
      flexDirection="column" 
      marginBottom={1} 
      borderStyle="round" 
      borderColor={theme.borderFocus}
      paddingX={1}
      width={70}
    >
      <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
        <Text color={theme.accent} bold>{title}</Text>
        <Text color={theme.subtle}> [Enter to submit, Esc to cancel]</Text>
      </Box>
      <Box flexDirection="row">
        <Text color={theme.accent}>❯ </Text>
        <Text color={isPlaceholder ? theme.subtle : theme.text}>
          {displayValue.slice(0, isPlaceholder ? displayValue.length : cursor)}
        </Text>
        <Text backgroundColor={theme.accent} color={theme.background}>
          {!isPlaceholder && cursor < displayValue.length ? displayValue[cursor] : ' '}
        </Text>
        <Text color={isPlaceholder ? theme.subtle : theme.text}>
          {!isPlaceholder && cursor < displayValue.length - 1 ? displayValue.slice(cursor + 1) : ''}
        </Text>
      </Box>
    </Box>
  );
}

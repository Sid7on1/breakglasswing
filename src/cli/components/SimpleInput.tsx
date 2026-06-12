import React, { useState, useRef, useEffect } from 'react';
import { Text, useInput } from 'ink';

export interface SimpleInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  focus: boolean;
  placeholder?: string;
  mask?: boolean;
}

export function SimpleInput({ value, onChange, onSubmit, focus, placeholder, mask }: SimpleInputProps) {
  const [cursorOffset, setCursorOffset] = useState(0);
  
  // Use a ref to track the latest value synchronously for rapid typing/pasting
  const internalValueRef = useRef(value);
  
  // Sync prop changes that come from outside (e.g. clearing the input, autocompletion)
  useEffect(() => {
    // To support rapid pasting in Ink, we track typing synchronously in internalValueRef.
    // Parent React state updates (via onChange) will lag behind our synchronous ref.
    // We only want to adopt the parent's value if it's completely out of sync or cleared.
    if (value === '') {
      internalValueRef.current = '';
      setCursorOffset(0);
    } else if (
      value !== internalValueRef.current && 
      !internalValueRef.current.startsWith(value) && 
      !value.startsWith(internalValueRef.current)
    ) {
      internalValueRef.current = value;
      if (cursorOffset > value.length) {
        setCursorOffset(0);
      }
    }
  }, [value, cursorOffset]);

  useInput((char, key) => {
    if (!focus) return;

    if (key.return) {
      onSubmit(internalValueRef.current);
      return;
    }

    if (key.leftArrow) {
      setCursorOffset(Math.min(internalValueRef.current.length, cursorOffset + 1));
      return;
    }

    if (key.rightArrow) {
      setCursorOffset(Math.max(0, cursorOffset - 1));
      return;
    }

    if (key.backspace || key.delete) {
      const curVal = internalValueRef.current;
      if (cursorOffset === curVal.length) return; // Cursor at the very beginning
      
      const beforeCursor = curVal.slice(0, curVal.length - cursorOffset);
      const afterCursor = curVal.slice(curVal.length - cursorOffset);
      
      const newVal = beforeCursor.slice(0, -1) + afterCursor;
      internalValueRef.current = newVal;
      onChange(newVal);
      return;
    }

    if (key.upArrow || key.downArrow || key.escape || key.ctrl || key.meta) {
      return; // Handled by parent components or ignored
    }

    // For typing and pasting
    if (char) {
      // Ignore ansi escape codes that leak through
      if (char.includes('\u001b')) return;

      const curVal = internalValueRef.current;
      const beforeCursor = curVal.slice(0, curVal.length - cursorOffset);
      const afterCursor = curVal.slice(curVal.length - cursorOffset);
      
      const newVal = beforeCursor + char + afterCursor;
      internalValueRef.current = newVal;
      onChange(newVal);
    }
  });

  const displayValue = value || placeholder || '';
  
  if (!focus) {
    return <Text>{mask && value ? '*'.repeat(value.length) : displayValue}</Text>;
  }

  const renderedValue = mask ? '*'.repeat(value.length) : value;
  const beforeCursor = renderedValue.slice(0, renderedValue.length - cursorOffset);
  const afterCursor = renderedValue.slice(renderedValue.length - cursorOffset);
  
  if (value.length === 0) {
    return <Text><Text inverse> </Text>{placeholder}</Text>;
  }

  if (cursorOffset === 0) {
    return <Text>{renderedValue}<Text inverse> </Text></Text>;
  }

  const cursorChar = afterCursor[0];
  const restAfter = afterCursor.slice(1);

  return (
    <Text>
      {beforeCursor}
      <Text inverse>{cursorChar}</Text>
      {restAfter}
    </Text>
  );
}

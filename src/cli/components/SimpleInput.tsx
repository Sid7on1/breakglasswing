import React, { useState, useRef, useEffect } from 'react';
import { Text, useInput } from 'ink';

/** Shell-style line edits. `offset` is the cursor distance from the END of the string (the model
 *  SimpleInput already uses). Pure so it can be unit-tested without the TUI. */
export type LineEdit = 'home' | 'end' | 'killStart' | 'killEnd' | 'deleteWord';
export function editLine(op: LineEdit, value: string, offset: number): { value: string; offset: number } {
  const i = value.length - offset; // cursor index from the start
  const before = value.slice(0, i);
  const after = value.slice(i);
  switch (op) {
    case 'home': return { value, offset: value.length };          // Ctrl+A
    case 'end': return { value, offset: 0 };                       // Ctrl+E
    case 'killStart': return { value: after, offset: after.length }; // Ctrl+U
    case 'killEnd': return { value: before, offset: 0 };           // Ctrl+K
    case 'deleteWord': {                                            // Ctrl+W
      const cut = before.replace(/\s+$/, '').replace(/\S+$/, '');
      return { value: cut + after, offset: after.length };
    }
  }
}

// Ctrl-letter → edit op. Excludes letters bound to global shortcuts (f/p/o/t/r/d/c) so there's
// no collision with FullScreen's keybindings.
const CTRL_EDITS: Record<string, LineEdit> = { a: 'home', e: 'end', u: 'killStart', k: 'killEnd', w: 'deleteWord' };

export interface SimpleInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  focus: boolean;
  placeholder?: string;
  mask?: boolean;
  // When a multi-line paste arrives, the parent can swap the raw blob for a short placeholder
  // chip (Claude-Code style). Return the text to actually insert into the visible input.
  onPaste?: (text: string) => string;
  // Inline ghost text (gray) shown after the cursor when it is at the end — the predicted
  // completion of the current token. Accepted via Tab (handled by the parent). Empty = none.
  ghost?: string;
}

export function SimpleInput({ value, onChange, onSubmit, focus, placeholder, mask, onPaste, ghost }: SimpleInputProps) {
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

    // Shell-style line editing (Ctrl+A/E/U/K/W). Handle these before delegating other ctrl
    // combos (the global shortcuts) up to the parent.
    if (key.ctrl && char) {
      const op = CTRL_EDITS[char.toLowerCase()];
      if (op) {
        const r = editLine(op, internalValueRef.current, cursorOffset);
        internalValueRef.current = r.value;
        setCursorOffset(r.offset);
        onChange(r.value);
        return;
      }
    }

    if (key.upArrow || key.downArrow || key.escape || key.tab || key.ctrl || key.meta) {
      return; // Handled by parent components (incl. Tab = accept ghost/suggestion) or ignored
    }

    // For typing and pasting
    if (char) {
      // Ignore ansi escape codes that leak through
      if (char.includes('\u001b')) return;

      // A chunk containing newlines is a multi-line paste — collapse it to a placeholder chip
      // (via the parent) so the raw blob never gets rendered and overflows the input border.
      let toInsert = char;
      if (onPaste && (char.includes('\n') || char.includes('\r'))) {
        toInsert = onPaste(char.replace(/\r\n?/g, '\n'));
      }

      const curVal = internalValueRef.current;
      const beforeCursor = curVal.slice(0, curVal.length - cursorOffset);
      const afterCursor = curVal.slice(curVal.length - cursorOffset);

      const newVal = beforeCursor + toInsert + afterCursor;
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
    // Cursor at end: if there's predicted ghost text, put the cursor on its first char and dim
    // the rest (gray) so it reads as a suggestion to accept with Tab.
    if (ghost && !mask) {
      return <Text>{renderedValue}<Text inverse>{ghost[0]}</Text><Text dimColor>{ghost.slice(1)}</Text></Text>;
    }
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

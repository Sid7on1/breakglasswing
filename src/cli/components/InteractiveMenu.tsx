import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { ThemeColors } from '../themes';
import fuzzysort from 'fuzzysort';

export interface MenuOption {
  label: string;
  value: string;
  desc?: string;
  category?: string;
}

interface InteractiveMenuProps {
  theme: ThemeColors;
  options: MenuOption[];
  onSelect: (option: MenuOption) => void;
  onCancel: () => void;
  title: string;
  enableSearch?: boolean;
  /** Start with the pointer on this option index (default 0). Pass the index of the currently
   *  active option so the pointer reflects the real current state, not always the first item. */
  initialIndex?: number;
}

export function InteractiveMenu({ theme, options, onSelect, onCancel, title, enableSearch = false, initialIndex = 0 }: InteractiveMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, Math.min(initialIndex, options.length - 1)));
  const [searchQuery, setSearchQuery] = useState('');

  const filteredOptions = useMemo(() => {
    if (!enableSearch || !searchQuery) return options;
    const results = fuzzysort.go(searchQuery, options, { keys: ['label', 'desc', 'category'] });
    return results.map((r: any) => r.obj);
  }, [options, searchQuery, enableSearch]);

  useInput((char, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => (i > 0 ? i - 1 : Math.max(0, filteredOptions.length - 1)));
    } else if (key.downArrow) {
      setSelectedIndex((i) => (i < filteredOptions.length - 1 ? i + 1 : 0));
    } else if (key.return) {
      // onSelect may be async; swallow rejections here so a failing handler can't crash the input
      // loop with an unhandled rejection (the handler itself surfaces errors to the user).
      if (filteredOptions.length > 0) {
        Promise.resolve(onSelect(filteredOptions[selectedIndex])).catch(() => { /* handler reports its own errors */ });
      }
    } else if (key.escape) {
      onCancel();
    } else if (enableSearch && (key.backspace || key.delete)) {
      setSearchQuery(q => q.slice(0, -1));
      setSelectedIndex(0);
    } else if (enableSearch && char && char.length === 1 && !key.ctrl && !key.meta) {
      setSearchQuery(q => q + char);
      setSelectedIndex(0);
    }
  });

  return (
    <Box 
      flexDirection="column" 
      marginBottom={1} 
      borderStyle="round"
      borderColor={theme.borderFocus}
      paddingX={1}
      // Grow with the terminal so long descriptions don't wrap so aggressively (was a fixed 70).
      // Clamp so it never gets absurdly wide on huge monitors or collapses on narrow ones.
      width={Math.min(120, Math.max(70, (process.stdout.columns || 80) - 4))}
    >
      <Box marginBottom={1} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={theme.accent} bold>{title}</Text>
          <Text color={theme.subtle}> [↑/↓ navigate, Enter select, Esc cancel]</Text>
        </Box>
        {enableSearch && (
          <Box marginTop={1} paddingBottom={1} borderStyle="single" borderColor={theme.border}>
            <Text color={theme.text}>🔍 </Text>
            <Text color={searchQuery ? theme.accent : theme.subtle}>{searchQuery || 'Type to search...'}</Text>
          </Box>
        )}
      </Box>
      
      {(() => {
        const windowSize = 8;
        let startIdx = 0;
        
        if (filteredOptions.length > windowSize) {
          if (selectedIndex < windowSize / 2) {
            startIdx = 0;
          } else if (selectedIndex >= filteredOptions.length - windowSize / 2) {
            startIdx = filteredOptions.length - windowSize;
          } else {
            startIdx = Math.max(0, selectedIndex - Math.floor(windowSize / 2));
          }
        }
        
        const visibleOptions = filteredOptions.slice(startIdx, startIdx + windowSize);
        const hasMoreTop = startIdx > 0;
        const hasMoreBottom = startIdx + windowSize < filteredOptions.length;

        let lastCategory = startIdx > 0 ? filteredOptions[startIdx - 1].category : null;

        return (
          <Box flexDirection="column">
            {hasMoreTop && (
              <Box paddingLeft={2} marginBottom={1}>
                <Text color={theme.subtle}>↑ ...more options...</Text>
              </Box>
            )}
            
            {visibleOptions.length === 0 ? (
               <Box paddingLeft={2}><Text color={theme.subtle}>No matches found</Text></Box>
            ) : visibleOptions.map((opt: MenuOption, idx: number) => {
              const actualIdx = startIdx + idx;
              const isActive = actualIdx === selectedIndex;
              const showCategory = opt.category && opt.category !== lastCategory;
              lastCategory = opt.category;

              return (
                <Box key={opt.value + idx} flexDirection="column">
                  {showCategory && (
                    <Box marginTop={idx > 0 ? 1 : 0} marginBottom={0}>
                      <Text color={theme.warning} bold>{opt.category}</Text>
                    </Box>
                  )}
                  <Box flexDirection="row" paddingLeft={opt.category ? 2 : 0}>
                    <Box width={2}>
                      <Text color={isActive ? theme.accent : theme.subtle}>{isActive ? '❯' : ' '}</Text>
                    </Box>
                    <Box width={25}>
                      <Text color={isActive ? theme.accent : theme.text} bold={isActive}>{opt.label}</Text>
                    </Box>
                    {opt.desc && (
                      <Box flexGrow={1}>
                        <Text color={theme.subtle}>{opt.desc}</Text>
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
            
            {hasMoreBottom && (
              <Box paddingLeft={2} marginTop={1}>
                <Text color={theme.subtle}>↓ ...more options...</Text>
              </Box>
            )}
          </Box>
        );
      })()}
    </Box>
  );
}

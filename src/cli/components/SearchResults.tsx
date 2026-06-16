import React from 'react';
import { Box, Text } from 'ink';
import { ThemeColors } from '../themes';
import { SearchHighlight } from './SearchHighlight';

export interface SearchMatch {
  /** Where the match came from, used for the row label. */
  source: 'you' | 'assistant' | 'system' | 'log';
  /** The single matching line of text. */
  lineText: string;
}

interface SearchResultsProps {
  matches: SearchMatch[];
  query: string;
  /** Index of the currently-focused match (highlighted distinctly). */
  current: number;
  theme: ThemeColors;
  /** Max rows to show at once; windows around `current`. */
  maxRows?: number;
}

const SOURCE_LABEL: Record<SearchMatch['source'], string> = {
  you: 'you',
  assistant: 'bimax',
  system: 'sys',
  log: 'log',
};

/**
 * Search results panel shown while Ctrl+F search is active. Lists matching lines from the
 * transcript and logs with the query highlighted, the focused match marked distinctly, and an
 * "N of M" counter — the navigable equivalent of Claude Code's search. Windows around the
 * current match so long result sets stay bounded in the live region.
 */
export function SearchResults({ matches, query, current, theme, maxRows = 10 }: SearchResultsProps) {
  if (!query.trim()) {
    return <Text color={theme.subtle}>Search: type to find in transcript and logs…</Text>;
  }
  if (matches.length === 0) {
    return <Text color={theme.warning}>No matches for “{query}”</Text>;
  }

  // Window the visible rows around the focused match.
  const half = Math.floor(maxRows / 2);
  let start = Math.max(0, current - half);
  const end = Math.min(matches.length, start + maxRows);
  start = Math.max(0, end - maxRows);
  const window = matches.slice(start, end);
  const labelW = Math.max(...window.map((m) => SOURCE_LABEL[m.source].length));

  return (
    <Box flexDirection="column">
      <Text color={theme.accent}>
        {' '}🔍 {current + 1} of {matches.length} match{matches.length === 1 ? '' : 'es'} for “{query}”
        <Text color={theme.subtle}>  (↑/↓ or Enter to navigate · Esc to exit)</Text>
      </Text>
      {window.map((m, i) => {
        const idx = start + i;
        const isCurrent = idx === current;
        return (
          <Box key={idx}>
            <Text color={isCurrent ? theme.accent : theme.subtle}>
              {isCurrent ? '▸ ' : '  '}{SOURCE_LABEL[m.source].padEnd(labelW)} │ </Text>
            <Text color={isCurrent ? theme.text : theme.inactive}>
              <SearchHighlight
                text={m.lineText.length > 120 ? m.lineText.slice(0, 117) + '…' : m.lineText}
                query={query}
                theme={theme}
                highlightColor={isCurrent ? theme.searchCurrent : theme.searchHighlight}
              />
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

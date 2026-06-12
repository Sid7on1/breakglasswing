import React from 'react';
import { Text } from 'ink';
import { ThemeColors } from '../themes';

interface SearchHighlightProps {
  text: string;
  query: string;
  theme: ThemeColors;
}

export function SearchHighlight({ text, query, theme }: SearchHighlightProps) {
  if (!query || !text) {
    return <Text>{text}</Text>;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: { match: boolean; text: string }[] = [];
  let idx = 0;

  while (idx < text.length) {
    const matchIdx = lowerText.indexOf(lowerQuery, idx);
    if (matchIdx === -1) {
      parts.push({ match: false, text: text.slice(idx) });
      break;
    }
    if (matchIdx > idx) {
      parts.push({ match: false, text: text.slice(idx, matchIdx) });
    }
    parts.push({ match: true, text: text.slice(matchIdx, matchIdx + query.length) });
    idx = matchIdx + query.length;
  }

  return (
    <Text>
      {parts.map((part, i) =>
        part.match
          ? <Text key={i} backgroundColor={theme.searchHighlight} bold>{part.text}</Text>
          : <Text key={i}>{part.text}</Text>
      )}
    </Text>
  );
}

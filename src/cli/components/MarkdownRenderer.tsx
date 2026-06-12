import React from 'react';
import { Box, Text } from 'ink';
import { ThemeColors } from '../themes';

interface MarkdownRendererProps {
  content: string;
  theme: ThemeColors;
}

function splitInlineFormatting(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<Text key={`t-${lastIndex}`}>{text.slice(lastIndex, match.index)}</Text>);
    }
    if (match[1]) {
      const code = match[1].slice(1, -1);
      parts.push(<Text key={`c-${match.index}`} backgroundColor={'#333'}>{code}</Text>);
    } else if (match[2]) {
      const boldText = match[2].slice(2, -2);
      parts.push(<Text key={`b-${match.index}`} bold>{boldText}</Text>);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<Text key={`t-${lastIndex}`}>{text.slice(lastIndex)}</Text>);
  }

  return parts.length > 0 ? parts : [<Text key="empty">{text}</Text>];
}

export function MarkdownRenderer({ content, theme }: MarkdownRendererProps) {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textPart = content.slice(lastIndex, match.index);
      const lines = textPart.split('\n');
      lines.forEach((line, li) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('# ')) {
          elements.push(
            <Text key={`t-${lastIndex}-${li}`} bold color={theme.accent}>
              {trimmed.slice(2)}
            </Text>
          );
        } else if (trimmed.startsWith('## ')) {
          elements.push(
            <Text key={`t-${lastIndex}-${li}`} bold color={theme.warning}>
              {trimmed.slice(3)}
            </Text>
          );
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          elements.push(
            <Box key={`t-${lastIndex}-${li}`} marginLeft={2}>
              <Text>• {trimmed.slice(2)}</Text>
            </Box>
          );
        } else if (/^\d+\.\s/.test(trimmed)) {
          elements.push(
            <Box key={`t-${lastIndex}-${li}`} marginLeft={2}>
              <Text>{trimmed}</Text>
            </Box>
          );
        } else if (trimmed.startsWith('|')) {
          const cells = trimmed.split('|').filter(c => c.length > 0).map(c => c.trim());
          const isSeparator = cells.every(c => /^[-:]+$/.test(c));
          if (isSeparator) return; // Skip separator lines
          
          elements.push(
            <Box key={`t-${lastIndex}-${li}`} flexDirection="row" borderStyle="single" borderColor={theme.border} paddingX={1} marginY={0}>
              {cells.map((cell, cidx) => (
                <Box key={cidx} width={20} borderStyle="single" borderColor={theme.border} paddingRight={1} marginRight={1}>
                  <Text>{splitInlineFormatting(cell)}</Text>
                </Box>
              ))}
            </Box>
          );
        } else {
          elements.push(
            <Text key={`t-${lastIndex}-${li}`}>
              {splitInlineFormatting(line)}
            </Text>
          );
        }
      });
    }

    const lang = match[1] || '';
    const code = match[2].trimEnd();
    elements.push(
      <Box key={`cb-${match.index}`} flexDirection="column" marginLeft={1} marginY={1}>
        {lang ? (
          <Text color={theme.subtle}>{lang}</Text>
        ) : null}
        <Box
          borderStyle="round"
          borderColor={theme.border}
          paddingX={1}
          paddingY={1}
        >
          <Text backgroundColor={theme.codeBlockBg || '#1a1a2e'}>
            {code}
          </Text>
        </Box>
      </Box>
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    const lines = remaining.split('\n');
    lines.forEach((line, li) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) {
        elements.push(
          <Text key={`r-${lastIndex}-${li}`} bold color={theme.accent}>
            {trimmed.slice(2)}
          </Text>
        );
      } else if (trimmed.startsWith('## ')) {
        elements.push(
          <Text key={`r-${lastIndex}-${li}`} bold color={theme.warning}>
            {trimmed.slice(3)}
          </Text>
        );
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        elements.push(
          <Box key={`r-${lastIndex}-${li}`} marginLeft={2}>
            <Text>• {trimmed.slice(2)}</Text>
          </Box>
        );
      } else if (/^\d+\.\s/.test(trimmed)) {
        elements.push(
          <Box key={`r-${lastIndex}-${li}`} marginLeft={2}>
            <Text>{trimmed}</Text>
          </Box>
        );
      } else {
        elements.push(
          <Text key={`r-${lastIndex}-${li}`}>
            {splitInlineFormatting(line)}
          </Text>
        );
      }
    });
  }

  return <>{elements}</>;
}

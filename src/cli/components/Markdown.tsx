import React from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import highlight from 'cli-highlight';
import { ThemeColors } from '../themes';

interface MarkdownProps {
  children: string;
  theme: ThemeColors;
}

export function Markdown({ children, theme }: MarkdownProps) {
  if (!children) return null;

  try {
    const tokens = marked.lexer(children);
    return (
      <Box flexDirection="column">
        {tokens.map((token, i) => <MarkdownToken key={i} token={token} theme={theme} />)}
      </Box>
    );
  } catch (err) {
    // Fallback to raw text if parsing fails
    return <Text color={theme.text}>{children}</Text>;
  }
}

function MarkdownToken({ token, theme }: { token: any; theme: ThemeColors }) {
  switch (token.type) {
    case 'space':
      return null;
      
    case 'paragraph':
      return (
        <Box marginBottom={1}>
          <Text color={theme.text}>
            {token.tokens ? token.tokens.map((t: any, i: number) => (
              <InlineToken key={i} token={t} theme={theme} />
            )) : token.text}
          </Text>
        </Box>
      );
      
    case 'code':
      try {
        const highlighted = highlight(token.text, {
          language: token.lang || 'plaintext',
          ignoreIllegals: true
        });
        return (
          <Box flexDirection="column" marginBottom={1} paddingX={1} borderStyle="round" borderColor={theme.border}>
            <Text color={theme.subtle}>{token.lang || 'code'}</Text>
            <Text>{highlighted}</Text>
          </Box>
        );
      } catch (e) {
        return (
          <Box flexDirection="column" marginBottom={1} paddingX={1} borderStyle="round" borderColor={theme.border}>
            <Text color={theme.text}>{token.text}</Text>
          </Box>
        );
      }

    case 'heading':
      return (
        <Box marginBottom={1}>
          <Text color={theme.accent} bold>
            {'#'.repeat(token.depth)} {token.text}
          </Text>
        </Box>
      );

    case 'list':
      return (
        <Box flexDirection="column" marginBottom={1} marginLeft={2}>
          {token.items.map((item: any, i: number) => (
            <Box key={i} flexDirection="row">
              <Text color={theme.subtle}>• </Text>
              <Text color={theme.text}>
                {item.tokens ? item.tokens.map((t: any, j: number) => (
                  <InlineToken key={j} token={t} theme={theme} />
                )) : item.text}
              </Text>
            </Box>
          ))}
        </Box>
      );

    case 'blockquote':
      return (
        <Box marginBottom={1} marginLeft={2} paddingLeft={1}>
          <Text color={theme.subtle}>{'┃ '} {token.text}</Text>
        </Box>
      );

    case 'hr':
      return (
        <Box marginBottom={1}>
          <Text color={theme.subtle}>{'—'.repeat(40)}</Text>
        </Box>
      );

    case 'html':
    case 'text':
      return (
        <Text color={theme.text}>
          {token.tokens ? token.tokens.map((t: any, i: number) => (
            <InlineToken key={i} token={t} theme={theme} />
          )) : token.text}
        </Text>
      );

    default:
      // Unknown block
      return <Text color={theme.text}>{token.raw}</Text>;
  }
}

function InlineToken({ token, theme }: { token: any; theme: ThemeColors }) {
  switch (token.type) {
    case 'strong':
      return <Text bold color={theme.text}>{token.text}</Text>;
    case 'em':
      return <Text italic color={theme.text}>{token.text}</Text>;
    case 'codespan':
      return <Text color={theme.warning} backgroundColor={theme.border}> {token.text} </Text>;
    case 'del':
      return <Text strikethrough color={theme.subtle}>{token.text}</Text>;
    case 'link':
      return <Text color={theme.accent} underline>{token.text}</Text>;
    case 'image':
      return <Text color={theme.subtle}>[Image: {token.text}]</Text>;
    case 'escape':
    case 'text':
    default:
      // Some text tokens have child tokens if they contain inline styles
      if (token.tokens && token.tokens.length > 0) {
        return <>{token.tokens.map((t: any, i: number) => <InlineToken key={i} token={t} theme={theme} />)}</>;
      }
      return <Text color={theme.text}>{token.raw || token.text}</Text>;
  }
}

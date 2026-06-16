import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import highlight from 'cli-highlight';
import { ThemeColors } from '../themes';
import { MarkdownTable } from './MarkdownTable';

interface MarkdownProps {
  children: string;
  theme: ThemeColors;
}

// --- Token cache + fast-path lexing (ported from Claude Code's Markdown.tsx) ---
// marked.lexer is the hot cost when committed transcript rows re-mount in Ink's
// <Static> region and when the live preview re-renders each streaming delta. Tokens
// for a given content string are stable, so we cache them (LRU, hash-keyed to avoid
// retaining full content strings) and skip the parse entirely for plain text.
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, any[]>();

// Any markdown marker, a blank line (paragraph break), or an ordered-list start.
const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;
function hasMarkdownSyntax(s: string): boolean {
  // Markdown markers appear early if at all (headers, fences, lists); long plain
  // tool-output tails don't need a full scan.
  return MD_SYNTAX_RE.test(s.length > 500 ? s.slice(0, 500) : s);
}

// Fast non-crypto string hash (djb2). Good enough as a cache key for immutable content.
function hashContent(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + s.length;
}

function cachedLexer(content: string): any[] {
  // Fast path: plain text with no markdown → a single paragraph token, no parse.
  if (!hasMarkdownSyntax(content)) {
    return [{ type: 'paragraph', raw: content, text: content,
      tokens: [{ type: 'text', raw: content, text: content }] }];
  }
  const key = hashContent(content);
  const hit = tokenCache.get(key);
  if (hit) {
    // Promote to MRU so scrolling back to an early message doesn't evict it.
    tokenCache.delete(key);
    tokenCache.set(key, hit);
    return hit;
  }
  const tokens = marked.lexer(content);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const first = tokenCache.keys().next().value; // Map preserves insertion order → drop oldest
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(key, tokens);
  return tokens;
}

export function Markdown({ children, theme }: MarkdownProps) {
  // Memoize on (content, theme): avoids re-tokenizing + rebuilding the element tree
  // when the parent re-renders for unrelated reasons (the common case during streaming).
  return useMemo(() => {
    if (!children) return null;
    try {
      const tokens = cachedLexer(children);
      return (
        <Box flexDirection="column">
          {tokens.map((token, i) => <MarkdownToken key={i} token={token} theme={theme} />)}
        </Box>
      );
    } catch {
      return <Text color={theme.text}>{children}</Text>;
    }
  }, [children, theme]);
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

    case 'table':
      return <MarkdownTable token={token} theme={theme} />;

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

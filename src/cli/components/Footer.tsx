import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { cliEvents, AgentState } from '../events';
import { ThemeColors } from '../themes';

interface FooterProps {
  theme: ThemeColors;
  model?: string;
  agent: string;
  verbose: boolean;
  streamMeta?: { chars: number; elapsed: number };
}

export function Footer({ theme, model, agent, verbose, streamMeta }: FooterProps) {
  const [status, setStatus] = useState('idle');
  const [statusText, setStatusText] = useState('Ready');
  const [mode, setMode] = useState<string | null>(null);
  const [totalTokens, setTotalTokens] = useState(0);

  useEffect(() => {
    const handleSpinner = (state: AgentState, msg?: string) => {
      setStatus(state);
      setStatusText(msg || state);
    };
    const handleMode = (m: string) => setMode(m);
    const handleStatus = (text: string) => setStatusText(text);
    const handleCost = (chars: number) => setTotalTokens((p) => p + Math.round(chars / 4));
    cliEvents.on('spinner_state', handleSpinner);
    cliEvents.on('mode_change', handleMode);
    cliEvents.on('status', handleStatus);
    cliEvents.on('cost_update', handleCost);
    return () => {
      cliEvents.off('spinner_state', handleSpinner);
      cliEvents.off('mode_change', handleMode);
      cliEvents.off('status', handleStatus);
      cliEvents.off('cost_update', handleCost);
    };
  }, []);

  const isIdle = status === 'idle';

  return (
    <Box marginTop={1} paddingX={1}>
      <Text color={isIdle ? theme.subtle : theme.accent}>
        {isIdle ? '✻' : '✶'}{' '}
      </Text>
      <Text color={isIdle ? theme.subtle : theme.inactive}>
        {statusText}
      </Text>
      <Box flexGrow={1} />
      {streamMeta && streamMeta.chars > 0 && (
        <Text color={theme.subtle}>{streamMeta.chars} chars · {streamMeta.elapsed}s{'  '}</Text>
      )}
      <Text color={theme.subtle}>
        /help · Ctrl+O logs · Esc stash{'  '}
      </Text>
      <Text color={theme.inactive}>
        {mode ? `${mode} · ` : ''}{(model || 'default').split('/').pop()} · {agent}
        {verbose ? ` · ~${totalTokens}tok` : ''}
      </Text>
    </Box>
  );
}

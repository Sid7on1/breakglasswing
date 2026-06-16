import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { cliEvents, AgentState } from '../events';
import { ThemeColors } from '../themes';
import { getConfig } from '../config';
import { capabilitiesFor, capabilityGlyphs } from '../../core/capabilities';

interface FooterProps {
  theme: ThemeColors;
  model?: string;       // initial heavy coding model (live value is read from config)
  liteModel?: string;   // initial lite model (live value is read from config)
  agent: string;
  verbose: boolean;
  streamMeta?: { chars: number; elapsed: number };
}

export function Footer({ theme, model, liteModel, agent, verbose, streamMeta }: FooterProps) {
  const [status, setStatus] = useState('idle');
  const [statusText, setStatusText] = useState('Ready');
  const [mode, setMode] = useState<string | null>(null);
  const [totalTokens, setTotalTokens] = useState(0);
  // Which tier will RECEIVE the next request: 'lite' by default (the routing entry point),
  // flipping to 'heavy' on escalation. `pinned` marks a manual Ctrl+T override.
  const [tier, setTier] = useState<'lite' | 'heavy'>('lite');
  const [pinned, setPinned] = useState<'lite' | 'heavy' | null>(null);
  // The actual model ids per tier, read LIVE from config so the displayed name follows whatever
  // the user picks via /model — never a hardcoded name. Refreshed on config_changed.
  const readModels = () => {
    try { const c = getConfig(); return { coding: c.model, lite: c.liteModel }; }
    catch { return { coding: model, lite: liteModel }; }
  };
  const [models, setModels] = useState<{ coding?: string; lite?: string }>(() => readModels());

  useEffect(() => {
    const handleSpinner = (state: AgentState, msg?: string) => {
      setStatus(state);
      setStatusText(msg || state);
    };
    const handleMode = (m: string) => setMode(m);
    const handleStatus = (text: string) => setStatusText(text);
    const handleCost = (chars: number) => setTotalTokens((p) => p + Math.round(chars / 4));
    const handleTier = (info: { tier: 'lite' | 'heavy'; pinned?: 'lite' | 'heavy' | null }) => {
      setTier(info.tier);
      if (info.pinned !== undefined) setPinned(info.pinned);
    };
    const handleConfigChanged = () => setModels(readModels());
    cliEvents.on('spinner_state', handleSpinner);
    cliEvents.on('mode_change', handleMode);
    cliEvents.on('status', handleStatus);
    cliEvents.on('cost_update', handleCost);
    cliEvents.on('model_tier', handleTier);
    cliEvents.on('config_changed', handleConfigChanged);
    return () => {
      cliEvents.off('spinner_state', handleSpinner);
      cliEvents.off('mode_change', handleMode);
      cliEvents.off('status', handleStatus);
      cliEvents.off('cost_update', handleCost);
      cliEvents.off('model_tier', handleTier);
      cliEvents.off('config_changed', handleConfigChanged);
    };
  }, []);

  const isIdle = status === 'idle';
  // The model that will receive the next request, derived from the live tier + config.
  const activeModel = (tier === 'heavy' ? models.coding : models.lite) || models.coding || models.lite || model;
  // Capability glyphs for that model (⚡cache ⊹think {}json ◉vision); empty for a floor model.
  const glyphs = capabilityGlyphs(capabilitiesFor(undefined, activeModel));

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
        Ctrl+G palette · /help · Ctrl+O logs · Esc stash{'  '}
      </Text>
      <Text color={tier === 'heavy' ? theme.accent : theme.inactive}>
        {mode ? `${mode} · ` : ''}
        {tier === 'heavy' ? '⇧ ' : '▸ '}
        {(activeModel || 'default').split('/').pop()}
        {pinned ? ' 📌' : ''} · {agent}
        {verbose ? ` · ~${totalTokens}tok` : ''}
      </Text>
      {glyphs ? <Text color={theme.subtle}>{'  '}{glyphs}</Text> : null}
    </Box>
  );
}

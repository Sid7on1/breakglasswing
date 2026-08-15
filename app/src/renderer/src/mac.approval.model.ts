import type { RequestMsg } from './protocol';

/**
 * Match only the redundant generic governor prompt emitted by the packaged legacy engine for the
 * app-owned Mac provider. The surrounding Control Mac turn is explicit task consent; provider
 * policy still resolves and gates every concrete action. Taint warnings, asks, diffs and every
 * third-party tool remain visible and require the person's answer.
 */
export function isRoutineAppOwnedMacPrompt(
  request: RequestMsg | null,
  taskConsentActive: boolean,
): request is RequestMsg {
  if (!taskConsentActive || !request) return false;
  return request.kind === 'prompt'
    && request.isAsk !== true
    && request.question.trim() === 'Allow? Run mcp__bimax-mac__mac_control'
    && request.options.includes('Yes');
}

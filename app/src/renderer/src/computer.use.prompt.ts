/** Marker used to keep the execution contract out of the visible transcript and restored tasks. */
export const COMPUTER_USE_EXECUTION_MARKER = '[BIMAX APP CONTROL MAC EXECUTION CONTRACT]';

/**
 * Late, app-owned steering for a Control Mac turn.
 *
 * The packaged engine also serves Terminal, so Desktop cannot make it own macOS control. The app
 * adds this contract only after its lane, live-model and Trust Center gates have all passed. The
 * text is intentionally compact: the current fast controller completed the first native action,
 * then lost the task while paraphrasing the large generic tool schema.
 */
export function buildComputerUseExecutionPrompt(userText: string): string {
  const task = String(userText || '').trim();
  if (!task) return '';
  return `${task}\n\n${COMPUTER_USE_EXECUTION_MARKER}
- You are executing this task now through mcp__bimax-mac__mac_control. Do not give instructions to the user and do not narrate prospective JSON or the tool schema.
- Call exactly one mac_control action, read its fresh returned frame/elements/receipt, then choose the next action. Continue this loop until the task is complete.
- The open result is already a fresh observation. Prefer its semantic elementIndex/elementToken/query over guessed coordinates. Never reuse an element handle after the returned frame changes.
- For keyboard-driven apps, focus the opened app and use key/type when that is clearer than guessing buttons. Attach expect when native text can prove the requested result.
- Finish only when the newest native result proves the requested end state. If it cannot be proven, report the concrete runtime blocker instead of claiming success.`;
}

/** The execution contract is model context, not user-authored transcript content. */
export function visibleComputerUsePrompt(text: string): string {
  const value = String(text || '');
  const marker = `\n\n${COMPUTER_USE_EXECUTION_MARKER}`;
  const at = value.indexOf(marker);
  return (at === -1 ? value : value.slice(0, at)).trim();
}

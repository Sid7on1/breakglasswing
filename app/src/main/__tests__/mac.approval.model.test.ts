import { isRoutineAppOwnedMacPrompt } from '../../renderer/src/mac.approval.model';
import type { RequestMsg } from '../../renderer/src/protocol';

const request = (question: string): RequestMsg => ({
  t: 'request', id: 7, kind: 'prompt', question,
  options: ['Yes', 'No', 'Always Allow This Tool'],
});

describe('task-scoped app-owned Mac approval', () => {
  test('absorbs only the duplicate mac_control prompt during an explicit Control Mac turn', () => {
    expect(isRoutineAppOwnedMacPrompt(
      request('Allow? Run mcp__bimax-mac__mac_control'), true,
    )).toBe(true);
    expect(isRoutineAppOwnedMacPrompt(
      request('Allow? Run mcp__bimax-mac__mac_control'), false,
    )).toBe(false);
    expect(isRoutineAppOwnedMacPrompt(
      request('Allow? Run mcp__third-party__click'), true,
    )).toBe(false);
  });

  test('never absorbs a taint-narrowed warning', () => {
    expect(isRoutineAppOwnedMacPrompt(request(
      '⚠ TAINTED CONTEXT — untrusted content\nAllow anyway? Run mcp__bimax-mac__mac_control',
    ), true)).toBe(false);
  });
});

import {
  applyImplicitComputerGoalConstraints,
  inferStructuredComputerGoal,
  structuredComputerCompletionNudge,
  structuredComputerGoalSatisfied,
} from '../computer/structured.goal';
import { Message } from '../core/llm.provider';

const request = `Open the macOS application named BimaxCuFixture and do BOTH of these:
1. set the single-line text field to exactly: txn-ok
2. tick the checkbox labelled "Fixture Checkbox"
Do not change any other control. Stop once both are done.`;

const state = (field = 'alpha beta gamma', checked = '0', popup = 'First', radio = '0'): Message => ({
  role: 'tool', tool_call_id: 'state', content: JSON.stringify({
    ok: true, driver: 'bimax-computer-use-cua', action: 'observe',
    elements: [
      { role: 'AXTextField', label: field, value: field, element_token: 'field' },
      { role: 'AXCheckBox', label: 'Fixture Checkbox', value: checked, element_token: 'box' },
      { role: 'AXPopUpButton', label: popup, value: popup, element_token: 'popup' },
      { role: 'AXRadioButton', label: 'Two', value: radio, element_token: 'two' },
    ],
  }),
});

const pairedState = (content: Record<string, unknown>): Message[] => [{
  role: 'assistant', tool_calls: [{
    id: 'compat-state', type: 'function',
    function: { name: 'ComputerTool', arguments: '{"action":"observe"}' },
  }],
}, {
  role: 'tool', tool_call_id: 'compat-state', content: JSON.stringify({
    driver: 'compatibility', action: 'observe', ...content,
  }),
}];

describe('structured computer form goals', () => {
  it('extracts only explicit end states and the exact app name', () => {
    expect(inferStructuredComputerGoal([{ role: 'user', content: request }])).toEqual({
      request,
      app: 'BimaxCuFixture',
      requirements: [
        { kind: 'text', value: 'txn-ok' },
        { kind: 'checkbox', label: 'Fixture Checkbox' },
      ],
    });
    expect(inferStructuredComputerGoal([{ role: 'user', content: 'poke around Notes' }])).toBeUndefined();
  });

  it('repairs a hallucinated bundle id and preserves the user-given app name', () => {
    const repaired = applyImplicitComputerGoalConstraints(
      JSON.stringify({ action: 'open', bundleId: 'com.invented.fixture' }),
      [{ role: 'user', content: request }],
    );
    expect(JSON.parse(repaired)).toEqual({ action: 'open', app: 'BimaxCuFixture' });
  });

  it('drops unrelated authority and recording fields before the first app observation', () => {
    const repaired = applyImplicitComputerGoalConstraints(JSON.stringify({
      action: 'request_access', pid: 1234567890, windowId: 987654321,
      surface: 'browser_page', handoffRef: 'invented', captureScope: 'display',
      outputDir: '/tmp/not-relevant',
    }), [{ role: 'user', content: request }]);
    expect(JSON.parse(repaired)).toEqual({ action: 'open', app: 'BimaxCuFixture' });
  });

  it('makes an explicitly exact text assignment replace existing content', () => {
    const repaired = applyImplicitComputerGoalConstraints(
      JSON.stringify({ action: 'type', text: 'txn-ok', elementToken: 'field' }),
      [{ role: 'user', content: request }, state()],
    );
    expect(JSON.parse(repaired)).toEqual({
      action: 'set_value', value: 'txn-ok', elementToken: 'field',
      expect: 'txn-ok', expectMode: 'present',
    });
  });

  it('compiles the next unmet requirement instead of trusting a weak model selection', () => {
    const repaired = applyImplicitComputerGoalConstraints(
      JSON.stringify({ action: 'click', elementToken: 'box' }),
      [{ role: 'user', content: request }, state()],
    );
    expect(JSON.parse(repaired)).toEqual({
      action: 'set_value', value: 'txn-ok', elementToken: 'field',
      expect: 'txn-ok', expectMode: 'present',
    });
  });

  it('turns every redundant mutation into a read after all requirements are satisfied', () => {
    const repaired = applyImplicitComputerGoalConstraints(
      JSON.stringify({ action: 'click', elementToken: 'box' }),
      [{ role: 'user', content: request }, state('txn-ok', '1')],
    );
    expect(JSON.parse(repaired)).toEqual({ action: 'observe', includeScreenshot: false });
  });

  it('compiles a popup into one exact set_value action', () => {
    const menuRequest = 'Open the macOS application named BimaxCuFixture and use the pop-up button (its choices are First, Second and Third) to select: Third';
    const open = applyImplicitComputerGoalConstraints(
      JSON.stringify({ action: 'click', elementToken: 'wrong-control' }),
      [{ role: 'user', content: menuRequest }, state()],
    );
    expect(JSON.parse(open)).toEqual({ action: 'set_value', value: 'Third', elementToken: 'popup' });
  });

  it('holds premature completion and names the exact next safe action', () => {
    const messages: Message[] = [{ role: 'user', content: request }, state()];
    expect(structuredComputerGoalSatisfied(messages)).toBe(false);
    expect(structuredComputerCompletionNudge(messages, 'Done, both values are correct.'))
      .toContain('{"action":"set_value","value":"txn-ok","elementToken":"field"');
    const finished: Message[] = [{ role: 'user', content: request }, state('txn-ok', '1')];
    expect(structuredComputerGoalSatisfied(finished)).toBe(true);
    expect(structuredComputerCompletionNudge(finished, 'Done.')).toBe('');
  });

  it('uses compatibility-provider state instead of relaunching the app', () => {
    const repaired = applyImplicitComputerGoalConstraints(
      JSON.stringify({ action: 'click', x: 999, y: 999 }),
      [{ role: 'user', content: request }, ...pairedState({
        ok: true, elements: [{
          role: 'AXTextField', label: 'alpha beta gamma', value: 'alpha beta gamma', element_token: 'fresh-field',
        }],
      })],
    );
    expect(JSON.parse(repaired)).toEqual({
      action: 'set_value', value: 'txn-ok', elementToken: 'fresh-field',
      expect: 'txn-ok', expectMode: 'present',
    });
  });

  it('observes again after a failed action instead of reusing an older element token', () => {
    const failed: Message = {
      role: 'tool', tool_call_id: 'failed', content: JSON.stringify({
        ok: false, driver: 'bimax-computer-use-cua', action: 'click',
        error: 'frame is 84 seconds old; observe again',
      }),
    };
    const messages: Message[] = [{ role: 'user', content: request }, state(), failed];
    expect(JSON.parse(applyImplicitComputerGoalConstraints(
      JSON.stringify({ action: 'set_value', elementToken: 'field', value: 'txn-ok' }), messages,
    ))).toEqual({ action: 'observe', includeScreenshot: false });
    expect(structuredComputerCompletionNudge(messages, 'Unable to continue because the frame is stale.'))
      .toContain('{"action":"observe","includeScreenshot":false}');
  });
});

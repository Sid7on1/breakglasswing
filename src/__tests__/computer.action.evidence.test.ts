import { Message } from '../core/llm.provider';
import {
  actionChangedTheScreen, appMentionedIn, appsInEvidence, clipboardWriteProven,
  commitProvenAfter, computerToolResults, computerToolSteps, interactionProven, lastContentEntryIndex, scopeToApp,
} from '../computer/action.evidence';
import { computerCommitCompletionNudge } from '../core/agent.loop';
import { computerTodoCompletionError } from '../tools/implementations/todo.tool';

const result = (value: Record<string, unknown>): Message => ({
  role: 'tool', tool_call_id: String(value.action || 'call'),
  content: JSON.stringify({ ok: true, driver: 'bimax-computer-use 0.12.3', ...value }),
});

describe('computerToolResults', () => {
  it('reads only Bimax computer results and survives compacted content', () => {
    const messages: Message[] = [
      { role: 'user', content: 'go' },
      result({ action: 'open', app: 'Notes' }),
      { role: 'tool', tool_call_id: 'x', content: 'compacted to prose, not JSON' },
      { role: 'tool', tool_call_id: 'y', content: JSON.stringify({ ok: true, driver: 'other-tool', action: 'read' }) },
      result({ action: 'type', app: 'Notes' }),
    ];
    expect(computerToolResults(messages).map(r => r.action)).toEqual(['open', 'type']);
    // Fail-open on a wiped transcript: an absent history must never strand a completed task.
    expect(computerToolResults(undefined)).toEqual([]);
  });
});

describe('computerToolSteps', () => {
  it('pairs executed ComputerTool arguments with their result', () => {
    const messages: Message[] = [
      { role: 'assistant', tool_calls: [{
        id: 'type-1', type: 'function',
        function: { name: 'ComputerTool', arguments: '{"action":"type","query":"Search","text":"Mom"}' },
      }] },
      { ...result({ action: 'type', app: 'Messages' }), tool_call_id: 'type-1' },
    ];
    expect(computerToolSteps(messages)).toEqual([expect.objectContaining({
      args: expect.objectContaining({ action: 'type', text: 'Mom' }),
      result: expect.objectContaining({ action: 'type', app: 'Messages' }),
    })]);
  });
});

describe('actionChangedTheScreen', () => {
  it('requires a fresh frame and rejects every outcome that disproves an effect', () => {
    expect(actionChangedTheScreen({ action: 'click' })).toBe(false); // no screenshot
    expect(actionChangedTheScreen({ action: 'click', screenshot: '/tmp/a.png' })).toBe(true);
    expect(actionChangedTheScreen({ action: 'click', screenshot: '/tmp/a.png', ok: false })).toBe(false);
    for (const outcome of ['no-change', 'expectation-missed', 'rejected', 'failed', 'wrong-window']) {
      expect(actionChangedTheScreen({
        action: 'click', screenshot: '/tmp/a.png', progressCheck: { outcome },
      })).toBe(false);
    }
    expect(actionChangedTheScreen({
      action: 'click', screenshot: '/tmp/a.png',
      summary: 'clicked Send — screen did NOT change: the input landed but nothing visibly happened',
    })).toBe(false);
  });
});

describe('app scoping comes from the evidence, never a hardcoded list', () => {
  const results = computerToolResults([
    result({ action: 'open', app: 'Obsidian' }),
    result({ action: 'type', app: 'Obsidian' }),
    result({ action: 'open', app: 'Linear' }),
  ]);

  it('derives the app vocabulary from the recorded results', () => {
    expect(appsInEvidence(results).sort()).toEqual(['Linear', 'Obsidian']);
  });

  it('only matches an app the session actually used', () => {
    expect(appMentionedIn('write the note in Obsidian', results)).toBe('Obsidian');
    expect(appMentionedIn('write the note in Safari', results)).toBeUndefined();
    expect(appMentionedIn('write the note somewhere', results)).toBeUndefined();
  });

  it('falls back to the whole sequence when no observed app is named', () => {
    expect(scopeToApp(results, undefined)).toHaveLength(3);
    expect(scopeToApp(results, 'Obsidian')).toHaveLength(2);
  });
});

describe('commitProvenAfter', () => {
  it('needs the commit to come after the entry, in the same app, with a changed frame', () => {
    const typed = { action: 'type', app: 'Chat', screenshot: '/tmp/typed.png' };

    // Nothing after the typing.
    expect(commitProvenAfter([typed], 0)).toBe(false);
    // Return, same app, fresh frame.
    expect(commitProvenAfter([typed, {
      action: 'key', app: 'Chat', summary: 'pressed return in Chat', screenshot: '/tmp/sent.png',
    }], 0)).toBe(true);
    // A Return in a DIFFERENT app is somebody else's commit.
    expect(commitProvenAfter([typed, {
      action: 'key', app: 'Browser', summary: 'pressed return in Browser', screenshot: '/tmp/search.png',
    }], 0)).toBe(false);
    // Right app and verb, but the screen never moved.
    expect(commitProvenAfter([typed, {
      action: 'key', app: 'Chat', summary: 'pressed return in Chat', screenshot: '/tmp/same.png',
      progressCheck: { outcome: 'no-change' },
    }], 0)).toBe(false);
    // A commit-named click counts; an unrelated click does not.
    expect(commitProvenAfter([typed, {
      action: 'click', app: 'Chat', targeting: { label: 'Send' }, screenshot: '/tmp/sent.png',
    }], 0)).toBe(true);
    expect(commitProvenAfter([typed, {
      action: 'click', app: 'Chat', targeting: { label: 'Emoji' }, screenshot: '/tmp/emoji.png',
    }], 0)).toBe(false);
    // Dismissing an error dialog is the OPPOSITE of committing, so its labels must not qualify.
    expect(commitProvenAfter([typed, {
      action: 'click', app: 'Chat', targeting: { label: 'OK' }, screenshot: '/tmp/dismissed.png',
    }], 0)).toBe(false);
    // No entry at all.
    expect(commitProvenAfter([typed], -1)).toBe(false);
  });

  it('accepts a proven declared postcondition on an unlabeled commit control', () => {
    // The named route cannot possibly pass here: describeUnlabeledControls names icon-only buttons by
    // position, and this project's persona warns that commit buttons are usually unlabeled icons. So a
    // model that correctly clicks the send icon must be able to prove the send some other way, or the
    // gate would push it toward pressing Return in an app that needs the button.
    const typed = { action: 'type', app: 'Chat', screenshot: '/tmp/typed.png' };
    const unlabeledClick = {
      action: 'click', app: 'Chat', screenshot: '/tmp/sent.png',
      targeting: { label: 'bottom-right #3' },
    };
    expect(commitProvenAfter([typed, unlabeledClick], 0)).toBe(false);

    // `confidence: 'proven'` is reachable only through a matched semantic expectation.
    expect(commitProvenAfter([typed, {
      ...unlabeledClick, actionResult: { confidence: 'proven' },
    }], 0)).toBe(true);
    expect(commitProvenAfter([typed, {
      ...unlabeledClick, actionResult: { confidence: 'likely' },
    }], 0)).toBe(false);
    expect(commitProvenAfter([typed, {
      ...unlabeledClick, actionResult: { postcondition: { query: 'dinner ideas', matched: true } },
    }], 0)).toBe(true);
    expect(commitProvenAfter([typed, {
      ...unlabeledClick, actionResult: { postcondition: { query: 'dinner ideas', matched: false } },
    }], 0)).toBe(false);
  });

  it('does not let a proven postcondition on a NON-commit action stand in for the commit', () => {
    // Proving "the conversation is open" after selecting a chat is real evidence of something, but it
    // is not evidence that the message was sent. The action shape still has to be commit-shaped.
    const typed = { action: 'type', app: 'Chat', screenshot: '/tmp/typed.png' };
    expect(commitProvenAfter([typed, {
      action: 'scroll', app: 'Chat', screenshot: '/tmp/scrolled.png',
      actionResult: { confidence: 'proven' },
    }], 0)).toBe(false);
    expect(commitProvenAfter([typed, {
      action: 'observe', app: 'Chat', screenshot: '/tmp/observed.png',
      actionResult: { confidence: 'proven' },
    }], 0)).toBe(false);
  });

  it('anchors on the LATEST content entry', () => {
    const results = computerToolResults([
      result({ action: 'type', app: 'Chat', screenshot: '/tmp/first.png' }),
      result({ action: 'key', app: 'Chat', summary: 'pressed return in Chat', screenshot: '/tmp/sent.png' }),
      result({ action: 'type', app: 'Chat', screenshot: '/tmp/second.png' }),
    ]);
    expect(lastContentEntryIndex(results)).toBe(2);
    expect(commitProvenAfter(results, lastContentEntryIndex(results))).toBe(false);
  });
});

describe('interactionProven and clipboardWriteProven', () => {
  it('does not accept navigation alone as evidence that a surface shows a result', () => {
    const navigation = computerToolResults([
      result({ action: 'open', app: 'Browser', screenshot: '/tmp/open.png' }),
      result({ action: 'focus', app: 'Browser', screenshot: '/tmp/focus.png' }),
      result({ action: 'observe', app: 'Browser', screenshot: '/tmp/observe.png' }),
    ]);
    expect(interactionProven(navigation)).toBe(false);
    expect(interactionProven([...navigation, { action: 'click', screenshot: '/tmp/clicked.png' }])).toBe(true);
  });

  it('requires a real copy/clipboard action', () => {
    expect(clipboardWriteProven(computerToolResults([result({ action: 'click' })]))).toBe(false);
    expect(clipboardWriteProven(computerToolResults([result({ action: 'copy' })]))).toBe(true);
    expect(clipboardWriteProven(computerToolResults([result({ action: 'clipboard' })]))).toBe(true);
  });
});

describe('the loop gate and the todo gate share one definition of proof', () => {
  // These two gates were written independently and disagreed: one accepted any result carrying a
  // screenshot, the other additionally required the frame to have changed. The looser rule silently
  // set the ceiling. Both now import commitProvenAfter, so identical evidence must produce identical
  // verdicts — that agreement is the point of the shared module and is pinned here.
  const uncommitted: Message[] = [
    { role: 'user', content: 'open Chat and send hi to Mom' },
    result({ action: 'open', app: 'Chat', screenshot: '/tmp/open.png' }),
    result({ action: 'type', app: 'Chat', screenshot: '/tmp/typed.png' }),
  ];
  const committed: Message[] = [...uncommitted, result({
    action: 'key', app: 'Chat', summary: 'pressed return in Chat', screenshot: '/tmp/sent.png',
  })];
  const todo = 'Send the message in the Chat composer and verify it appears in the conversation';

  it('both refuse the same uncommitted sequence', () => {
    expect(computerCommitCompletionNudge(uncommitted, 'Sent hi to Mom.')).toMatch(/COMPUTER COMMIT GATE/);
    expect(computerTodoCompletionError(todo, uncommitted)).toMatch(/proves the content was committed/);
  });

  it('both accept the same committed sequence', () => {
    expect(computerCommitCompletionNudge(committed, 'Sent hi to Mom.')).toBe('');
    expect(computerTodoCompletionError(todo, committed)).toBe('');
  });

  it('both refuse a commit whose frame did not change', () => {
    const unchanged: Message[] = [...uncommitted, result({
      action: 'key', app: 'Chat', summary: 'pressed return in Chat', screenshot: '/tmp/same.png',
      progressCheck: { outcome: 'no-change' },
    })];
    expect(computerCommitCompletionNudge(unchanged, 'Sent hi to Mom.')).toMatch(/COMPUTER COMMIT GATE/);
    expect(computerTodoCompletionError(todo, unchanged)).toMatch(/proves the content was committed/);
  });
});

describe('the loop gate stays out of the way of read-only work', () => {
  it('does not hold a completed read task hostage', () => {
    // "read the text in Notes" contains no send intent. An earlier draft matched \btext\b and would
    // have blocked this answer up to the nudge cap.
    const messages: Message[] = [
      { role: 'user', content: 'read the text in Notes and tell me the first line' },
      result({ action: 'open', app: 'Notes', screenshot: '/tmp/open.png' }),
      result({ action: 'type', app: 'Notes', screenshot: '/tmp/typed.png' }),
    ];
    expect(computerCommitCompletionNudge(messages, 'The first line is "Groceries".')).toBe('');
  });

  it('lets an honest blocker report through', () => {
    const messages: Message[] = [
      { role: 'user', content: 'send hi to Mom on Chat' },
      result({ action: 'type', app: 'Chat', screenshot: '/tmp/typed.png' }),
    ];
    expect(computerCommitCompletionNudge(messages, 'I could not send it — the app blocked the action.')).toBe('');
    expect(computerCommitCompletionNudge(messages, 'Sent.')).toMatch(/COMPUTER COMMIT GATE/);
  });
});

import React from 'react';
import { LiveTarget } from '../src/renderer/src/components/LiveTarget';
import type { MacSession, MacTimelineEntry } from '../src/renderer/src/mac.session.model';

/**
 * The Mac lane, with the timeline the seeded expansion exists for.
 *
 * The entries mirror a real 2026-08-14 run (open Messages → click a conversation row) rather than
 * lorem, because the thing being judged is how a LONG "Not confirmed — …" line behaves when its row
 * becomes a panel. Placeholder text of a convenient length would verify nothing.
 */

const entry = (
  id: string,
  label: string,
  over: Partial<MacTimelineEntry> = {},
): MacTimelineEntry => ({
  id,
  label,
  action: 'click',
  outcome: 'the app changed and the named target could not be reacquired',
  executor: 'stop',
  focus: 'background',
  postcondition: 'not requested',
  status: 'error',
  atMs: Date.now() - 60_000,
  refusedForTakeover: false,
  ...over,
});

const TIMELINE: MacTimelineEntry[] = [
  entry('1', 'Opened Messages', {
    action: 'open',
    outcome: 'opened Messages as pid 91942 window 26998; fresh screen attached',
    executor: 'semantic',
    focus: 'background',
    postcondition: 'matched — window 26998 is frontmost',
    status: 'success',
  }),
  entry('2', 'Clicked the conversation row', {
    outcome:
      'the target accessibility state changed after the screenshot and semantic re-grounding failed: '
      + 'the element you named (AXStaticText "Mama Ji 🔥, 7732-091343 veeramani, 7/12/26") is no longer '
      + 'in the tree after the app changed',
    postcondition: 'not requested',
  }),
  entry('3', 'Typed the message', {
    action: 'type',
    outcome: 'nothing was sent to your Mac',
    executor: 'stop',
    focus: 'none',
    postcondition: 'refused while you held control',
    refusedForTakeover: true,
    status: 'error',
  }),
  entry('4', 'Observing the window', {
    action: 'observe',
    outcome: 'reading the accessibility tree',
    executor: 'semantic',
    focus: 'background',
    postcondition: 'in progress',
    status: 'running',
  }),
];

const SESSION: MacSession = {
  active: true,
  state: 'observing' as MacSession['state'],
  target: { app: 'Messages', windowId: 26998, pid: 91942 },
  evidence: {
    observation: 'f1-91942-26998',
    capturedAtMs: Date.now() - 9_000,
    ageMs: 9_000,
    freshness: 'fresh' as MacSession['evidence'] extends null ? never : 'fresh',
    screenshot: '',
  } as unknown as MacSession['evidence'],
  timeline: TIMELINE,
  latest: TIMELINE[TIMELINE.length - 1]!,
  paused: false,
  pauseReason: '',
  refusedWhilePaused: 0,
};

export function InspectorPreview(): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <figcaption
          style={{
            font: '600 11px/1 ui-monospace, monospace',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#8a8a85',
          }}
        >
          Mac lane — click any action
        </figcaption>
        <div
          className="evidence-studio"
          style={{ width: 380, height: 660, display: 'flex', flexDirection: 'column', borderRadius: 14, overflow: 'hidden' }}
        >
          <div style={{ minHeight: 0, flex: 1, overflowY: 'auto', padding: 12 }}>
            <LiveTarget session={SESSION} onPause={() => {}} onResume={() => {}} />
          </div>
        </div>
      </figure>
    </div>
  );
}

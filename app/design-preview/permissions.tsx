import React, { useCallback, useState } from 'react';
import { PermissionsPane, type Disposition } from '../src/renderer/src/components/PermissionsPane';
import { PermissionCoachOverlay } from '../src/renderer/src/components/PermissionCoachOverlay';

/**
 * Permissions harness.
 *
 * The interesting states are the partial ones, so the fixture starts at 2/4 with Accessibility
 * ungranted — the row that carries the drag coach. "Opening" the pane here only flips the coach on;
 * a real `shell.openExternal` would take the whole screen away from the preview.
 */
export function PermissionsPreview(): React.ReactElement {
  const [readings, setReadings] = useState<Record<string, Disposition>>({
    accessibility: 'not-determined',
    screenRecording: 'granted',
    fullDisk: 'granted',
    microphone: 'not-determined',
  });

  const onOpenPane = useCallback(async () => true, []);
  // The overlay normally lives in its own always-on-top window; rendered inline here so its layout
  // and drag affordance can be looked at without taking the screen away from the preview.
  const onRefresh = useCallback(async () => {}, []);

  return (
    <div className="min-h-[560px] w-[min(720px,100%)] p-6">
      <PermissionsPane readings={readings} onOpenPane={onOpenPane} onRefresh={onRefresh} />
      <div className="mt-8">
        <p className="mb-2 text-[10px] tracking-wider text-faint uppercase">drag coach overlay (own window in the app)</p>
        <div className="relative h-[300px] w-[260px] overflow-hidden rounded-xl bg-gradient-to-br from-[#2f4858] via-[#6d597a] to-[#b56576]">
          <PermissionCoachOverlay />
        </div>
      </div>
      <div className="mt-6 flex gap-2">
        <button
          onClick={() => setReadings((r) => ({ ...r, accessibility: r.accessibility === 'granted' ? 'not-determined' : 'granted' }))}
          className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[11.5px] text-dim hover:border-ember/50 hover:text-ink"
        >
          simulate: toggle Accessibility grant
        </button>
        <button
          onClick={() => setReadings({ accessibility: 'granted', screenRecording: 'granted', fullDisk: 'granted', microphone: 'granted' })}
          className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[11.5px] text-dim hover:border-ember/50 hover:text-ink"
        >
          simulate: all granted
        </button>
      </div>
    </div>
  );
}

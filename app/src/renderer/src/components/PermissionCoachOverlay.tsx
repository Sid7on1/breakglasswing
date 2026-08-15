import React, { useCallback, useEffect, useState } from 'react';

/**
 * The floating drag source shown over System Settings.
 *
 * This renders in its own always-on-top window (main/permission.coach.ts), and the single most
 * important thing it does is hand the mouse back:
 *
 * The BrowserWindow is deliberately only as large as this tile. That makes the drag source reliable
 * without placing a transparent click-blocking pane over System Settings.
 */
export function PermissionCoachOverlay(): React.ReactElement {
  const [dragging, setDragging] = useState(false);
  const [bundle, setBundle] = useState<string>('');

  useEffect(() => {
    void window.bimax.permissionCoach.bundlePath().then(setBundle);
  }, []);

  const passThrough = useCallback(() => {
    setDragging(false);
  }, []);

  useEffect(() => {
    window.addEventListener('blur', passThrough);
    return () => window.removeEventListener('blur', passThrough);
  }, [passThrough]);

  const onDragStart = useCallback((event: React.DragEvent) => {
    // The real drag is a native file drag started in main; the HTML5 drag would carry nothing
    // System Settings understands, so it is cancelled and replaced.
    event.preventDefault();
    setDragging(true);
    window.bimax.permissionCoach.dragBundle();
    // startDrag owns the pointer until the drop ends. A short-lived pressed state is enough to make
    // the pickup visible without animating the object away from the cursor.
    setTimeout(passThrough, 180);
  }, [passThrough]);

  const responsibleName = bundle.split('/').filter(Boolean).pop()?.replace(/\.app$/i, '') || 'BiMAX';

  return (
    <div className="flex h-screen w-screen items-end justify-center bg-transparent p-3 select-none">
      <section
        aria-label="Drag BiMAX into macOS permissions"
        className="w-full overflow-hidden rounded-[24px] border border-white/24 bg-[#171716]/76 px-3.5 pb-3 pt-2.5 shadow-[0_24px_72px_rgba(0,0,0,.52)] backdrop-blur-3xl backdrop-saturate-150"
      >
        <div className="mx-auto mb-2 h-1 w-8 rounded-full bg-white/18" aria-hidden />
        <div className="mb-2 flex items-center justify-between px-1">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.08em] text-white/45 uppercase">macOS permission</p>
            <h1 className="mt-0.5 text-[13px] font-semibold tracking-[-0.01em] text-white">Add BiMAX to the list</h1>
          </div>
          <CurlyArrow />
        </div>

        <div
          draggable
          onDragStart={onDragStart}
          onDragEnd={passThrough}
          onMouseDown={() => setDragging(true)}
          onMouseUp={passThrough}
          className={[
            'group relative flex h-[70px] w-full cursor-grab items-center gap-3 rounded-[18px] p-2.5',
            'border border-white/18 bg-gradient-to-br from-white/16 to-white/[0.055]',
            'transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45',
            dragging
              ? 'scale-[0.975] cursor-grabbing border-white/26 bg-white/14'
              : 'hover:-translate-y-0.5 hover:border-white/24 hover:bg-white/10',
          ].join(' ')}
          style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 12px 28px rgba(0,0,0,.3)' }}
        >
          <div className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[14px] border border-white/15 bg-gradient-to-br from-[#383734] to-[#111] shadow-lg">
            <span className="font-display text-[13px] font-bold tracking-[-0.06em] text-white">BiMAX</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">{responsibleName}</p>
            <p className="mt-0.5 text-[10.5px] text-white/48">Hold, then drag into the list</p>
          </div>
          <DragHandle />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 px-1 text-[9.5px] text-white/48">
          <span>{bundle ? 'Bimax returns automatically after macOS records it' : 'Press + and choose BiMAX'}</span>
          <button
            onClick={() => void window.bimax.permissionCoach.stop()}
            className="cursor-pointer rounded-full border border-white/12 px-2 py-1 text-white/70 transition-colors duration-150 hover:border-white/22 hover:bg-white/10 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * The curly arrow from the icon up to the list.
 *
 * A straight arrow reads as "this is above me"; a hand-drawn curl reads as "take this and put it
 * there", which is the instruction. It is drawn rather than animated into position because the
 * overlay sits over another app's window and a moving graphic there competes with the drag the user
 * is trying to perform — the dash animation is the only motion, and it points one way.
 */
function CurlyArrow(): React.ReactElement {
  return (
    <svg width="54" height="32" viewBox="0 0 54 32" fill="none" aria-hidden className="drop-shadow-lg">
      <path
        d="M4 27 C 12 27, 14 13, 25 13 C 35 13, 36 24, 28 25 C 20 26, 21 8, 45 7"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="3 4"
        opacity="0.72"
      />
      <path d="M45 7 L 39 4 M45 7 L 41 13" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.72" />
    </svg>
  );
}

function DragHandle(): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-[3px] pr-1 opacity-35 transition-opacity duration-150 group-hover:opacity-65" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => <span key={index} className="h-[3px] w-[3px] rounded-full bg-white" />)}
    </div>
  );
}

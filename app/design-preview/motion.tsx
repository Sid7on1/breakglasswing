import React, { useState } from 'react';
import { Settings, Sparkles, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../src/renderer/src/components/ui/dialog';
import { SeedMenu, SeedMenuItem } from '../src/renderer/src/components/ui/morph/SeedMenu';
import { SPRINGS, springFor } from '../src/renderer/src/components/ui/motion';
import { destinationFor } from '../src/renderer/src/components/ui/morph/geometry';

/**
 * The motion harness.
 *
 * A seeded expansion is a claim about geometry, and geometry is the one thing that changes when the
 * window does. The unit tests pin the numbers; this pins what they look like — the same round
 * button opening the same panel inside frames the size of a dragged-small window, a half-screen
 * column, a laptop and an ultrawide, all on screen at once.
 *
 * Each frame is a real containing block with its own size, so a panel sized in `vw`/`vh` would NOT
 * respond to it — which is the point. What is being checked here is that the flight starts from the
 * button, that nothing is clipped, and that the material reads as glass over a real backdrop; the
 * viewport-relative clamps are checked by `destinationFor` in the test lane, and reported per frame
 * below so the two can be compared side by side.
 */

/** The window shapes worth looking at. Same list as the test matrix, trimmed to what fits a page. */
const FRAMES: { label: string; width: number; height: number }[] = [
  { label: 'tiny · 320×480', width: 320, height: 480 },
  { label: 'laptop · 1024×640', width: 1024, height: 640 },
  { label: 'squashed · 1440×320', width: 1440, height: 320 },
  { label: 'tall · 380×760', width: 380, height: 760 },
];

/** Something for the glass to refract. Flat colour makes translucency unverifiable. */
const DESKTOP = 'linear-gradient(135deg, #1f3a5f 0%, #6d597a 34%, #b56576 62%, #eaac8b 100%)';

function Seeded({ width, height, label }: { width: number; height: number; label: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  // The same pure placement the flight uses, asked about this frame rather than about the browser
  // window — so the readout below and the surface above are computed from one function.
  const box = destinationFor({ kind: 'floatingPanel' }, { width, height }, null);

  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <figcaption style={{ font: '600 11px/1 ui-monospace, monospace', letterSpacing: '.08em', textTransform: 'uppercase', color: '#8a8a85' }}>
        {label}
      </figcaption>
      <div
        style={{
          position: 'relative', width, height, overflow: 'hidden', borderRadius: 14,
          background: DESKTOP, boxShadow: '0 24px 60px rgba(0,0,0,.35)',
          display: 'grid', placeItems: 'center',
        }}
      >
        {/* The round button from the brief: press it and it becomes the window. */}
        <button
          onClick={() => setOpen(true)}
          aria-label="Open panel"
          className="glass-pill pressable flex size-14 cursor-pointer items-center justify-center rounded-full text-ink"
        >
          <Sparkles size={20} />
        </button>

        <Dialog open={open} onOpenChange={(v) => { if (!v) setOpen(false); }}>
          <DialogContent className="w-[min(420px,calc(100vw-min(56px,40vw)))] p-0">
            <DialogTitle className="sr-only">Seeded panel</DialogTitle>
            <header className="flex items-center justify-between border-b border-line/60 px-4 py-3">
              <span className="text-[13px] font-semibold text-ink">It grew out of the button</span>
              <button onClick={() => setOpen(false)} aria-label="Close" className="cursor-pointer rounded-md p-1 text-dim hover:text-ink">
                <X size={14} />
              </button>
            </header>
            <div className="space-y-2.5 p-4 text-[12px] leading-relaxed text-dim">
              <p>
                The shell starts at the button&apos;s exact rect and springs its real
                width, height and corner to this box. Closing retargets the same springs at the
                button, so it folds back into the control you pressed.
              </p>
              <p className="text-faint">
                This text is laid out once, at the size you are reading it — the shell grows over it
                and clips it, so no glyph is ever scaled and the corner is a real radius rather than
                an ellipse smeared by a transform.
              </p>
              {/* A morph inside a morph: this menu flies from a control that is itself still
                  arriving. It is here because that is the one arrangement where a surface can be
                  given the wrong coordinate space and still look plausible — the menu must land on
                  the button, not where the button will be. */}
              <SeedMenu
                label="Demo"
                trigger={() => <span className="glass-pill rounded-lg px-2.5 py-1.5 text-[11px]">A popover, same material</span>}
              >
                {(close) => (
                  <>
                    <SeedMenuItem label="Bouncy" desc="the house spring" onClick={close} />
                    <SeedMenuItem label="Glass" desc="panels and sheets" onClick={close} />
                  </>
                )}
              </SeedMenu>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {/* What the pure placement computes for this window, so geometry and render can be compared. */}
      <div style={{ font: '10px/1.5 ui-monospace, monospace', color: '#8a8a85' }}>
        destinationFor → {Math.round(box.width)}×{Math.round(box.height)} at ({Math.round(box.x)}, {Math.round(box.y)})
      </div>
    </figure>
  );
}

/** The spring table: what each preset does to a control, a dialog and a full window. */
function Springs(): React.ReactElement {
  const sizes = [
    { label: 'control 40px', diagonal: 40 },
    { label: 'popover 300px', diagonal: 300 },
    { label: 'dialog 900px', diagonal: 900 },
    { label: 'window 1600px', diagonal: 1600 },
  ];
  return (
    <table style={{ borderCollapse: 'collapse', font: '11px/1.6 ui-monospace, monospace', color: '#c8c8c4' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', padding: '4px 14px 4px 0', color: '#8a8a85' }}>preset</th>
          {sizes.map((size) => (
            <th key={size.label} style={{ textAlign: 'left', padding: '4px 14px 4px 0', color: '#8a8a85' }}>{size.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(Object.keys(SPRINGS) as (keyof typeof SPRINGS)[]).map((preset) => (
          <tr key={preset}>
            <td style={{ padding: '3px 14px 3px 0' }}>{preset}</td>
            {sizes.map((size) => {
              const spring = springFor(preset, size.diagonal);
              return (
                <td key={size.label} style={{ padding: '3px 14px 3px 0' }}>
                  {spring.duration}ms · {((spring.peak - 1) * 100).toFixed(1)}%
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MotionPreview(): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <div style={{ font: '600 11px/1 ui-monospace, monospace', letterSpacing: '.08em', textTransform: 'uppercase', color: '#8a8a85', marginBottom: 10 }}>
          springs · duration and overshoot by surface size
        </div>
        <Springs />
      </div>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {FRAMES.map((frame) => (
          <Seeded key={frame.label} {...frame} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', font: '11px/1.6 system-ui', color: '#8a8a85' }}>
        <Settings size={13} /> Press a button, then press Escape — the collapse is the flight in reverse.
      </div>
    </div>
  );
}

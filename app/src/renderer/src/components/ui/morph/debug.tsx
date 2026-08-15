/**
 * The morph debug overlay (Prompt 1 §35, Prompt 2 §116).
 *
 * A seeded morph is a claim about three rectangles, and when it looks wrong the useful question is
 * always *which* rectangle is wrong — the seed we measured, the destination we computed, or the
 * interpolation between them. Watching the animation cannot distinguish them: a flight from a stale
 * seed and a flight to a mis-clamped destination both look like "it came from slightly the wrong
 * place". Drawing all three settles it in one frame.
 *
 * Dev-only, and enforced structurally rather than by discipline: the whole module short-circuits
 * unless `enabled` is passed, and the only callers are the Motion Lab and a keyboard-gated switch in
 * the app that is compiled out of production builds.
 */

import React from 'react';
import type { MorphFrame } from './controller';
import type { MorphGeometry } from './geometry';

export interface MorphDebugProps {
  enabled: boolean;
  /** Where the flight started. */
  origin: MorphGeometry | null;
  /** Where it is going. */
  destination: MorphGeometry | null;
  /** The latest published frame. */
  frame: MorphFrame | null;
  /** Centre points already visited, in window coordinates. */
  trail?: { x: number; y: number }[];
}

const SOURCE = '#4ade80';
const DESTINATION = '#60a5fa';
const CURRENT = '#ffffff';

export function MorphDebug({ enabled, origin, destination, frame, trail }: MorphDebugProps): React.ReactElement | null {
  if (!enabled || !frame) return null;

  const speed = Math.hypot(frame.velocity.x, frame.velocity.y);

  return (
    <div className="pointer-events-none fixed inset-0 z-[999] font-mono text-[10px] leading-tight">
      {origin ? <Outline box={origin} colour={SOURCE} label="SOURCE" /> : null}
      {destination ? <Outline box={destination} colour={DESTINATION} label="DEST" /> : null}
      <Outline box={frame.geometry} colour={CURRENT} label="CURRENT" solid />

      {/* The path the centre actually took. A morph that looks like it "goes the wrong way round"
          is nearly always two springs of different stiffness on x and y; the trail shows the bow
          immediately, where the numbers do not. */}
      {trail && trail.length > 1 ? (
        <svg className="absolute inset-0 h-full w-full" aria-hidden>
          <polyline
            points={trail.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={CURRENT}
            strokeOpacity={0.55}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        </svg>
      ) : null}

      <dl
        className="absolute top-3 right-3 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 rounded-lg px-3 py-2 text-white"
        style={{ background: 'rgba(10,10,12,0.82)', border: '1px solid rgba(255,255,255,0.14)' }}
      >
        <Row k="state" v={frame.state} />
        <Row k="progress" v={frame.progress.toFixed(3)} />
        <Row k="reveal" v={frame.reveal.toFixed(3)} />
        <Row k="radius" v={`${frame.geometry.radius.toFixed(1)}px`} />
        <Row k="size" v={`${Math.round(frame.geometry.width)}×${Math.round(frame.geometry.height)}`} />
        <Row k="speed" v={`${Math.round(speed)} px/s`} />
        <Row k="dw/dt" v={`${Math.round(frame.velocity.width)} px/s`} />
        <Row k="deform" v={`${frame.deform.x.toFixed(3)} / ${frame.deform.y.toFixed(3)}`} />
        <Row k="thickness" v={`${frame.material.thickness.toFixed(1)}px`} />
        <Row k="elevation" v={frame.material.elevation.toFixed(2)} />
      </dl>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }): React.ReactElement {
  return (
    <>
      <dt className="opacity-55">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </>
  );
}

function Outline({
  box, colour, label, solid,
}: { box: MorphGeometry; colour: string; label: string; solid?: boolean }): React.ReactElement {
  return (
    <div
      className="absolute"
      style={{
        translate: `${box.x}px ${box.y}px`,
        width: box.width,
        height: box.height,
        borderRadius: box.radius,
        border: `1px ${solid ? 'solid' : 'dashed'} ${colour}`,
        boxShadow: `0 0 0 0.5px ${colour}33`,
      }}
    >
      <span
        className="absolute -top-3.5 left-0 whitespace-nowrap"
        style={{ color: colour }}
      >
        {label} {Math.round(box.x)},{Math.round(box.y)} {Math.round(box.width)}×{Math.round(box.height)} r{box.radius.toFixed(1)}
      </span>
    </div>
  );
}

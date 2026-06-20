import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import { ThemeColors } from '../themes';
import { getConfig } from '../config';

// A premium "shimmer" — a bright cell sweeps left-to-right across the text, fading to dim on either
// side, so a label like "Pondering" pulses with light while the agent works. Stock Ink: each char
// is its own <Text> whose color is chosen by distance from the moving sweep position. Honors a
// reduced-motion preference (env BGW_REDUCED_MOTION) by rendering a calm static label instead.

/**
 * Reduced-motion opt-out: disables shimmer/spinner animation in favor of calm static glyphs (better
 * for screen readers + low-noise terminals). Enabled by the BGW_REDUCED_MOTION env (1/true/yes) OR
 * the persisted `reducedMotion` config flag (toggled in-session via /a11y).
 */
export function prefersReducedMotion(): boolean {
  const v = (process.env.BGW_REDUCED_MOTION || '').toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  try { return getConfig().reducedMotion === true; } catch { return false; }
}

/** Pure: pick a char's color by its distance from the sweep center. Bright at the center, dim away. */
export function shimmerColorAt(charIndex: number, pos: number, theme: ThemeColors): string {
  const d = Math.abs(charIndex - pos);
  if (d === 0) return theme.accentShimmer; // brightest cell
  if (d === 1) return theme.accent;        // halo
  return theme.subtle;                     // resting
}

interface ShimmerTextProps {
  text: string;
  theme: ThemeColors;
  bold?: boolean;
  /** ms per sweep step (default 90). */
  speed?: number;
}

export function ShimmerText({ text, theme, bold = true, speed = 90 }: ShimmerTextProps) {
  const reduced = prefersReducedMotion();
  const [pos, setPos] = useState(0);

  useEffect(() => {
    if (reduced) return;
    // Sweep across the text, then a short gap (the whole label rests dim) before repeating.
    const period = text.length + 6;
    const t = setInterval(() => setPos((p) => (p + 1) % period), speed);
    return () => clearInterval(t);
  }, [text.length, speed, reduced]);

  if (reduced) return <Text color={theme.accentShimmer} bold={bold}>{text}</Text>;

  return (
    <Text bold={bold}>
      {[...text].map((ch, i) => (
        <Text key={i} color={shimmerColorAt(i, pos, theme)}>{ch}</Text>
      ))}
    </Text>
  );
}

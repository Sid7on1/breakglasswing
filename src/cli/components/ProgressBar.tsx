import React from 'react';
import { Box, Text } from 'ink';
import { ThemeColors } from '../themes';

// A determinate progress bar that finally uses the progressFill/progressEmpty theme fields (defined
// in every theme but previously never rendered). Used for operations with a known fraction
// (e.g. "indexing file 12/40"). The bar geometry is a pure function so it's unit-testable.

/** Pure: how many of `width` cells are filled for a fraction in [0,1]. Clamps out-of-range input. */
export function filledCells(fraction: number, width: number): number {
  if (!(width > 0)) return 0;
  if (Number.isNaN(fraction)) return 0;
  // Math.min/max clamp ±Infinity to the [0,1] ends (over-full → full bar; negative → empty).
  const f = Math.max(0, Math.min(1, fraction));
  return Math.round(f * width);
}

interface ProgressBarProps {
  /** Completion fraction in [0,1]. */
  value: number;
  theme: ThemeColors;
  /** Total bar width in cells (default 24). */
  width?: number;
  /** Optional label shown before the bar. */
  label?: string;
  /** Show a trailing percentage (default true). */
  showPercent?: boolean;
}

export function ProgressBar({ value, theme, width = 24, label, showPercent = true }: ProgressBarProps) {
  const filled = filledCells(value, width);
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <Box flexDirection="row">
      {label ? <Text color={theme.subtle}>{label} </Text> : null}
      <Text color={theme.progressFill}>{'█'.repeat(filled)}</Text>
      <Text color={theme.progressEmpty}>{'░'.repeat(width - filled)}</Text>
      {showPercent ? <Text color={theme.subtle}> {pct}%</Text> : null}
    </Box>
  );
}

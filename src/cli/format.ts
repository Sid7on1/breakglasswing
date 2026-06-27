// Pure display formatters — no Ink, no side effects. Ported from Claude Code's
// src/utils/format.ts (formatDuration / formatSecondsShort) and trimmed to what the
// Bimax TUI needs. Used for the per-tool timing badge and elsewhere.

/**
 * Formats milliseconds as seconds with 1 decimal place (e.g. `1234` -> `"1.2s"`).
 * Always keeps the decimal — use for sub-minute timings where the fractional
 * second is meaningful (tool durations, TTFT, hook timings).
 */
export function formatSecondsShort(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Human-readable duration. Sub-minute → "0.3s" / "12s"; longer → "3m 12s",
 * "2h 3m 45s", "1d 2h 3m". Handles rounding carry-over (59.5s → "1m 0s").
 */
export function formatDuration(
  ms: number,
  options?: { hideTrailingZeros?: boolean; mostSignificantOnly?: boolean },
): string {
  if (ms < 60000) {
    if (ms === 0) return '0s';
    // Sub-second: show one decimal (e.g. 0.3s). Sub-minute whole seconds: "12s".
    if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 1000)}s`;
  }

  let days = Math.floor(ms / 86400000);
  let hours = Math.floor((ms % 86400000) / 3600000);
  let minutes = Math.floor((ms % 3600000) / 60000);
  let seconds = Math.round((ms % 60000) / 1000);

  // Rounding carry-over (59.5s rounds to 60s).
  if (seconds === 60) { seconds = 0; minutes++; }
  if (minutes === 60) { minutes = 0; hours++; }
  if (hours === 24) { hours = 0; days++; }

  const hide = options?.hideTrailingZeros;

  if (options?.mostSignificantOnly) {
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }

  if (days > 0) {
    if (hide && hours === 0 && minutes === 0) return `${days}d`;
    if (hide && minutes === 0) return `${days}d ${hours}h`;
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    if (hide && minutes === 0 && seconds === 0) return `${hours}h`;
    if (hide && seconds === 0) return `${hours}h ${minutes}m`;
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    if (hide && seconds === 0) return `${minutes}m`;
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/** Wall-clock duration of a tool call, or null while it is still running.
 *  Accepts Date or ISO-string timestamps (session JSONL reload serializes Dates). */
export function toolDurationMs(call: { startTime: Date | string; endTime?: Date | string }): number | null {
  if (!call.endTime) return null;
  const end = new Date(call.endTime).getTime();
  const start = new Date(call.startTime).getTime();
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  const ms = end - start;
  return ms >= 0 ? ms : null;
}

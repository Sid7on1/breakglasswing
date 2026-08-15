/**
 * Compact visual evidence attached to an accessibility element.
 *
 * RGB is useful for display/debugging, while OKLab is used for comparisons because equal numeric
 * distances are much closer to equal perceived colour changes.  The screenshot sampler normalizes
 * every image to sRGB before producing these values, so profiles and wide-gamut displays do not
 * silently change the meaning of a fingerprint.
 */
export interface VisualDominantColor {
  rgb: [number, number, number];
  coverage: number;
}

export interface VisualFingerprint {
  centerRgb: [number, number, number];
  medianRgb: [number, number, number];
  dominant: VisualDominantColor[];
  oklab: [number, number, number];
  luminance: number;
  chroma: number;
  colorName: string;
  entropy: number;
  confidence: number;
  sampleCount: number;
  sourceColorSpace: 'sRGB';
}

export interface VisualDelta {
  /** Euclidean distance in OKLab. Around 0.02 is a just-noticeable difference. */
  deltaE: number;
  luminanceDelta: number;
  changed: boolean;
  dominantChanged: boolean;
  beforeColorName: string;
  afterColorName: string;
}

export interface NativeVisualSignature {
  id?: unknown;
  center_rgb?: unknown;
  median_rgb?: unknown;
  dominant?: unknown;
  oklab?: unknown;
  luminance?: unknown;
  chroma?: unknown;
  color_name?: unknown;
  entropy?: unknown;
  confidence?: unknown;
  sample_count?: unknown;
  source_color_space?: unknown;
}

const finiteTuple3 = (value: unknown): [number, number, number] | null => {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const tuple = value.map(Number) as [number, number, number];
  return tuple.every(Number.isFinite) ? tuple : null;
};

const round = (value: number, places = 4): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** Validate the native boundary. Malformed sampler output is ignored, never trusted by targeting. */
export function parseVisualFingerprint(raw: NativeVisualSignature): VisualFingerprint | null {
  const centerRgb = finiteTuple3(raw.center_rgb);
  const medianRgb = finiteTuple3(raw.median_rgb);
  const oklab = finiteTuple3(raw.oklab);
  if (!centerRgb || !medianRgb || !oklab) return null;
  if (![...centerRgb, ...medianRgb].every(channel => channel >= 0 && channel <= 255)) return null;

  const dominant: VisualDominantColor[] = Array.isArray(raw.dominant)
    ? raw.dominant.flatMap((entry: any) => {
      const rgb = finiteTuple3(entry?.rgb);
      const coverage = Number(entry?.coverage);
      return rgb && rgb.every(channel => channel >= 0 && channel <= 255)
        && Number.isFinite(coverage) && coverage >= 0 && coverage <= 1
        ? [{ rgb, coverage: round(coverage) }]
        : [];
    }).slice(0, 3)
    : [];
  const numeric = {
    luminance: Number(raw.luminance), chroma: Number(raw.chroma), entropy: Number(raw.entropy),
    confidence: Number(raw.confidence), sampleCount: Number(raw.sample_count),
  };
  if (!Object.values(numeric).every(Number.isFinite)) return null;
  if (numeric.confidence < 0 || numeric.confidence > 1 || numeric.sampleCount < 1) return null;

  return {
    centerRgb: centerRgb.map(Math.round) as [number, number, number],
    medianRgb: medianRgb.map(Math.round) as [number, number, number],
    dominant,
    oklab: oklab.map(value => round(value, 6)) as [number, number, number],
    luminance: round(numeric.luminance, 6),
    chroma: round(numeric.chroma, 6),
    colorName: String(raw.color_name || 'unknown').toLocaleLowerCase(),
    entropy: round(numeric.entropy),
    confidence: round(numeric.confidence),
    sampleCount: Math.floor(numeric.sampleCount),
    sourceColorSpace: 'sRGB',
  };
}

export function diffVisualFingerprints(before: VisualFingerprint, after: VisualFingerprint, threshold = 0.035): VisualDelta {
  const deltaE = Math.hypot(
    after.oklab[0] - before.oklab[0],
    after.oklab[1] - before.oklab[1],
    after.oklab[2] - before.oklab[2],
  );
  const beforeDominant = before.dominant[0]?.rgb;
  const afterDominant = after.dominant[0]?.rgb;
  const dominantChanged = !!beforeDominant && !!afterDominant
    && Math.hypot(
      afterDominant[0] - beforeDominant[0],
      afterDominant[1] - beforeDominant[1],
      afterDominant[2] - beforeDominant[2],
    ) >= 24;
  return {
    deltaE: round(deltaE, 6),
    luminanceDelta: round(after.luminance - before.luminance, 6),
    changed: deltaE >= threshold,
    dominantChanged,
    beforeColorName: before.colorName,
    afterColorName: after.colorName,
  };
}

/** Stable enough across successive frames, but intentionally scoped by caller to one window. */
export function visualElementIdentity(element: {
  role?: unknown; label?: unknown; original_label?: unknown; originalLabel?: unknown;
  context_label?: unknown; contextLabel?: unknown; value?: unknown; frame?: any;
  element_index?: unknown; elementIndex?: unknown;
}): string {
  return visualElementIdentities(element)[0];
}

/** Multiple aliases survive both AX traversal-index churn and a few pixels of layout drift. */
export function visualElementIdentities(element: {
  role?: unknown; label?: unknown; original_label?: unknown; originalLabel?: unknown;
  context_label?: unknown; contextLabel?: unknown; value?: unknown; frame?: any;
  element_index?: unknown; elementIndex?: unknown;
}): string[] {
  const frame = element.frame || {};
  const nativeText = String(
    element.original_label || element.originalLabel || element.context_label || element.contextLabel
      || element.label || element.value || '',
  ).normalize('NFKC').toLocaleLowerCase().trim().slice(0, 120);
  const prefix = `${String(element.role || '')}|${nativeText}`;
  const aliases: string[] = [];
  const index = Number(element.element_index ?? element.elementIndex);
  if (Number.isInteger(index) && index >= 0) aliases.push(`${prefix}|index:${index}`);
  // Two staggered 12px grids: when a control crosses a boundary in one grid after normal layout
  // jitter, it remains in the same bucket in the other. Text/role keep neighbouring controls apart.
  for (const offset of [0, 6]) {
    const quantize = (value: unknown) => Math.floor((Number(value || 0) + offset) / 12);
    aliases.push([
      prefix, `grid:${offset}`,
      quantize(frame.x), quantize(frame.y), quantize(frame.w), quantize(frame.h),
    ].join('|'));
  }
  return [...new Set(aliases)];
}

/** Token-budgeted form shown to the model; full fingerprints stay available in internal traces. */
export function compactVisualEvidence(fingerprint?: VisualFingerprint, delta?: VisualDelta): Record<string, unknown> | undefined {
  if (!fingerprint) return undefined;
  return {
    color: fingerprint.colorName,
    rgb: fingerprint.medianRgb,
    confidence: fingerprint.confidence,
    ...(delta ? { deltaE: delta.deltaE, changed: delta.changed } : {}),
  };
}

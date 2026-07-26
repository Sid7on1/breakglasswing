import { DESKTOP_HELPER_SOURCE } from '../computer/helper.source';
import {
  diffVisualFingerprints, parseVisualFingerprint, visualElementIdentity, VisualFingerprint,
} from '../computer/visual.fingerprint';
import { rankSemanticTargets } from '../computer/semantic.targeting';

const native = (overrides: Record<string, unknown> = {}) => ({
  id: 'sample', center_rgb: [30, 120, 240], median_rgb: [32, 118, 238],
  dominant: [{ rgb: [32, 118, 238], coverage: 0.75 }],
  oklab: [0.61, -0.02, -0.18], luminance: 0.21, chroma: 0.181,
  color_name: 'blue', entropy: 0.23, confidence: 0.96, sample_count: 49,
  source_color_space: 'sRGB', ...overrides,
});

describe('colour fingerprint boundary and temporal state', () => {
  it('accepts bounded native evidence and preserves explicit sRGB semantics', () => {
    expect(parseVisualFingerprint(native())).toEqual(expect.objectContaining({
      medianRgb: [32, 118, 238], colorName: 'blue', confidence: 0.96,
      sourceColorSpace: 'sRGB',
    }));
  });

  it('rejects malformed or impossible native RGB instead of feeding it to targeting', () => {
    expect(parseVisualFingerprint(native({ median_rgb: [500, 0, 0] }))).toBeNull();
    expect(parseVisualFingerprint(native({ confidence: 4 }))).toBeNull();
    expect(parseVisualFingerprint(native({ oklab: ['?', 0, 0] }))).toBeNull();
  });

  it('distinguishes screenshot noise from a meaningful perceived colour change', () => {
    const before = parseVisualFingerprint(native())!;
    const tiny: VisualFingerprint = { ...before, oklab: [0.615, -0.018, -0.181], luminance: 0.212 };
    const changed: VisualFingerprint = { ...before, oklab: [0.72, 0.11, 0.08], luminance: 0.42, colorName: 'orange' };
    expect(diffVisualFingerprints(before, tiny).changed).toBe(false);
    expect(diffVisualFingerprints(before, changed)).toEqual(expect.objectContaining({
      changed: true, beforeColorName: 'blue', afterColorName: 'orange',
    }));
  });

  it('uses a quantized semantic+geometry identity across subpixel observation drift', () => {
    const a = visualElementIdentity({ role: 'AXButton', label: 'Send', frame: { x: 61, y: 121, w: 80, h: 30 } });
    const b = visualElementIdentity({ role: 'AXButton', label: 'Send', frame: { x: 62, y: 122, w: 80, h: 30 } });
    expect(a).toBe(b);
  });

  it('uses colour to disambiguate a named control but refuses colour-only clicking', () => {
    const elements = [
      { elementIndex: 1, label: 'Send', role: 'AXButton', visual: { colorName: 'gray', confidence: 0.9 } },
      { elementIndex: 2, label: 'Send', role: 'AXButton', visual: { colorName: 'blue', confidence: 0.9 } },
    ];
    const resolved = rankSemanticTargets('blue Send button', elements);
    expect(resolved.confidence).toBe('high');
    expect(resolved.ranked[0].element.elementIndex).toBe(2);
    expect(resolved.ranked[0].reasons).toContain('sRGB colour matched');

    const refused = rankSemanticTargets('click the blue button', elements);
    expect(refused.confidence).toBe('none');
  });

  it('keeps the native sampler profile-aware and top-left aligned by contract', () => {
    expect(DESKTOP_HELPER_SOURCE).toContain('CGColorSpace(name: CGColorSpace.sRGB)');
    expect(DESKTOP_HELPER_SOURCE).toContain('context.translateBy(x: 0, y: CGFloat(pixelHeight))');
    expect(DESKTOP_HELPER_SOURCE).toContain('case "visual-signatures":');
    expect(DESKTOP_HELPER_SOURCE).toContain('regions.prefix(160)');
  });
});

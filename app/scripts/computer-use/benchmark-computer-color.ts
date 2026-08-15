/** Hermetic benchmark for colour-state fusion. No applications are opened and no input is sent. */
import { rankSemanticTargets } from '../../src/capabilities/mac/semantic.targeting';
import { diffVisualFingerprints, parseVisualFingerprint } from '../../src/capabilities/mac/visual.fingerprint';

const raw = {
  center_rgb: [30, 120, 240], median_rgb: [32, 118, 238],
  dominant: [{ rgb: [32, 118, 238], coverage: 0.8 }],
  oklab: [0.61, -0.02, -0.18], luminance: 0.21, chroma: 0.181,
  color_name: 'blue', entropy: 0.2, confidence: 0.96, sample_count: 49,
  source_color_space: 'sRGB',
};
const blue = parseVisualFingerprint(raw)!;
const orange = { ...blue, oklab: [0.73, 0.11, 0.09] as [number, number, number], luminance: 0.44, colorName: 'orange' };
const cases = [
  { name: 'valid native boundary', passed: !!blue && blue.sourceColorSpace === 'sRGB' },
  { name: 'invalid RGB refused', passed: parseVisualFingerprint({ ...raw, median_rgb: [-1, 0, 0] }) === null },
  { name: 'stable noise ignored', passed: !diffVisualFingerprints(blue, { ...blue, oklab: [0.612, -0.019, -0.181] }).changed },
  { name: 'perceived state change detected', passed: diffVisualFingerprints(blue, orange).changed },
  { name: 'named colour target resolved', passed: rankSemanticTargets('blue Send button', [
    { elementIndex: 1, label: 'Send', role: 'AXButton', visual: { colorName: 'gray', confidence: 0.9 } },
    { elementIndex: 2, label: 'Send', role: 'AXButton', visual: { colorName: 'blue', confidence: 0.9 } },
  ]).ranked[0]?.element.elementIndex === 2 },
  { name: 'colour-only click refused', passed: rankSemanticTargets('click the blue button', [
    { elementIndex: 1, label: 'Delete', role: 'AXButton', visual: { colorName: 'blue', confidence: 0.9 } },
  ]).confidence === 'none' },
];

const samples: number[] = [];
for (let i = 0; i < 20_000; i++) {
  const started = process.hrtime.bigint();
  diffVisualFingerprints(blue, orange);
  rankSemanticTargets('blue Send button', [
    { elementIndex: 1, label: 'Send', role: 'AXButton', visual: { colorName: 'gray', confidence: 0.9 } },
    { elementIndex: 2, label: 'Send', role: 'AXButton', visual: { colorName: 'blue', confidence: 0.9 } },
  ]);
  samples.push(Number(process.hrtime.bigint() - started) / 1e6);
}
samples.sort((a, b) => a - b);
const percentile = (p: number) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)];
const passed = cases.filter(test => test.passed).length;
const report = {
  ok: passed === cases.length, passed, total: cases.length,
  fusionLatencyMs: { p50: percentile(0.5), p95: percentile(0.95), worst: samples[samples.length - 1] },
  cases,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

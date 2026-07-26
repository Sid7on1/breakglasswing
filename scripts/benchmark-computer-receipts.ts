/** Hermetic benchmark for element/keyboard Action Receipts. Sends no desktop input. */
import { compareKeyboardFocus, matchHitElement, sameNativeElement } from '../src/computer/action.receipt';

const expected = { role: 'AXButton', label: 'Send', frame: { x: 100, y: 200, w: 80, h: 32 } };
const send = { pid: 42, role: 'AXButton', title: 'Send', frame: { x: 100, y: 200, w: 80, h: 32 }, enabled: true };
const cases = [
  { name: 'exact live element', passed: matchHitElement(expected, [send]).matched },
  { name: 'parent chain resolution', passed: matchHitElement(expected, [
    { pid: 42, role: 'AXStaticText', title: 'Send', frame: { x: 110, y: 205, w: 40, h: 20 } }, send,
  ]).recipient?.role === 'AXButton' },
  { name: 'contradictory label refused', passed: !matchHitElement(expected, [{ ...send, title: 'Delete' }]).matched },
  { name: 'moved target detected', passed: sameNativeElement(send, { ...send, frame: { x: 300, y: 200, w: 80, h: 32 } }) === false },
  { name: 'input field receipt', passed: compareKeyboardFocus(42,
    { pid: 42, role: 'AXTextArea', identifier: 'composer', editable: true, valueLength: 0, selectedRange: { location: 0, length: 0 } },
    { pid: 42, role: 'AXTextArea', identifier: 'composer', editable: true, valueLength: 5, selectedRange: { location: 5, length: 0 } },
  ).inputObserved },
  { name: 'wrong keyboard process refused', passed: !compareKeyboardFocus(42,
    { pid: 99, role: 'AXTextArea', editable: true }, undefined,
  ).recipientMatched },
];

const samples: number[] = [];
for (let i = 0; i < 20_000; i++) {
  const started = process.hrtime.bigint();
  matchHitElement(expected, [send]);
  compareKeyboardFocus(42,
    { pid: 42, role: 'AXTextArea', identifier: 'composer', editable: true, valueLength: 0, selectedRange: { location: 0, length: 0 } },
    { pid: 42, role: 'AXTextArea', identifier: 'composer', editable: true, valueLength: 5, selectedRange: { location: 5, length: 0 } },
  );
  samples.push(Number(process.hrtime.bigint() - started) / 1e6);
}
samples.sort((a, b) => a - b);
const percentile = (p: number) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)];
const passed = cases.filter(test => test.passed).length;
const report = {
  ok: passed === cases.length, passed, total: cases.length,
  receiptScoringLatencyMs: { p50: percentile(0.5), p95: percentile(0.95), worst: samples.at(-1) },
  cases,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

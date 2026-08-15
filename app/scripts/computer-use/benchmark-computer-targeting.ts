/** Hermetic universal-targeting benchmark. No applications are opened and no input is delivered. */
import { rankSemanticTargets, SemanticElement } from '../../src/capabilities/mac/semantic.targeting';

const button = (elementIndex: number, label: string, x: number, extra: Partial<SemanticElement> = {}): SemanticElement => ({
  elementIndex, label, role: 'AXButton', enabled: true, frame: { x, y: 10, w: 30, h: 30 }, ...extra,
});

const cases: Array<{
  name: string;
  query: string;
  elements: SemanticElement[];
  expectedIndex?: number;
  abstain?: boolean;
}> = [
  { name: 'exact native label', query: 'Save', elements: [button(1, 'Cancel', 10), button(2, 'Save', 50)], expectedIndex: 2 },
  { name: 'affordance synonym', query: 'submit button', elements: [button(1, 'Cancel', 10), button(2, 'Send', 50)], expectedIndex: 2 },
  { name: 'minor typo', query: 'notifcations', elements: [button(1, 'Network', 10), button(2, 'Notifications', 50)], expectedIndex: 2 },
  { name: 'heading/control collision', query: 'Chats', elements: [
    { elementIndex: 1, label: 'Chats', role: 'AXHeading', frame: { x: 10, y: 10, w: 100, h: 30 } },
    button(2, 'Chats', 50),
  ], expectedIndex: 2 },
  { name: 'duplicate controls abstain', query: 'Chats', elements: [button(1, 'Chats', 10), button(2, 'Chats', 50)], abstain: true },
  { name: 'disabled control excluded', query: 'Continue', elements: [
    button(1, 'Continue', 10, { enabled: false }), button(2, 'Next', 50),
  ], expectedIndex: 2 },
  { name: 'ordinal unlabeled icon', query: 'second button from left', elements: [
    button(1, '', 300), button(2, '', 100), button(3, '', 200),
  ], expectedIndex: 3 },
  { name: 'relational icon label', query: 'button right of Type a message', elements: [
    button(1, 'left of "Type a message" #1', 10), button(2, 'right of "Type a message" #2', 300),
  ], expectedIndex: 2 },
  { name: 'composer role plus text', query: 'message composer', elements: [
    { elementIndex: 1, label: 'Title', role: 'AXTextField', frame: { x: 10, y: 10, w: 100, h: 30 } },
    { elementIndex: 2, label: 'Type a message', role: 'AXTextArea', frame: { x: 10, y: 50, w: 300, h: 60 } },
  ], expectedIndex: 2 },
  { name: 'role-only ambiguity abstains', query: 'click the button', elements: [button(1, 'Delete', 10), button(2, 'Archive', 50)], abstain: true },
];

const samples: number[] = [];
const results = cases.map(test => {
  let ranking = rankSemanticTargets(test.query, test.elements);
  for (let i = 0; i < 1000; i++) {
    const started = process.hrtime.bigint();
    ranking = rankSemanticTargets(test.query, test.elements);
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  const predicted = ranking.confidence === 'none' || ranking.ambiguous || ranking.confidence === 'low'
    ? undefined
    : ranking.ranked[0]?.element.elementIndex;
  const passed = test.abstain ? predicted == null : predicted === test.expectedIndex;
  return { name: test.name, passed, predicted: predicted ?? 'abstain', expected: test.abstain ? 'abstain' : test.expectedIndex, confidence: ranking.confidence, margin: ranking.margin };
});

samples.sort((a, b) => a - b);
const percentile = (p: number) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)];
const passed = results.filter(result => result.passed).length;
const report = {
  ok: passed === results.length,
  accuracy: passed / results.length,
  passed,
  total: results.length,
  resolverLatencyMs: { p50: percentile(0.5), p95: percentile(0.95), worst: samples[samples.length - 1] },
  results,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

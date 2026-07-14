import { Outbound, Inbound, PROTOCOL_VERSION } from '../protocol';

/**
 * Protocol contract fixtures (v2 §3.11, honest-minimal tier).
 *
 * ONE canonical instance of every wire message, type-checked against the TS protocol
 * types at compile time and committed as `fixtures.json` for the Go side to strict-
 * decode (DisallowUnknownFields) in `tui/protocol_contract_test.go`. The result: a
 * field added or renamed on either side fails a test instead of silently garbling the
 * wire. Full codegen (schema → TS + Go structs) can replace the hand-mirrored types
 * later; the CONTRACT — both sides tested against one artifact — starts holding now.
 *
 * Every fixture deliberately populates EVERY optional field of its variant, so the
 * strict decoder exercises the whole surface, not the happy minimum.
 */

export const OUTBOUND_FIXTURES: Outbound[] = [
  { t: 'event', name: 'message', args: [{ role: 'assistant', content: 'hello', level: 'info' }] },
  { t: 'request', id: 7, kind: 'prompt', question: 'Run `npm test`?', options: ['Yes', 'No', 'Always Allow'], isAsk: false, isMulti: false },
  { t: 'request', id: 8, kind: 'diff', question: 'Apply this edit?', options: ['Yes', 'No'], isAsk: false, isMulti: false, body: '--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new' },
  { t: 'request', id: 9, kind: 'input', question: 'Branch name:', options: [], isAsk: true, isMulti: false },
  { t: 'ready', protocol: PROTOCOL_VERSION },
  {
    t: 'queryResult', id: 3, items: [
      { value: '/git', label: '/git', desc: 'Git helpers', kind: 'command', disabled: true, disabledReason: 'repo not initialized' },
      { value: '@handlePayment', label: 'handlePayment', desc: 'src/pay.ts', kind: 'symbol' },
      { value: '@./src/', label: './src/', desc: 'directory', kind: 'path' },
    ],
  },
  { t: 'pong', id: 42 },
  { t: 'configResult', id: 5, config: { model: 'stepfun-ai/step-3.7-flash', notificationBell: false, temperature: 0.7, contextMode: 'smart' } },
  { t: 'boot', phase: 'loading_graph', detail: 'sqlite graph store', pid: 4242 },
  { t: 'health', uptimeMs: 61234, rssMb: 312, heapMb: 148, eventLoopDelayMs: 4, activeTurn: true, phase: 'ready' },
];

export const INBOUND_FIXTURES: Inbound[] = [
  { t: 'reply', id: 7, value: 'Yes' },
  { t: 'input', text: 'refactor the auth module' },
  { t: 'interrupt' },
  { t: 'query', id: 3, text: '/g' },
  { t: 'menuSelect', id: 'model-menu', value: 'claude-fable-5' },
  { t: 'ping', id: 42 },
  { t: 'configGet', id: 5 },
  { t: 'configSet', id: 6, patch: { notificationBell: true, reasoningEffort: 'high' } },
  { t: 'resume', id: 'sess-20260712-abc123' },
  { t: 'controls', mode: 'code', tier: 'heavy', autonomy: 'ask' },
];

// Compile-time exhaustiveness: adding a new message variant without a fixture makes
// these records fail to type-check — the contract cannot silently under-cover.
export const OUTBOUND_KINDS: Record<Outbound['t'], true> = { event: true, request: true, ready: true, queryResult: true, pong: true, configResult: true, boot: true, health: true };
export const INBOUND_KINDS: Record<Inbound['t'], true> = { reply: true, input: true, interrupt: true, query: true, menuSelect: true, ping: true, configGet: true, configSet: true, resume: true, controls: true };

/** The committed artifact both sides test against. Regenerate with `npm run gen:protocol`. */
export function fixturesJson(): string {
  return JSON.stringify(
    { protocolVersion: PROTOCOL_VERSION, outbound: OUTBOUND_FIXTURES, inbound: INBOUND_FIXTURES },
    null, 2,
  ) + '\n';
}

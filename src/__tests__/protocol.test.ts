import { EventEmitter } from 'events';
import { encode, LineDecoder } from '../protocol/codec';
import { ProtocolHost } from '../protocol/host';
import { Outbound, Inbound, sanitizeArgs, PROTOCOL_VERSION } from '../protocol/protocol';

// The protocol is the keystone of the hybrid TUI split: it lets the unchanged Node engine drive
// an out-of-process front-end. These tests pin the wire framing and the engine-side host's two
// jobs — forwarding events out, and turning the GlobalPrompter callback into a request/reply.

describe('codec — NDJSON framing', () => {
  it('round-trips a message', () => {
    const dec = new LineDecoder<Outbound>();
    const [msg] = dec.push(encode({ t: 'ready', protocol: 1 }));
    expect(msg).toEqual({ t: 'ready', protocol: 1 });
  });

  it('reassembles a message split across chunks and splits coalesced ones', () => {
    const dec = new LineDecoder<any>();
    expect(dec.push('{"t":"input",')).toEqual([]);          // partial line buffered
    const out = dec.push('"text":"hi"}\n{"t":"interrupt"}\n'); // completion + a second message
    expect(out).toEqual([{ t: 'input', text: 'hi' }, { t: 'interrupt' }]);
  });

  it('skips malformed lines via onError instead of throwing', () => {
    const bad: string[] = [];
    const dec = new LineDecoder<any>((line) => bad.push(line));
    const out = dec.push('not json\n{"t":"interrupt"}\n');
    expect(out).toEqual([{ t: 'interrupt' }]);
    expect(bad).toEqual(['not json']);
  });
});

describe('sanitizeArgs', () => {
  it('nulls out functions and marks React elements, keeping JSON-safe data', () => {
    const reactEl = { $$typeof: Symbol.for('react.element'), type: { name: 'Menu' } };
    const out = sanitizeArgs(['hello', 42, () => {}, reactEl, { ok: true }]);
    // A bare function arg is not valid JSON, so it collapses to null on the wire (not undefined).
    expect(out).toEqual(['hello', 42, null, { __ui: 'Menu' }, { ok: true }]);
  });
});

describe('ProtocolHost', () => {
  let emitter: EventEmitter;
  let sent: Outbound[];
  let host: ProtocolHost;
  let inputs: string[];

  beforeEach(() => {
    emitter = new EventEmitter();
    sent = [];
    inputs = [];
    host = new ProtocolHost((m) => sent.push(m), { onInput: (t) => inputs.push(t) });
    host.attach(emitter);
  });
  afterEach(() => host.detach());

  it('emits a handshake on attach', () => {
    expect(sent[0]).toEqual({ t: 'ready', protocol: PROTOCOL_VERSION });
  });

  it('forwards a cliEvents emit as an event message with sanitized args', () => {
    emitter.emit('status', 'Indexing…');
    expect(sent).toContainEqual({ t: 'event', name: 'status', args: ['Indexing…'] });
  });

  it('translates a veto_prompt into a request and resolves it on the matching reply', () => {
    let answer: string | undefined;
    // GlobalPrompter emits veto_prompt(question, options, resolve).
    emitter.emit('veto_prompt', 'Run rm -rf?', ['Yes', 'No'], (a: string) => { answer = a; });

    const req = sent.find(m => m.t === 'request') as any;
    expect(req).toMatchObject({ t: 'request', kind: 'prompt', question: 'Run rm -rf?', options: ['Yes', 'No'] });
    expect(host.pendingCount()).toBe(1);

    host.ingest({ t: 'reply', id: req.id, value: 'No' } as Inbound);
    expect(answer).toBe('No');
    expect(host.pendingCount()).toBe(0);
  });

  it('translates a diff_prompt into a diff request carrying the diff body', () => {
    let approved: string | undefined;
    emitter.emit('diff_prompt', 'Edit foo.ts', '@@ -1 +1 @@\n-old\n+new', (a: string) => { approved = a; });

    const req = sent.find(m => m.t === 'request') as any;
    expect(req).toMatchObject({ t: 'request', kind: 'diff', question: 'Edit foo.ts', options: ['Approve', 'Reject'] });
    expect(req.body).toContain('+new');

    host.ingest({ t: 'reply', id: req.id, value: 'Approve' } as Inbound);
    expect(approved).toBe('Approve');
  });

  it('routes inbound input to the handler and ignores stale replies', () => {
    host.ingest({ t: 'input', text: 'refactor the parser' });
    expect(inputs).toEqual(['refactor the parser']);
    expect(() => host.ingest({ t: 'reply', id: 999, value: 'x' } as Inbound)).not.toThrow();
  });

  it('does not leak listeners after detach', () => {
    expect(emitter.listenerCount('status')).toBe(1);
    host.detach();
    expect(emitter.listenerCount('status')).toBe(0);
  });
});

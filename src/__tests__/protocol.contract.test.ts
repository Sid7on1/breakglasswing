import * as fs from 'fs';
import * as path from 'path';
import { OUTBOUND_FIXTURES, INBOUND_FIXTURES, OUTBOUND_KINDS, INBOUND_KINDS, fixturesJson } from '../protocol/schema/fixtures';
import { PROTOCOL_VERSION } from '../protocol/protocol';

/**
 * TS half of the protocol contract (v2 §3.11). The Go half lives in
 * tui/protocol_contract_test.go and strict-decodes the same committed artifact —
 * so a wire change that touches only one side fails a test on the other.
 */
describe('protocol contract — fixtures are the single source both sides test against', () => {
  const artifact = path.join(__dirname, '..', 'protocol', 'schema', 'fixtures.json');

  it('the committed fixtures.json matches the type-checked TS fixtures (run `npm run gen:protocol` after protocol changes)', () => {
    const onDisk = fs.readFileSync(artifact, 'utf-8');
    expect(onDisk).toBe(fixturesJson());
  });

  it('every outbound and inbound discriminator has a fixture', () => {
    const outSeen = new Set(OUTBOUND_FIXTURES.map(f => f.t));
    for (const k of Object.keys(OUTBOUND_KINDS)) expect(outSeen.has(k as any)).toBe(true);
    const inSeen = new Set(INBOUND_FIXTURES.map(f => f.t));
    for (const k of Object.keys(INBOUND_KINDS)) expect(inSeen.has(k as any)).toBe(true);
  });

  it('the artifact carries the live protocol version — the Go side handshake-checks against it', () => {
    const parsed = JSON.parse(fs.readFileSync(artifact, 'utf-8'));
    expect(parsed.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('fixtures survive an NDJSON round-trip byte-for-byte (what actually crosses the pipe)', () => {
    for (const f of [...OUTBOUND_FIXTURES, ...INBOUND_FIXTURES]) {
      const line = JSON.stringify(f);
      expect(line.includes('\n')).toBe(false); // one message = one line, framing invariant
      expect(JSON.parse(line)).toEqual(f);
    }
  });
});

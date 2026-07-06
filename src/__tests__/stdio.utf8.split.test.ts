import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { startStdioHost } from '../protocol/stdio.host';

// A multibyte UTF-8 character split across two pipe reads must decode intact — per-chunk
// Buffer.toString('utf8') turns the split character into U+FFFD replacement garbage.
describe('stdio host — UTF-8 split across chunks', () => {
  it('reassembles an emoji split mid-sequence across two data events', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const received: string[] = [];

    const dispose = startStdioHost({
      emitter: new EventEmitter(),
      input,
      output,
      onInput: (text) => received.push(text),
    });

    const line = Buffer.from(JSON.stringify({ t: 'input', text: 'fix the 🚀 launcher' }) + '\n', 'utf8');
    // Split INSIDE the 4-byte rocket emoji sequence.
    const rocketAt = line.indexOf(Buffer.from('🚀'));
    const cut = rocketAt + 2;
    input.write(line.subarray(0, cut));
    await new Promise(r => setImmediate(r));
    input.write(line.subarray(cut));
    await new Promise(r => setImmediate(r));

    expect(received).toEqual(['fix the 🚀 launcher']);
    expect(received[0]).not.toContain('�');
    dispose();
  });
});

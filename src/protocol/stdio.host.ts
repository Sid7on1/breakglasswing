import { EventEmitter } from 'events';
import { StringDecoder } from 'string_decoder';
import { ProtocolHost, HostHandlers } from './host';
import { LineDecoder, encode } from './codec';
import { Inbound, Outbound } from './protocol';

export interface StdioHostOptions extends HostHandlers {
  emitter: EventEmitter;            // the engine's cliEvents
  input?: NodeJS.ReadableStream;    // defaults to process.stdin
  output?: NodeJS.WritableStream;   // defaults to process.stdout
}

/**
 * Bind a {@link ProtocolHost} to real process streams: engine events go out as NDJSON on stdout,
 * the front-end's NDJSON commands come in on stdin. This is the only place that touches the OS
 * pipes; everything above it is transport-agnostic and unit-tested. Activated solely in headless
 * mode (e.g. when the Go TUI spawns the engine) — never on the in-process Ink path.
 *
 * Returns a disposer that detaches listeners and stops reading stdin.
 */
export function startStdioHost(opts: StdioHostOptions): () => void {
  const out = opts.output ?? process.stdout;
  const inp = opts.input ?? process.stdin;

  const host = new ProtocolHost(
    (msg: Outbound) => out.write(encode(msg)),
    {
      onInput: opts.onInput, onInterrupt: opts.onInterrupt, onQuery: opts.onQuery,
      onMenuSelect: opts.onMenuSelect, onConfigGet: opts.onConfigGet, onConfigSet: opts.onConfigSet,
      onResume: opts.onResume, onControls: opts.onControls,
    },
  );

  const decoder = new LineDecoder<Inbound>((line, err) =>
    process.stderr.write(`[stdio.host] dropped malformed line: ${String(err)}\n`));

  // StringDecoder, NOT per-chunk Buffer.toString: a pipe read can split a multibyte UTF-8
  // character (emoji/CJK in a user message) across two chunks, and decoding each chunk
  // independently turns the split character into U+FFFD garbage. StringDecoder buffers the
  // partial sequence until the rest arrives.
  const utf8 = new StringDecoder('utf8');
  const onData = (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : utf8.write(chunk);
    for (const msg of decoder.push(text)) host.ingest(msg);
  };

  inp.on('data', onData);
  if (typeof (inp as any).resume === 'function') (inp as any).resume();
  host.attach(opts.emitter);

  return () => {
    inp.off('data', onData);
    host.detach();
  };
}

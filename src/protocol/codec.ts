import { Outbound, Inbound } from './protocol';

// NDJSON framing for the UI protocol. One JSON object per line; '\n' is the record separator.
// Chosen over length-prefixed binary because it's trivially debuggable (you can `tee` the pipe
// and read it) and both Node and Go have first-class line + JSON handling.

/** Serialize a message to a single wire line (terminating newline included). */
export function encode(msg: Outbound | Inbound): string {
  return JSON.stringify(msg) + '\n';
}

/**
 * Incremental line decoder. Feed it arbitrary chunks (a TCP/pipe read can split or coalesce
 * lines); it buffers partial data and yields one parsed object per completed line. Malformed
 * lines are passed to `onError` and skipped rather than throwing — a single bad line must not
 * tear down the session.
 */
export class LineDecoder<T = Inbound | Outbound> {
  private buffer = '';

  constructor(private onError?: (line: string, err: unknown) => void) {}

  /** Push a chunk; returns every fully-formed message it completed. */
  push(chunk: string): T[] {
    this.buffer += chunk;
    const out: T[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed) continue; // tolerate blank/keepalive lines
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch (err) {
        this.onError?.(trimmed, err);
      }
    }
    return out;
  }
}

import { Writable } from 'stream';

const BSU = '\x1b[?2026h';
const ESU = '\x1b[?2026l';

/**
 * Intercepts Ink v3's output and converts full-frame rewrites into
 * atomic, diff-based line patches wrapped with DEC 2026 Synchronized
 * Output (BSU/ESU). Eliminates terminal resize flicker by:
 *
 * 1. Stripping Ink's line-based update sequences (which rely on stale
 *    cursor positions after resize) and replacing with absolute
 *    cursor-positioned writes.
 * 2. Wrapping the entire frame in BSU/ESU so the terminal buffers all
 *    writes and paints atomically — no partial frames visible.
 *
 * Ink v3 outputs frames as:
 *   First frame:  "content\n"
 *   Updates:      "\x1b[2K\x1b[1A\x1b[2K\x1b[Gcontent\n"
 */
export class FrameBuffer extends Writable {
  private prevLines: string[] = [];
  private firstFrame = true;

  constructor(private terminal: typeof process.stdout) {
    super();
    if (terminal.isTTY) {
      terminal.on('resize', () => this.emit('resize'));
    }
  }

  get isTTY() { return this.terminal.isTTY; }
  get columns() { return this.terminal.columns; }
  get rows() { return this.terminal.rows; }

  private isAltScreen(str: string) {
    return str.includes('\x1b[?1049');
  }

  /** True when Ink writes a frame update (not a one-off control sequence) */
  private isFrame(str: string) {
    return str.includes('\x1b[2K') || str.includes('\x1b[1A');
  }

  /** Extract just the display content from Ink's frame output */
  private extractContent(str: string): string | null {
    const gIdx = str.lastIndexOf('\x1b[G');
    return gIdx >= 0 ? str.slice(gIdx + 3) : (this.firstFrame ? str : null);
  }

  _write(chunk: any, encoding: string, callback: () => void) {
    const str = chunk.toString();

    // Pass through alt-screen enter/exit sequences unchanged
    if (this.isAltScreen(str)) {
      this.terminal.write(str);
      callback();
      return;
    }

    // Extract frame content or pass through non-frame writes
    const content = this.extractContent(str);
    if (!this.isFrame(str) && !this.firstFrame) {
      this.terminal.write(str);
      callback();
      return;
    }

    if (content === null || !content.trim()) {
      callback();
      return;
    }

    const lines = content.split('\n');

    if (this.firstFrame) {
      this.firstFrame = false;
      this.prevLines = lines;
      this.terminal.write(content + '\n');
      callback();
      return;
    }

    // Build diff: write only changed lines at absolute positions
    const max = Math.max(this.prevLines.length, lines.length);
    let output = BSU;
    let hasChanges = false;

    for (let i = 0; i < max; i++) {
      const prev = this.prevLines[i] || '';
      const next = lines[i] || '';
      if (prev !== next) {
        output += `\x1b[${i + 1};1H${next}`;
        if (prev.length > next.length) {
          output += '\x1b[0K';
        }
        hasChanges = true;
      }
    }

    if (hasChanges) {
      output += ESU;
      this.terminal.write(output);
    }

    this.prevLines = lines;
    callback();
  }
}

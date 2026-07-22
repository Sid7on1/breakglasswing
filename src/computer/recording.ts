import * as fs from 'fs';
import * as path from 'path';
import { sweepRecordings } from './durability';

/**
 * RecordingController — the single owner of computer-use screen-recording state.
 *
 * Invariants (privacy-by-default):
 *   1. Recording NEVER starts implicitly. There is no auto-record path: only an explicit
 *      `record_start` action reaches {@link start}, and the runtime gates that on the opt-in
 *      `computerRecord` config being true.
 *   2. Whole-display video capture requires explicit approval. When no capture-safe window scope
 *      exists, {@link start} refuses video recording unless `approveFullDisplay` is true — which
 *      the runtime derives ONLY from a valid single-use token minted after a governor-approved
 *      whole-display prompt (never from any model-controlled argument).
 *   3. The reported scope is the truth about what was REQUESTED. Passing pid/window_id to the
 *      driver is best-effort, so `captureSafe` is false whenever the request was not window-scoped.
 */
export interface RecordingScopeTarget { pid: number; windowId: number; label: string }

export interface RecordingStatus {
  enabled: boolean;
  outputDir?: string;
  videoPath?: string;
  error?: string;
  scope?: string;
  captureSafe?: boolean;
}

export class RecordingController {
  private startedFlag = false;
  private dir: string | undefined;
  private lastError: string | undefined;
  private scopeLabel: string | undefined;
  private scopeCaptureSafe: boolean | undefined;

  get started(): boolean { return this.startedFlag; }
  get outputDir(): string | undefined { return this.dir; }
  get error(): string | undefined { return this.lastError; }
  get scope(): string | undefined { return this.scopeLabel; }
  get captureSafe(): boolean | undefined { return this.scopeCaptureSafe; }

  private defaultDir(cwd: string): string {
    const root = path.join(cwd, '.bimax', 'computer', 'recordings');
    fs.mkdirSync(root, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(root, `run-${stamp}-${process.pid}`);
  }

  /**
   * Start a recording via the injected driver call. Refuses whole-display VIDEO capture without
   * explicit approval (invariant 2). Idempotent while a recording is active.
   */
  async start(opts: {
    cwd: string;
    outputDir?: string;
    recordVideo: boolean;
    approveFullDisplay: boolean;
    scopeTarget: RecordingScopeTarget | null;
    call: (name: string, args: Record<string, unknown>) => Promise<any>;
  }): Promise<any> {
    if (this.startedFlag) return { enabled: true, output_dir: this.dir };
    if (opts.recordVideo && !opts.scopeTarget && !opts.approveFullDisplay) {
      throw new Error(
        'refusing whole-display video recording: no window-scoped capture surface is available, so the '
        + 'recording would capture the ENTIRE display including unrelated windows. This requires the '
        + 'user\'s explicit approval of whole-display capture (the approval prompt states that scope); '
        + 'or open a target window first so the recording can be scoped to it.',
      );
    }
    // Bound recording storage before adding another run — hours-long sessions must not fill the disk.
    sweepRecordings(path.join(opts.cwd, '.bimax', 'computer', 'recordings'), { keepRuns: 5 });
    const dir = path.resolve(opts.outputDir || this.defaultDir(opts.cwd));
    fs.mkdirSync(dir, { recursive: true });
    this.scopeLabel = opts.scopeTarget ? opts.scopeTarget.label : 'whole display';
    this.scopeCaptureSafe = !!opts.scopeTarget;
    try {
      const data = await opts.call('start_recording', {
        output_dir: dir,
        record_video: opts.recordVideo,
        ...(opts.scopeTarget ? { pid: opts.scopeTarget.pid, window_id: opts.scopeTarget.windowId } : {}),
      });
      this.startedFlag = true;
      this.dir = dir;
      this.lastError = undefined;
      return data;
    } catch (err: any) {
      this.lastError = String(err?.message || err).slice(0, 500);
      throw err;
    }
  }

  markStopped(): void { this.startedFlag = false; }

  reset(): void {
    this.startedFlag = false;
    this.dir = undefined;
    this.lastError = undefined;
    this.scopeLabel = undefined;
    this.scopeCaptureSafe = undefined;
  }
}

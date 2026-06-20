import * as crypto from 'crypto';

export type LoopType =
  | 'generic_repeat'       // same (tool, args) called N times
  | 'no_progress_poll'     // same (tool, args, result) — calling but nothing changes
  | 'ping_pong'            // A→B→A→B alternation between two tools
  | 'unknown_tool_repeat'  // model keeps calling a non-existent tool name
  | 'circuit_breaker';     // total tool calls for this session exceeded the budget

export interface LoopSignal {
  type: LoopType;
  tool: string;
  argsHash: string;
  count: number;
  severity: 'soft' | 'hard';
}

interface CallRecord {
  tool: string;
  argsHash: string;
  resultHash: string;
}

const SOFT_THRESHOLD = 3;  // warn, inject hint
const HARD_THRESHOLD = 5;  // intervene, push the model to stop
const MAX_TOTAL_CALLS = 200; // circuit breaker

function sha256Short(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * LoopDetector — 5-detector loop pattern recognition for the agent loop.
 * Instantiated fresh per execute() call; carries state for one session turn series.
 * After each tool result, call record(). It returns a LoopSignal if a pattern fires,
 * null if the turn looks normal.
 */
export class LoopDetector {
  private history: CallRecord[] = [];
  private totalCalls = 0;
  // Latch: the circuit breaker is a one-shot. Without this, every call past MAX_TOTAL_CALLS would
  // re-fire a hard signal, spamming "[LOOP DETECTED — HARD STOP]" into history on calls 200, 201, …
  private breakerFired = false;
  // Cooldown for ping-pong: the A→B→A→B test matches on every subsequent call once an alternation
  // is established, so without a cooldown it re-warns each cycle. Suppress until this many further
  // calls have elapsed since the last ping-pong signal.
  private lastPingPongAt = -Infinity;
  private static readonly PING_PONG_COOLDOWN = 4;

  record(toolName: string, argsJson: string, resultText: string): LoopSignal | null {
    this.totalCalls++;
    const argsHash = sha256Short(toolName + ':' + argsJson);
    const resultHash = sha256Short(resultText);

    this.history.push({ tool: toolName, argsHash, resultHash });
    // Keep a rolling window — only the last 20 calls matter for pattern matching
    if (this.history.length > 20) this.history.shift();

    // Circuit breaker — fires once, regardless of what tool is being called.
    if (this.totalCalls >= MAX_TOTAL_CALLS && !this.breakerFired) {
      this.breakerFired = true;
      return {
        type: 'circuit_breaker',
        tool: toolName,
        argsHash,
        count: this.totalCalls,
        severity: 'hard',
      };
    }

    // Generic repeat — same (tool, argsHash) HARD_THRESHOLD times in a row
    if (this.history.length >= HARD_THRESHOLD) {
      const tail = this.history.slice(-HARD_THRESHOLD);
      if (tail.every(c => c.tool === toolName && c.argsHash === argsHash)) {
        return {
          type: 'generic_repeat',
          tool: toolName,
          argsHash,
          count: HARD_THRESHOLD,
          severity: 'hard',
        };
      }
    }

    // No-progress poll — same (tool, argsHash, resultHash) SOFT_THRESHOLD times in a row
    if (this.history.length >= SOFT_THRESHOLD) {
      const tail = this.history.slice(-SOFT_THRESHOLD);
      if (tail.every(c => c.tool === toolName && c.argsHash === argsHash && c.resultHash === resultHash)) {
        return {
          type: 'no_progress_poll',
          tool: toolName,
          argsHash,
          count: SOFT_THRESHOLD,
          severity: 'soft',
        };
      }
    }

    // Ping-pong — A→B→A→B alternation over last 4 calls. Cooled down so a sustained alternation
    // warns once per few cycles instead of on every call.
    if (this.history.length >= 4 && this.totalCalls - this.lastPingPongAt >= LoopDetector.PING_PONG_COOLDOWN) {
      const [h0, h1, h2, h3] = this.history.slice(-4);
      if (
        h0.tool === h2.tool && h0.argsHash === h2.argsHash &&
        h1.tool === h3.tool && h1.argsHash === h3.argsHash &&
        h0.tool !== h1.tool
      ) {
        this.lastPingPongAt = this.totalCalls;
        return {
          type: 'ping_pong',
          tool: `${h0.tool} ↔ ${h1.tool}`,
          argsHash,
          count: 4,
          severity: 'soft',
        };
      }
    }

    // Unknown-tool repeat — model calling a tool name that returned "not found" twice
    if (resultText.startsWith('Tool ') && resultText.includes('not found') && this.history.length >= 2) {
      const prev = this.history[this.history.length - 2];
      if (prev.tool === toolName && prev.argsHash === argsHash) {
        return {
          type: 'unknown_tool_repeat',
          tool: toolName,
          argsHash,
          count: 2,
          severity: 'soft',
        };
      }
    }

    return null;
  }

  getSoftThreshold(): number { return SOFT_THRESHOLD; }
  getHardThreshold(): number { return HARD_THRESHOLD; }

  reset(): void {
    this.history = [];
    this.totalCalls = 0;
    this.breakerFired = false;
    this.lastPingPongAt = -Infinity;
  }
}

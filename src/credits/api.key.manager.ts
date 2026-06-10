import { Logger } from '../utils';

export interface KeyState {
  keyStr: string;
  cooldown_until: number;
  consecutive_429: number;
  consecutive_403: number;
  consecutive_401: number;
  total_ok: number;
  total_fail: number;
  last_used: number;
}

export class ApiKeyManager {
  private keyStates: KeyState[] = [];
  private keyRR: number = 0; // Round-robin cursor

  // Exponential back-off settings
  private readonly KEY_COOLDOWN_BASE = 2.0;
  private readonly KEY_COOLDOWN_MAX = 60.0;
  private readonly KEY_COOLDOWN_JITTER = 1.0;

  constructor(keys: string[]) {
    // Deduplicate while preserving order
    const uniqueKeys = Array.from(new Set(keys));
    this.keyStates = uniqueKeys.map(keyStr => ({
      keyStr,
      cooldown_until: 0.0,
      consecutive_429: 0,
      consecutive_403: 0,
      consecutive_401: 0,
      total_ok: 0,
      total_fail: 0,
      last_used: Date.now() / 1000
    }));
    Logger.info(`[ApiKeyManager] Initialized with ${this.keyStates.length} NVIDIA NIM keys.`);
  }

  public getNextKey(): { keyStr: string | null; idx: number | null; waitTimeSecs: number } {
    if (this.keyStates.length === 0) return { keyStr: null, idx: null, waitTimeSecs: 0 };

    const n = this.keyStates.length;
    const now = Date.now() / 1000;

    // Pass 1: Ready keys
    for (let i = 0; i < n; i++) {
      const idx = (this.keyRR + i) % n;
      const state = this.keyStates[idx];
      
      if (now >= state.cooldown_until) {
        this.keyRR = (idx + 1) % n; // Advance cursor for next call
        state.last_used = now;
        return { keyStr: state.keyStr, idx, waitTimeSecs: 0 };
      }
    }

    // Pass 2: All on cooldown; pick soonest
    let bestIdx = 0;
    let soonestCooldown = this.keyStates[0].cooldown_until;

    for (let i = 1; i < n; i++) {
      if (this.keyStates[i].cooldown_until < soonestCooldown) {
        bestIdx = i;
        soonestCooldown = this.keyStates[i].cooldown_until;
      }
    }

    this.keyStates[bestIdx].last_used = now;
    const waitTimeSecs = Math.max(0, soonestCooldown - now);
    
    return { keyStr: this.keyStates[bestIdx].keyStr, idx: bestIdx, waitTimeSecs };
  }

  public reportKeyResult(idx: number, status: number, retryAfterSecs: number | null = null): void {
    const now = Date.now() / 1000;
    const s = this.keyStates[idx];

    if (status >= 200 && status < 300) {
      s.total_ok++;
      s.consecutive_429 = 0;
      s.consecutive_403 = 0;
      s.consecutive_401 = 0;
      s.cooldown_until = 0.0;
      return;
    }

    s.total_fail++;

    if (status === 429) {
      s.consecutive_429++;
      let cooldown = retryAfterSecs;
      
      if (cooldown === null) {
        cooldown = Math.min(
          this.KEY_COOLDOWN_BASE * Math.pow(2, s.consecutive_429 - 1),
          this.KEY_COOLDOWN_MAX
        );
      }
      
      const jitter = Math.random() * this.KEY_COOLDOWN_JITTER;
      s.cooldown_until = now + cooldown + jitter;
      
      Logger.warn(`[ApiKeyManager] KEY #${idx + 1} -> 429 cooldown ${cooldown.toFixed(1)}s + ${jitter.toFixed(1)}j (streak ${s.consecutive_429})`);
    } 
    else if (status === 403) {
      s.consecutive_403++;
      s.cooldown_until = now + 2.0;
      Logger.warn(`[ApiKeyManager] KEY #${idx + 1} -> 403 cooldown 2s (streak ${s.consecutive_403})`);
    } 
    else if (status === 401) {
      s.consecutive_401++;
      s.cooldown_until = now + 5.0;
      Logger.warn(`[ApiKeyManager] KEY #${idx + 1} -> 401 cooldown 5s`);
    } 
    else if (status === 502 || status === 504) {
      s.cooldown_until = now + 2.0;
    } 
    else if (status >= 500) {
      s.cooldown_until = now + 3.0;
      Logger.warn(`[ApiKeyManager] KEY #${idx + 1} -> server error ${status} cooldown 3s`);
    }
  }

  public getStates() {
    return this.keyStates.map(state => ({
      ...state,
      keyStr: state.keyStr && state.keyStr.length > 8 
        ? `${state.keyStr.substring(0, 4)}...${state.keyStr.slice(-4)}`
        : '***'
    }));
  }
}

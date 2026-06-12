import { Logger } from '../utils';
import { Mutex } from 'async-mutex';

export interface KeyConfig {
  keyStr: string;
  model?: string;
  baseURL?: string;
  provider?: string;
  label?: string;
}

export interface KeyState extends KeyConfig {
  cooldown_until: number;
  consecutive_429: number;
  consecutive_403: number;
  consecutive_401: number;
  total_ok: number;
  total_fail: number;
  last_used: number;
}

export interface KeyResult {
  keyStr: string | null;
  model: string | null;
  baseURL: string | null;
  idx: number | null;
  waitTimeSecs: number;
}

export class ApiKeyManager {
  private keyStates: KeyState[] = [];
  private keyRR: number = 0;

  private readonly KEY_COOLDOWN_BASE = 2.0;
  private readonly KEY_COOLDOWN_MAX = 60.0;
  private readonly KEY_COOLDOWN_JITTER = 1.0;

  constructor(keys: KeyConfig[]) {
    const uniqueKeys = new Map<string, KeyConfig>();
    for (const k of keys) {
      if (!uniqueKeys.has(k.keyStr)) uniqueKeys.set(k.keyStr, k);
    }
    this.keyStates = Array.from(uniqueKeys.values()).map(k => ({
      ...k,
      cooldown_until: 0.0,
      consecutive_429: 0,
      consecutive_403: 0,
      consecutive_401: 0,
      total_ok: 0,
      total_fail: 0,
      last_used: Date.now() / 1000,
    }));
    Logger.info(`[ApiKeyManager] Initialized with ${this.keyStates.length} keys across ${new Set(keys.map(k => k.provider || 'unknown')).size} provider(s).`);
  }

  private mutex = new Mutex();

  public async getNextKey(): Promise<KeyResult> {
    return await this.mutex.runExclusive(async () => {
      if (this.keyStates.length === 0) return { keyStr: null, model: null, baseURL: null, idx: null, waitTimeSecs: 0 };

      const n = this.keyStates.length;
      const now = Date.now() / 1000;

      for (let i = 0; i < n; i++) {
        const idx = (this.keyRR + i) % n;
        const state = this.keyStates[idx];
        if (now >= state.cooldown_until) {
          this.keyRR = (idx + 1) % n;
          state.last_used = now;
          return { keyStr: state.keyStr, model: state.model || null, baseURL: state.baseURL || null, idx, waitTimeSecs: 0 };
        }
      }

      let bestIdx = 0;
      let soonestCooldown = this.keyStates[0].cooldown_until;
      for (let i = 1; i < n; i++) {
        if (this.keyStates[i].cooldown_until < soonestCooldown) {
          bestIdx = i;
          soonestCooldown = this.keyStates[i].cooldown_until;
        }
      }

      this.keyStates[bestIdx].last_used = now;
      return { keyStr: this.keyStates[bestIdx].keyStr, model: this.keyStates[bestIdx].model || null, baseURL: this.keyStates[bestIdx].baseURL || null, idx: bestIdx, waitTimeSecs: Math.max(0, soonestCooldown - now) };
    });
  }

  public reportKeyResult(idx: number, status: number, retryAfterSecs: number | null = null): void {
    const now = Date.now() / 1000;
    const s = this.keyStates[idx];
    if (!s) return;

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
      const cooldown = retryAfterSecs ?? Math.min(this.KEY_COOLDOWN_BASE * Math.pow(2, s.consecutive_429 - 1), this.KEY_COOLDOWN_MAX);
      const jitter = Math.random() * this.KEY_COOLDOWN_JITTER;
      s.cooldown_until = now + cooldown + jitter;
      Logger.warn(`[ApiKeyManager] KEY #${idx + 1} (${s.label || s.provider || '?'}) -> 429 cooldown ${cooldown.toFixed(1)}s`);
    } else if (status === 403) {
      s.consecutive_403++;
      s.cooldown_until = now + 2.0;
    } else if (status === 401) {
      s.consecutive_401++;
      s.cooldown_until = now + 5.0;
    } else if (status === 408) {
      s.cooldown_until = now + 2.0;
    } else if (status === 502 || status === 504) {
      s.cooldown_until = now + 2.0;
    } else if (status >= 500) {
      s.cooldown_until = now + 3.0;
    }
  }

  public getStates() {
    return this.keyStates.map(s => ({
      label: s.label || s.provider || 'key',
      model: s.model || 'default',
      baseURL: s.baseURL || 'default',
      ok: s.total_ok,
      fail: s.total_fail,
      onCooldown: s.cooldown_until > Date.now() / 1000,
    }));
  }
}

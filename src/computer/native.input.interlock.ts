export interface NativeInputInterlockState {
  paused: boolean;
  generation: number;
  reason?: string;
  changedAtMs: number;
}

/**
 * Process-wide user-takeover latch for the packaged native tool surface.
 *
 * The compatibility runtime already has a per-surface input owner. Packaged Desktop does not
 * register that runtime, so `/computer pause` also needs a latch shared by the command and every
 * native mutation coordinator. Reads/capture remain available while paused; anything that can
 * mutate app/file/window state checks this immediately before crossing the bridge.
 */
export class NativeInputInterlock {
  /** Last generation observed from Electron main's authoritative latch. */
  private authorityGenerationValue: number | null = null;
  private stateValue: NativeInputInterlockState = {
    paused: false,
    generation: 0,
    changedAtMs: 0,
  };

  public pause(reason = 'user took control'): NativeInputInterlockState {
    this.stateValue = {
      paused: true,
      generation: this.stateValue.generation + 1,
      reason,
      changedAtMs: Date.now(),
    };
    return this.state();
  }

  public resume(): NativeInputInterlockState {
    this.stateValue = {
      paused: false,
      generation: this.stateValue.generation + 1,
      changedAtMs: Date.now(),
    };
    return this.state();
  }

  /**
   * Mirror Electron main's authoritative state, including its generation.
   *
   * The generation is load-bearing even when `paused` is unchanged. Main can transition
   * running → paused → running entirely between two provider reads. Comparing only the final
   * boolean would miss that the human touched the machine and could release an action prepared
   * against the old state. Any new authority generation therefore advances the provider-local
   * generation exactly once, invalidating every older prepared mutation.
   */
  public synchronizeAuthority(input: {
    paused: boolean;
    generation: number;
    reason?: string;
  }): NativeInputInterlockState {
    const reason = input.paused ? (input.reason || 'user took control') : undefined;
    const firstMeaningfulAuthority = this.authorityGenerationValue === null
      && (input.generation !== 0 || input.paused);
    const authorityChanged = this.authorityGenerationValue !== null
      && input.generation !== this.authorityGenerationValue;
    const valueChanged = input.paused !== this.stateValue.paused
      || reason !== this.stateValue.reason;

    this.authorityGenerationValue = input.generation;
    if (firstMeaningfulAuthority || authorityChanged || valueChanged) {
      this.stateValue = {
        paused: input.paused,
        generation: this.stateValue.generation + 1,
        ...(reason ? { reason } : {}),
        changedAtMs: Date.now(),
      };
    }
    return this.state();
  }

  public state(): NativeInputInterlockState {
    return { ...this.stateValue };
  }
}

export const globalNativeInputInterlock = new NativeInputInterlock();

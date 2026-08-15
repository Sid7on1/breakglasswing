/** Phase 9 / V20 + V29B / S29-D — optional Computer Use changes activation, never ownership. */

export type PackHost = 'desktop' | 'terminal';
export type ComputerUsePackState = 'inactive' | 'active' | 'blocked' | 'revoked';

export interface ComputerUsePackSnapshot {
  state: ComputerUsePackState;
  toolExposed: boolean;
  permissionsRequested: boolean;
  contentDigest: string | null;
  blockers: string[];
  revokeInstructions: string[];
}

export class ComputerUsePackController {
  private snapshotValue: ComputerUsePackSnapshot = {
    state: 'inactive', toolExposed: false, permissionsRequested: false, contentDigest: null,
    blockers: [], revokeInstructions: [],
  };

  snapshot(): ComputerUsePackSnapshot { return { ...this.snapshotValue, blockers: [...this.snapshotValue.blockers], revokeInstructions: [...this.snapshotValue.revokeInstructions] }; }

  activate(input: { host: PackHost; contentDigest: string; verifiedComponents: string[]; approved: boolean }): ComputerUsePackSnapshot {
    const required = ['mac-capability', 'xpc-service', 'bridge', 'helper'];
    const blockers = [
      ...(input.host === 'desktop' ? [] : ['Computer Use can only be activated by Bimax for Mac.']),
      ...(input.contentDigest.startsWith('sha256:') ? [] : ['The capability digest is invalid.']),
      ...required.filter((name) => !input.verifiedComponents.includes(name)).map((name) => `${name} is not verified.`),
      ...(input.approved ? [] : ['Activation was not approved.']),
    ];
    this.snapshotValue = blockers.length ? {
      state: 'blocked', toolExposed: false, permissionsRequested: false, contentDigest: null,
      blockers, revokeInstructions: [],
    } : {
      state: 'active', toolExposed: true, permissionsRequested: false, contentDigest: input.contentDigest,
      blockers: [], revokeInstructions: [
        'Deactivate Computer Use in Bimax Trust Center.',
        'Revoke Screen Recording and Accessibility in macOS System Settings if you no longer want Bimax to retain those grants.',
      ],
    };
    return this.snapshot();
  }

  /** TCC is contextual: activation alone never prompts; first invocation may open guidance. */
  firstInvocation(): ComputerUsePackSnapshot {
    if (this.snapshotValue.state === 'active') this.snapshotValue.permissionsRequested = true;
    return this.snapshot();
  }

  deactivate(reason = 'user deactivated the capability'): ComputerUsePackSnapshot {
    this.snapshotValue = {
      ...this.snapshotValue, state: 'revoked', toolExposed: false, permissionsRequested: false,
      blockers: [reason], contentDigest: null,
    };
    return this.snapshot();
  }
}


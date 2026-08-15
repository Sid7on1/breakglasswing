/**
 * Packaged Desktop owns Computer Use. Its production process may expose the signed native tools or
 * no Computer Use tools at all; it must never fall through to the compatibility runtime merely
 * because native discovery failed. Development keeps the compatibility surface so engineers can
 * qualify individual rungs before a signed bundle exists.
 */
export interface DesktopProductionRoutingDecision {
  attemptNative: boolean;
  nativeMode: 'semantic' | 'full';
  registerCompatibility: boolean;
  failClosedWithoutNative: boolean;
}

export function decideDesktopProductionRouting(input: {
  desktopHost: boolean;
  packaged: boolean;
  nativeFullRequested: boolean;
  nativeRolloutSelected: boolean;
}): DesktopProductionRoutingDecision {
  if (!input.desktopHost) {
    return {
      attemptNative: false,
      nativeMode: 'semantic',
      registerCompatibility: false,
      failClosedWithoutNative: false,
    };
  }
  if (input.packaged) {
    return {
      attemptNative: true,
      nativeMode: 'full',
      registerCompatibility: false,
      failClosedWithoutNative: true,
    };
  }
  return {
    attemptNative: input.nativeFullRequested || input.nativeRolloutSelected,
    nativeMode: input.nativeFullRequested ? 'full' : 'semantic',
    registerCompatibility: true,
    failClosedWithoutNative: false,
  };
}

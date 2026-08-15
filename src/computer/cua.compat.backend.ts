import { BimaxComputerRuntime, DesktopRuntimePort, PUBLIC_DESKTOP_ACTIONS } from './desktop.runtime';
import { LivePipPort } from './pip';
import { ComputerBackend, ComputerBackendCapabilities, ComputerBackendDescriptor } from './backend';

export const CUA_COMPATIBILITY_BACKEND: ComputerBackendDescriptor = Object.freeze({
  id: 'bimax-cua-compat',
  name: 'Bimax CUA compatibility backend',
  priority: 10,
  platforms: ['darwin'],
  capabilities: Object.freeze({
    accessibility: true,
    screenshots: true,
    backgroundInput: true,
    physicalInput: true,
    windowCapture: true,
  }),
});

/**
 * The current modified CUA runtime behind the Phase-1 backend contract.
 *
 * This adapter is intentionally thin. It gives the existing implementation an explicit role as
 * the compatibility backend while the macOS-native backend is built beside it in later phases.
 */
export class CuaCompatibilityBackend extends BimaxComputerRuntime implements ComputerBackend {
  public readonly descriptor = CUA_COMPATIBILITY_BACKEND;

  public constructor(
    sessionId: string,
    fallback?: DesktopRuntimePort,
    livePip?: LivePipPort,
  ) {
    // DELIBERATE DIVERGENCE from the Desktop copy of this file, which passes a fourth
    // `TakeoverMutationGuard` argument. That guard enforces the APP-owned takeover broker
    // (app/src/main/takeover.ts) — a control that only exists in the packaged Desktop shell. The
    // engine runtime is not missing takeover: it enforces its own, refusing every acting verb
    // between `pauseForUser()` and `resume()`. Passing a broker-backed guard here would bind the
    // engine to a broker that never runs in this process, which fails OPEN, so it is left off.
    super(fallback, livePip, sessionId);
  }

  public discoverCapabilities(): ComputerBackendCapabilities {
    const status = this.quickStatus();
    return {
      protocolVersion: 1,
      backendId: this.descriptor.id,
      backendName: this.descriptor.name,
      platform: process.platform,
      driver: status.driver,
      ready: status.ready,
      permissions: { accessibility: status.accessibility, screenRecording: status.screenRecording },
      actions: PUBLIC_DESKTOP_ACTIONS,
      deliveryModes: ['background', 'foreground'],
      captureModes: ['accessibility', 'screenshot', 'window'],
      limits: { maxSessions: null },
    };
  }
}

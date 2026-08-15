import { BimaxComputerRuntime, DesktopRuntimePort, PUBLIC_DESKTOP_ACTIONS } from './desktop.runtime';
import { LivePipPort } from './pip';
import { ComputerBackend, ComputerBackendCapabilities, ComputerBackendDescriptor } from './backend';
import { TakeoverMutationGuard } from './takeover.authority';

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
    const guard = new TakeoverMutationGuard();
    super(fallback, livePip, sessionId, guard);
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

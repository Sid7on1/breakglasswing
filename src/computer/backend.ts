/**
 * The computer-use backend contract.
 *
 * PROVENANCE: this module was lost (its siblings were evicted by iCloud with no git copy) and is
 * reconstructed from its two surviving consumers — `cua.compat.backend.ts`, which implements it,
 * and `__tests__/computer.session.manager.test.ts`, which implements it a second time against a
 * fixture. Both were used as the specification, so the shape here is what the code already relies
 * on rather than a fresh design. It is types only: nothing here executes, which is why the bundle
 * still ran without it while `tsc` did not.
 *
 * The contract exists so the modified-CUA compatibility runtime and the macOS-native backend can
 * be swapped behind one interface. Members the session manager calls unconditionally are required;
 * everything it reaches with `?.` is optional here, so a backend that implements only the core is
 * still a valid backend.
 */
import type { DesktopCommand, DesktopResult } from './desktop.runtime';

/** Coarse, static facts about a backend — known without starting it. */
export interface ComputerBackendStaticCapabilities {
  readonly accessibility: boolean;
  readonly screenshots: boolean;
  readonly backgroundInput: boolean;
  readonly physicalInput: boolean;
  readonly windowCapture: boolean;
}

/** Identity and selection metadata. Higher `priority` wins when several backends match. */
export interface ComputerBackendDescriptor {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
  readonly platforms: readonly string[];
  readonly capabilities: ComputerBackendStaticCapabilities;
}

/** What a backend reports about itself once live — measured, not declared. */
export interface ComputerBackendCapabilities {
  protocolVersion: number;
  backendId: string;
  backendName: string;
  platform: string;
  driver: string;
  ready: boolean;
  permissions: { accessibility: boolean | null; screenRecording: boolean | null };
  actions: readonly string[];
  deliveryModes: readonly string[];
  captureModes: readonly string[];
  limits: { maxSessions: number | null };
}

/**
 * Quick, non-prompting health read used for status lines and gating.
 *
 * The permission fields are `boolean | null` because `null` means "could not be read", which this
 * codebase never collapses into `false` — an unknown must stay visibly unknown rather than being
 * reported as a definite denial.
 */
export interface ComputerBackendStatus {
  driver: string;
  ready: boolean;
  accessibility: boolean | null;
  screenRecording: boolean | null;
}

export interface ComputerBackend {
  readonly descriptor: ComputerBackendDescriptor;

  /** Execute one desktop command. The only required mutating entry point. */
  run(cmd: DesktopCommand, ctx?: unknown): Promise<DesktopResult>;
  quickStatus(): ComputerBackendStatus;
  discoverCapabilities(): ComputerBackendCapabilities;
  frontmostApp(): Promise<string>;

  // Optional surface — the session manager calls each of these with `?.` and falls back when a
  // backend does not provide it.
  dispose?(): Promise<void> | void;
  describeTarget?(cmd: DesktopCommand & { session?: string }): unknown;
  watchAccessibility?(pid: number, onEvent: (event: unknown) => void): () => void;
  pipStatus?(): Promise<unknown>;
  recordingScopePreview?(scope: unknown): unknown;
  authorizeFullDisplayRecording?(...args: unknown[]): unknown;
  activeSurface?(...args: unknown[]): unknown;
  history?(...args: unknown[]): unknown;
  memoryFootprint?(...args: unknown[]): unknown;
  pauseForUser?(...args: unknown[]): unknown;
  resume?(...args: unknown[]): unknown;
  warm?(...args: unknown[]): unknown;
}

/** Creates one backend per session id. */
export interface ComputerBackendFactory {
  create(sessionId: string): ComputerBackend;
}

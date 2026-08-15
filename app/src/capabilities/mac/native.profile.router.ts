import type { NativeServiceHandshake } from './native.service.client';

export const NATIVE_PERCEPTION_PROFILES = [
  'flash', 'balanced', 'vision', 'som', 'audit', 'stream',
] as const;

export type NativePerceptionProfile = typeof NATIVE_PERCEPTION_PROFILES[number];

export interface NativeModelPerceptionCapabilities {
  /** True when the active model or a configured vision slot can receive image observations. */
  visionInput: boolean;
  /** Existing Bimax capability signal used as the conservative strong-tool-calling proxy. */
  parallelToolCalls: boolean;
  /** Explicit opt-in for models trained to ground image coordinates or SOM marks. */
  coordinateGrounding: boolean;
}

export interface NativeProfileRoutingRequest {
  requestedProfile?: NativePerceptionProfile;
  model: NativeModelPerceptionCapabilities;
  target?: {
    axSilent?: boolean;
    groundingFailures?: number;
  };
  action?: {
    highImpact?: boolean;
  };
}

export interface NativeProfileRoute {
  desiredProfile: NativePerceptionProfile;
  selectedProfile: NativePerceptionProfile | null;
  backendEligible: boolean;
  safetyEscalation: boolean;
  consideredProfiles: NativePerceptionProfile[];
  blockers: string[];
  reasons: string[];
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isProfile(value: unknown): value is NativePerceptionProfile {
  return typeof value === 'string'
    && (NATIVE_PERCEPTION_PROFILES as readonly string[]).includes(value);
}

function availability(
  profile: NativePerceptionProfile,
  handshake: NativeServiceHandshake | undefined,
  model: NativeModelPerceptionCapabilities,
): string[] {
  if (!handshake) return ['service_unreachable'];
  const blockers: string[] = [];
  const observe = handshake.capabilities.observe;
  if (!observe.profiles.includes(profile)) blockers.push(`profile_${profile}_unadvertised`);

  if (profile === 'vision') {
    if (!observe.regionCapture) blockers.push('capture_unavailable');
    if (!model.visionInput) blockers.push('model_vision_unavailable');
  } else if (profile === 'som') {
    if (!observe.regionCapture) blockers.push('capture_unavailable');
    if (!observe.som) blockers.push('som_unavailable');
    if (!model.visionInput) blockers.push('model_vision_unavailable');
  } else if (profile === 'audit') {
    if (!observe.regionCapture) blockers.push('capture_unavailable');
  } else if (profile === 'stream') {
    if (!observe.streams) blockers.push('stream_unavailable');
    if (!model.visionInput) blockers.push('model_vision_unavailable');
  }
  return unique(blockers);
}

/**
 * Choose an observation profile solely from model/target intent and the measured native handshake.
 *
 * This function never selects an unadvertised profile and never launders a required visual/audit
 * route into AX-only evidence. A null selection means the compatibility backend must keep the task;
 * it does not mean the native service should improvise a weaker profile.
 */
export function routeNativePerceptionProfile(
  request: NativeProfileRoutingRequest,
  handshake: NativeServiceHandshake | undefined,
): NativeProfileRoute {
  const model = request?.model;
  if (!model || typeof model.visionInput !== 'boolean'
      || typeof model.parallelToolCalls !== 'boolean'
      || typeof model.coordinateGrounding !== 'boolean') {
    return {
      desiredProfile: 'flash', selectedProfile: null, backendEligible: false,
      safetyEscalation: false, consideredProfiles: [], blockers: ['invalid_model_capabilities'],
      reasons: ['profile routing requires explicit conservative model capabilities'],
    };
  }
  if (request.requestedProfile !== undefined && !isProfile(request.requestedProfile)) {
    return {
      desiredProfile: 'flash', selectedProfile: null, backendEligible: false,
      safetyEscalation: false, consideredProfiles: [], blockers: ['invalid_requested_profile'],
      reasons: ['the requested perception profile is unknown'],
    };
  }

  const groundingFailures = Number.isSafeInteger(request.target?.groundingFailures)
    ? Math.max(0, request.target!.groundingFailures!) : 0;
  const highImpact = request.action?.highImpact === true;
  const axSilent = request.target?.axSilent === true;
  const repeatedGroundingFailure = groundingFailures >= 2;
  let desired: NativePerceptionProfile;
  let considered: NativePerceptionProfile[];
  let safetyEscalation = false;
  const reasons: string[] = [];

  // Safety evidence wins over user/task preference. A weaker profile is not a valid fallback for
  // the commit step, so audit has no downgrade chain.
  if (highImpact) {
    desired = 'audit';
    considered = ['audit'];
    safetyEscalation = request.requestedProfile !== undefined && request.requestedProfile !== 'audit';
    reasons.push('high-impact commit requires audit evidence');
  } else if (axSilent) {
    desired = 'vision';
    considered = model.coordinateGrounding ? ['som', 'vision'] : ['vision', 'som'];
    safetyEscalation = request.requestedProfile === 'flash' || request.requestedProfile === 'balanced';
    reasons.push('AX-silent target requires a visual profile');
  } else if (repeatedGroundingFailure) {
    desired = model.coordinateGrounding ? 'som' : 'vision';
    considered = model.coordinateGrounding ? ['som', 'vision'] : ['vision', 'som'];
    safetyEscalation = request.requestedProfile === 'flash' || request.requestedProfile === 'balanced';
    reasons.push('repeated grounding failures require visual escalation');
  } else if (request.requestedProfile) {
    desired = request.requestedProfile;
    switch (desired) {
    case 'flash': considered = ['flash']; break;
    case 'balanced': considered = ['balanced', 'flash']; break;
    case 'vision': considered = ['vision', 'som']; break;
    case 'som': considered = ['som', 'vision']; break;
    case 'audit': considered = ['audit']; break;
    case 'stream': considered = ['stream']; break;
    }
    reasons.push(`explicit ${desired} profile requested`);
  } else if (!model.visionInput) {
    desired = 'flash';
    considered = ['flash', 'balanced'];
    reasons.push('text-only model defaults to flash');
  } else if (model.coordinateGrounding) {
    desired = 'som';
    considered = ['som', 'vision'];
    reasons.push('coordinate-grounded vision model defaults to SOM');
  } else if (model.parallelToolCalls) {
    desired = 'balanced';
    considered = ['balanced', 'flash'];
    reasons.push('vision model with strong tool calling defaults to balanced');
  } else {
    desired = 'vision';
    considered = ['vision', 'som'];
    reasons.push('vision model without strong semantic tool calling defaults to vision');
  }

  const blockers: string[] = [];
  for (const profile of considered) {
    const profileBlockers = availability(profile, handshake, model);
    if (profileBlockers.length === 0) {
      if (profile !== desired) reasons.push(`${desired} unavailable; selected ${profile}`);
      return {
        desiredProfile: desired,
        selectedProfile: profile,
        backendEligible: true,
        safetyEscalation,
        consideredProfiles: [...considered],
        blockers: [],
        reasons,
      };
    }
    blockers.push(...profileBlockers);
  }
  return {
    desiredProfile: desired,
    selectedProfile: null,
    backendEligible: false,
    safetyEscalation,
    consideredProfiles: [...considered],
    blockers: unique(blockers),
    reasons,
  };
}

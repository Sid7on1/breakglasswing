/**
 * Bundle-scoped guidance for the native computer-use coordinator.
 *
 * Profiles contain declarative hints only. They cannot add tools, bypass approvals, name shell
 * commands, or widen a service capability. A profile is delivered at most once per bundle in a
 * task so repeated observations do not consume the model context with the same instructions.
 */
export interface NativeAppRecipe {
  intent: string;
  preferredActions: string[];
  note: string;
}

export interface NativeAppProfile {
  id: string;
  bundleIds: string[];
  displayNames?: string[];
  guidance: string[];
  recipes: NativeAppRecipe[];
}

export interface NativeAppIdentity {
  pid: number;
  bundleId?: string;
  displayName?: string;
}

export interface NativeAppGuidanceReceipt {
  profileId: string;
  bundleId?: string;
  displayName?: string;
  guidance: string[];
  recipes: NativeAppRecipe[];
}

const MAX_GUIDANCE_ITEMS = 12;
const MAX_GUIDANCE_CHARS = 512;
const MAX_RECIPE_ACTIONS = 8;

function normalized(value: string): string { return value.trim().toLocaleLowerCase('en-US'); }

function boundedText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const result = value.trim();
  if (!result || result.length > MAX_GUIDANCE_CHARS || result.includes('\0')) {
    throw new Error(`${field} must contain 1-${MAX_GUIDANCE_CHARS} safe characters`);
  }
  return result;
}

function validateProfile(profile: NativeAppProfile): NativeAppProfile {
  const id = boundedText(profile.id, 'profile id');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) throw new Error('profile id is malformed');
  if (!Array.isArray(profile.bundleIds) || profile.bundleIds.length === 0 || profile.bundleIds.length > 16) {
    throw new Error('a profile must name 1-16 bundle ids');
  }
  const bundleIds = [...new Set(profile.bundleIds.map(value => boundedText(value, 'bundle id')))].map(normalized);
  const displayNames = [...new Set((profile.displayNames ?? []).map(value => boundedText(value, 'display name')))].map(normalized);
  if (!Array.isArray(profile.guidance) || profile.guidance.length > MAX_GUIDANCE_ITEMS) {
    throw new Error(`profile guidance is limited to ${MAX_GUIDANCE_ITEMS} items`);
  }
  if (!Array.isArray(profile.recipes) || profile.recipes.length > MAX_GUIDANCE_ITEMS) {
    throw new Error(`profile recipes are limited to ${MAX_GUIDANCE_ITEMS} items`);
  }
  const guidance = profile.guidance.map((value, index) => boundedText(value, `guidance ${index}`));
  const recipes = profile.recipes.map((recipe, index) => {
    if (!recipe || typeof recipe !== 'object') throw new Error(`recipe ${index} is malformed`);
    if (!Array.isArray(recipe.preferredActions) || recipe.preferredActions.length > MAX_RECIPE_ACTIONS) {
      throw new Error(`recipe ${index} has too many actions`);
    }
    return {
      intent: boundedText(recipe.intent, `recipe ${index} intent`),
      preferredActions: recipe.preferredActions.map((action, actionIndex) =>
        boundedText(action, `recipe ${index} action ${actionIndex}`)),
      note: boundedText(recipe.note, `recipe ${index} note`),
    };
  });
  return Object.freeze({
    id, bundleIds: Object.freeze(bundleIds) as unknown as string[],
    displayNames: Object.freeze(displayNames) as unknown as string[],
    guidance: Object.freeze(guidance) as unknown as string[],
    recipes: Object.freeze(recipes.map(recipe => Object.freeze({
      ...recipe, preferredActions: Object.freeze(recipe.preferredActions) as unknown as string[],
    }))) as unknown as NativeAppRecipe[],
  });
}

export const DEFAULT_NATIVE_APP_PROFILES: readonly NativeAppProfile[] = Object.freeze([
  {
    id: 'finder', bundleIds: ['com.apple.finder'], displayNames: ['Finder'],
    guidance: [
      'Prefer the governed file operations for reveal, duplicate, and recoverable trash.',
      'Treat sidebar and file-list selections as separate targets; verify the selected row before a commit action.',
    ],
    recipes: [{
      intent: 'manage workspace files',
      preferredActions: ['inspect_file', 'reveal_file', 'duplicate_file', 'trash_file'],
      note: 'Use workspace-scoped operations instead of coordinate gestures when the operation is expressible.',
    }],
  },
  {
    id: 'browser',
    bundleIds: ['com.apple.safari', 'com.google.chrome', 'com.google.chrome.canary', 'org.chromium.chromium'],
    displayNames: ['Safari', 'Google Chrome', 'Chromium'],
    guidance: [
      'Use the typed browser route for page content and native Accessibility only for browser chrome or OS prompts.',
      'A WebArea observation is a bounded fallback, not authority to mix DOM and native element references.',
    ],
    recipes: [{
      intent: 'interact with a web page', preferredActions: ['typed_browser_route'],
      note: 'Keep page, chrome, and system-prompt authority explicit when crossing surfaces.',
    }],
  },
  {
    id: 'system-settings', bundleIds: ['com.apple.systempreferences'], displayNames: ['System Settings'],
    guidance: [
      'Permission changes are high-impact and require a fresh exact target plus explicit approval.',
      'Read the permission doctor first; do not infer a grant from a click or from a Settings pane being open.',
    ],
    recipes: [{
      intent: 'diagnose a missing macOS permission', preferredActions: ['permission_doctor', 'observe'],
      note: 'The post-change permission probe, not UI delivery, is the evidence of a grant.',
    }],
  },
]);

export class NativeAppProfileRegistry {
  private readonly byBundle = new Map<string, NativeAppProfile>();
  private readonly byDisplayName = new Map<string, NativeAppProfile>();
  private readonly delivered = new Map<string, Set<string>>();

  public constructor(profiles: readonly NativeAppProfile[] = DEFAULT_NATIVE_APP_PROFILES) {
    for (const candidate of profiles) {
      const profile = validateProfile(candidate);
      for (const bundleId of profile.bundleIds) {
        if (this.byBundle.has(bundleId)) throw new Error(`duplicate app profile bundle id: ${bundleId}`);
        this.byBundle.set(bundleId, profile);
      }
      for (const displayName of profile.displayNames ?? []) {
        if (!this.byDisplayName.has(displayName)) this.byDisplayName.set(displayName, profile);
      }
    }
  }

  public profileFor(identity: NativeAppIdentity): NativeAppProfile | null {
    const bundleId = identity.bundleId?.trim();
    if (bundleId) return this.byBundle.get(normalized(bundleId)) ?? null;
    const displayName = identity.displayName?.trim();
    return displayName ? this.byDisplayName.get(normalized(displayName)) ?? null : null;
  }

  public takeGuidance(taskSessionId: string, identity: NativeAppIdentity): NativeAppGuidanceReceipt | null {
    if (!taskSessionId || taskSessionId.length > 256 || taskSessionId.includes('\0')) {
      throw new Error('app guidance requires a valid task session');
    }
    const profile = this.profileFor(identity);
    if (!profile) return null;
    const authorityKey = identity.bundleId ? `bundle:${normalized(identity.bundleId)}` : `profile:${profile.id}`;
    const seen = this.delivered.get(taskSessionId) ?? new Set<string>();
    if (seen.has(authorityKey)) return null;
    seen.add(authorityKey);
    this.delivered.set(taskSessionId, seen);
    return {
      profileId: profile.id,
      ...(identity.bundleId ? { bundleId: identity.bundleId } : {}),
      ...(identity.displayName ? { displayName: identity.displayName } : {}),
      guidance: [...profile.guidance],
      recipes: profile.recipes.map(recipe => ({ ...recipe, preferredActions: [...recipe.preferredActions] })),
    };
  }

  public resetTask(taskSessionId: string): void { this.delivered.delete(taskSessionId); }
}

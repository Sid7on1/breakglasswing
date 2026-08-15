// Deterministic macOS path classification — the input every Layer A/B/C rule reasons over.
//
// Owner section 28 (V28B). The detection stack in
// docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md §6 asks for rules like "never
// read credential stores" and "a formatter writing source is normal; the same formatter editing a
// LaunchAgent is not". Both are statements about the *class* of a path, not its spelling, so the
// classification is separated from the rules: it is pure, table-driven, and independently testable,
// and a rule can never accidentally depend on a substring match someone tuned for one app.
//
// Two design constraints from the research:
//
//   - S28-01 requires that a normal build deleting its own generated output produces no warning.
//     `build-output` therefore has to be recognised *inside* a project, ahead of `project`.
//   - S28-04 requires that ordinary toolchain traffic and caches are not anomalies. `toolchain` and
//     `temp` exist so a rule can say "this is boring" without an allowlist per tool.
//
// Classification is conservative: an unrecognised path is `external`, which is the class rules treat
// with the most suspicion. Being wrong in the direction of "ask" is recoverable; being wrong in the
// direction of "this was fine" is the failure mode the section 28 gate forbids.

export type PathClass =
  | 'credential'        // SSH keys, keychains, cloud/registry tokens, browser credential stores
  | 'ssh-authorized'    // ~/.ssh/authorized_keys specifically — MITRE T1098.004
  | 'persistence'       // LaunchAgents/Daemons, login items, cron, shell profiles — T1543/T1546
  | 'security-setting'  // TCC, system policy, firewall configuration
  | 'system-integrity'  // SIP/SSV-protected volumes and system binaries
  | 'build-output'      // generated output inside a project
  | 'project'           // inside an approved project root
  | 'toolchain'         // package-manager, SDK and cache roots
  | 'temp'              // /tmp, /var/folders — process scratch
  | 'user-data'         // the user's home outside every category above
  | 'external';         // anything else, including other users' data

export interface ClassifyOptions {
  /** Absolute, normalized. Used to separate `project`/`build-output` from `user-data`. */
  projectRoot?: string | null;
  /** Absolute home directory. Injected so the classifier is testable off the running machine. */
  home?: string;
}

/** Collapse `.`/`..`, duplicate separators and a trailing slash without touching the filesystem. */
export function normalizePath(input: string): string {
  if (!input) return '';
  const absolute = input.startsWith('/');
  const parts: string[] = [];
  for (const segment of input.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push('..');
      continue;
    }
    parts.push(segment);
  }
  const joined = parts.join('/');
  return absolute ? `/${joined}` : joined;
}

/** True when `path` is `root` or lies beneath it. Segment-aware: `/a/bc` is not inside `/a/b`. */
export function isInside(path: string, root: string): boolean {
  if (!root) return false;
  const p = normalizePath(path);
  const r = normalizePath(root).replace(/\/$/, '');
  if (r === '/') return p.startsWith('/');
  return p === r || p.startsWith(`${r}/`);
}

const BUILD_OUTPUT_SEGMENTS = new Set([
  'dist', 'build', 'out', 'target', 'coverage', '.next', '.nuxt', '.turbo', '.parcel-cache',
  '.svelte-kit', '.output', 'DerivedData', '.gradle', '.dart_tool', '__pycache__', '.pytest_cache',
]);

const CREDENTIAL_FILE_PATTERNS: RegExp[] = [
  /^\/\.ssh\/(id_[^/]+|identity|.*\.pem)$/,
  /^\/\.aws\/credentials$/,
  /^\/\.aws\/config$/,
  /^\/\.netrc$/,
  /^\/\.git-credentials$/,
  /^\/\.npmrc$/,
  /^\/\.pypirc$/,
  /^\/\.docker\/config\.json$/,
  /^\/\.kube\/config$/,
  /^\/\.gnupg(\/|$)/,
  /^\/\.config\/gcloud\//,
  /^\/Library\/Keychains(\/|$)/,
];

/** Browser credential databases, kept separate so Layer C can name the browser in its finding. */
const BROWSER_CREDENTIAL_PATTERNS: RegExp[] = [
  /^\/Library\/Application Support\/Google\/Chrome\/.*\/Login Data/,
  /^\/Library\/Application Support\/(BraveSoftware|Microsoft Edge|Arc|Vivaldi)\//,
  /^\/Library\/Application Support\/Firefox\/Profiles\/[^/]+\/(logins\.json|key[0-9]*\.db)$/,
  /^\/Library\/Safari\//,
  /^\/Library\/Cookies(\/|$)/,
];

const PERSISTENCE_HOME_PATTERNS: RegExp[] = [
  /^\/Library\/LaunchAgents(\/|$)/,
  /^\/Library\/Preferences\/com\.apple\.loginitems\.plist$/,
  /^\/Library\/Application Support\/com\.apple\.backgroundtaskmanagementagent(\/|$)/,
  /^\/\.(zshrc|zprofile|zshenv|zlogin|bash_profile|bashrc|profile|login)$/,
  /^\/\.config\/(fish\/config\.fish|zsh\/)/,
];

const PERSISTENCE_SYSTEM_PREFIXES = [
  '/Library/LaunchAgents', '/Library/LaunchDaemons', '/Library/StartupItems',
  '/System/Library/LaunchAgents', '/System/Library/LaunchDaemons',
  '/usr/lib/cron', '/var/at/tabs', '/etc/periodic', '/etc/cron.d', '/etc/crontab',
  '/Library/Application Support/com.apple.TCC',
];

const SECURITY_SETTING_PREFIXES = [
  '/Library/Application Support/com.apple.TCC',
  '/var/db/SystemPolicy', '/var/db/SystemPolicyConfiguration',
  '/Library/Preferences/com.apple.alf.plist',
  '/Library/Security', '/etc/sudoers', '/etc/pam.d', '/private/etc/sudoers', '/private/etc/pam.d',
];

/** SIP/SSV-protected. `/usr/local` and `/opt` are deliberately NOT here — they are toolchain roots. */
const SYSTEM_INTEGRITY_PREFIXES = ['/System', '/bin', '/sbin', '/Library/Apple'];

const TOOLCHAIN_HOME_PREFIXES = [
  '/Library/Caches', '/.npm', '/.cache', '/.yarn', '/.pnpm-store', '/.bun', '/.cargo', '/.rustup',
  '/.gradle', '/.m2', '/.pub-cache', '/.nvm', '/.pyenv', '/.rbenv', '/.rvm', '/.sdkman',
  '/Library/Developer', '/Library/Android', '/go/pkg',
];

const TOOLCHAIN_SYSTEM_PREFIXES = [
  '/opt/homebrew', '/usr/local', '/opt/local', '/Applications/Xcode.app', '/Library/Developer',
  '/usr/lib', '/usr/share', '/usr/bin', '/usr/libexec', '/Library/Frameworks',
];

const TEMP_PREFIXES = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders'];

const startsWithAny = (path: string, prefixes: string[]): boolean =>
  prefixes.some(prefix => isInside(path, prefix));

/**
 * Classify one absolute path. Order is the whole contract: the most dangerous classes are tested
 * first, so a credential file that happens to live inside a project root is still `credential`.
 */
export function classifyPath(rawPath: string, options: ClassifyOptions = {}): PathClass {
  const path = normalizePath(rawPath);
  if (!path.startsWith('/')) return 'external';
  const home = options.home ? normalizePath(options.home) : '';
  const inHome = home ? isInside(path, home) : false;
  const homeRelative = inHome ? path.slice(home.length) || '/' : '';

  if (inHome && homeRelative === '/.ssh/authorized_keys') return 'ssh-authorized';
  if (inHome && CREDENTIAL_FILE_PATTERNS.some(p => p.test(homeRelative))) return 'credential';
  if (inHome && BROWSER_CREDENTIAL_PATTERNS.some(p => p.test(homeRelative))) return 'credential';
  if (startsWithAny(path, ['/Library/Keychains', '/private/var/db/KeychainSync'])) return 'credential';

  if (startsWithAny(path, SECURITY_SETTING_PREFIXES)) return 'security-setting';
  if (inHome && isInside(homeRelative, '/Library/Application Support/com.apple.TCC')) return 'security-setting';

  if (startsWithAny(path, PERSISTENCE_SYSTEM_PREFIXES)) return 'persistence';
  if (inHome && PERSISTENCE_HOME_PATTERNS.some(p => p.test(homeRelative))) return 'persistence';

  // Checked after persistence and security-setting so /System/Library/LaunchDaemons reports the
  // more actionable class. Both block; the more specific one explains better.
  if (startsWithAny(path, SYSTEM_INTEGRITY_PREFIXES)) return 'system-integrity';
  if (isInside(path, '/usr') && !isInside(path, '/usr/local')) {
    return startsWithAny(path, TOOLCHAIN_SYSTEM_PREFIXES) ? 'toolchain' : 'system-integrity';
  }

  if (startsWithAny(path, TEMP_PREFIXES)) return 'temp';

  const projectRoot = options.projectRoot ? normalizePath(options.projectRoot) : '';
  if (projectRoot && isInside(path, projectRoot)) {
    const relative = path.slice(projectRoot.length);
    const segments = relative.split('/').filter(Boolean);
    if (segments.some(segment => BUILD_OUTPUT_SEGMENTS.has(segment))) return 'build-output';
    // node_modules is a project-local toolchain surface, not authored source: a build that rewrites
    // it is ordinary, which is why it is not `project`.
    if (segments.includes('node_modules')) return 'toolchain';
    return 'project';
  }

  if (startsWithAny(path, TOOLCHAIN_SYSTEM_PREFIXES)) return 'toolchain';
  if (inHome && TOOLCHAIN_HOME_PREFIXES.some(prefix => isInside(homeRelative, prefix))) return 'toolchain';
  if (inHome) return 'user-data';
  return 'external';
}

/** The classes a Bimax-owned operation may never mutate, whatever the task approved. */
export const NEVER_MUTABLE: ReadonlySet<PathClass> = new Set<PathClass>([
  'system-integrity', 'security-setting',
]);

/** The classes that read as credential access for Layer A. */
export const CREDENTIAL_CLASSES: ReadonlySet<PathClass> = new Set<PathClass>([
  'credential',
]);

/** True when a browser credential store specifically — Layer C names the store in its finding. */
export function isBrowserCredentialStore(rawPath: string, home?: string): boolean {
  const path = normalizePath(rawPath);
  const resolvedHome = home ? normalizePath(home) : '';
  if (!resolvedHome || !isInside(path, resolvedHome)) return false;
  const relative = path.slice(resolvedHome.length);
  return BROWSER_CREDENTIAL_PATTERNS.some(pattern => pattern.test(relative));
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Which applications actually exist on THIS machine — discovered from disk, never hardcoded.
 *
 * The computer-use gate used to ask `/\b(finder|safari|system settings)\b/`, so "send a jpeg to
 * mom on whatsapp" was not recognized as operating the machine at all. The turn then got no
 * computer-use framing, and the model answered it as ordinary chat — which is how a request the
 * ComputerTool handles perfectly well came back as "I can't send files to WhatsApp".
 *
 * A hardcoded list can only ever be wrong in that direction: it is a guess about which apps a
 * person owns. The machine already knows, so ask it.
 */

const APP_DIRS = [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  path.join(os.homedir(), 'Applications'),
];

/** Apps can be installed mid-session, so the answer is cached briefly rather than forever. */
const CACHE_TTL_MS = 60_000;
let cache: { names: string[]; at: number } | null = null;

/** Every installed application name, without the `.app` suffix. Empty off macOS. */
export function installedAppNames(): string[] {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.names;
  const names: string[] = [];
  if (process.platform === 'darwin') {
    for (const dir of APP_DIRS) {
      let entries: string[];
      try { entries = fs.readdirSync(dir); } catch { continue; } // absent dir / no permission
      for (const entry of entries) {
        if (entry.endsWith('.app')) names.push(entry.slice(0, -4));
      }
    }
  }
  cache = { names: Array.from(new Set(names)), at: now };
  return cache.names;
}

/** Test seam — discovery is machine-dependent, so tests need a way to drop the cached answer. */
export function resetInstalledAppCache(): void { cache = null; }

/**
 * Split an app name into the words a person would type: "WhatsApp" → whats/app, "System Settings"
 * → system/settings. People vary the spacing of compound names freely ("whats app", "whatsapp"),
 * so the tokens are what we match on, joined by optional whitespace.
 */
function tokenize(appName: string): string[] {
  return appName
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // CamelCase boundary
    .split(/\s+/)
    .filter(Boolean)
    .map(t => t.toLowerCase());
}

/**
 * The grammatical slot an application name occupies: "on whatsapp", "open notes", "put safari".
 *
 * Position, not vocabulary, is what identifies an app here — which is why this stays honest for
 * apps nobody anticipated. Requiring the slot (rather than accepting the bare name anywhere) is
 * what keeps single-word app names that are also ordinary English words — Notes, Books, Music,
 * Clock — from turning every sentence containing them into a computer-use turn.
 */
const APP_SLOT = '(?:on|in|to|into|from|with|using|via|through|open|opens|launch|start|quit|close|switch to|put|move|place|focus|show)\\s+(?:my\\s+|the\\s+|a\\s+)?';

/**
 * Build the recognizer for a given set of app names. Pure and exported so the rule can be tested
 * against a fixed roster — the real roster is whatever happens to be installed, which is not
 * something a test can assert on.
 */
export function appSlotPattern(names: string[]): RegExp | null {
  const alternatives = names
    .map(tokenize)
    .filter(tokens => tokens.join('').length >= 3) // "TV" and friends are too short to be evidence
    .map(tokens => tokens.join('\\s*'))
    .sort((a, b) => b.length - a.length); // longest-first so "Google Chrome" wins over "Google"
  return alternatives.length ? new RegExp(`\\b${APP_SLOT}(?:${alternatives.join('|')})\\b`, 'i') : null;
}

let patternCache: { regex: RegExp | null; names: string[] } | null = null;

/** Does this prompt name an application installed on this machine, in a slot that means "use it"? */
export function mentionsInstalledApp(prompt: string): boolean {
  const names = installedAppNames();
  if (!patternCache || patternCache.names !== names) patternCache = { regex: appSlotPattern(names), names };
  return !!patternCache.regex && patternCache.regex.test(prompt);
}

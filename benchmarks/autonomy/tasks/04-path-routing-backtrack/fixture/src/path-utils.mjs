export function normalizeRoutePath(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new TypeError('path must be a non-empty string');
  }

  const pathname = input.split(/[?#]/, 1)[0];
  // BUG: only the first Windows separator is normalized.
  return pathname.replace('\\', '/').replace(/\/{2,}/g, '/').toLowerCase();
}

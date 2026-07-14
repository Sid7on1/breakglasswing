import { createHash } from 'crypto';

/**
 * Deterministic JSON serialization: object keys are emitted in sorted order at
 * every level, so two structurally-equal payloads always serialize identically
 * regardless of key insertion order. Plain `JSON.stringify` preserves insertion
 * order, which made fingerprints unstable for equivalent tasks.
 */
function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export const HashUtils = {
  generateTaskFingerprint: (payload: any): string => {
    const dataString = stableStringify(payload);
    return createHash('sha256').update(dataString).digest('hex').substring(0, 16);
  }
};

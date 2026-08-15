// ⚠️  GENERATED FILE — DO NOT EDIT BY HAND.
// Source: src/protocol/protocol.ts · Regenerate: npm run gen:app-protocol
export const CLIENT_PROTOCOL_VERSION = '3.2.0';
export const CLIENT_MIN_COMPATIBLE_MAJOR = 2;
export const CLIENT_MAX_COMPATIBLE_MAJOR = 3;

export function supportsProtocolMajor(major: number): boolean {
  return Number.isInteger(major) && major >= CLIENT_MIN_COMPATIBLE_MAJOR && major <= CLIENT_MAX_COMPATIBLE_MAJOR;
}

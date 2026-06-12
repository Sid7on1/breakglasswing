import { useEffect } from 'react';

/**
 * useAltScreen — intentionally a no-op.
 * 
 * Alt-screen (\x1b[?1049h) and Ink v3 fight over cursor positioning,
 * causing frame duplication. Ink's native renderer handles stdout correctly
 * without alt-screen. Keeping this file as a no-op so existing imports
 * don't break.
 */
export function useAltScreen() {
  // No-op: alt-screen is incompatible with Ink's frame management
}

import { useCallback, useEffect, useState } from 'react';
import type { TrustReport } from './global';

/**
 * The app-owned trust report, read once per shell and refreshable on demand.
 *
 * The shell needs it for two decisions the Trust Center sheet cannot make on its own: whether a
 * Control Mac task must stop at the contextual permission flow first, and whether the sidebar
 * should mark Computer Use as needing attention. Both are read-only and non-prompting — `trust.ts`
 * uses the query-only macOS APIs, so consulting this can never be the thing that raises a
 * permission dialog.
 */
export function useTrust(): { report: TrustReport | null; refresh: () => Promise<TrustReport | null> } {
  const [report, setReport] = useState<TrustReport | null>(null);

  const refresh = useCallback(async () => {
    const value = await window.bimax.trustReport().catch(() => null);
    setReport(value);
    return value;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { report, refresh };
}

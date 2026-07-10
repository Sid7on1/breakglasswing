import { useCallback, useEffect, useState } from 'react';
import type { GitStatusResult } from './global';

/**
 * One git-status poller for the whole shell: the TitleBar changes-pill and the Review panel both
 * read from here. Refresh cadence = 4s poll + the main-process fs watcher's fast path (the
 * watcher ignores .git, so commits made in the embedded terminal surface via the poll).
 */
export function useGit(project: string): { status: GitStatusResult | null; refresh: () => void } {
  const [status, setStatus] = useState<GitStatusResult | null>(null);

  const refresh = useCallback(() => {
    window.bimax.git.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    setStatus(null);
    if (!project) return;
    refresh();
    const id = setInterval(refresh, 4000);
    const off = window.bimax.files.onChanged(refresh);
    return () => { clearInterval(id); off(); };
  }, [project, refresh]);

  return { status, refresh };
}

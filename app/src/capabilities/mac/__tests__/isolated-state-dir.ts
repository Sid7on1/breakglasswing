import { mkdtempSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Give a suite its own state directory.
 *
 * `BimaxComputerRuntime` persists a session file under `<cwd>/.bimax/computer/` and defaults `cwd`
 * to `process.cwd()`. Any test that drives the runtime without passing an explicit `ctx.cwd`
 * therefore writes a generated runtime artifact into whichever directory jest happened to be
 * launched from — which is how `app/.bimax/computer/session.json` ended up in the working tree.
 *
 * The suite runs inside a fresh temp directory instead, and asserts on the way out that the
 * repository was not written to. Jest runs the files inside one worker sequentially, so the chdir
 * is scoped to this suite and restored before the next one starts.
 */
export function useIsolatedStateDir(): { dir: () => string } {
  let dir = '';
  let previousCwd = '';
  let repositoryComputerState = '';

  const fingerprint = (root: string): string => {
    if (!existsSync(root)) return 'absent';
    const rows: string[] = [];
    const visit = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) visit(full);
        else {
          const stat = statSync(full);
          rows.push(`${path.relative(root, full)}:${stat.size}:${stat.mtimeMs}`);
        }
      }
    };
    visit(root);
    return rows.sort().join('\n');
  };

  beforeAll(() => {
    previousCwd = process.cwd();
    repositoryComputerState = fingerprint(path.join(previousCwd, '.bimax', 'computer'));
    dir = mkdtempSync(path.join(tmpdir(), 'bimax-suite-state-'));
    process.chdir(dir);
  });

  afterAll(() => {
    const repoArtifact = path.join(previousCwd, '.bimax', 'computer');
    process.chdir(previousCwd);
    rmSync(dir, { recursive: true, force: true });
    // The point of the isolation, asserted rather than assumed: a suite that starts writing to the
    // repository again fails here instead of leaving a file for someone to find in `git status`.
    if (fingerprint(repoArtifact) !== repositoryComputerState) {
      throw new Error(
        `this suite changed runtime artifacts in the repository at ${repoArtifact}; `
        + 'pass an explicit ctx.cwd or extend useIsolatedStateDir()',
      );
    }
  });

  return { dir: () => dir };
}

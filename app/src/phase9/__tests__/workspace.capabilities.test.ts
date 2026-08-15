import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectEnvironmentCapabilities, readProjectPackageName } from '../workspace.capabilities';

describe('Desktop workspace capability inventory', () => {
  test('reads only the bounded project identity and supported root declarations', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bimax-environment-'));
    try {
      await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-workspace', scripts: { postinstall: 'exit 99' } }));
      await writeFile(path.join(root, 'pyproject.toml'), '[project]\nname = "fixture"\n');
      const snapshot = await inspectEnvironmentCapabilities(root);
      expect(await readProjectPackageName(root)).toBe('fixture-workspace');
      expect(snapshot.declarations).toEqual(expect.arrayContaining([
        { file: 'package.json', ecosystem: 'Node' },
        { file: 'pyproject.toml', ecosystem: 'Python' },
      ]));
      expect(snapshot.safety).toEqual({ mutating: false, sourcedShellProfiles: false, executedProjectScripts: false });
      expect(snapshot.tools.length).toBeGreaterThan(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

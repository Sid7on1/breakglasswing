import path from 'node:path';
import { resolveNativeComponent, type RuntimeLayout } from '../../../main/runtime.paths';

const layout = (packaged: boolean, existing: string[] = [], env: Record<string, string> = {}): RuntimeLayout => ({
  packaged,
  resourcesPath: '/Applications/Bimax.app/Contents/Resources',
  devRepoRoot: '/repo',
  env,
  exists: candidate => existing.includes(candidate),
});

describe('Desktop provider trust uses the launcher resolver', () => {
  it('resolves the provider only from its package location in a packaged app', () => {
    const bundled = '/Applications/Bimax.app/Contents/MacOS/bimax-mac-capability';
    expect(resolveNativeComponent(layout(true, [bundled]), 'macCapability')).toEqual({
      path: bundled,
      source: 'bundle',
    });
  });

  it('refuses a packaged override instead of trusting or silently discarding it', () => {
    const resolution = resolveNativeComponent(layout(true, [], {
      BIMAX_MAC_CAPABILITY_PROVIDER: '/tmp/untrusted-provider',
    }), 'macCapability');
    expect(resolution.source).toBe('missing');
    expect(resolution.refusedOverride).toEqual({
      variable: 'BIMAX_MAC_CAPABILITY_PROVIDER', value: '/tmp/untrusted-provider',
    });
    expect(resolution.path).toBeUndefined();
  });

  it('uses the staged Desktop component in development', () => {
    const staged = path.join('/repo', 'app', 'native-service', 'bimax-mac-capability');
    expect(resolveNativeComponent(layout(false, [staged]), 'macCapability')).toEqual({
      path: staged, source: 'dev',
    });
  });
});

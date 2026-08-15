import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const repo = path.resolve(__dirname, '..', '..');
const read = (relative: string): string => fs.readFileSync(path.join(repo, relative), 'utf8');

describe('Phase 1 package boundary', () => {
  test('the desktop package has one Mac target and owns every native computer-use component', () => {
    const config = yaml.load(read('app/electron-builder.yml')) as Record<string, any>;
    expect(config.win).toBeUndefined();
    expect(config.linux).toBeUndefined();
    expect(config.mac.target).toEqual(['dmg']);
    expect(config.mac.extraFiles).toEqual(expect.arrayContaining([
      { from: 'native-service/BimaxCuService.xpc', to: 'XPCServices/BimaxCuService.xpc' },
      { from: 'native-service/bimax-cu-bridge', to: 'MacOS/bimax-cu-bridge' },
      { from: 'native-service/bimax-desktop-helper', to: 'MacOS/bimax-desktop-helper' },
      { from: 'native-service/bimax-mac-capability', to: 'MacOS/bimax-mac-capability' },
    ]));
    expect(config.extraResources).toContainEqual({ from: 'engine', to: 'engine' });
  });

  test('the desktop build stages its engine, XPC service, bridge, and helper only for macOS', () => {
    const engine = read('app/scripts/prepare-engine.sh');
    const native = read('app/scripts/prepare-native.sh');
    expect(engine).toContain('darwin-arm64|darwin-x64');
    expect(engine).toContain('resolve-engine-artifact.mjs');
    // After the local Phase 6 split, these scripts are Desktop-root relative. Requiring the old
    // monorepo `app/` prefix would make a source-free Desktop checkout fail this boundary test.
    expect(native).toContain('$DESKTOP_ROOT/scripts/computer-use/stage-bimax-cu-service.sh');
    expect(native).toContain('bun scripts/computer-use/stage-desktop-helper.ts darwin');
    expect(native).toContain('native-service/BimaxCuService.xpc');
    expect(native).toContain('native-service/bimax-cu-bridge');
    expect(native).toContain('native-service/bimax-desktop-helper');
    expect(native).toContain('native-service/bimax-mac-capability');
    expect(native).toContain('provider_target=bun-darwin-arm64');
    expect(native).toContain('provider_target=bun-darwin-x64');
  });

  test('the packaged app resolves native payloads from Contents and injects a generic provider', () => {
    // Phase 2 slice 2 moved the location and profile decisions out of engine.ts into
    // runtime.paths.ts, so this reads the Desktop main-process sources as a whole rather than one
    // file. The assertions are unchanged in strength — same four required facts, same exclusion.
    // The end-state form of this check runs against the packaged bundle in
    // scripts/verify-desktop-package.mjs and in desktop.bundle.resolution.test.ts.
    const mainProcess = ['app/src/main/engine.ts', 'app/src/main/runtime.paths.ts']
      .map(read).join('\n');
    expect(mainProcess).toContain("BIMAX_HOST_CAPABILITIES_JSON");
    expect(mainProcess).toContain("BIMAX_MAC_PROVIDER_AUTHORITY: 'electron-main'");
    expect(mainProcess).toContain("BIMAX_DESKTOP_RELEASE_MODE: input.packaged ? 'packaged' : 'development'");
    expect(mainProcess).toContain("'XPCServices', 'BimaxCuService.xpc'");
    expect(mainProcess).toContain("'MacOS', 'bimax-cu-bridge'");
    expect(mainProcess).toContain("'MacOS', 'bimax-desktop-helper'");
    expect(mainProcess).toContain("'MacOS', 'bimax-mac-capability'");
    expect(mainProcess).not.toContain("BIMAX_HOST_PROFILE: 'desktop'");
    expect(mainProcess).not.toContain('bimax-engine.exe');
  });

  test('artifact verifiers cover both Terminal architectures and the real app bundle', () => {
    const terminalGate = read('scripts/verify-terminal-archives.mjs');
    const desktopGate = read('scripts/verify-desktop-package.mjs');
    expect(terminalGate).toContain('bimax-darwin-arm64.tar.gz');
    expect(terminalGate).toContain('bimax-darwin-x64.tar.gz');
    expect(terminalGate).toContain('SHA256SUMS');
    expect(desktopGate).toContain("'XPCServices', 'BimaxCuService.xpc'");
    expect(desktopGate).toContain('BIMAX_HOST_CAPABILITIES_JSON');
    expect(desktopGate).toContain('BIMAX_DESKTOP_RELEASE_MODE');
    expect(desktopGate).toContain("asar.extractFile(files.asar, 'out/main/index.js')");
  });
});

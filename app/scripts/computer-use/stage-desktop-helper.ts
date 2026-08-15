#!/usr/bin/env npx tsx
import { execFileSync } from 'child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DESKTOP_HELPER_SOURCE } from '../../src/capabilities/mac/helper.source';

const targetOs = process.argv[2] || 'darwin';
const targetArch = process.argv[3] || process.arch;
const destination = path.resolve(process.argv[4] || 'tui/embed/bimax-desktop-helper');
mkdirSync(path.dirname(destination), { recursive: true });

if (targetOs !== 'darwin') {
  writeFileSync(destination, '#!/usr/bin/env sh\nexit 1\n', { mode: 0o755 });
  process.exit(0);
}
if (process.platform !== 'darwin') throw new Error('the desktop helper must be built on macOS');

const temp = mkdtempSync(path.join(os.tmpdir(), 'bimax-desktop-helper-'));
try {
  const source = path.join(temp, 'BimaxDesktopHelper.swift');
  const binary = path.join(temp, 'bimax-desktop-helper');
  writeFileSync(source, DESKTOP_HELPER_SOURCE, { mode: 0o600 });
  const swiftArch = targetArch === 'amd64' || targetArch === 'x64' || targetArch === 'x86_64'
    ? 'x86_64' : 'arm64';
  const retainedSdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk';
  const sdk = existsSync(retainedSdk) ? retainedSdk
    : execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
        encoding: 'utf8', timeout: 10_000,
      }).trim();
  const moduleCache = path.join(temp, 'module-cache');
  mkdirSync(moduleCache);
  execFileSync('xcrun', [
    '--sdk', 'macosx', 'swiftc', '-O',
    '-target', `${swiftArch}-apple-macosx13.0`, '-sdk', sdk, '-o', binary, source,
  ], {
    stdio: 'inherit', timeout: 180_000,
    env: { ...process.env, SDKROOT: sdk, CLANG_MODULE_CACHE_PATH: moduleCache, SWIFT_MODULECACHE_PATH: moduleCache },
  });
  copyFileSync(binary, destination);
  chmodSync(destination, 0o755);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

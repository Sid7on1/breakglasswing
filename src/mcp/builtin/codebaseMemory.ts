// Built-in engine: codebase-memory-mcp (DeusData/codebase-memory-mcp).
//
// A single static C binary that speaks MCP over stdio and exposes a 158-language
// code knowledge graph (callers/callees, cross-service call graphs, data-flow,
// clusters, cohesion, ADR hints) — a far richer replacement for Bimax's basic
// native graph. We "bake it in" without bloating the repo: the 269 MB binary is
// NOT committed (it's gitignored under vendor/*/bin/). Instead we provision it on
// first use exactly the way the upstream npm package does — fetch the pinned
// release archive for this platform, verify its checksum, extract, and cache it.
//
// The agent then gets the engine auto-registered as a built-in MCP server with
// zero manual setup. See memory [[bake_in_codemem_headroom]].

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { McpServerSpec } from '../config';
import { Logger } from '../../utils/logger';

const REPO = 'DeusData/codebase-memory-mcp';
const VERSION = '0.8.1';
export const SERVER_NAME = 'codebase-memory';

/** Repo/package root (where vendor/ lives). Works from both dist/ and src (tsx). */
function pkgRoot(): string {
  // dist/mcp/builtin/codebaseMemory.js  -> ../../.. = repo root
  // src/mcp/builtin/codebaseMemory.ts   -> ../../.. = repo root
  return path.resolve(__dirname, '..', '..', '..');
}

function binName(): string {
  return process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
}

function binDir(): string {
  return path.join(pkgRoot(), 'vendor', 'codebase-memory', 'bin');
}

export function binPath(): string {
  return path.join(binDir(), binName());
}

function getPlatform(): string {
  switch (process.platform) {
    case 'linux': return 'linux';
    case 'darwin': return 'darwin';
    case 'win32': return 'windows';
    default: throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function getArch(): string {
  switch (process.arch) {
    case 'arm64': return 'arm64';
    case 'x64': return 'amd64';
    default: throw new Error(`Unsupported architecture: ${process.arch}`);
  }
}

function assetName(): string {
  const platform = getPlatform();
  const arch = getArch();
  const ext = platform === 'windows' ? 'zip' : 'tar.gz';
  // Linux ships a fully-static "-portable" build; the standard linux binary links
  // glibc 2.38+ and fails on older distros. macOS/Windows have no such variant.
  const variant = platform === 'linux' ? '-portable' : '';
  return `codebase-memory-mcp-${platform}-${arch}${variant}.${ext}`;
}

function assertHttps(url: string): void {
  if (!url.startsWith('https://')) throw new Error(`Refusing non-HTTPS URL: ${url}`);
}

function download(url: string, dest: string): Promise<void> {
  assertHttps(url);
  return new Promise((resolve, reject) => {
    const follow = (u: string, depth: number) => {
      if (depth > 5) { reject(new Error('Too many redirects')); return; }
      assertHttps(u);
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location;
          if (!loc) { reject(new Error('Redirect with no location')); return; }
          follow(loc.startsWith('/') ? new URL(loc, u).href : loc, depth + 1);
          return;
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${u}`)); return; }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      }).on('error', reject);
    };
    follow(url, 0);
  });
}

/** Verify the archive's sha256 against the release checksums.txt. Mismatch is fatal. */
async function verifyChecksum(archivePath: string, archiveName: string): Promise<void> {
  const url = `https://github.com/${REPO}/releases/download/v${VERSION}/checksums.txt`;
  const tmp = archivePath + '.checksums';
  try {
    await download(url, tmp);
    const line = fs.readFileSync(tmp, 'utf8').split('\n').find((l) => l.includes(archiveName));
    if (!line) return; // checksum line missing — non-fatal (pre-release etc.)
    const expected = line.split(/\s+/)[0];
    const actual = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
    if (expected !== actual) {
      throw new Error(`Checksum mismatch for ${archiveName}: expected ${expected}, got ${actual}`);
    }
    Logger.info('[codebase-memory] checksum verified');
  } catch (err: any) {
    if (String(err?.message).startsWith('Checksum mismatch')) throw err;
    // Network/unavailable — non-fatal, proceed without verification.
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

let provisioning: Promise<string | null> | null = null;

/**
 * Ensure the codebase-memory binary exists locally, fetching it once on first use.
 * Returns the absolute binary path, or null if provisioning failed (best-effort).
 * Concurrent callers share a single in-flight download.
 */
export function ensureBinary(): Promise<string | null> {
  const target = binPath();
  if (fs.existsSync(target)) return Promise.resolve(target);
  if (provisioning) return provisioning;

  provisioning = (async () => {
    const archiveName = assetName();
    const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${archiveName}`;
    const ext = archiveName.endsWith('.zip') ? 'zip' : 'tar.gz';
    fs.mkdirSync(binDir(), { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbm-'));
    const tmpArchive = path.join(tmpDir, `cbm.${ext}`);
    try {
      Logger.info(`[codebase-memory] provisioning v${VERSION} for ${getPlatform()}/${getArch()} (one-time)...`);
      await download(url, tmpArchive);
      await verifyChecksum(tmpArchive, archiveName);
      if (ext === 'tar.gz') {
        execFileSync('tar', ['-xzf', tmpArchive, '-C', tmpDir, '--no-same-owner']);
      } else {
        execFileSync('powershell', ['-NoProfile', '-Command',
          `Expand-Archive -Path '${tmpArchive}' -DestinationPath '${tmpDir}' -Force`]);
      }
      const extracted = path.join(tmpDir, binName());
      // tar-slip defense: extracted path must stay inside tmpDir.
      if (!path.resolve(extracted).startsWith(path.resolve(tmpDir) + path.sep)) {
        throw new Error('Path traversal detected in archive');
      }
      fs.copyFileSync(extracted, target);
      fs.chmodSync(target, 0o755);
      // macOS: strip the Gatekeeper quarantine flag so the binary can be spawned.
      if (process.platform === 'darwin') {
        try { execFileSync('xattr', ['-d', 'com.apple.quarantine', target]); } catch { /* not quarantined */ }
      }
      Logger.info('[codebase-memory] binary ready');
      return target;
    } catch (err: any) {
      Logger.warn(`[codebase-memory] provisioning failed: ${err?.message || err}`);
      provisioning = null; // allow a later retry
      return null;
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  })();
  return provisioning;
}

/**
 * Built-in MCP server spec for codebase-memory, or null if disabled / unprovisionable.
 * Opt out with BIMAX_DISABLE_CODEBASE_MEMORY=1. Default invocation (no args) runs the
 * JSON-RPC stdio MCP server; cwd is inherited from the engine (the project root).
 */
export async function codebaseMemorySpec(): Promise<McpServerSpec | null> {
  if (process.env.BIMAX_DISABLE_CODEBASE_MEMORY === '1') return null;
  const bin = await ensureBinary();
  if (!bin) return null;
  return { name: SERVER_NAME, command: bin, args: [] };
}

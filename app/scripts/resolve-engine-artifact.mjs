#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!['darwin-arm64', 'darwin-x64'].includes(target)) throw new Error('target must be darwin-arm64 or darwin-x64');
const lockPath = path.join(appRoot, 'engine.lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const sha256 = async (file) => {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
};

const staging = path.join(appRoot, `.engine-staging-${process.pid}`);
const destination = path.join(appRoot, 'engine');
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

async function download(url, output) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(output));
      return;
    } catch (error) {
      last = error;
      await rm(output, { force: true });
    }
  }
  throw new Error(`download failed after 3 bounded attempts: ${url}: ${String(last)}`);
}

try {
  const explicit = process.env.BIMAX_ENGINE_LOCAL_OVERRIDE?.trim();
  if (explicit) {
    if (process.env.BIMAX_RELEASE_BUILD === '1') throw new Error('BIMAX_ENGINE_LOCAL_OVERRIDE is forbidden for a release build');
    const info = await stat(explicit);
    if (!info.isFile()) throw new Error(`local override is not a file: ${explicit}`);
    await copyFile(explicit, path.join(staging, 'bimax-engine'));
    await chmod(path.join(staging, 'bimax-engine'), 0o755);
    await writeFile(path.join(staging, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, localOverride: true,
      engine: { version: 'contributor-override', buildCommit: 'unverified-local' },
      protocol: lock.protocol,
      artifacts: [{ platform: 'darwin', arch: target.endsWith('arm64') ? 'arm64' : 'x64', file: 'bimax-engine', sha256: await sha256(path.join(staging, 'bimax-engine')), sizeBytes: info.size }],
    }, null, 2) + '\n');
    await copyFile(lockPath, path.join(staging, 'lock.json'));
    console.warn(`engine staged from explicit contributor override: ${explicit}`);
  } else {
    const artifactDir = process.env.BIMAX_ENGINE_ARTIFACT_DIR?.trim();
    const manifestFile = path.join(staging, 'release-manifest.json');
    if (artifactDir) await copyFile(path.join(artifactDir, lock.manifestFile), manifestFile);
    else await download(`${lock.baseUrl}/${lock.manifestFile}`, manifestFile);

    const manifestDigest = await sha256(manifestFile);
    if (manifestDigest !== lock.manifestSha256) throw new Error(`engine manifest digest mismatch: expected ${lock.manifestSha256}, got ${manifestDigest}`);
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (manifest.engine?.version !== lock.engineVersion) throw new Error(`engine version mismatch: expected ${lock.engineVersion}, got ${manifest.engine?.version}`);
    const p = manifest.protocol || {};
    if (Math.max(Number(p.minCompatibleMajor), Number(lock.protocol.minCompatibleMajor)) > Math.min(Number(p.maxCompatibleMajor), Number(lock.protocol.maxCompatibleMajor))) {
      throw new Error(`engine protocol ${p.version} does not overlap Desktop compatibility range`);
    }
    const arch = target.endsWith('arm64') ? 'arm64' : 'x64';
    const artifact = manifest.artifacts?.find((a) => a.platform === 'darwin' && a.arch === arch);
    if (!artifact) throw new Error(`manifest has no ${target} engine artifact`);
    const source = path.join(staging, artifact.file);
    if (artifactDir) await copyFile(path.join(artifactDir, artifact.file), source);
    else await download(`${lock.baseUrl}/${artifact.file}`, source);
    const info = await stat(source);
    if (info.size !== artifact.sizeBytes) throw new Error(`engine size mismatch: expected ${artifact.sizeBytes}, got ${info.size}`);
    const digest = await sha256(source);
    if (digest !== artifact.sha256) throw new Error(`engine digest mismatch: expected ${artifact.sha256}, got ${digest}`);
    await rename(source, path.join(staging, 'bimax-engine'));
    await chmod(path.join(staging, 'bimax-engine'), 0o755);
    await rename(manifestFile, path.join(staging, 'manifest.json'));
    await copyFile(lockPath, path.join(staging, 'lock.json'));
    console.log(`engine verified: ${target} ${digest.slice(0, 16)}… ${Math.round(info.size / 1048576)} MiB`);
  }
  await rm(destination, { recursive: true, force: true });
  await rename(staging, destination);
  console.log(`engine staged: ${path.relative(appRoot, path.join(destination, 'bimax-engine'))}`);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [desktopArg, manifestArg] = process.argv.slice(2);
if (!desktopArg || !manifestArg) {
  throw new Error('usage: pin-desktop-engine.mjs <desktop-repo> <terminal-manifest>');
}
const desktop = path.resolve(desktopArg);
const manifestPath = path.resolve(manifestArg);
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const lockPath = path.join(desktop, 'engine.lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));

if (manifest.engine?.version !== lock.engineVersion) {
  throw new Error(`engine version changed during split: ${manifest.engine?.version} != ${lock.engineVersion}`);
}
if (manifest.protocol?.version !== lock.protocol?.version) {
  throw new Error(`protocol changed during split: ${manifest.protocol?.version} != ${lock.protocol?.version}`);
}
for (const arch of ['arm64', 'x64']) {
  if (!manifest.artifacts?.some((artifact) => artifact.platform === 'darwin' && artifact.arch === arch)) {
    throw new Error(`split Terminal manifest is missing darwin-${arch}`);
  }
}

lock.manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
lock.publicationStatus = 'local-migration';
lock.publicationNote = 'Set the final Terminal release URL only after the owner confirms the GitHub organization and repository name.';
await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

const boundaryPath = path.join(desktop, 'repo-boundary.json');
const boundary = JSON.parse(await readFile(boundaryPath, 'utf8'));
boundary.engineManifest = {
  version: manifest.engine.version,
  protocol: manifest.protocol.version,
  sha256: lock.manifestSha256,
  architectures: manifest.artifacts.map((artifact) => `${artifact.platform}-${artifact.arch}`).sort(),
  publicationStatus: 'local-migration',
};
await writeFile(boundaryPath, `${JSON.stringify(boundary, null, 2)}\n`);

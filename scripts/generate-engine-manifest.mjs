#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const buildDir = path.resolve(process.argv[2] || 'build');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const protocolSource = readFileSync('src/protocol/protocol.ts', 'utf8');
const protocolVersion = protocolSource.match(/PROTOCOL_SEMVER\s*=\s*'([^']+)'/)?.[1];
const minMajor = Number(protocolSource.match(/PROTOCOL_MIN_COMPATIBLE_MAJOR\s*=\s*(\d+)/)?.[1]);
const maxMajor = Number(protocolSource.match(/PROTOCOL_MAX_COMPATIBLE_MAJOR\s*=\s*(\d+)/)?.[1]);
if (!protocolVersion || !minMajor || !maxMajor) throw new Error('protocol compatibility constants missing');

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const commit = process.env.GITHUB_SHA || process.env.BIMAX_BUILD_COMMIT || 'working-tree';
const targets = ['darwin-arm64', 'darwin-x64'];
const artifacts = [];
for (const target of targets) {
  const file = `bimax-engine-${target}`;
  const absolute = path.join(buildDir, file);
  try {
    artifacts.push({
      platform: 'darwin', arch: target.endsWith('arm64') ? 'arm64' : 'x64',
      file, sha256: sha256(absolute), sizeBytes: statSync(absolute).size,
    });
  } catch { /* a single-target local release is valid */ }
}
if (!artifacts.length) throw new Error(`no bimax-engine-darwin-* artifacts in ${buildDir}`);

const protocolDir = path.join(buildDir, 'protocol', `bimax-client-protocol-v${protocolVersion}`);
const schemaFile = path.join(protocolDir, 'protocol.schema.json');
const fixturesFile = path.join(protocolDir, 'fixtures.json');
const manifest = {
  schemaVersion: 1,
  engine: { version: packageJson.version, buildCommit: commit },
  protocol: {
    version: protocolVersion, minCompatibleMajor: minMajor, maxCompatibleMajor: maxMajor,
    schema: { file: path.relative(buildDir, schemaFile), sha256: sha256(schemaFile) },
    fixtures: { file: path.relative(buildDir, fixturesFile), sha256: sha256(fixturesFile) },
  },
  artifacts,
};
const out = path.join(buildDir, 'bimax-engine-manifest.json');
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(path.join(buildDir, 'ENGINE_SHA256SUMS'), artifacts.map((a) => `${a.sha256}  ${a.file}`).join('\n') + `\n${sha256(out)}  ${path.basename(out)}\n`);
console.log(`engine manifest ready: ${out} (${artifacts.length} architecture${artifacts.length === 1 ? '' : 's'})`);

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const buildDir = path.resolve(process.argv[2] || path.join(repo, 'build'));
const expected = [
  { archive: 'bimax-darwin-arm64.tar.gz', architecture: 'arm64' },
  { archive: 'bimax-darwin-x64.tar.gz', architecture: 'x86_64' },
];

function fail(message) {
  console.error(`terminal archive gate: FAIL: ${message}`);
  process.exit(1);
}

function command(name, args) {
  try {
    return execFileSync(name, args, { encoding: 'utf8' }).trim();
  } catch (error) {
    fail(`${name} ${args.join(' ')} failed: ${error.message}`);
  }
}

const sumsPath = path.join(buildDir, 'SHA256SUMS');
if (!existsSync(sumsPath)) fail(`missing ${sumsPath}`);
const sums = new Map(
  readFileSync(sumsPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
      if (!match) fail(`malformed checksum line: ${line}`);
      return [match[2], match[1].toLowerCase()];
    }),
);

const temp = mkdtempSync(path.join(tmpdir(), 'bimax-terminal-archives-'));
try {
  for (const item of expected) {
    const archivePath = path.join(buildDir, item.archive);
    if (!existsSync(archivePath)) fail(`missing ${item.archive}`);
    const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
    if (sums.get(item.archive) !== digest) fail(`checksum mismatch for ${item.archive}`);

    const members = command('tar', ['-tzf', archivePath]).split(/\r?\n/).filter(Boolean);
    if (members.length !== 1 || !/^bimax-[^/]+$/.test(members[0])) {
      fail(`${item.archive} must contain exactly one top-level bimax binary; found ${members.join(', ')}`);
    }
    if (members.some((member) => /(computer[-_ ]?use|desktop[-_ ]?helper|cu[-_ ]?service|xpc)/i.test(member))) {
      fail(`${item.archive} exposes a computer-use payload`);
    }

    const outputDir = path.join(temp, item.architecture);
    command('mkdir', ['-p', outputDir]);
    command('tar', ['-xzf', archivePath, '-C', outputDir]);
    const binary = path.join(outputDir, members[0]);
    const fileInfo = command('file', [binary]);
    if (!fileInfo.includes(item.architecture)) {
      fail(`${item.archive} has the wrong architecture: ${fileInfo}`);
    }
    console.log(`terminal archive gate: PASS ${item.archive} (${item.architecture}, ${digest})`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (sums.size !== expected.length) fail(`SHA256SUMS must describe exactly ${expected.length} archives`);
console.log('terminal archive gate: PASS 2/2 Mac Terminal archives; no desktop payload members');

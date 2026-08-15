#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  createManifest, installManualAlpha, verifyManifest, writeManifestFiles,
} from './release/manual-alpha-lib.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'bimax-phase7-'));
try {
  const app = path.join(root, 'Bimax.app');
  const exe = path.join(app, 'Contents', 'MacOS', 'Bimax');
  mkdirSync(path.dirname(exe), { recursive: true });
  writeFileSync(exe, '#!/bin/sh\nexit 0\n');
  chmodSync(exe, 0o755);
  mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(path.join(app, 'Contents', 'Resources', 'payload'), 'release-a');
  const dmg = path.join(root, 'Bimax-1.1.0-arm64.dmg');
  writeFileSync(dmg, 'fake deterministic DMG bytes');

  const manifest = createManifest({
    dmg, app, version: '1.1.0', architecture: 'arm64', generatedAt: '2026-08-09T00:00:00.000Z',
  });
  const manifestPath = writeManifestFiles(manifest, root);
  verifyManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), root);

  writeFileSync(dmg, 'mutated DMG');
  assert.throws(() => verifyManifest(manifest, root), /DMG digest mismatch/);
  writeFileSync(dmg, 'fake deterministic DMG bytes');
  writeFileSync(path.join(app, 'Contents', 'Resources', 'payload'), 'mutated app');
  assert.throws(() => verifyManifest(manifest, root), /app tree digest mismatch/);
  writeFileSync(path.join(app, 'Contents', 'Resources', 'payload'), 'release-a');

  const destination = path.join(root, 'Applications', 'Bimax.app');
  const oldExe = path.join(destination, 'Contents', 'MacOS', 'Bimax');
  mkdirSync(path.dirname(oldExe), { recursive: true });
  writeFileSync(oldExe, 'old-install');
  assert.throws(() => installManualAlpha({
    source: app,
    destination,
    expectedApp: manifest.app,
    postcondition: () => { throw new Error('injected postcondition failure'); },
  }), /injected postcondition failure/);
  assert.equal(readFileSync(oldExe, 'utf8'), 'old-install', 'failed activation must restore previous app');

  const installed = installManualAlpha({ source: app, destination, expectedApp: manifest.app });
  assert.equal(installed.rollback, `${destination}.previous`);
  assert.equal(readFileSync(path.join(destination, 'Contents', 'Resources', 'payload'), 'utf8'), 'release-a');
  assert.equal(readFileSync(path.join(`${destination}.previous`, 'Contents', 'MacOS', 'Bimax'), 'utf8'), 'old-install');
  console.log('phase7 manual-alpha integrity, mutation rejection and rollback: PASS');
} finally {
  rmSync(root, { recursive: true, force: true });
}

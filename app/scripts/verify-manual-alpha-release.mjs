#!/usr/bin/env node
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { verifyManifest } from './release/manual-alpha-lib.mjs';

try {
  const manifestPath = path.resolve(process.argv[2] || '');
  const artifactDirectory = path.resolve(process.argv[3] || path.dirname(manifestPath));
  const appOverride = process.argv[4] ? path.resolve(process.argv[4]) : undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  verifyManifest(manifest, artifactDirectory, appOverride);
  console.log(`verified manual-alpha DMG and app tree: ${manifest.version} ${manifest.architecture}`);
} catch (error) {
  console.error(`verification failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

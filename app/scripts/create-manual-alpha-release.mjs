#!/usr/bin/env node
import path from 'node:path';
import { createManifest, writeManifestFiles } from './release/manual-alpha-lib.mjs';

function value(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${name}`);
  return path.resolve(process.argv[i + 1]);
}

try {
  const dmg = value('--dmg');
  const app = value('--app');
  const out = value('--out');
  const version = process.argv[process.argv.indexOf('--version') + 1];
  const architecture = process.argv[process.argv.indexOf('--arch') + 1];
  if (!version || !architecture || !['arm64', 'x64'].includes(architecture)) throw new Error('require --version and --arch arm64|x64');
  const manifest = createManifest({ dmg, app, version, architecture });
  const file = writeManifestFiles(manifest, out);
  console.log(`manual-alpha manifest: ${file}`);
  console.log(`DMG sha256: ${manifest.dmg.sha256}`);
  console.log(`app tree sha256: ${manifest.app.treeSha256}`);
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

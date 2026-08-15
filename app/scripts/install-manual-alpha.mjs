#!/usr/bin/env node
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { installManualAlpha } from './release/manual-alpha-lib.mjs';

function value(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${name}`);
  return path.resolve(process.argv[i + 1]);
}

try {
  const source = value('--source');
  const destination = value('--destination');
  const manifestPath = value('--manifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.channel !== 'manual-alpha') throw new Error('manifest is not a manual-alpha release');
  const result = installManualAlpha({ source, destination, expectedApp: manifest.app });
  console.log(`installed: ${result.installed}`);
  console.log(result.rollback ? `rollback copy: ${result.rollback}` : 'rollback copy: none (fresh install)');
  console.log(manifest.permissionRegrantWarning);
} catch (error) {
  console.error(`install failed; previous app restored: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

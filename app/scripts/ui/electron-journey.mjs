#!/usr/bin/env node

/** Phase 5 journey through built Electron main → preload IPC → renderer → engine → real provider. */
import puppeteer from 'puppeteer';
import { createRequire } from 'node:module';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electron = require('electron');
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_DIR = path.resolve(APP_DIR, '..');
const provider = path.resolve(process.env.BIMAX_PHASE5_PROVIDER || '/tmp/bimax-mac-capability-phase5');
const engineFixture = path.join(APP_DIR, 'scripts/ui/electron-engine-fixture.mjs');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const resultsDir = path.join(APP_DIR, 'benchmarks/ui/results/phase5', `electron-${runId}`);
const temp = mkdtempSync(path.join(tmpdir(), 'bimax-phase5-electron-'));
const project = path.join(temp, 'project');
const evidenceFile = path.join(temp, 'provider-evidence.json');
mkdirSync(project, { recursive: true });
writeFileSync(path.join(project, 'package.json'), '{"name":"phase5-safe-fixture","private":true}\n');
mkdirSync(resultsDir, { recursive: true });

if (!existsSync(provider)) throw new Error(`compiled provider missing at ${provider}`);
if (!existsSync(path.join(APP_DIR, 'out/main/index.js'))) throw new Error('Electron build missing; run npm --prefix app run build');

const checks = [];
const check = (name, pass, observed) => checks.push({ name, pass: !!pass, observed: String(observed).slice(0, 500) });
const waitForEvidence = async (predicate, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const records = JSON.parse(readFileSync(evidenceFile, 'utf8'));
      if (predicate(records)) return records;
    } catch { /* provider has not written its first record yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`provider evidence did not reach the required state within ${timeoutMs}ms`);
};
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: electron,
    headless: false,
    env: {
      ...process.env,
      BIMAX_CWD: project,
      BIMAX_ENGINE_CMD: `${process.execPath} ${engineFixture}`,
      BIMAX_MAC_CAPABILITY_PROVIDER: provider,
      BIMAX_PHASE5_EVIDENCE_FILE: evidenceFile,
    },
    args: [APP_DIR, `--user-data-dir=${path.join(temp, 'user-data')}`, '--no-sandbox'],
    timeout: 30_000,
  });
  const pages = await browser.pages();
  const page = pages.find((candidate) => !candidate.url().startsWith('devtools://')) || await browser.waitForTarget(() => true).then((t) => t.page());
  if (!page) throw new Error('Electron did not create a renderer page');
  await page.waitForSelector('textarea[data-bimax-composer]', { timeout: 30_000 });
  await page.waitForFunction(() => document.body.innerText.includes('Phase 5 Safe Fixture'), { timeout: 30_000 });
  await page.screenshot({ path: path.join(resultsDir, 'electron-live-target.png'), fullPage: true });

  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (wanted) => {
    const clicked = await page.evaluate((label) => {
      const node = [...document.querySelectorAll('button, [role="tab"]')]
        .find((candidate) => (candidate.textContent || '').includes(label));
      if (!node) return false;
      node.click();
      return true;
    }, wanted);
    if (!clicked) throw new Error(`no Electron control matching ${JSON.stringify(wanted)}`);
  };
  const submit = async (value) => {
    const composer = await page.$('textarea[data-bimax-composer]');
    await composer.focus();
    await composer.type(value);
    await page.keyboard.press('Enter');
  };

  await click('Mac');
  let live = await text();
  check('production-qualified provider result creates the Mac lane', /Phase 5 Safe Fixture/.test(live), 'target visible');
  check('the exact safe fixture window is visible', /Window 5150/.test(live), live.match(/Window[^\n]*/)?.[0] || 'missing');

  await click('Take control');
  await page.waitForFunction(() => document.body.innerText.includes('You have control'), { timeout: 10_000 });
  await submit('Attempt the safe provider action while I have control');
  await page.waitForFunction(() => document.body.innerText.includes('computer_use_paused'), { timeout: 20_000 });
  await click('Mac');
  await page.waitForFunction(() => document.body.innerText.includes('Nothing was sent to your Mac'), { timeout: 10_000 });
  await page.screenshot({ path: path.join(resultsDir, 'electron-paused-refusal.png'), fullPage: true });

  await click('Let Bimax continue');
  await page.waitForFunction(() => !document.body.innerText.includes('You have control'), { timeout: 10_000 });
  await submit('Issue a fresh safe provider action after resume');
  await waitForEvidence((records) => records.some((record) => record.action === 'wait' && record.ok === true));
  await click('Mac');
  // Grade the production tool event where the user consumes it. The assistant sentence is only a
  // fixture convenience and may be virtualized out of the transcript; the Live Target's newest
  // `Waited` + `Confirmed` row is the actual product end state.
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('Waited') && text.includes('Confirmed');
  }, { timeout: 60_000 });
  const resumedText = await text();
  check('the resumed provider result reaches the Live Target', resumedText.includes('Waited') && resumedText.includes('Confirmed'), 'Waited + Confirmed visible');
  await page.screenshot({ path: path.join(resultsDir, 'electron-resumed-success.png'), fullPage: true });

  const records = JSON.parse(readFileSync(evidenceFile, 'utf8'));
  const paused = records.find((record) => record.action === 'wait' && record.code === 'computer_use_paused');
  const resumed = records.find((record) => record.action === 'wait' && record.ok === true);
  check('the actual provider refused while main owned the pause', !!paused && paused.isError === true, JSON.stringify(paused));
  check('only a freshly issued post-resume action succeeded', !!resumed && resumed.sequence > paused?.sequence, JSON.stringify(records));
  check('the provider name is the production MCP identity', records.every((record) => record.qualifiedTool === 'mcp__bimax-mac__mac_control'), JSON.stringify(records.map((r) => r.qualifiedTool)));

  const report = {
    schema_version: '1.0', phase: 5, product: 'bimax-desktop-electron-boundary',
    run_id: runId, architecture: process.arch, provider, checks,
    providerRecords: records,
    outcome: checks.every((item) => item.pass) ? 'pass' : 'fail',
  };
  writeFileSync(path.join(resultsDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.outcome === 'pass' ? 'PASS' : 'FAIL'} Electron production boundary\n`);
  for (const item of checks.filter((entry) => !entry.pass)) process.stdout.write(`  ✗ ${item.name}: ${item.observed}\n`);
  process.stdout.write(`report: ${path.relative(REPO_DIR, path.join(resultsDir, 'report.json'))}\n`);
  if (report.outcome !== 'pass') process.exitCode = 1;
} catch (error) {
  let providerRecords = [];
  try { providerRecords = JSON.parse(readFileSync(evidenceFile, 'utf8')); } catch { /* no record */ }
  writeFileSync(path.join(resultsDir, 'failure.json'), `${JSON.stringify({
    schema_version: '1.0', phase: 5, product: 'bimax-desktop-electron-boundary',
    run_id: runId, architecture: process.arch, provider, checks, providerRecords,
    outcome: 'fail', error: String(error?.stack || error),
  }, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  rmSync(temp, { recursive: true, force: true });
}

// Render the Bimax app icon (1024×1024 PNG) via system Chrome — rounded square, graphite base,
// terracotta mark (Graphite & Phosphor). Resolves puppeteer from the repo root's node_modules.
// Usage: node app/scripts/make-icon.mjs   (from anywhere; paths are script-relative)
// electron-builder converts buildResources/icon.png → .icns/.ico per target automatically.
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(appDir, 'buildResources');
const out = path.join(outDir, 'icon.png');

const html = `<!doctype html><html><head><style>
  * { margin:0; padding:0; }
  body { width:1024px; height:1024px; background:transparent; }
  .tile {
    position:absolute; left:100px; top:100px; width:824px; height:824px;
    border-radius:186px;
    background: radial-gradient(120% 120% at 20% 10%, #2a2521 0%, #1b1815 55%, #141210 100%);
    box-shadow: inset 0 2px 6px rgba(255,255,255,0.06), inset 0 -8px 24px rgba(0,0,0,0.5);
    display:flex; align-items:center; justify-content:center; overflow:hidden;
  }
  .glow {
    position:absolute; width:620px; height:620px; border-radius:50%;
    background:radial-gradient(circle, rgba(215,119,87,0.22) 0%, rgba(215,119,87,0) 70%);
  }
  .mark {
    font-family:-apple-system, 'Helvetica Neue', sans-serif;
    font-size:430px; font-weight:700; letter-spacing:-0.04em;
    background:linear-gradient(160deg, #E89B7C 0%, #D77757 45%, #B85E40 100%);
    -webkit-background-clip:text; color:transparent;
  }
  .blade {
    position:absolute; right:190px; top:310px; width:30px; height:404px; border-radius:15px;
    background:linear-gradient(180deg, #E89B7C, #B85E40); opacity:0.9;
  }
</style></head><body>
  <div class="tile"><div class="glow"></div><span class="mark">bi</span><div class="blade"></div></div>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle0' });
mkdirSync(outDir, { recursive: true });
await page.screenshot({ path: out, omitBackground: true });
await browser.close();
console.log('icon written:', out);

// Water look review: production build + vite preview + headless Chromium. Loads the synthetic
// hole-13 pond (`review-h13`) from fixed ?view bookmarks plus the normal chase camera, checks for
// console errors, and writes screenshots to docs/screens/water/. Not part of `pnpm -r test`.
//
//   pnpm --filter web water-review
//
// Chromium: $CHROMIUM_PATH, else the cloud image's /opt/pw-browsers build, else installed Chrome.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const screensRel = 'docs/screens/water';
const outDir = resolve(appDir, '../..', screensRel);
const level = process.env.GCS_LEVEL ?? 'review-h13';

/** name -> ?view=x,z,height,headingDeg,pitchDeg ('' = chase camera at the level's spawn). */
export const BOOKMARKS = {
  'h13-chase': '',
  'h13-sun-glitter': '-56,38,8,112,-26',
  'h13-along-pond': '-12,128,2.2,352,-4',
  'h13-overhead': '0,70,30,315,-30',
  'h13-close': '-40,10,1.2,120,-18',
};

function chromiumLaunchOptions() {
  if (process.env.CHROMIUM_PATH) return { executablePath: process.env.CHROMIUM_PATH };
  const root = '/opt/pw-browsers';
  if (existsSync(root)) {
    for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const exe = join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(exe)) return { executablePath: exe };
    }
  }
  return { channel: 'chrome' };
}

await build({ root: appDir, logLevel: 'warn' });
const server = await preview({ root: appDir, preview: { port: 4174, strictPort: false, open: false }, logLevel: 'warn' });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ ...chromiumLaunchOptions(), args: ['--ignore-gpu-blocklist'] });
mkdirSync(outDir, { recursive: true });

const errors = [];
const shots = {};
try {
  for (const [name, view] of Object.entries(BOOKMARKS)) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    await page.goto(`${base}?level=${level}&menu=0${view ? `&view=${view}` : ''}`);
    await page.waitForFunction(() => window.__gcs?.ready || window.__gcs?.error, null, { timeout: 180_000 });
    const startError = await page.evaluate(() => window.__gcs.error ?? null);
    if (startError) throw new Error(`app failed to start: ${startError}`);
    await page.waitForFunction(() => window.__gcs.frames > 8, null, { timeout: 180_000 });
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    shots[name] = {
      url: `?level=${level}${view ? `&view=${view}` : ''}`,
      backend: await page.evaluate(() => window.__gcs.backend),
      fps: Number((await page.evaluate(() => window.__gcs.stats().fps)).toFixed(1)),
    };
    await page.close();
  }
  console.log(JSON.stringify({ level, shots, consoleErrors: errors, dir: screensRel }, null, 2));
  if (errors.length) {
    console.error(`WATER REVIEW FAIL: ${errors.length} console error(s)`);
    process.exitCode = 1;
  } else {
    console.log('WATER REVIEW PASS');
  }
} catch (err) {
  console.error(`WATER REVIEW FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

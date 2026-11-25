// Smoke test: production build + vite preview + headless Chromium. Loads dummy-01, goes through
// the title and ride menus, checks for console errors, drives forward, pauses and resumes, toggles
// the mode, drifts in Joyride, drives into the wading pool, and writes screenshots to
// docs/screens/m1/ (GCS_SCREENS picks another folder).
// Not part of `pnpm -r test`.
//
//   pnpm --filter web smoke
//
// Chromium: $CHROMIUM_PATH, else the cloud image's /opt/pw-browsers build, else installed Chrome.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// GCS_SCREENS picks the folder (M2 runs it on the real course into docs/screens/m2/smoke).
const screensRel = process.env.GCS_SCREENS ?? 'docs/screens/m1';
const outDir = resolve(appDir, '../..', screensRel);
const level = process.env.GCS_LEVEL ?? 'dummy-01';

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

function fail(message) {
  console.error(`SMOKE FAIL: ${message}`);
  process.exitCode = 1;
}

await build({ root: appDir, logLevel: 'warn' });
const server = await preview({ root: appDir, preview: { port: 4173, strictPort: false, open: false }, logLevel: 'warn' });
const base = server.resolvedUrls.local[0];
// No --enable-unsafe-webgpu: without a GPU this exercises three's automatic WebGL2 fallback.
const browser = await chromium.launch({ ...chromiumLaunchOptions(), args: ['--ignore-gpu-blocklist'] });
mkdirSync(outDir, { recursive: true });

async function open(query, { menus = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));
  await page.goto(`${base}?level=${level}${menus ? '' : '&menu=0'}${query}`);
  if (menus) await throughMenus(page);
  await page.waitForFunction(() => window.__gcs?.ready || window.__gcs?.error, null, { timeout: 120_000 });
  const startError = await page.evaluate(() => window.__gcs.error ?? null);
  if (startError) throw new Error(`app failed to start: ${startError}`);
  await page.waitForFunction(() => window.__gcs.frames > 10, null, { timeout: 120_000 });
  return { page, errors };
}

/** Title -> ride select -> tee off with the keyboard, as a player would. Screenshots both menus. */
async function throughMenus(page) {
  await page.waitForFunction(() => window.__gcs?.screen?.() === 'title', null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2600); // a turret strike into the swing cycle, so a ball is in the air
  await page.screenshot({ path: join(outDir, 'menu-title.png') });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__gcs.screen() === 'ride', null, { timeout: 10_000 });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1400);
  await page.screenshot({ path: join(outDir, 'menu-ride.png') });
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => window.__gcs.ready, null, { timeout: 120_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__gcs.screen() === 'play', null, { timeout: 10_000 });
}

try {
  const { page, errors } = await open('', { menus: true });
  const info = await page.evaluate(() => ({ backend: window.__gcs.backend, levelId: window.__gcs.levelId }));
  await page.screenshot({ path: join(outDir, 'spawn.png') });

  // Hold W until the cart passes 3 m/s. Software rendering can be slow, so allow plenty of wall time.
  await page.keyboard.down('KeyW');
  const t0 = Date.now();
  await page.waitForFunction(() => window.__gcs.speed() > 3, null, { timeout: 90_000, polling: 100 });
  const reachedIn = (Date.now() - t0) / 1000;
  await page.waitForTimeout(1500);
  const driving = await page.evaluate(() => ({
    speed: window.__gcs.speed(),
    position: window.__gcs.position(),
    wheels: window.__gcs.wheels().map((w) => `${w.name}=${w.inContact ? w.material : 'air'}`).join(' '),
    stats: window.__gcs.stats(),
    frames: window.__gcs.frames,
  }));
  await page.screenshot({ path: join(outDir, 'driving.png') });
  await page.keyboard.up('KeyW');

  // Esc pauses to the title; Esc again resumes the round.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__gcs.screen() === 'title', null, { timeout: 10_000 });
  const pausedAt = await page.evaluate(() => window.__gcs.frames);
  await page.waitForTimeout(500);
  const pausedFrames = (await page.evaluate(() => window.__gcs.frames)) - pausedAt;
  await page.screenshot({ path: join(outDir, 'menu-paused.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__gcs.screen() === 'play', null, { timeout: 10_000 });

  // M toggles the mode once per press.
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__gcs.mode() === 'joyride', null, { timeout: 30_000, polling: 100 });
  const toggled = await page.evaluate(() => window.__gcs.mode());

  // Joyride handbrake turn at 10 m/s on the proving straight: skid ribbons.
  await page.evaluate(() => window.__gcs.launch('driveStart', 10));
  await page.keyboard.down('Space');
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__gcs.fx().skids > 20, null, { timeout: 120_000, polling: 100 });
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyD');
  const drift = await page.evaluate(() => window.__gcs.fx());
  await page.screenshot({ path: join(outDir, 'joyride-skids.png') });

  // Hard stop on the cart path from 13 m/s: black rubber lock-up marks.
  await page.evaluate(() => window.__gcs.launch('driveStart', 13));
  await page.keyboard.down('KeyS');
  await page.waitForFunction((n) => window.__gcs.fx().skids > n + 10 && window.__gcs.speed() < 1, drift.skids, {
    timeout: 120_000,
    polling: 100,
  });
  await page.keyboard.up('KeyS');
  const braked = await page.evaluate(() => window.__gcs.fx());
  await page.screenshot({ path: join(outDir, 'brake-skids.png') });

  // Into the wading pool at 10 m/s: spray.
  await page.evaluate(() => window.__gcs.launch('waterEntry', 10));
  await page.waitForFunction(() => window.__gcs.water() > 0.4, null, { timeout: 120_000, polling: 100 });
  await page.waitForFunction((n) => window.__gcs.fx().particles > n, drift.particles + 60, { timeout: 120_000, polling: 100 });
  const water = await page.evaluate(() => ({ fx: window.__gcs.fx(), speed: window.__gcs.speed(), depth: window.__gcs.water() }));
  await page.screenshot({ path: join(outDir, 'water-spray.png') });

  const debug = await open('&debug=1&mode=joyride');
  await debug.page.waitForTimeout(1500);
  await debug.page.screenshot({ path: join(outDir, 'debug.png') });

  const tune = await open('&tune=1');
  await tune.page.waitForTimeout(500);
  const panel = await tune.page.evaluate(() => document.querySelector('.lil-gui')?.textContent?.includes('Tuning') ?? false);
  await tune.page.screenshot({ path: join(outDir, 'tuning-panel.png') });

  const allErrors = [...errors, ...debug.errors, ...tune.errors];
  console.log(
    JSON.stringify(
      {
        url: base,
        backend: info.backend,
        level: info.levelId,
        secondsToPass3mps: reachedIn,
        speedAfter: Number(driving.speed.toFixed(2)),
        position: { x: Number(driving.position.x.toFixed(1)), z: Number(driving.position.z.toFixed(1)) },
        wheels: driving.wheels,
        stats: Object.fromEntries(Object.entries(driving.stats).map(([k, v]) => [k, Number(v.toFixed(2))])),
        pausedFrames,
        modeAfterM: toggled,
        skidQuadsAfterDrift: drift.skids,
        skidQuadsAfterBrake: braked.skids,
        particlesAfterPool: water.fx.particles,
        speedInPool: Number(water.speed.toFixed(2)),
        poolDepth: Number(water.depth.toFixed(2)),
        tuningPanel: panel,
        consoleErrors: allErrors,
        screenshots: [
          'menu-title.png',
          'menu-ride.png',
          'menu-paused.png',
          'spawn.png',
          'driving.png',
          'joyride-skids.png',
          'brake-skids.png',
          'water-spray.png',
          'debug.png',
          'tuning-panel.png',
        ].map((f) =>
          join(screensRel, f),
        ),
      },
      null,
      2,
    ),
  );
  if (allErrors.length) fail(`${allErrors.length} console error(s)`);
  if (driving.speed <= 3) fail(`speed ${driving.speed} m/s after holding W`);
  if (toggled !== 'joyride') fail(`mode after M is ${toggled}`);
  if (pausedFrames !== 0) fail(`${pausedFrames} game frames ran while paused`);
  if (!panel) fail('tuning panel missing with ?tune=1');
  if (process.exitCode !== 1) console.log('SMOKE PASS');
} catch (err) {
  fail(err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err));
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

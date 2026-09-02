# Combat Rendering, Scene Gate and Cart HUD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Phase 3's already-simulated combat on screen — ragdoll targets, the projectiles that knock them down, and a health/ammo HUD — behind a geometry gate that guards all of it, and make the renderer's stale `ballLoaded` reads honest.

**Architecture:** The sim gains read-only, double-buffered `Float32Array` transform snapshots for targets and pooled balls, filled once per fixed tick beside the existing `syncCurrent`/`syncCurrentCart`. `src/entities/**` gains two render-only `THREE.Group` subclasses (`TargetRig`, `BallSwarm`) built from instanced meshes and posed from those buffers, following `GolfClub.ts`'s pattern exactly. `src/ui/**` gains a DOM-free state-derivation module plus a thin DOM writer. `tools/sceneGate.mjs` renders each piece of procedural geometry on a fixed rig in headless Chrome and diffs both structural metrics and a downsampled perceptual signature against checked-in baselines.

**Tech Stack:** TypeScript 7 (strict, `noUnusedLocals`, `noUnusedParameters`), Three.js 0.185, Rapier 0.20 (`@dimforge/rapier3d-compat`), Vite 8, Vitest 4 (node environment), Puppeteer 25.

**Spec:** `docs/superpowers/specs/2026-09-02-combat-rendering-hud-design.md`

## Global Constraints

Copied from `AGENTS.md` and the spec. Every task's requirements implicitly include this section.

- **`src/sim/**` and `src/physics/**` stay DOM-free and three-free.** No `three`, no `window`, no `document`. Vitest's node environment enforces this; a stray import fails the suite.
- **`src/render/**`, `src/entities/**`, `src/ui/**` never mutate `Sim` state.** They read snapshots. They never touch a Rapier body and never hold a `Target`.
- **Every `THREE.Mesh`'s geometry and material must be `.dispose()`d** when discarded — `traverse` + dispose geometry and material(s); materials can be arrays. `InstancedMesh` buffers follow the same rule.
- **No per-frame allocation in the render loop or the fixed tick.** Reuse scratch objects; see `main.ts`'s `scratchA`/`scratchB`/`scratchOut` quaternions for the pattern.
- **No `Math.random()` anywhere reachable from `src/sim/**` or `src/physics/**`.** Seeded PRNG only.
- **No `.glb`/`.obj`/`.fbx` in the playable path, ever.** All geometry is first-party procedural primitives.
- **Never add a second source of truth.** Target capsule dimensions come from `src/sim/entities/Target.ts`, the way `GolfClub.ts` already imports `TURRET_GEOMETRY` from `src/sim/entities/Cart.ts`.
- **`npx tsc --noEmit` must be clean.** Do not relax `strict`, `noUnusedLocals` or `noUnusedParameters` to make an error go away.
- **Every commit needs a DCO sign-off** (`git commit -s`).
- **Never put AI-session metadata in git.** No assistant co-author trailers, no session or chat URLs, no prompt text, no "generated with" footers — not in commit messages, not in PR bodies, not in code comments.
- **`npm run probe` output must stay byte-for-byte identical**, including its pre-existing `driver distance` failure. That failure is not this plan's to fix.
- **Licensing:** everything in this plan lands in `src/**` or `tools/**`, both Apache-2.0. Nothing here may import from `server/**`.

## Baseline at the start of this work

Verified by running them, not assumed:

- `npm test` — 232 tests pass across 16 files.
- `npx tsc --noEmit` — clean.
- `npm run smoke` — exits 1 with exactly three failures, all in `FIRE FROM THE MUZZLE`: `loaded shot counts a stroke (strokes 0)`, `ball leaves from above the cart, not from the ground (ball y=0.23 vs cart y=1.03)`, `ball unloads after being fired`.
- `npm run probe` — exits 1 on its `driver distance` check alone.

## Confirmed test seams

Tests are written at these boundaries and nowhere else. Anything not listed is covered by the gate or by smoke, not by Vitest.

| Seam | Where | Why here |
|---|---|---|
| `tools/gateCompare.mjs` pure comparators | `tools/gateCompare.test.mjs` | Threshold logic is the part of the gate that can be wrong in a way nothing else notices. |
| `Sim`'s public snapshot buffers | `src/sim/world.render.test.ts` | Observed through `Sim`'s public surface after real `step()`/`reset()`/`loadHole()` calls — never by reaching into Rapier bodies. |
| `src/ui/hudState.ts` pure derivation | `src/ui/hudState.test.ts` | DOM-free by construction, so the node environment reaches it. Takes a structural source interface, not a real `Sim`. |
| **Not** unit-tested: `THREE` object graphs | — | Guarded by `npm run gate`. A geometry assertion in Vitest would restate the constructor. |
| **Not** unit-tested: DOM writes | — | Guarded by `npm run smoke`, which drives the real browser. |

**On the gate baselines:** a baseline captured from the code it guards can never disagree with that code. It is evidence the geometry has not silently *changed*, not evidence it is *right*. That is why the human PNG review in Task 3 and Task 6 is load-bearing and not ceremony.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `tools/gateCompare.mjs` | Pure comparison of metrics and signatures against baselines. No I/O, no Puppeteer. |
| `tools/gateCompare.test.mjs` | Tests for the above. |
| `tools/gate/index.html` | The gate harness page shell. |
| `tools/gate/gateScene.ts` | Builds one subject on a fixed camera/light rig; exposes `window.__gate`. |
| `tools/gate.vite.config.ts` | Vite config building the harness page. |
| `tools/sceneGate.mjs` | The runner: drives Chrome, captures, compares, exits non-zero, `--update-baseline`. |
| `tools/gate-baseline/metrics.json` | Checked-in structural baselines. |
| `tools/gate-baseline/signatures.json` | Checked-in perceptual baselines. |
| `tools/gate-baseline/*.png` | Human-reviewable reference renders. |
| `src/entities/TargetRig.ts` | Render-only ragdoll: eleven `InstancedMesh`es posed from a transform buffer. |
| `src/entities/BallSwarm.ts` | Render-only pooled-ball swarm: one `InstancedMesh` of `POOL_SIZE`. |
| `src/ui/hudState.ts` | DOM-free derivation of HUD values from sim state. |
| `src/ui/hudState.test.ts` | Tests for the above. |
| `src/ui/hud.ts` | Reads the HUD elements once, writes derived state into them. |
| `src/sim/world.render.test.ts` | Tests for the snapshot buffers. |

**Modified:**

| Path | Change |
|---|---|
| `vitest.config.ts` | Include `tools/**/*.test.mjs`. |
| `tsconfig.json` | Include `tools/gate/**/*.ts`. |
| `package.json` | Add `gate` script; `build` gains `&& npm run gate`. |
| `src/sim/entities/Target.ts` | Export `TARGET_PART_SHAPES` and `PARTS_PER_TARGET`. |
| `src/sim/world.ts` | Snapshot buffers; delete `ballLoaded`/`ballInReach`. |
| `src/render/scene.ts` | Own `TargetRig` + `BallSwarm`; `ballLoaded` → `turretLoaded`. |
| `src/main.ts` | Interpolate the new buffers; delegate HUD to `src/ui/hud.ts`. |
| `index.html` | Combat HUD markup and styles. |
| `tools/smoke.mjs` | Rewrite the three stale assertions. |
| `docs/ROADMAP.md`, `docs/BACKLOG.md`, `docs/UI-SPEC.md` | Record what landed. |

---

## Task 1: Gate comparators

The pure half of the gate, built first because it is the only part with logic that can be silently wrong.

**Files:**
- Create: `tools/gateCompare.mjs`
- Create: `tools/gateCompare.test.mjs`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `compareMetrics(baseline, actual, bboxTolerance = 0.005) -> string[]` — a list of human-readable failure lines, empty when the subject passes. `baseline` and `actual` are `{ vertices: number, triangles: number, bbox: { x: number, y: number, z: number } }`.
  - `compareSignature(baseline, actual, threshold = 6) -> { ok: boolean, meanDelta: number, maxDelta: number }` — `baseline` and `actual` are flat arrays of `0..255` channel values of equal length.
  - `SIGNATURE_WIDTH = 64`, `SIGNATURE_HEIGHT = 36`.

- [ ] **Step 1: Extend the Vitest include so `tools/` tests run**

Edit `vitest.config.ts`, replacing the `include` line:

```ts
    include: ["src/**/*.test.ts", "tools/**/*.test.mjs"],
```

Leave `environment: "node"` and the file's comment block untouched — the DOM-free invariant it describes still applies to `src/sim/**`.

- [ ] **Step 2: Write the failing tests**

Create `tools/gateCompare.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { compareMetrics, compareSignature, SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from "./gateCompare.mjs";

const BASE = { vertices: 1200, triangles: 2100, bbox: { x: 1.4, y: 2.3, z: 2.2 } };

describe("compareMetrics", () => {
  it("passes an identical subject", () => {
    expect(compareMetrics(BASE, { ...BASE, bbox: { ...BASE.bbox } })).toEqual([]);
  });

  it("fails on any triangle count change, however small", () => {
    const failures = compareMetrics(BASE, { ...BASE, triangles: 2101, bbox: { ...BASE.bbox } });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("triangles");
  });

  it("fails on any vertex count change, however small", () => {
    const failures = compareMetrics(BASE, { ...BASE, vertices: 1199, bbox: { ...BASE.bbox } });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("vertices");
  });

  it("tolerates bbox drift inside the band and rejects it outside", () => {
    const inside = { ...BASE, bbox: { x: 1.4 * 1.004, y: 2.3, z: 2.2 } };
    const outside = { ...BASE, bbox: { x: 1.4 * 1.02, y: 2.3, z: 2.2 } };
    expect(compareMetrics(BASE, inside)).toEqual([]);
    expect(compareMetrics(BASE, outside)).toHaveLength(1);
  });

  it("reports every breached metric, not just the first", () => {
    const actual = { vertices: 1, triangles: 2, bbox: { x: 9, y: 9, z: 9 } };
    expect(compareMetrics(BASE, actual).length).toBeGreaterThan(2);
  });
});

describe("compareSignature", () => {
  const size = SIGNATURE_WIDTH * SIGNATURE_HEIGHT * 3;
  const flat = (v) => new Array(size).fill(v);

  it("passes an identical signature", () => {
    const result = compareSignature(flat(120), flat(120));
    expect(result.ok).toBe(true);
    expect(result.meanDelta).toBe(0);
  });

  it("tolerates uniform low-amplitude noise below threshold", () => {
    const noisy = flat(120).map((v, i) => v + (i % 2 === 0 ? 2 : -2));
    expect(compareSignature(flat(120), noisy).ok).toBe(true);
  });

  it("fails a wholesale change", () => {
    const result = compareSignature(flat(120), flat(40));
    expect(result.ok).toBe(false);
    expect(result.meanDelta).toBeCloseTo(80, 5);
    expect(result.maxDelta).toBe(80);
  });

  it("rejects a length mismatch rather than comparing a prefix", () => {
    expect(() => compareSignature(flat(120), flat(120).slice(0, -3))).toThrow(/length/i);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tools/gateCompare.test.mjs`
Expected: FAIL — cannot resolve `./gateCompare.mjs`.

- [ ] **Step 4: Write the implementation**

Create `tools/gateCompare.mjs`:

```js
/**
 * Pure comparison half of the Scene Gate. No I/O, no Puppeteer, no filesystem -- so the
 * thresholds, which are the only part of the gate with logic that can be silently wrong, are
 * testable in the node environment alongside everything else.
 *
 * Design note (spec section 3c): the perceptual half compares a downsampled RGB grid rather than a
 * full-resolution PNG. Downsampling is what buys tolerance to antialiasing and rasteriser
 * noise, it costs no new dependencies, and a JSON grid diffs legibly in git where a PNG does
 * not. Its blind spot -- a small high-frequency change such as one club-head facet -- is
 * covered by the exact triangle and vertex comparison below, which is why both halves exist.
 */

/** 16:9, matching the harness viewport. Small enough to average away edge noise. */
export const SIGNATURE_WIDTH = 64;
export const SIGNATURE_HEIGHT = 36;

/**
 * Counts are compared exactly: procedural geometry is deterministic, so a changed count is a
 * changed model and there is no noise to tolerate. Only the bounding box gets a band, and it is
 * narrow enough that a real silhouette change cannot hide inside it.
 */
export function compareMetrics(baseline, actual, bboxTolerance = 0.005) {
  const failures = [];

  if (actual.vertices !== baseline.vertices) {
    failures.push(`vertices ${actual.vertices} != baseline ${baseline.vertices}`);
  }
  if (actual.triangles !== baseline.triangles) {
    failures.push(`triangles ${actual.triangles} != baseline ${baseline.triangles}`);
  }

  for (const axis of ["x", "y", "z"]) {
    const want = baseline.bbox[axis];
    const got = actual.bbox[axis];
    // Guard the zero case so a flat subject does not divide by zero into a false pass.
    const drift = want === 0 ? Math.abs(got) : Math.abs(got - want) / Math.abs(want);
    if (drift > bboxTolerance) {
      failures.push(
        `bbox.${axis} ${got.toFixed(4)} != baseline ${want.toFixed(4)} ` +
          `(${(drift * 100).toFixed(2)}% > ${(bboxTolerance * 100).toFixed(2)}%)`,
      );
    }
  }

  return failures;
}

/**
 * Mean absolute per-channel delta across the whole grid, plus the worst single channel. The mean
 * is what the threshold gates on; maxDelta is reported so a failure says whether the whole image
 * shifted or one region did.
 */
export function compareSignature(baseline, actual, threshold = 6) {
  if (baseline.length !== actual.length) {
    throw new Error(`signature length mismatch: baseline ${baseline.length}, actual ${actual.length}`);
  }

  let total = 0;
  let maxDelta = 0;
  for (let i = 0; i < baseline.length; i++) {
    const delta = Math.abs(baseline[i] - actual[i]);
    total += delta;
    if (delta > maxDelta) maxDelta = delta;
  }

  const meanDelta = baseline.length === 0 ? 0 : total / baseline.length;
  return { ok: meanDelta <= threshold, meanDelta, maxDelta };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tools/gateCompare.test.mjs`
Expected: PASS, 9 tests.

Then run the whole suite to confirm the `include` change broke nothing:

Run: `npm test`
Expected: PASS, 241 tests (232 + 9).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tools/gateCompare.mjs tools/gateCompare.test.mjs
git commit -s -m "feat(tools): add scene gate comparators

Structural counts compare exactly -- procedural geometry is deterministic,
so a changed count is a changed model. Only the bounding box gets a
tolerance band, and only the perceptual signature gets a threshold.

Vitest's include gains tools/**/*.test.mjs so the gate's threshold logic,
the one part of it that can be silently wrong, is tested like everything
else."
```

---

## Task 2: Gate harness page

A fixed rig, not the game. The game's camera chases the cart and its course is generated per seed; `AGENTS.md` step 1 asks for a fixed camera, fixed lighting and a seeded RNG for the entity under test, which is a rig.

**Files:**
- Create: `tools/gate/index.html`
- Create: `tools/gate/gateScene.ts`
- Create: `tools/gate.vite.config.ts`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: `GolfClub` from `src/entities/GolfClub.ts`; `ClubType` from `src/physics/Ballistics.ts`.
- Produces: a built page at `tools/.gate-dist/index.html` reading `?subject=`, exposing on `window`:
  - `__gate.ready: boolean`
  - `__gate.metrics(): { vertices: number, triangles: number, bbox: { x: number, y: number, z: number } }`
  - `__gate.signature(): number[]` — length `SIGNATURE_WIDTH * SIGNATURE_HEIGHT * 3`
  - `__gate.subjects: string[]`
- Subjects in this task: `cart-driver`, `cart-iron`, `cart-putter`, `ball`. `target` is added in Task 6.

- [ ] **Step 1: Let `tsc` see the harness**

Edit `tsconfig.json`'s last line:

```json
  "include": ["src", "tools/gate/**/*.ts"]
```

Only `tools/gate/**` is added, not all of `tools/`. `tools/feelProbe.ts` uses `process`, which needs `@types/node`, and adding a dependency to typecheck an unrelated existing file is not this plan's business.

- [ ] **Step 2: Write the Vite config**

Create `tools/gate.vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Builds the Scene Gate harness page. Separate from the app build for the same reason
 * tools/probe.vite.config.ts is: the gate has its own entry point and its own output, and the
 * game bundle must not carry either.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, "gate"),
  base: "./",
  build: {
    outDir: resolve(import.meta.dirname, ".gate-dist"),
    emptyOutDir: true,
    minify: false,
  },
});
```

- [ ] **Step 3: Write the harness page shell**

Create `tools/gate/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>TeeTimeTurrets — Scene Gate</title>
    <style>
      html, body { margin: 0; height: 100%; background: #202428; overflow: hidden; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <script type="module" src="./gateScene.ts"></script>
  </body>
</html>
```

The background is a flat mid-grey rather than the game's sky blue: a neutral ground makes a silhouette change move the signature further than a colour-matched one would.

- [ ] **Step 4: Write the harness scene**

Create `tools/gate/gateScene.ts`:

```ts
import * as THREE from "three";
import { GolfClub } from "../../src/entities/GolfClub";
import { ClubType } from "../../src/physics/Ballistics";

/**
 * One subject, one fixed rig. No Sim, no terrain, no input, no randomness -- AGENTS.md's Scene
 * Gate step 1 asks for a fixed camera and fixed lighting, and the game provides neither: its
 * camera chases the cart and its course is generated per seed.
 *
 * Every subject is built by the same code the game ships, so the gate measures shipped geometry
 * rather than a copy of it that could drift out of step with the real thing.
 */

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 360;

/** Matches tools/gateCompare.mjs. Duplicated because that module is plain JS with no types. */
const SIGNATURE_WIDTH = 64;
const SIGNATURE_HEIGHT = 36;

/** Fixed three-quarter view: shows a silhouette's depth as well as its profile. */
const CAMERA_DIRECTION = new THREE.Vector3(1, 0.55, 1.35).normalize();
/** Multiplier on the subject's bounding sphere radius, so every subject is framed identically. */
const CAMERA_DISTANCE_SCALE = 2.6;

interface GateSubject {
  object: THREE.Object3D;
  dispose(): void;
}

const SUBJECTS: Record<string, () => GateSubject> = {
  "cart-driver": () => clubSubject(ClubType.Driver),
  "cart-iron": () => clubSubject(ClubType.Iron),
  "cart-putter": () => clubSubject(ClubType.Putter),
  ball: () => ballSubject(),
};

function clubSubject(club: ClubType): GateSubject {
  const cart = new GolfClub(club);
  return { object: cart, dispose: () => cart.dispose() };
}

/** The same sphere render/scene.ts builds for the course ball, at the same radius. */
function ballSubject(): GateSubject {
  const geometry = new THREE.SphereGeometry(0.15, 20, 16);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    object: mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

function countGeometry(root: THREE.Object3D): { vertices: number; triangles: number } {
  let vertices = 0;
  let triangles = 0;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean; count?: number };
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    // An InstancedMesh draws its one geometry `count` times; counting it once would let a
    // change in instance count slip past the gate entirely.
    const instances = typeof mesh.count === "number" ? mesh.count : 1;
    vertices += position.count * instances;
    const index = mesh.geometry.getIndex();
    triangles += ((index ? index.count : position.count) / 3) * instances;
  });
  return { vertices, triangles };
}

function main(): void {
  const params = new URLSearchParams(window.location.search);
  const name = params.get("subject") ?? "cart-driver";
  const build = SUBJECTS[name];
  if (!build) throw new Error(`unknown gate subject: ${name} (have ${Object.keys(SUBJECTS).join(", ")})`);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  // Pixel ratio is pinned to 1, never devicePixelRatio: the signature must not depend on the
  // display the gate happens to run against.
  renderer.setPixelRatio(1);
  renderer.setSize(VIEW_WIDTH, VIEW_HEIGHT);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202428);

  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(12, 18, 8);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const subject = build();
  scene.add(subject.object);

  const box = new THREE.Box3().setFromObject(subject.object);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;

  const camera = new THREE.PerspectiveCamera(45, VIEW_WIDTH / VIEW_HEIGHT, 0.01, radius * 100);
  camera.position.copy(centre).addScaledVector(CAMERA_DIRECTION, radius * CAMERA_DISTANCE_SCALE);
  camera.lookAt(centre);

  renderer.render(scene, camera);

  const counts = countGeometry(subject.object);

  // Read the pixels back through a 2D canvas rather than gl.readPixels: drawImage does the
  // downsample in one step, and the browser's own box filter is the averaging the signature
  // relies on to shrug off antialiasing noise.
  const scratch = document.createElement("canvas");
  scratch.width = SIGNATURE_WIDTH;
  scratch.height = SIGNATURE_HEIGHT;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("gate harness could not get a 2d context for the signature");

  (window as unknown as { __gate: unknown }).__gate = {
    ready: true,
    subject: name,
    subjects: Object.keys(SUBJECTS),
    metrics: () => ({
      vertices: counts.vertices,
      triangles: counts.triangles,
      bbox: { x: size.x, y: size.y, z: size.z },
    }),
    signature: () => {
      ctx.clearRect(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
      ctx.drawImage(renderer.domElement, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
      const data = ctx.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT).data;
      const out: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        out.push(data[i]!, data[i + 1]!, data[i + 2]!);
      }
      return out;
    },
    dispose: () => subject.dispose(),
  };
}

main();
```

- [ ] **Step 5: Verify the harness builds and typechecks**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vite build -c tools/gate.vite.config.ts`
Expected: success, output in `tools/.gate-dist/`.

- [ ] **Step 6: Verify the harness actually renders each subject**

Create a throwaway check (do not commit it) at `/tmp/gate-probe.mjs`:

```js
import { spawn } from "node:child_process";
import puppeteer from "puppeteer";

const server = spawn("npx", ["vite", "preview", "--outDir", "tools/.gate-dist", "--port", "4174"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await puppeteer.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
for (const subject of ["cart-driver", "cart-iron", "cart-putter", "ball"]) {
  await page.goto(`http://localhost:4174/?subject=${subject}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__gate?.ready === true, { timeout: 15000 });
  const m = await page.evaluate(() => window.__gate.metrics());
  const sigLen = await page.evaluate(() => window.__gate.signature().length);
  console.log(subject, JSON.stringify(m), "signature", sigLen);
}
await browser.close();
server.kill();
```

Run: `node /tmp/gate-probe.mjs`
Expected: four lines, each with non-zero `vertices`/`triangles`, non-zero bbox dimensions, and `signature 6912`. The three cart subjects must differ from each other in triangle count — that is the club head swapping, and if they match, `?subject=` is not reaching `GolfClub`.

- [ ] **Step 7: Commit**

```bash
git add tsconfig.json tools/gate.vite.config.ts tools/gate/index.html tools/gate/gateScene.ts
git commit -s -m "feat(tools): add the scene gate harness page

A fixed camera, fixed lights and one subject per page load. The game is
the wrong thing to baseline: its camera chases the cart and its course is
generated per seed, so neither framing nor content is fixed.

Subjects are built by the code the game ships, so the gate measures real
geometry rather than a copy that could drift. Instanced meshes are counted
by instance, or a change in instance count would pass unnoticed. Pixel
ratio is pinned to 1 so a signature does not depend on the display."
```

---

## Task 3: Gate runner, baselines, and wiring

**Files:**
- Create: `tools/sceneGate.mjs`
- Create: `tools/gate-baseline/metrics.json`, `tools/gate-baseline/signatures.json`, `tools/gate-baseline/*.png` (generated in Step 4)
- Modify: `package.json`
- Modify: `.gitignore` (add `tools/.gate-dist/` and `tools/.gate-out/`)

**Interfaces:**
- Consumes: `compareMetrics`, `compareSignature`, `SIGNATURE_WIDTH`, `SIGNATURE_HEIGHT` from Task 1; `window.__gate` from Task 2.
- Produces: `npm run gate`, exiting 0 on match and 1 on drift; `npm run gate -- --update-baseline` rewriting `tools/gate-baseline/`.

- [ ] **Step 1: Write the runner**

Create `tools/sceneGate.mjs`:

```js
/**
 * Scene Gate -- AGENTS.md "Visual Critic / Scene Gate protocol", built as an independent design.
 * That section is explicit that the reference repo's comparator internals are Reserved Content
 * and must not be reverse-engineered; nothing here derives from them.
 *
 * Loads each subject on the fixed harness rig in headless Chrome, reads structural metrics off
 * the BufferGeometry and a downsampled perceptual signature off the canvas, and diffs both
 * against tools/gate-baseline/. Exits non-zero on drift.
 *
 * This is NOT tools/smoke.mjs: smoke drives the real input path and asserts no console errors,
 * and has no geometry baseline at all.
 *
 * Usage: npm run gate
 *        npm run gate -- --update-baseline    (review tools/.gate-out/*.png first)
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer";
import { compareMetrics, compareSignature } from "./gateCompare.mjs";

const PORT = 4174;
const DIST = "tools/.gate-dist";
const BASELINE_DIR = resolve("tools/gate-baseline");
const OUT_DIR = resolve("tools/.gate-out");
const UPDATE = process.argv.includes("--update-baseline");

const SUBJECTS = ["cart-driver", "cart-iron", "cart-putter", "ball"];

const server = spawn("npx", ["vite", "preview", "--outDir", DIST, "--port", String(PORT)], {
  stdio: "ignore",
});
process.on("exit", () => server.kill());

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`gate preview server did not start at ${url}`);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(readFileSync(resolve(BASELINE_DIR, name), "utf8"));
  } catch {
    return fallback;
  }
}

await waitForServer(`http://localhost:${PORT}`, 20000);
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(BASELINE_DIR, { recursive: true });

// Software rasterisation, the same flag tools/smoke.mjs uses. This is what makes a signature
// portable between machines: every run goes through the same rasteriser rather than through
// whatever GPU driver happens to be installed.
const browser = await puppeteer.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 360 });

const baselineMetrics = readJson("metrics.json", {});
const baselineSignatures = readJson("signatures.json", {});
const nextMetrics = {};
const nextSignatures = {};
const failures = [];

for (const subject of SUBJECTS) {
  await page.goto(`http://localhost:${PORT}/?subject=${subject}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__gate?.ready === true, { timeout: 20000 });

  const metrics = await page.evaluate(() => window.__gate.metrics());
  const signature = await page.evaluate(() => window.__gate.signature());
  nextMetrics[subject] = metrics;
  nextSignatures[subject] = signature;

  // Always written, baseline update or not: a failure is only reviewable if the render that
  // produced it is on disk next to the reference.
  await page.screenshot({ path: resolve(OUT_DIR, `${subject}.png`) });

  if (UPDATE) {
    await page.screenshot({ path: resolve(BASELINE_DIR, `${subject}.png`) });
    console.log(`  BASELINE - ${subject} (${metrics.triangles} tris, ${metrics.vertices} verts)`);
    continue;
  }

  const baseM = baselineMetrics[subject];
  const baseS = baselineSignatures[subject];
  if (!baseM || !baseS) {
    failures.push(`${subject}: no baseline (run: npm run gate -- --update-baseline)`);
    console.log(`  FAIL - ${subject} has no baseline`);
    continue;
  }

  const metricFailures = compareMetrics(baseM, metrics);
  const sig = compareSignature(baseS, signature);

  if (metricFailures.length === 0 && sig.ok) {
    console.log(`  PASS - ${subject} (signature mean delta ${sig.meanDelta.toFixed(2)})`);
    continue;
  }
  for (const f of metricFailures) {
    failures.push(`${subject}: ${f}`);
    console.log(`  FAIL - ${subject}: ${f}`);
  }
  if (!sig.ok) {
    const detail = `signature mean delta ${sig.meanDelta.toFixed(2)} (max ${sig.maxDelta}) over threshold`;
    failures.push(`${subject}: ${detail}`);
    console.log(`  FAIL - ${subject}: ${detail}`);
  }
}

if (UPDATE) {
  writeFileSync(resolve(BASELINE_DIR, "metrics.json"), `${JSON.stringify(nextMetrics, null, 2)}\n`);
  writeFileSync(resolve(BASELINE_DIR, "signatures.json"), `${JSON.stringify(nextSignatures)}\n`);
  console.log(`\nBASELINE UPDATED -> ${BASELINE_DIR}`);
  console.log("Review the PNGs before committing: a baseline is only as good as the eyes that approved it.");
}

await browser.close();
server.kill();

if (!UPDATE) {
  console.log(`\n${failures.length === 0 ? "GATE PASS" : `GATE FAIL (${failures.length})`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}
```

- [ ] **Step 2: Add the scripts**

In `package.json`, replace the `build` line and add `gate` after `preview`:

```json
    "build": "tsc --noEmit && vite build && npm run gate",
    "gate": "vite build -c tools/gate.vite.config.ts && node tools/sceneGate.mjs",
```

`AGENTS.md` step 5 says to wire the gate into `build` once it exists. The cost is real and is recorded in the spec: `npm run build` now launches headless Chrome and takes roughly 30 s longer.

- [ ] **Step 3: Ignore the generated directories**

Add to `.gitignore`:

```
tools/.gate-dist/
tools/.gate-out/
```

- [ ] **Step 4: Confirm the gate fails with no baseline, then capture one**

Run: `npm run gate`
Expected: FAIL for all four subjects with "no baseline", exit 1. This is the red step — a gate that passes before it has anything to compare against is not a gate.

Run: `npm run gate -- --update-baseline`
Expected: four `BASELINE` lines and `BASELINE UPDATED`.

- [ ] **Step 5: Review the baselines by eye, then verify the gate passes**

Open all four PNGs in `tools/gate-baseline/`. Confirm the cart reads as a golf cart with a visible turret and club-barrel, that the three club heads visibly differ (mallet, blade, bulb), and that the ball is a ball. **This is the only step in the plan where a human decides the geometry is correct rather than merely unchanged.** If a subject is clipped, mis-framed or black, fix the harness before continuing.

Run: `npm run gate`
Expected: `PASS` for all four, `GATE PASS`, exit 0.

- [ ] **Step 6: Measure the signature's noise floor and fix the threshold against it**

The spec's §11 leaves the threshold open on purpose: a threshold that has never seen its own noise floor is a guess, and a flaky gate gets disabled within a week.

Run `npm run gate` three more times without changing anything. Record the `signature mean delta` printed for each subject on each run.

- If every delta is `0.00`, the rasteriser is fully deterministic here and the default threshold of `6` is generous. Leave it.
- If deltas are non-zero, the threshold must be at least **4× the largest observed idle delta**. Change the default in `tools/gateCompare.mjs`'s `compareSignature` signature, and add a comment recording the measured floor and the date, the way `docs/ROADMAP.md` Phase 2.5 records its measured noise-gradient constant.
- If any idle delta exceeds `6`, do not simply raise the threshold — something in the harness is non-deterministic (an unpinned pixel ratio, a time-dependent animation, an unseeded value). Find it first.

- [ ] **Step 7: Prove the gate actually catches a change**

Temporarily edit `src/entities/GolfClub.ts`'s `buildTurretRing` radial segment count from `16` to `18`:

```ts
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.12, 18), bodyMaterial(0x8d9298));
```

Run: `npm run gate`
Expected: FAIL on all three cart subjects with `vertices` and `triangles` deltas. Then revert the edit (`git checkout src/entities/GolfClub.ts`) and re-run `npm run gate` — expected `GATE PASS`. A gate that has never been seen to fail is a guess.

- [ ] **Step 8: Commit**

```bash
git add tools/sceneGate.mjs tools/gateCompare.mjs tools/gate-baseline package.json .gitignore
git commit -s -m "feat(tools): add the scene gate runner and baselines

Closes the Phase 1 gap AGENTS.md has specified since the beginning and
ROADMAP.md calls overdue: the cart and the three club heads have been in
the scene with nothing guarding them since Phase 2.

Baselines cover the cart with each club head and the ball. Verified to
actually fail by bumping the turret ring's segment count and watching all
three cart subjects break, then reverting.

Wired into npm run build per the protocol's step 5. That adds roughly 30s
and a headless Chrome launch to every build, which is the price of the
rule as written."
```

---

## Task 4: Backlog #16d — honest reads

Done before the HUD so the HUD is never written against fields that are about to disappear.

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `src/render/scene.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Cart.ammo` (existing).
- Produces: `FrameView.turretLoaded: boolean` replacing `FrameView.ballLoaded`. `Sim.ballLoaded` and `Sim.ballInReach` no longer exist.

- [ ] **Step 1: Confirm nothing in the test suite depends on the fields being removed**

Run: `grep -rn "ballLoaded\|ballInReach" src/**/*.test.ts`
Expected: no output. If there is output, stop — the spec's premise (§2) is wrong and the plan needs revisiting.

- [ ] **Step 2: Remove the dead state from `Sim`**

In `src/sim/world.ts`, delete these two field declarations and their doc comments (currently lines 218–224):

```ts
  /** True when the cart is close enough to a resting ball to scoop it up. */
  ballInReach = false;
  /**
   * True when the ball is riding the turret rather than lying on the course. While loaded it is
   * rendered at the muzzle and a shot plays it; while not loaded a shot is a blank.
   */
  ballLoaded = false;
```

In `stepCart`, delete the three lines that computed them (currently the `const b = ...` / `this.ballInReach = ...` / `this.ballLoaded = ...` block including its comment):

```ts
    const b = this.current.position;
    this.ballInReach = Math.hypot(b.x - c.x, b.z - c.z) <= PICKUP_RANGE;
    // The ball only rides the turret while it is settled: scooping one still rolling would let
    // a player cancel their own shot by chasing it.
    this.ballLoaded = driving && this.ballInReach && this.isResting() && !this.holedOut;
```

In `stepRespawn`, delete its first two lines:

```ts
    this.ballLoaded = false;
    this.ballInReach = false;
```

Add a comment above `resolveShot`'s cart branch recording why, so the next reader does not reintroduce it:

```ts
    if (this.mode === SwingMode.Cart) {
      // No ball is scooped off the course here and none ever will be: the ammo fork replaced
      // "drive over the ball to load it" with a pooled-ball ammo counter, and this branch never
      // touches Sim.ball. The old ballLoaded/ballInReach pair described the retired mechanic and
      // made the course ball vanish onto a turret that could not play it (BACKLOG #16d).
      if (!this.cart.shot.hasBall) {
```

- [ ] **Step 3: Rename the render-facing flag**

In `src/render/scene.ts`, change the `FrameView` field and its comment:

```ts
  /** True while a round of ammo rides the club head: drawn on the turret, ready to fire. */
  turretLoaded: boolean;
```

In `draw()`, delete the course-ball hiding entirely — the course ball is the stroke-play ball, it is still lying there, and cart fire no longer consumes it:

```ts
    this.drawCart(view);

```

(i.e. remove the two-line comment and `this.ball.visible = !view.ballLoaded;`.)

In `drawCart()`, change the last line:

```ts
    this.cart.setBallLoaded(view.turretLoaded);
```

`GolfClub.setBallLoaded` keeps its name: its job is still "show a ball on the club head."

- [ ] **Step 4: Derive it honestly in `main.ts`**

In the `view` initialiser, replace `ballLoaded: sim.ballLoaded,` with:

```ts
    turretLoaded: turretLoaded(sim),
```

In the render callback, replace `view.ballLoaded = sim.ballLoaded;` with:

```ts
      view.turretLoaded = turretLoaded(sim);
```

Add the helper next to `statusText`:

```ts
/**
 * What rides the club head in cart mode is a round of ammo, not the course ball -- images 03 and
 * 04, and what actually fires. In stationary mode there is no turret shot at all.
 */
function turretLoaded(sim: Sim): boolean {
  return sim.mode === SwingMode.Cart && sim.cart.ammo > 0;
}
```

Replace the three stale branches of `statusText` with the one rule that survived the fork:

```ts
function statusText(sim: Sim): string {
  if (sim.holedOut) return "HOLED OUT — R to reset";
  if (!sim.cart.canFire) return `RELOADING ${sim.cart.reloadRemaining.toFixed(1)}s`;
  if (sim.lastShotInWater) return "WATER HAZARD — plus one stroke";
  if (sim.lastShotOutOfBounds) return "OUT OF BOUNDS — returned to the tee";
  if (sim.mode !== SwingMode.Cart) return "READY";
  return sim.cart.ammo > 0 ? "READY" : "NO AMMO — fire a blank to boost";
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: clean. If it reports `PICKUP_RANGE` unused, do **not** delete the constant — it is still used for the bucket and landed-ball pickups a few lines below. If it reports an unused local `b`, that line should have been removed in Step 2.

Run: `npm test`
Expected: PASS, 241 tests.

Run: `npm run gate`
Expected: `GATE PASS` — this task changed no geometry.

- [ ] **Step 6: Commit**

```bash
git add src/sim/world.ts src/render/scene.ts src/main.ts
git commit -s -m "fix: make cart-mode ball reads honest (BACKLOG #16d)

ballLoaded and ballInReach described the pre-ammo mechanic where driving
over the course ball scooped it onto the turret. The ammo fork replaced
that with a pooled-ball counter and resolveShot's cart branch stopped
touching Sim.ball -- so the flag was not merely stale, it was harmful:
driving near the tee ball hid it onto a turret that could never play it.

Both fields are deleted; no test referenced either. The renderer's
turretLoaded is derived from cart.ammo, which is what actually fires, and
the course ball stays visible in cart mode because it is still lying
there. smoke.mjs still reads the removed fields and is rewritten later in
this plan."
```

**Note:** `npm run smoke` is expected to be *more* broken after this task — it reads `sim.ballLoaded`, which no longer exists. Task 10 fixes it. Do not patch smoke here.

---

## Task 5: Target transform snapshots in `Sim`

**Files:**
- Modify: `src/sim/entities/Target.ts`
- Modify: `src/sim/world.ts`
- Create: `src/sim/world.render.test.ts`

**Interfaces:**
- Consumes: `Sim.targets`, `Target.parts` (existing).
- Produces, all on `Sim`:
  - `PARTS_PER_TARGET: number` and `TARGET_PART_SHAPES: readonly TargetPartShape[]` exported from `src/sim/entities/Target.ts`
  - `TRANSFORM_STRIDE = 7` exported from `src/sim/world.ts`
  - `Sim.previousTargetTransforms: Float32Array`, `Sim.currentTargetTransforms: Float32Array` — `targets.length * PARTS_PER_TARGET * 7` floats, laid out `x, y, z, qx, qy, qz, qw`
  - `Sim.targetPartCount: number`

- [ ] **Step 1: Write the failing tests**

Create `src/sim/world.render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateCourse } from "./course";
import { Sim, TRANSFORM_STRIDE } from "./world";
import { PARTS_PER_TARGET, TARGET_PART_SHAPES } from "./entities/Target";

/**
 * The render snapshot buffers, tested through Sim's public surface only. The renderer is a pure
 * consumer of these, so if they are wrong every pixel downstream is wrong, and nothing in
 * src/render/** is reachable from the node environment to catch it.
 */
const holes = generateCourse(2026, 2).holes;

describe("target transform snapshots", () => {
  it("is sized for every part of every target", async () => {
    const sim = await Sim.create(holes[0]!);
    expect(sim.targets.length).toBeGreaterThan(0);
    expect(sim.targetPartCount).toBe(sim.targets.length * PARTS_PER_TARGET);
    expect(sim.currentTargetTransforms.length).toBe(sim.targetPartCount * TRANSFORM_STRIDE);
    expect(sim.previousTargetTransforms.length).toBe(sim.currentTargetTransforms.length);
  });

  it("matches the live body transforms after a step", async () => {
    const sim = await Sim.create(holes[0]!);
    sim.step();

    const buffer = sim.currentTargetTransforms;
    let i = 0;
    for (const target of sim.targets) {
      for (const part of target.parts) {
        const t = part.body.translation();
        const r = part.body.rotation();
        expect(buffer[i]).toBeCloseTo(t.x, 4);
        expect(buffer[i + 1]).toBeCloseTo(t.y, 4);
        expect(buffer[i + 2]).toBeCloseTo(t.z, 4);
        expect(buffer[i + 3]).toBeCloseTo(r.x, 4);
        expect(buffer[i + 4]).toBeCloseTo(r.y, 4);
        expect(buffer[i + 5]).toBeCloseTo(r.z, 4);
        expect(buffer[i + 6]).toBeCloseTo(r.w, 4);
        i += TRANSFORM_STRIDE;
      }
    }
  });

  it("does not allocate a new buffer per tick", async () => {
    const sim = await Sim.create(holes[0]!);
    const seen = new Set<Float32Array>();
    for (let n = 0; n < 8; n++) {
      sim.step();
      seen.add(sim.currentTargetTransforms);
      seen.add(sim.previousTargetTransforms);
    }
    // Double-buffered: exactly two arrays, swapped, never reallocated.
    expect(seen.size).toBe(2);
  });

  it("seeds previous from current on reset so a rebuild is not lerped through", async () => {
    const sim = await Sim.create(holes[0]!);
    for (let n = 0; n < 20; n++) sim.step();
    sim.reset();
    expect(Array.from(sim.previousTargetTransforms)).toEqual(
      Array.from(sim.currentTargetTransforms),
    );
  });

  it("resizes for a new hole's targets", async () => {
    const sim = await Sim.create(holes[0]!);
    sim.loadHole(holes[1]!);
    expect(sim.targetPartCount).toBe(sim.targets.length * PARTS_PER_TARGET);
    expect(sim.currentTargetTransforms.length).toBe(sim.targetPartCount * TRANSFORM_STRIDE);
    expect(sim.previousTargetTransforms.length).toBe(sim.currentTargetTransforms.length);
  });
});

describe("target part shapes", () => {
  it("exposes one shape per rig part, with positive dimensions", () => {
    expect(TARGET_PART_SHAPES).toHaveLength(PARTS_PER_TARGET);
    for (const shape of TARGET_PART_SHAPES) {
      expect(shape.radius).toBeGreaterThan(0);
      expect(shape.halfHeight).toBeGreaterThan(0);
    }
  });

  it("agrees with the colliders actually built from it", async () => {
    const sim = await Sim.create(holes[0]!);
    const target = sim.targets[0]!;
    expect(target.parts.map((p) => p.name)).toEqual(TARGET_PART_SHAPES.map((s) => s.name));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/world.render.test.ts`
Expected: FAIL — `TRANSFORM_STRIDE`, `PARTS_PER_TARGET`, `TARGET_PART_SHAPES`, `sim.targetPartCount` and the buffers do not exist.

- [ ] **Step 3: Export the rig's shape data**

In `src/sim/entities/Target.ts`, add after the `RIG` declaration (after the closing `] as const;`):

```ts
/**
 * The rig's capsule dimensions and rest pose, exported so the renderer builds its capsules from
 * the same numbers the colliders use. AGENTS.md's "never add a second source of truth" rule
 * applies here exactly as it does to CLUB_STATS: a visual capsule that disagrees with its
 * collider is the same class of bug as a club head that disagrees with its ballistics.
 *
 * Shape data only -- no Three types cross into src/sim/**, which stays DOM-free and three-free.
 */
export interface TargetPartShape {
  readonly name: TargetPartName;
  readonly radius: number;
  readonly halfHeight: number;
  readonly restOffset: { readonly x: number; readonly y: number; readonly z: number };
}

export const TARGET_PART_SHAPES: readonly TargetPartShape[] = RIG.map((spec) => ({
  name: spec.name,
  radius: spec.radius,
  halfHeight: spec.halfHeight,
  restOffset: { x: spec.x, y: spec.y, z: 0 },
}));

export const PARTS_PER_TARGET = RIG.length;
```

- [ ] **Step 4: Add the buffers to `Sim`**

In `src/sim/world.ts`, add the import of `PARTS_PER_TARGET` to the existing `Target` import, and export the stride near `FIXED_DT`:

```ts
/**
 * Floats per transform in the render snapshot buffers: x, y, z, qx, qy, qz, qw. Flat typed
 * arrays rather than objects because these are filled every tick for up to 33 ragdoll parts and
 * 32 pooled balls, and the no-allocation rule covers the fixed tick.
 */
export const TRANSFORM_STRIDE = 7;
```

Add the fields beside `targets` (after the `readonly targets: Target[] = [];` line):

```ts
  /** Parts across all targets on this hole. `targets.length * PARTS_PER_TARGET`. */
  targetPartCount = 0;
  /** Target part transforms from the previous fixed step, for render interpolation. */
  previousTargetTransforms = new Float32Array(0);
  /** Target part transforms from the most recent fixed step. */
  currentTargetTransforms = new Float32Array(0);
```

At the end of `buildTargets()`, size the buffers — this is the one place they are allocated:

```ts
    this.targetPartCount = this.targets.length * PARTS_PER_TARGET;
    const floats = this.targetPartCount * TRANSFORM_STRIDE;
    if (this.currentTargetTransforms.length !== floats) {
      this.currentTargetTransforms = new Float32Array(floats);
      this.previousTargetTransforms = new Float32Array(floats);
    }
    this.syncCurrentTargets();
    this.previousTargetTransforms.set(this.currentTargetTransforms);
```

Add the sync method beside `syncCurrentCart()`:

```ts
  /**
   * Flattens every target part's body transform into the current buffer. Reads Rapier directly
   * rather than going through Target, because Target owns no snapshot of its own and the render
   * layer must never touch a Rapier body itself.
   */
  private syncCurrentTargets(): void {
    const buffer = this.currentTargetTransforms;
    let i = 0;
    for (const target of this.targets) {
      for (const part of target.parts) {
        const t = part.body.translation();
        const r = part.body.rotation();
        buffer[i] = t.x;
        buffer[i + 1] = t.y;
        buffer[i + 2] = t.z;
        buffer[i + 3] = r.x;
        buffer[i + 4] = r.y;
        buffer[i + 5] = r.z;
        buffer[i + 6] = r.w;
        i += TRANSFORM_STRIDE;
      }
    }
  }
```

In `step()`, swap the two buffers before filling the current one. Add at the top of `step()`, beside the existing `this.previousCart = this.currentCart;`:

```ts
    const swapTargets = this.previousTargetTransforms;
    this.previousTargetTransforms = this.currentTargetTransforms;
    this.currentTargetTransforms = swapTargets;
```

and at the end of `step()`, after the existing `syncCurrent()`/`syncCurrentCart()` calls:

```ts
    this.syncCurrentTargets();
```

In `reset()`, after the `for (const target of this.targets) target.reset();` line, seed previous from current so the tick after a rebuild is not interpolated through a teleport:

```ts
    this.syncCurrentTargets();
    this.previousTargetTransforms.set(this.currentTargetTransforms);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/sim/world.render.test.ts`
Expected: PASS, 7 tests.

Run: `npm test`
Expected: PASS, 248 tests.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Confirm the sim is still DOM-free and the physics did not move**

Run: `npm run probe > /tmp/probe-after.txt 2>&1; echo "exit=$?"`
Expected: exit 1 on `driver distance` alone, and the numeric output identical to the baseline. If any number moved, this task changed physics and must be fixed, not accepted.

- [ ] **Step 7: Commit**

```bash
git add src/sim/entities/Target.ts src/sim/world.ts src/sim/world.render.test.ts
git commit -s -m "feat(sim): publish target part transforms for rendering

Double-buffered flat Float32Arrays, swapped rather than reallocated, so
filling 33 ragdoll part transforms every tick stays inside the
no-allocation rule. Laid out x,y,z,qx,qy,qz,qw at a shared stride the
pooled balls will reuse.

previous is seeded from current on reset and on loadHole: a rebuilt or
re-posed rig is a teleport, and interpolating through it would drag every
capsule across the course over one frame.

Target.ts exports its capsule dimensions so the renderer builds from the
same numbers the colliders use, rather than a copy that can drift."
```

---

## Task 6: `TargetRig` and target rendering

**Files:**
- Create: `src/entities/TargetRig.ts`
- Modify: `src/render/scene.ts`
- Modify: `src/main.ts`
- Modify: `tools/gate/gateScene.ts`
- Modify: `tools/sceneGate.mjs`
- Modify: `tools/gate-baseline/*` (regenerated)

**Interfaces:**
- Consumes: `TARGET_PART_SHAPES`, `PARTS_PER_TARGET` (Task 5); `TRANSFORM_STRIDE` (Task 5); `Sim.currentTargetTransforms`, `Sim.previousTargetTransforms`, `Sim.targetPartCount` (Task 5).
- Produces:
  - `class TargetRig extends THREE.Group` with `constructor(targetCount: number)`, `setFromTransforms(transforms: Float32Array, partCount: number): void`, `dispose(): void`
  - `FrameView.targetTransforms: Float32Array`, `FrameView.targetPartCount: number`

- [ ] **Step 1: Write `TargetRig`**

Create `src/entities/TargetRig.ts`:

```ts
import * as THREE from "three";
import { PARTS_PER_TARGET, TARGET_PART_SHAPES } from "../sim/entities/Target";
import { TRANSFORM_STRIDE } from "../sim/world";

/**
 * Render-only ragdoll targets, built to concept image 05 (the struck caddie) and image 01's form
 * language: flat-shaded, saturated, silhouette-first.
 *
 * Follows GolfClub.ts: a THREE.Group that owns no Rapier body and no authoritative state, posed
 * each frame from a sim snapshot. It never touches a Target or a Rapier body.
 *
 * Eleven InstancedMeshes, one per part name, with instance count equal to the number of targets
 * on the hole. Not thirty-three plain meshes, and not one instanced mesh: the eleven parts have
 * eleven distinct radius/half-height pairs, and a capsule under non-uniform scale stops being a
 * capsule -- its caps distort. This way the draw-call count is eleven no matter how many targets
 * a hole later grows to.
 *
 * There is no knocked-down tint. The collapse is what reads, and a colour change would be a
 * second signal for a state the pose already communicates.
 */

const CAPSULE_RADIAL_SEGMENTS = 8;
const CAPSULE_CAP_SEGMENTS = 4;

/** Muted work-wear against saturated turf, so the silhouette carries the read rather than hue. */
const SKIN = 0xd9a06b;
const SHIRT = 0xe8e4d9;
const TROUSERS = 0x3b4a63;

function materialColour(name: string): number {
  if (name === "head") return SKIN;
  if (name.startsWith("upperLeg") || name.startsWith("lowerLeg") || name === "pelvis") return TROUSERS;
  if (name.startsWith("lowerArm")) return SKIN;
  return SHIRT;
}

export class TargetRig extends THREE.Group {
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** Reused per-frame, per the AGENTS.md no-allocation rule. */
  private readonly positionScratch = new THREE.Vector3();
  private readonly quaternionScratch = new THREE.Quaternion();
  private readonly scaleScratch = new THREE.Vector3(1, 1, 1);
  private readonly matrixScratch = new THREE.Matrix4();

  constructor(targetCount: number) {
    super();
    for (const shape of TARGET_PART_SHAPES) {
      const geometry = new THREE.CapsuleGeometry(
        shape.radius,
        shape.halfHeight * 2,
        CAPSULE_CAP_SEGMENTS,
        CAPSULE_RADIAL_SEGMENTS,
      );
      const material = new THREE.MeshStandardMaterial({
        color: materialColour(shape.name),
        roughness: 0.85,
        metalness: 0,
        flatShading: true,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(targetCount, 0));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Ragdoll parts move every frame once down; a stale frustum box would pop them out of view.
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.add(mesh);
    }
  }

  /**
   * `transforms` is the interpolated snapshot: `partCount` entries of
   * (x, y, z, qx, qy, qz, qw), ordered target-major then part-major, exactly as
   * `Sim.syncCurrentTargets` writes it.
   */
  setFromTransforms(transforms: Float32Array, partCount: number): void {
    for (let partIndex = 0; partIndex < PARTS_PER_TARGET; partIndex++) {
      const mesh = this.meshes[partIndex]!;
      for (let targetIndex = 0; targetIndex < mesh.count; targetIndex++) {
        const flat = (targetIndex * PARTS_PER_TARGET + partIndex) * TRANSFORM_STRIDE;
        if (flat + TRANSFORM_STRIDE > partCount * TRANSFORM_STRIDE) break;

        this.positionScratch.set(transforms[flat]!, transforms[flat + 1]!, transforms[flat + 2]!);
        this.quaternionScratch.set(
          transforms[flat + 3]!,
          transforms[flat + 4]!,
          transforms[flat + 5]!,
          transforms[flat + 6]!,
        );
        this.matrixScratch.compose(this.positionScratch, this.quaternionScratch, this.scaleScratch);
        mesh.setMatrixAt(targetIndex, this.matrixScratch);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Frees every instanced geometry, material and instance buffer. AGENTS.md extends the
   * resource-cleanup rule to InstancedMesh buffers explicitly: dispose on teardown, not on
   * process exit.
   */
  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
      mesh.dispose();
    }
    this.meshes.length = 0;
    this.clear();
  }
}
```

- [ ] **Step 2: Add the transforms to `FrameView` and wire the rig into the scene**

In `src/render/scene.ts`, add the import:

```ts
import { TargetRig } from "../entities/TargetRig";
```

Add to `FrameView`, after `mode`:

```ts
  /** Interpolated target part transforms, laid out exactly as Sim publishes them. */
  targetTransforms: Float32Array;
  /** Number of valid transforms in `targetTransforms`. */
  targetPartCount: number;
```

Add the field beside `cart`:

```ts
  private readonly targets: TargetRig;
```

The constructor's signature gains the target count, because instance counts are fixed at construction:

```ts
  constructor(container: HTMLElement, terrain: Terrain, targetCount: number) {
```

and inside, after `this.scene.add(this.cart);`:

```ts
    this.targets = new TargetRig(targetCount);
    this.scene.add(this.targets);
```

In `draw()`, after `this.drawCart(view);`:

```ts
    this.targets.setFromTransforms(view.targetTransforms, view.targetPartCount);
```

In `dispose()`:

```ts
  dispose(): void {
    this.cart.dispose();
    this.targets.dispose();
    this.renderer.dispose();
  }
```

- [ ] **Step 3: Interpolate the buffer in `main.ts`**

Pass the target count when constructing the scene:

```ts
  const render = new RenderScene(container, sim.terrain, sim.targets.length);
```

Add to the `view` initialiser, after `mode: sim.mode,`:

```ts
    targetTransforms: new Float32Array(sim.currentTargetTransforms.length),
    targetPartCount: sim.targetPartCount,
```

In the render callback, after `view.mode = sim.mode;`:

```ts
      interpolateTransforms(
        sim.previousTargetTransforms,
        sim.currentTargetTransforms,
        alpha,
        view.targetTransforms,
      );
```

Add the helper below `interpolateCart`:

```ts
/**
 * Lerps positions and slerps rotations for a whole flat transform buffer in place. Uninterpolated,
 * a ragdoll collapsing over about a second steps visibly at any refresh rate above 60 Hz -- and
 * the collapse is the thing this rendering exists to show.
 *
 * Standing parts are interpolated too rather than special-cased: the copy costs a handful of
 * floats and keeps this one code path instead of two.
 */
function interpolateTransforms(
  previous: Float32Array,
  current: Float32Array,
  alpha: number,
  out: Float32Array,
): void {
  const count = Math.min(previous.length, current.length, out.length);
  for (let i = 0; i + TRANSFORM_STRIDE <= count; i += TRANSFORM_STRIDE) {
    out[i] = lerp(previous[i]!, current[i]!, alpha);
    out[i + 1] = lerp(previous[i + 1]!, current[i + 1]!, alpha);
    out[i + 2] = lerp(previous[i + 2]!, current[i + 2]!, alpha);

    scratchA.set(previous[i + 3]!, previous[i + 4]!, previous[i + 5]!, previous[i + 6]!);
    scratchB.set(current[i + 3]!, current[i + 4]!, current[i + 5]!, current[i + 6]!);
    scratchOut.slerpQuaternions(scratchA, scratchB, alpha);
    out[i + 3] = scratchOut.x;
    out[i + 4] = scratchOut.y;
    out[i + 5] = scratchOut.z;
    out[i + 6] = scratchOut.w;
  }
}
```

Extend the `world` import to bring in the stride:

```ts
import { FIXED_DT, Sim, SwingMode, TRANSFORM_STRIDE } from "./sim/world";
```

- [ ] **Step 4: Add the target subject to the gate**

In `tools/gate/gateScene.ts`, add the imports:

```ts
import { TargetRig } from "../../src/entities/TargetRig";
import { PARTS_PER_TARGET, TARGET_PART_SHAPES } from "../../src/sim/entities/Target";
import { TRANSFORM_STRIDE } from "../../src/sim/world";
```

Add to `SUBJECTS`:

```ts
  target: () => targetSubject(),
```

and the builder, beside `ballSubject`:

```ts
/**
 * One target in its rest pose, posed from TARGET_PART_SHAPES' own rest offsets rather than from a
 * live Sim -- the gate must not need Rapier, a terrain or a seed to render a subject.
 */
function targetSubject(): GateSubject {
  const rig = new TargetRig(1);
  const transforms = new Float32Array(PARTS_PER_TARGET * TRANSFORM_STRIDE);
  for (let i = 0; i < TARGET_PART_SHAPES.length; i++) {
    const offset = TARGET_PART_SHAPES[i]!.restOffset;
    const flat = i * TRANSFORM_STRIDE;
    transforms[flat] = offset.x;
    transforms[flat + 1] = offset.y;
    transforms[flat + 2] = offset.z;
    transforms[flat + 6] = 1; // identity quaternion
  }
  rig.setFromTransforms(transforms, PARTS_PER_TARGET);
  return { object: rig, dispose: () => rig.dispose() };
}
```

In `tools/sceneGate.mjs`, add the subject:

```js
const SUBJECTS = ["cart-driver", "cart-iron", "cart-putter", "ball", "target"];
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm test`
Expected: PASS, 248 tests.

Run: `npm run gate`
Expected: the four existing subjects PASS; `target` FAILs with "no baseline". That is correct — a new subject must not be able to appear already-passing.

Run: `npm run gate -- --update-baseline`

- [ ] **Step 6: Review the target baseline by eye**

Open `tools/gate-baseline/target.png`. **This is the human-judgement step for the ragdoll.** Confirm it reads as a standing humanoid — head above torso above pelvis, two arms, two legs, feet near the ground plane — and that no capsule is inside-out, detached, or at the origin. Per `UI-SPEC.md` §6's silhouette rule, it must be identifiable as a black shape; squint at it. If it is wrong, the fault is in `TargetRig`'s geometry or the rest offsets, not in the gate.

Run: `npm run gate`
Expected: `GATE PASS`, five subjects.

- [ ] **Step 7: See the ragdoll in the running game**

Run: `npm run dev`, open the page, press `C` for cart mode, drive down the corridor and fire at a target with `F`.

Confirm: three humanoid dummies stand along the tee→cup corridor, and a hit knocks one down as a connected rig rather than as eleven independent capsules or an explosion. Watch the collapse for stepping — if it judders, the interpolation in Step 3 is not being applied.

**This is a look-check on presentation, not evidence about physics.** Per `AGENTS.md`, a screenshot is never proof the simulation is correct; `Target.test.ts` and `combat.test.ts` own that and already pass.

- [ ] **Step 8: Commit**

```bash
git add src/entities/TargetRig.ts src/render/scene.ts src/main.ts tools/gate tools/sceneGate.mjs tools/gate-baseline
git commit -s -m "feat(render): draw the ragdoll targets

Eleven InstancedMeshes, one per part name, instance count equal to the
hole's target count -- eleven draw calls however many targets a hole grows
to. Not one instanced mesh, because the eleven parts have eleven distinct
radius/half-height pairs and a non-uniformly scaled capsule stops being a
capsule.

Capsule dimensions come from Target.ts's own rig table, so the visual
capsule cannot drift from its collider.

Transforms are lerped and slerped from the sim's double-buffered snapshot.
Uninterpolated, a collapse steps visibly above 60Hz, and the collapse is
the whole point.

The gate gains a target subject, posed from the rig's rest offsets so it
needs no Rapier, terrain or seed to render."
```

---

## Task 7: Pooled ball snapshots and rendering

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `src/sim/world.render.test.ts`
- Create: `src/entities/BallSwarm.ts`
- Modify: `src/render/scene.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `BallPool.all`, `POOL_SIZE` (existing); `TRANSFORM_STRIDE` (Task 5).
- Produces:
  - `POOL_TRANSFORM_STRIDE = 8` exported from `src/sim/world.ts` — `x, y, z, qx, qy, qz, qw, active`
  - `Sim.previousPoolTransforms: Float32Array`, `Sim.currentPoolTransforms: Float32Array`, both `POOL_SIZE * 8` floats
  - `class BallSwarm extends THREE.Group` with `constructor()`, `setFromTransforms(transforms: Float32Array): void`, `dispose(): void`
  - `FrameView.poolTransforms: Float32Array`

- [ ] **Step 1: Write the failing tests**

Append to `src/sim/world.render.test.ts`:

```ts
describe("pooled ball snapshots", () => {
  it("is sized for the whole pool and starts inactive", async () => {
    const sim = await Sim.create(generateCourse(2026, 1).holes[0]!);
    expect(sim.currentPoolTransforms.length).toBe(POOL_SIZE * POOL_TRANSFORM_STRIDE);
    expect(sim.previousPoolTransforms.length).toBe(sim.currentPoolTransforms.length);
    for (let i = 0; i < POOL_SIZE; i++) {
      expect(sim.currentPoolTransforms[i * POOL_TRANSFORM_STRIDE + 7]).toBe(0);
    }
  });

  it("marks a slot active once a cart-mode shot spawns a ball", async () => {
    const sim = await Sim.create(generateCourse(2026, 1).holes[0]!);
    sim.mode = SwingMode.Cart;
    const intent = neutralIntent();
    intent.fire = true;
    sim.step(intent);
    intent.fire = false;
    for (let n = 0; n < 30; n++) sim.step(intent);

    const active = countActive(sim.currentPoolTransforms);
    expect(active).toBeGreaterThan(0);
  });

  it("does not allocate a new pool buffer per tick", async () => {
    const sim = await Sim.create(generateCourse(2026, 1).holes[0]!);
    const seen = new Set<Float32Array>();
    for (let n = 0; n < 8; n++) {
      sim.step();
      seen.add(sim.currentPoolTransforms);
      seen.add(sim.previousPoolTransforms);
    }
    expect(seen.size).toBe(2);
  });

  it("clears every slot when the pool is released for a new hole", async () => {
    const course = generateCourse(2026, 2).holes;
    const sim = await Sim.create(course[0]!);
    sim.mode = SwingMode.Cart;
    const intent = neutralIntent();
    intent.fire = true;
    sim.step(intent);
    intent.fire = false;
    for (let n = 0; n < 30; n++) sim.step(intent);
    expect(countActive(sim.currentPoolTransforms)).toBeGreaterThan(0);

    sim.loadHole(course[1]!);
    expect(countActive(sim.currentPoolTransforms)).toBe(0);
  });
});

function countActive(buffer: Float32Array): number {
  let active = 0;
  for (let i = 0; i < POOL_SIZE; i++) {
    if (buffer[i * POOL_TRANSFORM_STRIDE + 7] === 1) active++;
  }
  return active;
}
```

Extend that file's imports:

```ts
import { POOL_TRANSFORM_STRIDE, Sim, SwingMode, TRANSFORM_STRIDE } from "./world";
import { POOL_SIZE } from "./entities/BallPool";
import { neutralIntent } from "../input/InputSource";
```

**Before running:** confirm `neutralIntent`'s import path and that `PlayerIntent` has a boolean `fire` field, with `grep -n "neutralIntent\|fire" src/input/InputSource.ts`. If `fire` is named differently, or firing needs a charge-and-release rather than a single tick, mirror exactly what `src/sim/world.cart.test.ts` already does to fire a shot — that file is the working reference and must be followed rather than guessed at.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/world.render.test.ts`
Expected: FAIL — `POOL_TRANSFORM_STRIDE` and the pool buffers do not exist.

- [ ] **Step 3: Add the buffers to `Sim`**

In `src/sim/world.ts`, export the stride beside `TRANSFORM_STRIDE`:

```ts
/** As TRANSFORM_STRIDE, plus a trailing 1/0 active flag: an idle pool slot is parked far below
 *  the world and must not be drawn where it is parked. */
export const POOL_TRANSFORM_STRIDE = 8;
```

Add the fields beside the target buffers:

```ts
  /** Pooled ball transforms from the previous fixed step, for render interpolation. */
  previousPoolTransforms = new Float32Array(POOL_SIZE * POOL_TRANSFORM_STRIDE);
  /** Pooled ball transforms from the most recent fixed step. */
  currentPoolTransforms = new Float32Array(POOL_SIZE * POOL_TRANSFORM_STRIDE);
```

Import `POOL_SIZE` alongside the existing `BallPool` import.

Add the sync method beside `syncCurrentTargets()`:

```ts
  /**
   * Flattens the pool into the current buffer. An idle ball is parked far below the world, so the
   * active flag is what stops the renderer drawing thirty-two spheres at y = -1000.
   */
  private syncCurrentPool(): void {
    const buffer = this.currentPoolTransforms;
    const balls = this.ballPool.all;
    for (let i = 0; i < POOL_SIZE; i++) {
      const flat = i * POOL_TRANSFORM_STRIDE;
      const ball = balls[i];
      if (!ball || ball.state === "idle") {
        buffer[flat + 7] = 0;
        continue;
      }
      const t = ball.body.translation();
      const r = ball.body.rotation();
      buffer[flat] = t.x;
      buffer[flat + 1] = t.y;
      buffer[flat + 2] = t.z;
      buffer[flat + 3] = r.x;
      buffer[flat + 4] = r.y;
      buffer[flat + 5] = r.z;
      buffer[flat + 6] = r.w;
      buffer[flat + 7] = 1;
    }
  }
```

In `step()`, swap the pool buffers beside the target swap:

```ts
    const swapPool = this.previousPoolTransforms;
    this.previousPoolTransforms = this.currentPoolTransforms;
    this.currentPoolTransforms = swapPool;
```

and call `this.syncCurrentPool();` beside `this.syncCurrentTargets();`.

In `loadHole()`, immediately after `this.ballPool.releaseAll();`:

```ts
    this.syncCurrentPool();
    this.previousPoolTransforms.set(this.currentPoolTransforms);
```

In `Sim.create()`, beside the existing `sim.syncCurrentCart(); sim.previousCart = sim.currentCart;` lines:

```ts
    sim.syncCurrentPool();
    sim.previousPoolTransforms.set(sim.currentPoolTransforms);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sim/world.render.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write `BallSwarm`**

Create `src/entities/BallSwarm.ts`:

```ts
import * as THREE from "three";
import { POOL_SIZE } from "../sim/entities/BallPool";
import { POOL_TRANSFORM_STRIDE } from "../sim/world";

/**
 * The pooled combat balls, which cart mode fires and which nothing drew before this: the player
 * pressed fire and a ragdoll fell over some distance away with nothing having visibly travelled
 * between them.
 *
 * One InstancedMesh of POOL_SIZE. Inactive slots are scaled to zero rather than removed, so the
 * instance count never changes and no buffer is reallocated mid-round.
 *
 * Render-only, like GolfClub and TargetRig: no Rapier body, no authoritative state.
 */

const BALL_RADIUS = 0.15;
const ZERO_SCALE = 0.0001;

export class BallSwarm extends THREE.Group {
  private readonly mesh: THREE.InstancedMesh;
  private readonly positionScratch = new THREE.Vector3();
  private readonly quaternionScratch = new THREE.Quaternion();
  private readonly scaleScratch = new THREE.Vector3();
  private readonly matrixScratch = new THREE.Matrix4();

  constructor() {
    super();
    const geometry = new THREE.SphereGeometry(BALL_RADIUS, 16, 12);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    this.mesh = new THREE.InstancedMesh(geometry, material, POOL_SIZE);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // A ball in flight leaves any precomputed bounds immediately.
    this.mesh.frustumCulled = false;
    this.add(this.mesh);
  }

  /** `transforms` is the interpolated pool snapshot, POOL_TRANSFORM_STRIDE floats per slot. */
  setFromTransforms(transforms: Float32Array): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      const flat = i * POOL_TRANSFORM_STRIDE;
      const active = transforms[flat + 7] === 1;
      const scale = active ? 1 : ZERO_SCALE;
      this.positionScratch.set(transforms[flat]!, transforms[flat + 1]!, transforms[flat + 2]!);
      this.quaternionScratch.set(
        transforms[flat + 3]!,
        transforms[flat + 4]!,
        transforms[flat + 5]!,
        transforms[flat + 6]!,
      );
      this.scaleScratch.set(scale, scale, scale);
      this.matrixScratch.compose(this.positionScratch, this.quaternionScratch, this.scaleScratch);
      this.mesh.setMatrixAt(i, this.matrixScratch);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
    this.mesh.dispose();
    this.clear();
  }
}
```

- [ ] **Step 6: Wire it into the scene and the loop**

In `src/render/scene.ts`: import `BallSwarm`, add `private readonly pooledBalls: BallSwarm;`, construct it after `TargetRig` and `this.scene.add(this.pooledBalls);`, add `poolTransforms: Float32Array;` to `FrameView`, call `this.pooledBalls.setFromTransforms(view.poolTransforms);` in `draw()` beside the target call, and add `this.pooledBalls.dispose();` to `dispose()`.

In `src/main.ts`, add to the `view` initialiser:

```ts
    poolTransforms: new Float32Array(sim.currentPoolTransforms.length),
```

and in the render callback, beside the target interpolation:

```ts
      interpolateTransforms(
        sim.previousPoolTransforms,
        sim.currentPoolTransforms,
        alpha,
        view.poolTransforms,
        POOL_TRANSFORM_STRIDE,
      );
```

`interpolateTransforms` gains a stride parameter defaulting to `TRANSFORM_STRIDE`, and copies any trailing floats beyond the seven it interpolates straight from `current` — the active flag must not be lerped into a fractional value:

```ts
function interpolateTransforms(
  previous: Float32Array,
  current: Float32Array,
  alpha: number,
  out: Float32Array,
  stride: number = TRANSFORM_STRIDE,
): void {
  const count = Math.min(previous.length, current.length, out.length);
  for (let i = 0; i + stride <= count; i += stride) {
    out[i] = lerp(previous[i]!, current[i]!, alpha);
    out[i + 1] = lerp(previous[i + 1]!, current[i + 1]!, alpha);
    out[i + 2] = lerp(previous[i + 2]!, current[i + 2]!, alpha);

    scratchA.set(previous[i + 3]!, previous[i + 4]!, previous[i + 5]!, previous[i + 6]!);
    scratchB.set(current[i + 3]!, current[i + 4]!, current[i + 5]!, current[i + 6]!);
    scratchOut.slerpQuaternions(scratchA, scratchB, alpha);
    out[i + 3] = scratchOut.x;
    out[i + 4] = scratchOut.y;
    out[i + 5] = scratchOut.z;
    out[i + 6] = scratchOut.w;

    // Anything past the transform itself is a flag, not a value: copy, never interpolate. A
    // half-active ball would be drawn at half scale on the frame it spawns.
    for (let extra = TRANSFORM_STRIDE; extra < stride; extra++) {
      out[i + extra] = current[i + extra]!;
    }
  }
}
```

Import `POOL_TRANSFORM_STRIDE` from `./sim/world`.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` — clean.
Run: `npm test` — PASS, 252 tests.
Run: `npm run gate` — `GATE PASS` (the `ball` subject is unchanged; `BallSwarm` reuses the same sphere parameters as the existing course ball, at 16×12 rather than 20×16, and is not itself a gate subject because a sphere adds nothing the `ball` subject does not already guard).

- [ ] **Step 8: See it in the running game**

Run: `npm run dev`. Press `C`, hold `F` and release. Confirm a white ball visibly leaves the club head and arcs down the fairway, and that it stops being drawn when it is picked back up as ammo. Fire eight or ten times and confirm no ball is ever drawn at the parked position below the world.

- [ ] **Step 9: Commit**

```bash
git add src/sim/world.ts src/sim/world.render.test.ts src/entities/BallSwarm.ts src/render/scene.ts src/main.ts
git commit -s -m "feat(render): draw the pooled combat balls

Cart-mode shots come out of BallPool and nothing drew them: the player
fired, and a ragdoll fell over some distance away with nothing having
visibly travelled between them. The projectile is what connects the turret
to the target.

One InstancedMesh of POOL_SIZE with inactive slots scaled to zero, fed by
a double-buffered snapshot carrying a trailing active flag. The flag is
copied rather than interpolated: a half-active ball would be drawn at half
scale on its spawn frame."
```

---

## Task 8: HUD state derivation

The DOM-free half, so the node environment can test it.

**Files:**
- Create: `src/ui/hudState.ts`
- Create: `src/ui/hudState.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks; takes a structural source, not a `Sim`.
- Produces:
  - `interface HudSource` — the read-only shape `deriveHudState` needs
  - `interface HudState`
  - `deriveHudState(source: HudSource): HudState`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/hudState.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveHudState } from "./hudState";
import { SwingMode } from "../sim/world";
import { ClubType } from "../physics/Ballistics";
import type { HudSource } from "./hudState";

function source(overrides: Partial<HudSource> = {}): HudSource {
  return {
    mode: SwingMode.Cart,
    strokes: 0,
    holedOut: false,
    lastShotInWater: false,
    lastShotOutOfBounds: false,
    cart: {
      equippedClub: ClubType.Driver,
      charge: 0,
      canFire: true,
      reloadRemaining: 0,
      ammo: 10,
      dead: false,
      respawnTimer: 0,
      health: { hp: 100, max: 100 },
    },
    ...overrides,
  };
}

describe("combat element visibility", () => {
  it("shows health and ammo in cart mode", () => {
    expect(deriveHudState(source()).combatVisible).toBe(true);
  });

  it("hides them in stationary mode rather than showing them full", () => {
    // UI-SPEC.md section 1 gives Health to the Cart HUD and marks it absent from the Swing HUD;
    // section 5 says an inert full bar reads as a bug.
    const state = deriveHudState(source({ mode: SwingMode.Stationary }));
    expect(state.combatVisible).toBe(false);
  });
});

describe("health", () => {
  it("reports the fraction and the rounded value", () => {
    const state = deriveHudState(source({ cart: { ...source().cart, health: { hp: 45, max: 100 } } }));
    expect(state.healthFraction).toBeCloseTo(0.45, 5);
    expect(state.healthText).toBe("45");
  });

  it("shows zero rather than hiding when the cart is dead", () => {
    // Section 5's rule is about elements with nothing behind them, not about a real value of zero.
    const state = deriveHudState(
      source({ cart: { ...source().cart, dead: true, respawnTimer: 2.4, health: { hp: 0, max: 100 } } }),
    );
    expect(state.combatVisible).toBe(true);
    expect(state.healthFraction).toBe(0);
    expect(state.healthText).toBe("0");
  });

  it("clamps a fraction that would otherwise go negative or past one", () => {
    const over = deriveHudState(source({ cart: { ...source().cart, health: { hp: 140, max: 100 } } }));
    const under = deriveHudState(source({ cart: { ...source().cart, health: { hp: -5, max: 100 } } }));
    expect(over.healthFraction).toBe(1);
    expect(under.healthFraction).toBe(0);
  });

  it("does not divide by zero on a zero-max health", () => {
    const state = deriveHudState(source({ cart: { ...source().cart, health: { hp: 0, max: 0 } } }));
    expect(state.healthFraction).toBe(0);
  });
});

describe("ammo", () => {
  it("reports the count", () => {
    expect(deriveHudState(source({ cart: { ...source().cart, ammo: 7 } })).ammoText).toBe("7");
  });
});

describe("status precedence", () => {
  it("puts death above reloading, because a dead cart's reload is frozen too", () => {
    const state = deriveHudState(
      source({ cart: { ...source().cart, dead: true, respawnTimer: 2.44, canFire: false, reloadRemaining: 1.2 } }),
    );
    expect(state.status).toBe("DESTROYED — RESPAWNING 2.4s");
  });

  it("reports holing out above everything", () => {
    expect(deriveHudState(source({ holedOut: true })).status).toBe("HOLED OUT — R to reset");
  });

  it("reports reloading when alive and not yet able to fire", () => {
    const state = deriveHudState(source({ cart: { ...source().cart, canFire: false, reloadRemaining: 1.25 } }));
    expect(state.status).toBe("RELOADING 1.2s");
  });

  it("reports the water hazard", () => {
    expect(deriveHudState(source({ lastShotInWater: true })).status).toBe("WATER HAZARD — plus one stroke");
  });

  it("reports out of bounds", () => {
    expect(deriveHudState(source({ lastShotOutOfBounds: true })).status).toBe(
      "OUT OF BOUNDS — returned to the tee",
    );
  });

  it("tells a player with no ammo that firing still boosts", () => {
    expect(deriveHudState(source({ cart: { ...source().cart, ammo: 0 } })).status).toBe(
      "NO AMMO — fire a blank to boost",
    );
  });

  it("is READY in stationary mode regardless of ammo", () => {
    const state = deriveHudState(source({ mode: SwingMode.Stationary, cart: { ...source().cart, ammo: 0 } }));
    expect(state.status).toBe("READY");
  });
});

describe("the rest of the readout", () => {
  it("labels the mode and the club and the strokes", () => {
    const state = deriveHudState(source({ strokes: 3, cart: { ...source().cart, equippedClub: ClubType.Putter } }));
    expect(state.modeText).toBe("CART");
    expect(state.clubText).toBe("PUTTER");
    expect(state.strokesText).toBe("STROKES 3");
  });

  it("labels stationary mode STANDING, which smoke.mjs asserts", () => {
    expect(deriveHudState(source({ mode: SwingMode.Stationary })).modeText).toBe("STANDING");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/hudState.test.ts`
Expected: FAIL — cannot resolve `./hudState`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/hudState.ts`:

```ts
import { SwingMode } from "../sim/world";
import type { ClubType } from "../physics/Ballistics";

/**
 * The DOM-free half of the HUD: sim state in, display values out. Split from the writing half so
 * this runs in Vitest's node environment like everything else, and so the rules below -- which
 * elements are visible, which status message wins -- are asserted rather than eyeballed in a
 * browser.
 *
 * Reads only. Per AGENTS.md, src/ui/** is a pure consumer of sim state.
 */

/** The structural slice of Sim this module needs. Structural so tests need no Rapier world. */
export interface HudSource {
  readonly mode: SwingMode;
  readonly strokes: number;
  readonly holedOut: boolean;
  readonly lastShotInWater: boolean;
  readonly lastShotOutOfBounds: boolean;
  readonly cart: {
    readonly equippedClub: ClubType;
    readonly charge: number;
    readonly canFire: boolean;
    readonly reloadRemaining: number;
    readonly ammo: number;
    readonly dead: boolean;
    readonly respawnTimer: number;
    readonly health: { readonly hp: number; readonly max: number };
  };
}

export interface HudState {
  modeText: string;
  clubText: string;
  strokesText: string;
  charge01: number;
  status: string;
  /** UI-SPEC H6 and H7. False hides them outright; see the note on the Swing HUD below. */
  combatVisible: boolean;
  healthFraction: number;
  healthText: string;
  ammoText: string;
}

export function deriveHudState(source: HudSource): HudState {
  const cart = source.cart;
  const inCart = source.mode === SwingMode.Cart;

  return {
    modeText: inCart ? "CART" : "STANDING",
    clubText: cart.equippedClub.toUpperCase(),
    strokesText: `STROKES ${source.strokes}`,
    charge01: clamp01(cart.charge),
    status: statusText(source, inCart),
    // UI-SPEC.md section 1's table gives Health and Reload to the Cart HUD and marks them absent
    // from the Swing HUD, and that split maps onto SwingMode. Section 5 scopes the same rule to
    // STROKE vs CTF/TARGETS, a switch that does not exist yet; when it lands these elements gain
    // a second hiding condition rather than a new mechanism.
    combatVisible: inCart,
    healthFraction: cart.health.max > 0 ? clamp01(cart.health.hp / cart.health.max) : 0,
    healthText: `${Math.max(0, Math.round(cart.health.hp))}`,
    ammoText: `${Math.max(0, Math.round(cart.ammo))}`,
  };
}

/**
 * One line, one message, most urgent first. Death outranks reloading because stepRespawn freezes
 * the reload timer along with everything else -- reporting a reload that is not counting down
 * would be a lie.
 *
 * The death case lives here rather than in a banner on purpose: UI-SPEC H12 (the event banner) is
 * Phase 4's, screen-anchored and longer-dwell, and a bespoke death banner now would either be
 * thrown away or pre-empt that layout. But stepRespawn ignores every intent for RESPAWN_DELAY_S,
 * so with no message at all the game simply appears to freeze. That is a playability hole, not
 * missing polish, and this line is the cheapest honest fix.
 */
function statusText(source: HudSource, inCart: boolean): string {
  const cart = source.cart;
  if (source.holedOut) return "HOLED OUT — R to reset";
  if (cart.dead) return `DESTROYED — RESPAWNING ${cart.respawnTimer.toFixed(1)}s`;
  if (!cart.canFire) return `RELOADING ${cart.reloadRemaining.toFixed(1)}s`;
  if (source.lastShotInWater) return "WATER HAZARD — plus one stroke";
  if (source.lastShotOutOfBounds) return "OUT OF BOUNDS — returned to the tee";
  if (!inCart) return "READY";
  return cart.ammo > 0 ? "READY" : "NO AMMO — fire a blank to boost";
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/hudState.test.ts`
Expected: PASS, 15 tests.

Run: `npm test`
Expected: PASS, 267 tests.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/hudState.ts src/ui/hudState.test.ts
git commit -s -m "feat(ui): derive HUD state from the sim, DOM-free

Split from the DOM-writing half so the rules run in the node environment
and are asserted rather than eyeballed: which elements are visible, and
which status message wins.

H6 and H7 hide in stationary mode. UI-SPEC section 1's table gives Health
to the Cart HUD and marks it absent from the Swing HUD, and that split maps
onto SwingMode, which exists -- unlike section 5's STROKE/CTF/TARGETS
switch, which does not. When that lands these gain a second hiding
condition rather than a new mechanism.

Death outranks reloading in the status line because stepRespawn freezes
the reload timer too, so reporting a countdown that is not counting would
be a lie."
```

---

## Task 9: HUD markup and DOM writer

**Files:**
- Create: `src/ui/hud.ts`
- Modify: `index.html`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `deriveHudState`, `HudState`, `HudSource` (Task 8).
- Produces: `readHud(): Hud | null` (null when any element is missing, matching `main.ts`'s existing guard) and `drawHud(hud: Hud, source: HudSource): void` from `src/ui/hud.ts`.

- [ ] **Step 1: Add the markup and styles**

In `index.html`, add these rules inside the existing `<style>` block, after `#power-fill`:

```css
      /* UI-SPEC section 6: dark translucent rounded rectangles, white bold condensed type.
         Bottom-left, the corner image 06 and image 08 put ammo and health in, and placed so
         Phase 4 can lay the full image-08 set out around them without moving them. */
      #hud-combat {
        position: fixed;
        left: 24px;
        bottom: 24px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font: 600 13px system-ui, sans-serif;
        letter-spacing: 0.06em;
        color: #fff;
        pointer-events: none;
      }
      #hud-combat[hidden] { display: none; }
      .hud-card {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 11px;
        border-radius: 8px;
        background: rgba(16, 20, 24, 0.62);
      }
      #health-track {
        width: 132px;
        height: 10px;
        border-radius: 5px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.5);
      }
      #health-fill {
        height: 100%;
        width: 100%;
        background: #46c46a;
        transition: width 90ms linear;
      }
      #health-icon { color: #e8564a; font-size: 15px; }
      #ammo-count { color: #ff9d3d; font-size: 17px; }
```

And add the element just before `<div id="hud">`:

```html
    <div id="hud-combat" hidden>
      <div class="hud-card">
        <span id="health-icon">&#9829;</span>
        <div id="health-track"><div id="health-fill"></div></div>
        <span id="health-text">100</span>
      </div>
      <div class="hud-card">
        <span>AMMO</span>
        <span id="ammo-count">0</span>
      </div>
    </div>
```

- [ ] **Step 2: Write the DOM writer**

Create `src/ui/hud.ts`:

```ts
import { deriveHudState } from "./hudState";
import type { HudSource } from "./hudState";

/**
 * The DOM-writing half of the HUD. Every decision lives in hudState.ts; this file only puts
 * strings and widths into elements, which is why it has no tests -- npm run smoke drives the real
 * browser and is the layer that notices if an element is wired to nothing.
 *
 * Deliberately not the image-08 HUD. UI-SPEC section 2 assigns exactly two elements to this phase,
 * H6 (health) and H7 (ammo); the power meter, club selector, reload gauge, minimap and the rest
 * are Phase 4's, and Phase 4 lays them out as one layout rather than growing them one span at a
 * time.
 */

export interface Hud {
  powerFill: HTMLElement;
  mode: HTMLElement;
  club: HTMLElement;
  strokes: HTMLElement;
  status: HTMLElement;
  combat: HTMLElement;
  healthFill: HTMLElement;
  healthText: HTMLElement;
  ammoCount: HTMLElement;
}

export function readHud(): Hud | null {
  const ids = [
    "power-fill",
    "hud-mode",
    "hud-club",
    "hud-strokes",
    "hud-status",
    "hud-combat",
    "health-fill",
    "health-text",
    "ammo-count",
  ] as const;

  const found = ids.map((id) => document.getElementById(id));
  if (found.some((element) => element === null)) return null;
  const [powerFill, mode, club, strokes, status, combat, healthFill, healthText, ammoCount] =
    found as HTMLElement[];

  return {
    powerFill: powerFill!,
    mode: mode!,
    club: club!,
    strokes: strokes!,
    status: status!,
    combat: combat!,
    healthFill: healthFill!,
    healthText: healthText!,
    ammoCount: ammoCount!,
  };
}

export function drawHud(hud: Hud, source: HudSource): void {
  const state = deriveHudState(source);

  setWidth(hud.powerFill, state.charge01);
  setText(hud.mode, state.modeText);
  setText(hud.club, state.clubText);
  setText(hud.strokes, state.strokesText);
  setText(hud.status, state.status);

  // Hidden outright rather than shown full: an inert bar reads as a bug (UI-SPEC section 5).
  if (hud.combat.hidden === state.combatVisible) hud.combat.hidden = !state.combatVisible;
  if (!state.combatVisible) return;

  setWidth(hud.healthFill, state.healthFraction);
  setText(hud.healthText, state.healthText);
  setText(hud.ammoCount, state.ammoText);
}

/** Guarded so an unchanged string does not dirty the DOM every frame at 60fps. */
function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function setWidth(element: HTMLElement, fraction01: number): void {
  const width = `${Math.round(fraction01 * 100)}%`;
  if (element.style.width !== width) element.style.width = width;
}
```

- [ ] **Step 3: Delegate from `main.ts`**

Delete `main.ts`'s `Hud` interface, `readHud`, `drawHud`, `statusText`, `turretLoaded`'s neighbours in that block, and `setText` — everything from `interface Hud {` through the end of `setText`, keeping `turretLoaded` — and replace with the import at the top:

```ts
import { drawHud, readHud } from "./ui/hud";
```

`main()`'s existing `const hud = readHud();` and its null guard are unchanged; the render callback's `drawHud(hud, sim);` is unchanged. `Sim` structurally satisfies `HudSource`, so no cast is needed — if `tsc` disagrees, the mismatch is a real one and `HudSource` should be corrected to match `Sim`, never the other way round.

Keep `turretLoaded` in `main.ts`: it feeds `FrameView`, not the HUD.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — clean. An unused-import error here means a leftover in `main.ts`; delete it rather than suppressing the rule.
Run: `npm test` — PASS, 267 tests.

- [ ] **Step 5: See it in the running game**

Run: `npm run dev`.

Confirm, in order:
1. On load (stationary mode) there is **no** health bar and **no** ammo card on screen.
2. Press `C`. Both appear, health full and green, ammo showing the starting count.
3. Fire with `F`. The ammo count drops by one per shot.
4. Press `C` again. Both disappear rather than freezing full.
5. Drive over the ammo bucket near the tee. The count jumps back up.

- [ ] **Step 6: Commit**

```bash
git add index.html src/ui/hud.ts src/main.ts
git commit -s -m "feat(ui): add the cart HUD health bar and ammo counter

UI-SPEC H6 and H7, the only two elements section 2's table assigns to this
phase. Both are marked 3/4 -- Phase 3 built the state, this is the
presentation.

Hidden outright in stationary mode rather than shown full, per section 5:
an inert bar reads as a bug. Placed bottom-left so Phase 4 can lay the
image-08 set out around them without moving them.

main.ts's inline HUD moves to src/ui/, which AGENTS.md already reserves
for exactly this."
```

---

## Task 10: Rewrite the smoke script's stale assertions

**Files:**
- Modify: `tools/smoke.mjs`

**Interfaces:**
- Consumes: `sim.cart.ammo`, `sim.currentPoolTransforms`, `POOL_TRANSFORM_STRIDE`'s layout (Task 7).
- Produces: a green `npm run smoke`.

- [ ] **Step 1: Confirm smoke is failing for the expected reason**

Run: `npm run smoke`
Expected: failures including `sim.ballLoaded` now being `undefined` — Task 4 removed it. This is the red state.

- [ ] **Step 2: Rewrite the reader**

In `tools/smoke.mjs`'s `read()`, replace the `loaded` and `inReach` lines with the fields that exist, and add a pooled-ball reader:

```js
      ammo: sim.cart.ammo,
      health: sim.cart.health.hp,
      dead: sim.cart.dead,
      // The highest-flying active pooled ball. Cart-mode shots are pooled bodies, not Sim.ball,
      // so this is the only honest way to ask "did a ball leave the muzzle".
      topPooledBallY: (() => {
        const stride = 8;
        let best = null;
        for (let i = 0; i < sim.currentPoolTransforms.length; i += stride) {
          if (sim.currentPoolTransforms[i + 7] !== 1) continue;
          const y = sim.currentPoolTransforms[i + 1];
          if (best === null || y > best) best = y;
        }
        return best;
      })(),
      hudCombatHidden: document.getElementById("hud-combat").hidden,
      hudAmmo: document.getElementById("ammo-count").textContent,
```

- [ ] **Step 3: Rewrite the three stale assertions**

Replace the `BALL ON THE TURRET` block's two ball-loaded checks and the whole `FIRE FROM THE MUZZLE` block:

```js
console.log("=== RESET AND RELOAD ===");
await page.keyboard.press("KeyR");
await new Promise((r) => setTimeout(r, 1200));
const readyState = await read();
check("cart is back in cart mode after reset", readyState.mode === "cart", readyState.mode);
check("cart has ammo to fire", readyState.ammo > 0, `ammo ${readyState.ammo}`);
check("health is restored by a reset", readyState.health > 0, `hp ${readyState.health}`);

// Swing the turret off-axis and pick the driver before the shot: dead astern the barrel is
// foreshortened to nothing, and the club-as-barrel is the whole point of the silhouette.
await page.keyboard.press("Digit3");
await hold(page, "KeyE", 620);
await new Promise((r) => setTimeout(r, 250));

mkdirSync(dirname(SHOT), { recursive: true });
await page.screenshot({ path: SHOT });
console.log(`  screenshot -> ${SHOT}`);

console.log("=== FIRE FROM THE MUZZLE ===");
// Cart mode fires pooled balls off an ammo counter, not Sim.ball off the turf, and a cart-mode
// shot is not a stroke -- Sim.strokes only moves on death, water, and a stationary launch. The
// assertions here are the mechanic that exists, not the pre-ammo one they replaced.
const ammoBefore = readyState.ammo;
const groundBefore = readyState.cart.y;
await hold(page, "KeyF", 1600);
await new Promise((r) => setTimeout(r, 120));
const shot = await read();
check("firing spends a round of ammo", shot.ammo === ammoBefore - 1, `${ammoBefore} -> ${shot.ammo}`);
check("a pooled ball is in flight", shot.topPooledBallY !== null, `y=${shot.topPooledBallY}`);
check(
  "the ball leaves from above the cart, not from the ground",
  shot.topPooledBallY !== null && shot.topPooledBallY > groundBefore,
  `ball y=${shot.topPooledBallY?.toFixed(2)} vs cart y=${groundBefore.toFixed(2)}`,
);

console.log("=== COMBAT HUD ===");
check("health and ammo are visible in cart mode", shot.hudCombatHidden === false);
check("the ammo card matches the sim", shot.hudAmmo === String(shot.ammo), `${shot.hudAmmo} vs ${shot.ammo}`);
await page.keyboard.press("KeyC");
await new Promise((r) => setTimeout(r, 200));
const standing = await read();
check("health and ammo hide in stationary mode", standing.hudCombatHidden === true);
```

Also fix the earlier `BLANK FIRE` block, which reads the removed `loaded` field. Delete this line entirely:

```js
check("ball is not loaded once driven away from it", putter.loaded === false);
```

Keep both remaining assertions in that block but restate the comment, because the reason the shot costs no stroke has changed. A cart-mode shot never costs a stroke now, ammo or no ammo — so the "blank" framing is about propulsion, not about stroke accounting:

```js
console.log("=== FIRE WHILE DRIVING (F) ===");
// Cart-mode fire is propulsion first: recoil opposes the shot, so firing shoves the cart. It
// costs no stroke whether or not a ball spawns, because Sim.strokes only moves on death, water
// and a stationary launch. Both assertions below still hold; only the reason has changed.
```

Leave `check("blank costs no stroke", ...)` and `check("blank still shoves the cart (recoil propulsion)", ...)` exactly as they are. Recoil is the assertion Phase 2 cared about and it is still true.

- [ ] **Step 4: Run smoke to verify it passes**

Run: `npm run smoke`
Expected: `SMOKE PASS`, exit 0, with no console errors.

- [ ] **Step 5: Commit**

```bash
git add tools/smoke.mjs
git commit -s -m "test(smoke): assert cart mode's real firing mechanic

The three failing assertions were asserting the pre-ammo mechanic: that a
cart-mode shot costs a stroke, that the fired ball is Sim.ball, and that
ballLoaded clears. None of those is true any more -- Sim.strokes moves only
on death, water and a stationary launch, and cart shots are pooled bodies.

Now asserts what happens: firing spends a round, a pooled ball is in
flight, and it left from above the cart. Adds a check that the new health
and ammo elements are visible in cart mode and hidden in stationary mode,
which is the layer that catches an element wired to nothing."
```

---

## Task 11: Update the docs and run the full verification

**Files:**
- Modify: `docs/ROADMAP.md`, `docs/BACKLOG.md`, `docs/UI-SPEC.md`

- [ ] **Step 1: Update `ROADMAP.md`**

In Phase 1, tick the `tools/sceneGate.mjs` item and replace its "Still open" note with what was built: the harness page, both comparison halves, the five baselined subjects, and the fact it is wired into `npm run build`. In Phase 2, tick the "sceneGate baseline extended to cover the cart + all three club heads" item and delete "Still open, and now overdue". In Phase 2's gate-status carve-outs, delete carve-out 2 ("No geometry baseline covers the cart or the club heads"). In Phase 3, note that target rendering, pooled-ball rendering and the H6/H7 HUD landed, pointing at this spec and plan. In Phase 4, note that H6 and H7 are done and that H11, H12 and the rest remain.

- [ ] **Step 2: Update `BACKLOG.md`**

Change row 16d's status from `READY` to `DONE`, recording that `ballLoaded`/`ballInReach` were deleted rather than rewired, that the flag was harmful rather than merely stale, and that `turretLoaded` is derived from `cart.ammo`. In row 16, replace "The HUD health bar those concept shots show is still unbuilt" with a pointer to this work. In row 24a, note that the ragdolls now render.

- [ ] **Step 3: Update `UI-SPEC.md`**

In §2's table, mark H6 and H7 as built and name `src/ui/hud.ts` as the presentation. Add a line to §5 recording that the hiding rule is currently implemented against `SwingMode` per §1, and that `STROKE`/`CTF`/`TARGETS` will add a second condition rather than replace the mechanism. Do not restate the argument — the spec holds it.

- [ ] **Step 4: Run every verification layer**

```bash
npx tsc --noEmit          # clean
npm test                  # 267 pass
npm run gate              # GATE PASS, 5 subjects
npm run smoke             # SMOKE PASS
npm run probe             # exit 1 on driver distance ONLY, numbers identical to the baseline
```

Diff the probe output against the run captured at the start of this work. **If any probe number moved, this slice changed physics and the change must be found, not accepted** — the spec commits to byte-for-byte identical output and that commitment is the point of running it.

- [ ] **Step 5: Commit**

```bash
git add docs/ROADMAP.md docs/BACKLOG.md docs/UI-SPEC.md
git commit -s -m "docs: record combat rendering, the scene gate and the cart HUD

Phase 1's sceneGate.mjs is built and Phase 2's cart/club-head baseline gap
is closed, so both items are ticked and the Phase 2 carve-out about
unguarded geometry is removed. Phase 3 gains target and pooled-ball
rendering; Phase 4 keeps H11, H12, the minimap and the rest.

BACKLOG #16d closes. UI-SPEC section 5 records that the hide rule runs off
SwingMode today per section 1, and that the mode switch will add a second
condition rather than replace the mechanism."
```

---

## Verification summary

| Layer | Question it answers | Expected |
|---|---|---|
| `npx tsc --noEmit` | Does it typecheck under strict? | clean |
| `npm test` | Are the rules and state machines right? | 267 pass |
| `npm run gate` | Has any procedural geometry silently changed? | GATE PASS, 5 subjects |
| `npm run smoke` | Does the real browser path work end to end? | SMOKE PASS |
| `npm run probe` | Did the feel and trajectory numbers move? | identical, `driver distance` still fails |

These are not substitutes for one another. A screenshot is never evidence about physics; `npm run gate` passing says the geometry has not changed, not that it is correct; and only the human review steps in Task 3 Step 5 and Task 6 Step 6 say a shape is right.

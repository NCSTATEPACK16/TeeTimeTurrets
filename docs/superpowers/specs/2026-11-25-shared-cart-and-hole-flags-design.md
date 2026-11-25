# One cart in both games, and branded hole flags in free drive

Written 2026-11-25. The decisions below were made by the user in one question round each on the vehicle, the flag and the scope; they are not open. Three PRs build it, in order, each ending at a play-test stop.

## 1. Why

Turrets (`src/`, three 0.185 WebGL, Rapier 0.20) and free drive (`drive/`: Chill and Joyride, three 0.186 WebGPU, Rapier 0.21) share a title screen and a site build, but each has its own cart. Free drive's is a gray-box placeholder (`drive/apps/web/src/vehicle/CartView.ts`, boxes and cylinders). The user wants the same vehicle in both games: the Turrets cart's look and feel in Chill and Joyride. They also want a large branded flag on each hole in free drive.

**The two games keep separate locations for now.** Turrets stays on the arena course, and free drive stays on Tee Time Links. Neither game's course changes here.

### How hard it is

Medium, and not a rewrite.

- **The model is portable data.** The Turrets cart is generated primitive-graph JSON (`src/entities/graphs/cart.json`, 52 nodes; the rider is `driver.json`, 26 nodes). It uses plain `MeshStandardMaterial`s and `RoundedBoxGeometry`, with no `onBeforeCompile` and no shader code, so it carries across to three's WebGPU renderer.
- **Free drive's vehicle is easy to swap.** It sits behind `VehicleModel` (`vehicle/VehicleModel.ts`), and every tunable is in `vehicle/cartTuning.ts`.
- **Turrets' handling cannot be lifted across as code.** It is a kinematic capsule (`CART_COLLIDER`, radius 0.6) moved by Rapier's character controller. The capsule never tilts, rolls or slides, and Joyride's drifts and flips depend on all three.
- **So:** free drive keeps its raycast-vehicle physics (`DynamicRayCastVehicleController`), and it is **retuned to Turrets' numbers and feel**.

## 2. Decisions (user, 2026-11-25)

| Topic | Decision |
|---|---|
| Mechanics | The Turrets look, with free drive's vehicle physics retuned to Turrets feel. Joyride keeps drifts, flips and boost |
| Speed | Joyride's top speed is Turrets' 20 m/s, and boost goes above it. Chill stays at 6.7 m/s but gets Turrets' throttle spool and steering response |
| Turret | None in Chill or Joyride. This keeps the M2 decision "Joyride is driving only" (`drive/docs/handoff/M2.md`, Part F) |
| Carried over from Turrets | The rider in the seat, team paint, Turrets' engine sound and horn (H), and spinning, steering wheels |
| Wheels in Turrets | The shared model's wheels spin and steer in Turrets too. It's render-only, so the golden fingerprint must not move |
| Paint | Swatches on Choose Your Ride: blue and orange plus a few Clubhouse Sunset colours. Remembered between visits |
| Logo | A "Tee Time Links" SVG designed in this repo in the Clubhouse Sunset style. The user approves it before it ships. It also becomes the title wordmark |
| Flag | Oversized: a pole of about 4 m and a 1.6 × 1.1 m cloth that waves a little. A big hole number, the logo and PAR. One on every hole's pin |
| Tee sign | HOLE n / PAR p / N YDS at every tee, as Turrets has |
| Collision | A cart knocks the flag over, and it stands back up a few seconds later. It never blocks the cart |
| Order | Three PRs: the logo, then the flags and tee signs, then the shared cart. Each gets its own play-test |

## 3. PR 1: the Tee Time Links logo

No logo exists anywhere in the repo:
- The old club logo was deleted (`DECISIONS.md`, "No real club's name or logo").
- Turrets' title wordmark is HTML text (`src/ui/screens/TitleScreen.ts` around line 88: "Tee Time" with a TURRETS banner).
- Free drive's own menu still reads "Golf Cart / SIMULATOR" (`drive/apps/web/src/ui/menus.ts:75`).

The work:
- **One source file:** `art/brand/tee-time-links.svg`. Both apps import it through Vite (`?url` or `?raw`); there is no second copy.
- **The look:** Clubhouse Sunset, with colours from `drive/apps/web/src/ui/theme.css` (`--ink #142018`, `--pine #1e4d2b`, `--cream #fff4dc`, `--sun #f6c343`, `--sunset #f28c28`, `--clay #c84b31`).
  - Shrikhand lettering, **converted to outlines**. OFL-1.1 allows this; note it in `LICENSES.md`.
  - A sunset-stripe disc, a pine and a small flag.
  - The sticker treatment: a thick ink outline and a hard drop shadow.
  - Reuse shapes from `drive/apps/web/src/ui/art.ts` `TITLE_SCENE`.
- **Two variants:** the full wordmark, and a compact square mark for the flag cloth and the tee signs.
- **Stop point:** render both at a few sizes, show them to the user, and **wait for approval** before wiring anything.
- **Then:**
  - Turrets' title wordmark uses the full mark, with TURRETS kept as the banner.
  - Free drive's menu wordmark uses it too.
  - `drive/PRD.md` around line 325 still says the real club's name and logo are allowed; correct it.
- **Smoke check:** one Vitest file asserting that the SVG parses, has a `viewBox`, and contains no `<text>` (outlines only).

## 4. PR 2: hole flags and tee signs in free drive

The data is already loaded but nothing uses it.
- `level.holes` (`drive/apps/web/src/level/loadLevel.ts`) holds `{ number, par, tee, green, pin }` for each of the 18 holes.
- `pin` equals the green centre on every hole.
- Ground height comes from `level/heightSampler.ts`.
- Free drive has no 3D text, no wind system and no flag today.

### 4.1 Flag: `drive/apps/web/src/env/holeFlags.ts`

- **Pole:** about 4 m tall, radius 0.04, white, with a ferrule band.
- **Cloth:** 1.6 × 1.1 m, a `PlaneGeometry` of about 16 × 8 segments, hung from the pole's top.
- **Wave:** a TSL `positionNode` driven by `time`.
  - The displacement grows toward the free edge, with a small amplitude (about 0.12 m) and a gentle rate.
  - Pattern references: `env/oceanWaves.ts` and `fx/skidMarks.ts`.
  - Design reference: `src/entities/Flagstick.ts` (pennant wave and `setFelled`). Port the idea, not its WebGL code.
  - Do not add a wind system.
- **Cloth face:** one `CanvasTexture` atlas for all 18 holes, built the way `src/render/teeSigns.ts` builds its atlas.
  - Each cell holds the compact logo, a large hole number in Shrikhand, and "PAR p" in Rubik.
  - Draw only after `document.fonts.ready`.
  - The cloth is two-sided and the number reads the right way round from both sides.
- **Draw cost:** instance or merge so the 18 flags cost about 3 draws in total.
- **Knock-over:**
  - Each step, a proximity check against the cart: within pole reach and moving faster than about 1 m/s.
  - The pole tips away from the cart over about 0.4 s and stands back up about 4 s later.
  - There is no collider, so the cart is never blocked or bounced.
- **Placement:** keep the flags clear of the spawn and the QA poses in `course.json`.

### 4.2 Tee sign: `drive/apps/web/src/env/teeSigns.ts`

- **Port:** `src/render/teeSigns.ts`, which has `teeSignLines` ("HOLE n / PAR p / N YDS") and the canvas atlas. Rebuild the frame with drive's node materials.
- **Yards:** the length of the hole's polyline in `paths.json` (`hNN-path`) where there is one, otherwise the straight tee-to-pin distance, converted from metres.
- **Placement:** beside the tee, facing down the hole (heading from tee to pin), offset so it is not on the cart path.

### 4.3 Wiring, smoke check, play-test

- **Wiring:** create both in the environment setup in `drive/apps/web/src/main.ts`, and dispose them when the level is torn down.
- **Smoke check:** one Vitest file, in Node with no renderer, covering:
  - 18 flags placed at their pins, standing on the ground;
  - the atlas lines for hole 7;
  - the fell and stand-up timing.
- **Play-test** at `/drive/?level=tee-time-links&mode=joyride`, each item 60 s or less:
  - read a hole number from about 60 m;
  - watch a cloth wave;
  - drive through a pin and watch it fall and stand up;
  - read a tee sign.

## 5. PR 3: the shared cart

### 5.1 Model, one source

- **Use the existing JSON.** `drive/` imports the root `src/entities/graphs/cart.json` and `driver.json` directly; there is no copy. They stay generated by `art/cart_v3_kit.py` and `art/rider_kit.py`.
- **New builder:** `drive/apps/web/src/vehicle/cartGraph.ts`, a WebGPU twin of `src/entities/primitiveGraph.ts`'s `buildGraph` and `drawBySlot`. It imports only from `three/webgpu`.
- **Never import `src/entities/primitiveGraph.ts` into drive.**
  - It imports `three` and the `three/examples` `RoundedBoxGeometry`, which would load a second three core beside `three/webgpu`.
  - Either port `RoundedBoxGeometry` into the builder (three.js is MIT; add a `NOTICE` line), or show that a Vite `resolve.alias` makes the addons resolve to `three/webgpu`.
- **Materials:** each slot becomes one `MeshStandardNodeMaterial`.
- **Parity test:** build both graphs in Node and compare node count, node names and bounding box, so the two builders cannot drift apart.
- **No turret:** hide it with `named.get("turret_pivot").visible = false`. The whole turret hangs under that node; the `bag_club_*` cylinders are scenery and stay.
- **Orientation:** the model faces +Z and drive faces −Z, so the root turns by π.
- **A new `CartView`** replaces the gray box behind the same `update(pos, quat, wheels)` call. Its wheel pivots steer and spin from the controller's `wheels()` data.

### 5.2 Wheels, in both games

- The four wheels (tyre and rim) become posed anchors in the graph build.
- **In `src/`:**
  - `GolfClub` gains `setWheels(spinRad, steerRad)`.
  - `scene.ts` integrates spin from the cart's speed (distance ÷ the 0.3 m radius) and steers from the cart's steer input. Render only.
- **Draw budget:** the draws-per-cart test caps a cart at 20, and posed wheels go over it. Either merge the four wheels into one instanced draw per cart, or raise the cap and record why in the commit.
- **The golden fingerprint must not move.**

### 5.3 Physics: drive's raycast vehicle with Turrets' numbers

- **Geometry** in `drive/apps/web/src/vehicle/cartTuning.ts` matches the model:
  - wheel radius 0.3 (was 0.24);
  - track 1.36 m (wheels at x ±0.68);
  - wheelbase about 1.54 m (z +0.78 and −0.76);
  - chassis box from `chassis_pan`, 1.26 × 2.2.
  - `setTuning` rejects geometry changes, so these are build-time values.
- **Joyride targets,** from `src/sim/entities/Cart.ts` `CART_TUNING`:
  - Top speed 20 m/s, reverse 7 m/s, acceleration about 16 m/s², braking about 24 m/s², coasting about 3.5 m/s².
  - At 300 kg that is about 4,800 N of drive force, with enough power to hold it up to about 15 m/s.
  - Set `maxForce`, `power`, `brakeForce` and the drag terms to match.
- **Boost:** goes above 20 m/s, to about 24 m/s. It keeps its 3 s duration and 6 s recharge.
- **Feel,** layered onto drive's drive force:
  - Throttle spool: 25% at once, full at 0.6 s. Throttle against the motion brakes, and braking is not spooled.
  - Turn bleed: −15% of the speed cap at full lock.
  - Downhill bonus, capped at 1.15×.
  - Steering response that matches Turrets' 2.4 rad/s heading rate at speed.
- **Surfaces:** keep drive's grip and drag table (`vehicle/surfaces.ts`). Do not port Turrets' mobility table.
- **Chill:** the same spool and steering feel, top speed still 6.7 m/s, no boost.
- **Tests to re-band** (`drive/apps/web/test/vehicle/`): `headlessDrive`, `joyrideTopSpeed`, `fullLockTurn`, `handbrakeDrift`, `forward` and `mischief`. New bands:
  - Joyride reaches 19–21 m/s;
  - the spool gives 25% at once and 100% by 0.6 s;
  - no rollover at full lock and top speed.
- **Camera and HUD:**
  - Joyride's FOV kick is rescaled to the new top speed (`camera/cameraConfig.ts`).
  - The speedometer's top rises from 35 mph to about 55 mph (`ui/uiConfig.ts`).
  - The chase framing stays drive's own, since there is no turret to follow.

### 5.4 Rider, paint, sound

- **Rider:** `driver.json` is built on the seat, as in Turrets, and stays rigid.
- **Paint:**
  - Choose Your Ride (`src/ui/screens/TitleScreen.ts`) gains a row of swatches.
  - The choice is saved in `localStorage`, with every read and write in try/catch.
  - It is passed as `&paint=<hex>` on the free-drive URL in `go()` (around line 190).
  - `drive/apps/web/src/core/settings.ts` reads it and sets the canopy slot, plus the matching shirt shade from `src/render/teamColors.ts`.
- **Sound:**
  - Port Turrets' `engine(speed01)` synth and the honk cue from `src/audio/audioEngine.ts` into `drive/apps/web/src/audio/cartAudio.ts`, keeping drive's surface sounds.
  - H honks. The gamepad honk goes on a free button; choose it and record it in `core/inputConfig.ts`.

### 5.5 Checks and play-test

- **Checks:**
  - the parity test;
  - the re-banded vehicle tests;
  - a wheel-pose test in `src/`;
  - `tsc` clean in both apps;
  - root `npm test` under 60 s;
  - `pnpm -r test` in `drive/`.
- **Play-test** at `/drive/?level=tee-time-links&mode=joyride`:
  - it looks like the Turrets cart without the turret;
  - it reaches about 45 mph, with boost above that;
  - drifts and flips still work;
  - the wheels spin and steer;
  - the paint chosen on the title carries over;
  - H honks.
- **Then a Turrets match at `?match=60`:** the wheels turn, and nothing else has changed.

## 6. Risks

- **A second three core.** Any `src/` module imported into drive that pulls in `three` loads a second copy. Share data only, build with the WebGPU twin, and let the parity test catch drift.
- **20 m/s on a raycast vehicle** may roll at full lock. Tune the centre of mass, the rear grip and drive's rollover assist before lowering the speed, and **ask the user before going below 20**.
- **Turrets' draw budget** once the wheels are posed (§5.2).
- **John's M2 approval** is still open on routing. None of this touches routing.

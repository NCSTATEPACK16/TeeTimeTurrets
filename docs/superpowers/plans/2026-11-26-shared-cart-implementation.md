# One cart in both games (PR 3): Implementation Plan

**Goal:** Chill and Joyride drive the Turrets cart, without its turret. It has the rider in the
seat, paint chosen on the title, Turrets' engine and horn, and wheels that spin and steer in both
games. Free drive keeps its raycast vehicle, retuned to Turrets' numbers: Joyride reaches 20 m/s,
and boost goes above it.

**Spec:** `docs/superpowers/specs/2026-11-25-shared-cart-and-hole-flags-design.md` §5. Its
decisions are the user's. Ask only if the code contradicts the spec.

**State:**
- PR 1 (the logo) merged as #95 and PR 2 (flags and tee signs) as #96. This is PR 3.
- Free drive still draws the gray-box placeholder, `drive/apps/web/src/vehicle/CartView.ts`. The
  user noticed it on 26 Nov.
- This plan was written that day from a read of the code and saved for a fresh session.

**Decided by the user on 26 Nov:**
- **Turrets' wheels steer from the turn rate.** The renderer never receives a steer input.
  `CartTransform` (`src/sim/world.ts`) carries only `position`, `heading` and `turretYaw`, and the
  bots' intents stay inside the sim.
- So `scene.ts` derives the steer angle as `atan(wheelbase × yaw rate ÷ speed)` from the heading
  change between frames, clamped to the lock and zeroed below a crawl.
- This works the same for the player and all 7 bots, and nothing under `src/sim/` changes.

## Global constraints

- **Never import a `src/` module that imports `three` into `drive/`.** It loads a second three
  core beside `three/webgpu`. Share data only (the graph JSON, `teamColors.ts`, which has no
  imports) and build with drive's own code. `src/entities/primitiveGraph.ts` imports `three` and
  `three/examples`, so it is off limits.
- **Turrets changes are render only.** The golden fingerprint (`src/sim/arenaGolden.test.ts`)
  must not move. A cloud session is Linux x64 and can check it directly.
- **Do not lower Joyride below 20 m/s** without asking. If it rolls at full lock, tune the centre
  of mass, the rear grip and the rollover assist first.
- **Root `npm test` already runs 55–60 s** in a cloud container, against a 60 s cap. Put new tests
  in `drive/` where possible, and keep the `src/` addition to one small case. If root goes over
  60 s, trim the slowest file (AGENTS.md).
- Commit with `git commit -s` and stage files by name. No AI or session metadata.
- See every new check fail once by breaking what it guards, and read the red line
  (`docs/TEST-AND-SPEC-PITFALLS.md`).

## Facts from the code (26 Nov)

- **Turrets' cart class is `GolfClub`** (`src/entities/GolfClub.ts`; the turret's barrel is a golf
  club). `buildGraph` builds the rig. `drawBySlot(CART_GRAPH, graph, POSED_NODES)` draws one mesh
  per slot per posed part, and the rider is drawn the same way with nothing posed.
- **`GolfClub.test.ts:416`** caps a riding, loaded cart at 20 drawn meshes.
- **`cart.json`** has 52 nodes, using `rbox`, `cylinder`, `torus`, `sphere`, `box` and `prism`.
  **`driver.json`** has 26, using `box`, `cylinder`, `sphere` and `capsule`.
- **Cart slots:** canopy, chassis, club_bag, frame, rims, seats, tires, turret_barrel and
  turret_housing.
- **Wheels:** `wheel_fl`, `wheel_fr`, `wheel_rl` and `wheel_rr` are cylinders under `chassis_pan`,
  each with a `rim_*` child. They sit at x ±0.68, z +0.78 and −0.76, with the centre 0.3 m above
  the ground.
- **The turret** hangs entirely under `turret_pivot`. The `bag_club_*` cylinders under `bag` are
  scenery.
- **The model faces +Z; drive's chassis faces −Z** (front wheels at z = −wheelbase/2,
  `RapierCart` mounts in order FL, FR, RL, RR). After turning the root by π, Blender's `_fl`
  lands on drive's other side, so **map the wheels by position, not by name.**
- **Drive's current geometry** (`cartTuning.ts`): wheel radius 0.24, wheelbase 1.66, track
  0.91 / 1.02, body half-extents 0.6 × 0.3 × 1.2. `setTuning` rejects geometry changes, so new
  geometry is a build-time value.
- **Turrets' `CART_TUNING`** (`src/sim/entities/Cart.ts`):
  - top speed 20 m/s, reverse 7 m/s;
  - accel 16 m/s², brake 24 m/s², coast 3.5 m/s²;
  - `steerRate` 2.4 rad/s at `steerFullSpeed` 8 m/s;
  - spool 0.25 at once, full at 0.6 s;
  - `turnBleed` 0.15;
  - `downhillPerGrade` 1.0, `downhillMaxScale` 1.15;
  - `overspeedDecel` 8.
- **Audio:** Turrets' engine is `engine(speed01)` (two detuned oscillators through a lowpass) and
  the H-key honk is the `honk` cue in `src/audio/audioEngine.ts`. Drive's sound is
  `drive/apps/web/src/audio/cartAudio.ts`.
- **Gamepad buttons** in drive's `core/inputConfig.ts`:
  - driving uses 0, 3, 5, 6, 7 and 8;
  - menus use 0, 1, 9, 14 and 15;
  - **2 (X / Square) is free.**
- **The free-drive URL** is built by `freeDriveUrl` in `src/ui/title/titleConfig.ts` and used in
  `TitleScreen.go()`.
- **Team colours** are in `src/render/teamColors.ts`: canopy 0x2f7be0 / 0xf07a1a and shirt
  0x2560b8 / 0xc85f12.
- **The dev-server allow-list** in `drive/apps/web/vite.config.ts` already covers
  `src/entities/graphs/` (added in #96).
- **three 0.186 applies instancing before `positionNode`**, so `positionLocal` and `normalLocal` are
  already placed (learned in #96).
- **`env/colouredGeometry.ts` (`mergeColoured`)** merges indexed parts with vertex colours.

## Task 1: the model, one source (§5.1)

- **`drive/apps/web/src/vehicle/roundedBox.ts`** ports three's `RoundedBoxGeometry` (MIT),
  importing only `three/webgpu`. Add a `NOTICE` entry in the same commit: it is code from another
  project. Don't alias `three` to `three/webgpu`, because that risks `three/tsl` internals and the
  Node tests.
- **`drive/apps/web/src/vehicle/cartGraph.ts`** is the WebGPU twin of `buildGraph` and
  `drawBySlot`:
  - **Kinds:** all eight, with the same parameter order. `rbox` and `prism` get the same
    sequential index, and the same radius and point checks.
  - **Materials:** one `MeshStandardNodeMaterial` per slot. It keeps `named`, `setSlotColor` and
    `dispose`.
  - **Merging:** `drawBySlot` merges each node into its nearest posed ancestor, by slot. It uses a
    local indexed merge, not `BufferGeometryUtils`, which imports `three`.
  - **Data:** it imports `src/entities/graphs/cart.json` and `driver.json` as data.
- **A new `CartView`**, behind the same `update(pos, quat, wheels)` call:
  - **Builds:** the cart and the rider, rigid on the seat.
  - **Hides:** `turret_pivot` (`visible = false`).
  - **Turns:** the root by π.
  - **Offsets:** the root, so the model's wheel centres sit on drive's mounts at rest.
  - **Wheels:** posed anchors, mapped by position. Each frame:
    - the quaternion is `steer(Y) · rest · spin(the cylinder's axis)`;
    - the height follows the suspension by `restLength − suspensionLength`.

    No allocation per frame.
  - **Paint:** `setPaint(canopy, shirt)`.
  - **Clean-up:** delete the gray-box colours in `envConfig.cart` once nothing reads them.

## Task 2: the physics retune (§5.3), every number in `cartTuning.ts`

- **Geometry, both modes:**
  - wheel radius 0.3;
  - track 1.36;
  - wheelbase 1.54;
  - body half-width 0.63 and half-length 1.1 (`chassis_pan`, 1.26 × 2.2);
  - `hardpointY` and `restLength` re-derived so the chassis rides at the model's height.
- **Joyride:**
  - top speed 20, reverse 7;
  - `maxForce` about 4,800 N (16 m/s² at 300 kg);
  - `power` about 72 kW, which holds full force to 15 m/s;
  - brake about 7,200 N;
  - `coastForce` about 1,050 N less drag;
  - boost to about 24 m/s, keeping 3 s and 6 s.
- **Chill:** stays at 6.7 m/s with no boost.
- **Feel, in `RapierCart.update`'s drive force,** with new `CartTuning` fields for both modes:
  - **Spool:** 25% at once and full at 0.6 s. It restarts when the throttle's sign changes or it
    reaches 0. Throttle against the motion brakes, and braking is not spooled.
  - **Turn bleed:** −15% of the speed cap at full lock.
  - **Downhill bonus:** 1.0 per unit of grade, capped at 1.15×.
- **Steering:**
  - Aim for 2.4 rad/s of heading up to 8 m/s; above that, tyre grip limits it.
  - At 20 m/s, 2.4 rad/s would need about 4.9 g, which a tilting raycast car rolls or slides out
    of. Say so in the code and the PR.
- **Unchanged:** `surfaces.ts`.
- **Camera and HUD:**
  - Joyride's FOV kick is rescaled to the new top speed (`camera/cameraConfig.ts`).
  - The speedometer's top goes to about 55 mph (`ui/uiConfig.ts`).

## Task 3: paint (§5.4)

- **The swatch table:** one shared table of canopy and shirt pairs in `src/render/teamColors.ts`,
  pure data. It holds blue and orange (the team pairs) plus pine, sun and clay from Clubhouse
  Sunset, each with a darker shirt shade.
- **The swatch row:** Choose Your Ride (`src/ui/screens/TitleScreen.ts`) gains one. The choice is
  kept in `localStorage`, with every read and write in try/catch.
- **The URL:** `freeDriveUrl` adds `&paint=<hex>`.
- **Drive's side:** `core/settings.ts` reads `paint` and accepts only a hex in the table, and
  `main.ts` calls `cartView.setPaint`.

## Task 4: sound (§5.4)

- **Engine:** port `engine(speed01)` into `cartAudio.ts`, replacing drive's engine. Keep its
  surface sounds.
- **Honk:** port the `honk` cue too.
- **Bindings:** H, and gamepad button 2, recorded in `core/inputConfig.ts`.
- **NOTICE:** none needed; this is a port within the repo.

## Task 5: wheels in Turrets (§5.2), render only

- **`GolfClub.setWheels(spinRad, steerRad)`:** the wheel nodes join `POSED_NODES`, posed by the
  same quaternion composition as Task 1.
- **`scene.ts`** keeps each cart's previous position and heading in scratch fields:
  - spin increases by the signed distance along the heading ÷ 0.3;
  - steer is derived from the turn rate (above).
- **The draw budget:** measure `drawn(cart)` first.
  - Prefer one tyre and one rim `InstancedMesh` per cart (four instances each, on the slot's own
    material) if that keeps the cart at 20 or fewer.
  - Otherwise raise the cap and record why in the commit.
- **The golden must not move.**

## Checks

- **Parity:** `drive/apps/web/test/vehicle/cartGraphParity.test.ts` builds both builders' cart and
  driver graphs in Node and compares node count, names and bounding boxes. See it fail: drop a
  node, and change an rbox radius.
- **Re-banded vehicle tests:** `headlessDrive`, `joyrideTopSpeed`, `fullLockTurn`,
  `handbrakeDrift`, `forward` and `mischief`, in `drive/apps/web/test/vehicle/`. The new bands:
  - Joyride reaches 19–21 m/s;
  - the spool gives 25% at once and 100% by 0.6 s;
  - no rollover at full lock and top speed;
  - boost reaches about 24 m/s.
- **Wheel pose:** one case in `src/entities/GolfClub.test.ts`.
- **Clean and passing:**
  - `tsc` in both apps;
  - root `npm test` under 60 s;
  - `pnpm -r typecheck`, `pnpm -r lint` and `pnpm -r test` in `drive/`;
  - the golden unchanged.
- **Headless:** screenshots through the dev server at `?view=…`. WebGPU has no adapter in the
  container, so three falls back to WebGL2 at about 1 frame a second. Compare against a `main`
  worktree before calling anything a regression.

## Finish

- Push, and open a **draft** PR containing the check outputs, the screenshots and the play-test
  list.
- **Play-test at `/drive/?level=tee-time-links&mode=joyride`:**
  - it looks like the Turrets cart, without the turret;
  - it reaches about 45 mph, with boost above that;
  - drifts and flips still work;
  - the wheels spin and steer;
  - the paint chosen on the title carries over;
  - H honks.
- **Then a Turrets match at `?match=60`:** the wheels turn, and nothing else has changed.
- Update `docs/HANDOFF.md`, `docs/SPEC-QUEUE.md` and prompt D. Then **STOP**.

# Next-session prompts

Written 2026-11-23, after slice C of the Caswell look (pine straw and grass tufts, #92) was play-tested and merged. Four prompts follow. Paste the one that fits into a fresh Claude Code session; each stands alone.

- **A. Slice D, loblolly pines.** The next thing to build. **Local only:** it needs Blender and the Blender MCP on the Mac.
- **B. The 3.5c spec (mortar and capture flags).** For a cloud session when no Blender session is to hand. It writes a spec and stops for the user's answers; it builds nothing. **Done 27 Nov:** the spec (`docs/superpowers/specs/2026-11-27-mortar-and-capture-flags-design.md`) is answered, every default stands, and the plan is `docs/superpowers/plans/2026-11-27-mortar-and-capture-flags-implementation.md`. **Slice 1, the flags, is built as draft #100** (27 Nov) and waits on the play-test. A session picking this up addresses that play-test's notes on #100; after #100 merges, it builds slice 2 (the player's mortar) from the plan, starting at Task 0.
- **C. Stage 4b, iOS and gamepad.** After 3.5c. Written on 7 Nov and still current.
- **D. One cart in both games, and hole flags in free drive.** Added 25 Nov at the user's request. Three PRs, run one per session in order: the logo, then the flags and tee signs, then the shared cart. It runs in the cloud and is independent of A–C.
  - **PR 1, the logo, merged as #95** (26 Nov). **PR 2, flags and tee signs, merged as #96** (26 Nov). **PR 3, the shared cart, merged as #98** (27 Nov). **Prompt D is done.**

---

## A. Slice D of the Caswell look: loblolly pines (local, Blender)

> You are building **slice D** of the Caswell look for TeeTimeTurrets, a browser golf-combat game (three.js, Rapier, TypeScript). Slices A, B and C are merged (#90, #91, #92). This slice replaces the stacked-cone stand-in conifer with a **loblolly pine** species, so the woods read as a Carolina Piedmont pine course. It is render only: no file under `src/sim/**` or `src/physics/**` changes, and the golden fingerprint must not move.
>
> **This needs Blender.** Run it on the Mac, with Blender open and the Blender MCP connected (`execute_blender_code`, `get_scene_info`, `get_viewport_screenshot`). If those tools are not available, stop and say so. Do not hand-write the species into `trees.json`.
>
> ### Where to work
> Branch from the latest `main`. Use a worktree `../TeeTimeTurrets-pines` and run `npm ci`. Commit with `git commit -s` on every commit. Put no AI or session metadata in commits, PR titles or bodies. Stage files by name, never `git add -A`: the main checkout carries an untracked `.scratch/`.
>
> ### Read first, in this order
> 1. `AGENTS.md`: one smoke check of 15 s or less per change, `npm test` under 60 s, and play-test items at `?match=60`.
> 2. `docs/HANDOFF.md`. Read the slice C section, "The direction" (Blender authors primitive-graph JSON only, and the kit script is the source) and **"Traps"**. The Blender traps there have each cost a session before:
>    - Unhide every collection before export. Hidden collections export every node at the origin.
>    - Run the build in a separate `execute_blender_code` call after `read_homefile`.
>    - Three (x, y, z) is Blender (x, −z, y).
>    - Call `view_layer.update()` before reading matrices.
> 3. `docs/superpowers/specs/2026-11-15-caswell-look-and-grass-detail-design.md` §3.9 (the species) and `docs/superpowers/plans/2026-11-15-caswell-look-and-grass-detail-implementation.md`, Task 7 and Task 8.
> 4. `docs/art/specs/stage5/trees.md`: the contract the existing species follow (unit height, slot names, how `Trees.ts` scales and colours them). The new species goes in this file.
> 5. `art/stage5_kit.py` (collection `trees`) and `art/kit_common.py`: where the species are authored and exported to `src/entities/graphs/trees.json`.
>
> ### What to build (plan Task 7)
> - **The species `pine_loblolly`**, at unit height.
>   - Trunk: a tapered cylinder to 0.58 of the height, radius 0.035 at the base.
>   - Crown: three masses (flattened spheres, or short wide cones with rounded tops) at heights 0.62, 0.78 and 0.92, radii 0.20, 0.17 and 0.11. Set each a few percent off-axis, so the crown is irregular.
>   - Slots `tree_trunk`, `tree_foliage_dark` and `tree_foliage_light`; the top mass is light.
>   - Budget: 220 triangles after `smoothedGraph` in `Trees.ts`, which raises cone, cylinder and sphere segment counts. Count after that, not in Blender.
>   - Proportions: GolfCartSimulator's stand-in pine is 12 m tall, with a 0.18 m trunk radius and a 2.1 m crown radius.
> - **Write the spec first** into `docs/art/specs/stage5/trees.md`. Then author the species in `art/stage5_kit.py`. Rebuild from an empty file, export, and check `git diff --stat src/entities/graphs/` shows **only** `trees.json`.
> - **Wiring:**
>   - `src/entities/envGraphs.ts`: `TREE_SPECIES.conifer = ["pine_loblolly", "broadleaf_oak"]`. `conifer_tall` stays in `trees.json` for the title backdrop.
>   - `src/render/biomes.ts`: `treeHeight` 14, 14, 12 for the three variations. No test pins the heights today; `woodsDensity.test.ts` and `Trees.test.ts` are the ones they can move.
>   - `PURE_CONIFER_SHARE` in `woodsPlacement.ts` stays 0.8.
> - **Wind:** `SWAY_AMPLITUDE` in `Trees.ts` bends by height squared, so a 14 m crown moves about 0.3 m. If that looks like rubber, halve it for species taller than 10 m.
> - **Smoke check:** extend the colour-bake test in `Trees.test.ts` to the new species, and assert its merged triangle count is under 260. See it fail first.
>
> ### Knock-ons from slice C (check each; they are why this prompt is long)
> - **Straw grows with the trees.** `stampRadius` in `woodsPlacement.ts` is `1.6 × MIN_SPACING_M + 0.25 × height`. Going from about 10 m to 14 m widens every straw patch by about 1 m. Run `woodsDensity.test.ts`: the mean must stay between 0.03 and 0.25, and fairway centrelines must stay at 0. If straw reaches too far, lower the 0.25 rather than the test.
> - **Tufts** thin under the woods from the same density (`grassCells.ts`, `MAX_WOODS` 0.5). Taller trees mean fewer tufts beside the woods. That is expected; say so in the PR.
> - **Tree counts and caps.** Placement does not depend on height, so the count stays 2,564 and Med's `treeCap` stays 2,750. The triangle count does change: (new triangles − old) × 2,564 is the per-frame cost. Compute it and put it in the PR.
> - **Shadows.** 14 m trees cast longer shadows. Med's single shadow map (`shadows.ts`, `SINGLE_HALF_EXTENT_M`) may now clip shadows near its edge. Look for it.
> - **The treeline beyond the road** (`treeline.ts`) plants the biome's same two species through `plantTrees`, so it changes too. Check it still reads as a band and does not tower over the course edge.
> - **Sight lines.** Taller trees with high crowns should let you see under them to the next fairway. Check that crowns do not cover the chase camera's view of your own cart.
>
> ### Verify
> - `npx tsc --noEmit` is clean, and `npm test` passes in under 60 s. The golden must not change. If `arenaGolden.test.ts` moves, something reached the sim: stop and find it.
> - Look at it in the real game in the browser (`npm run dev`, `?match=60`) on Med and High, on this Mac's GPU. Record Med's frame time and draw calls from the perf overlay before and after. Slice C's tufts and the pond shader have never been measured on a real GPU, so this is the first real number for the whole look. Put it in the PR.
>
> ### Finish (plan Task 8)
> - Push, and open a **draft** PR with: what changed, the deviations, the checks with outputs, the perf numbers, and a play-test list of items 60 s or less at `?match=60`:
>   - Do the woods read as tall pines?
>   - Can you see under the crowns to the next fairway?
>   - Does the treeline beyond the road match?
>   - Do trees hide the camera's view of your own cart?
>   - Is the straw still where the trees are, and no wider?
>   - Is Med still smooth?
> - Rewrite `docs/HANDOFF.md` for slice D. In `docs/SPEC-QUEUE.md`, mark the Caswell look done once D merges. In `docs/DECISIONS.md`, add one entry if a decision was made.
> - **Then stop and wait for the user's play-test. Do not merge.**

---

## B. Spec for Stage 3.5c: mortar and capture flags (cloud)

> You are writing the **spec** for Stage 3.5c of TeeTimeTurrets, a browser golf-combat game (three.js, Rapier, TypeScript): a mortar as a 3-kill streak reward, and capture flags on three greens. **Write the spec and stop. Build nothing.** The user answers the open questions before any code is written.
>
> ### Read first
> - `AGENTS.md` and `docs/TEST-AND-SPEC-PITFALLS.md`. The pitfalls file is about specs as much as tests.
> - `docs/SPEC-QUEUE.md`, item 1 under "Needs a spec": the list of what is missing.
> - `docs/REVAMP-PLAN.md`, the 3.5 section: the six lines of rules the plan gives.
> - `docs/DECISIONS.md`, "Stage 3.5: a countdown, and arena rules that grow capture flags and a mortar", and "The golden fingerprint is Linux x64's".
> - `docs/UI-SPEC.md`, for the HUD and map elements.
> - The code the spec will touch: `src/sim/combat.ts`, `src/sim/arena.ts`, `src/sim/arenaZone.ts`, `src/sim/bot.ts`, `src/sim/events.ts`, `src/sim/stats.ts`, the ball pool, and the HUD under `src/ui/`. Read enough to name exact functions and constants, not to change them.
> - Two earlier specs in `docs/superpowers/specs/` as models of the format, for example `2026-09-12-stage-d-pickups-design.md` and `2026-11-15-caswell-look-and-grass-detail-design.md`.
>
> ### What the spec must settle
> Everything in SPEC-QUEUE item 1:
> - **Mortar:** how the owner aims it, the telegraph (what the target sees, and for how long), the barrage's seeded spread, damage per ball, whether it uses the ball pool, and what a bot does with one.
> - **Flags:** which three greens, capture state per flag, how "contested" is counted, how the stroke bleed joins the existing stroke scoring and the match end, and the events the HUD and audio hear.
> - **Bots:** when they go for a flag instead of a target. Stage 6's routing does not exist yet, so say what they do without it.
> - **HUD and map elements**, against `UI-SPEC.md`.
> - **The golden:** it moves once. Say which commit records it, and that it is recorded from Linux x64.
>
> Give every open question a default, in a "Questions for the user" table, so the build can start the moment the user answers. Split the build into slices, each ending at a play-test stop, as the Caswell plan does. Each slice's smoke check must be 15 s or less.
>
> ### Finish
> Commit the spec as `docs/superpowers/specs/<date>-mortar-and-capture-flags-design.md` with `git commit -s`, and no AI or session metadata. Update `docs/SPEC-QUEUE.md` to point to it. Push, open a draft PR containing only the spec, list the questions in the PR body, and **stop for the user's answers.**

---

## C. Stage 4b: iOS and gamepad (cloud first, then Xcode on the Mac)

> You are building **Stage 4b** of TeeTimeTurrets, a browser golf-combat game (three.js, Rapier, TypeScript): a gamepad on the web, then a Capacitor iOS shell for TestFlight, plus KTX2 terrain textures and a CI size budget. The design is decided in `docs/superpowers/specs/2026-11-07-ios-gamepad-and-asset-adoption-design.md`, and `docs/REVAMP-PLAN.md` § Stage 4b summarises it. **Those are user decisions; do not relitigate them.** Build it, and ask only if a fact in the code contradicts the spec.
>
> ### Where to work
> Work on a new branch **`stage-4b-ios-gamepad`** from `origin/main`. Stage 4 (PR #88) must be merged first; if it isn't, stop and ask. Locally, use a worktree `../TeeTimeTurrets-stage4b` and run `npm ci`. Never commit the main checkout's untracked `.scratch/` or `tools/zzshots.mjs`.
>
> ### Read first
> - `AGENTS.md`, including the testing policy: one smoke check of 15 s or less per change, every automated check under 60 s, and the user play-tests at `?match=60`.
> - `docs/HANDOFF.md`, especially "Next: Stage 4b", which lists what Stage 4 changed that this stage must respect.
> - The spec, in full.
> - `docs/ARCHITECTURE.md` on input sources, and `src/input/` (`InputSource.ts`, `KeyboardMouseSource.ts`, `mapping.ts` and its test).
> - `docs/TEST-AND-SPEC-PITFALLS.md`.
>
> ### What Stage 4 left that bears on this
> - **The throttle spools** (`CART_TUNING.spoolInstant`/`spoolSeconds`): 25% of the drive is instant, and the rest ramps in over 0.6 s. The spool restarts whenever the throttle's sign changes or it reaches 0. A stick that jitters around its centre would keep restarting it, so the left stick's deadzone must emit an exact 0, not small noise.
> - **The chase camera is off-centre:** 0.7 m to the turret's right (`CHASE_SIDE` in `src/render/chaseCamera.ts`). The screen centre is not the turret line. Aim assist must measure an enemy's angle from the turret's yaw (`CartTransform.turretYaw`), not from the screen centre.
> - **`MatchScreen` was not changed by Stage 4.** The pause on pointer-lock loss is at `MatchScreen.ts:122`. The out-of-zone warning is a HUD element inside `#hud` (`hudState.zoneWarning`), not a screen, so it needs no controller focus.
>
> ### The slices, in this order (one commit or more each)
> 1. **`GamepadSource` (web).**
>    - Build it on the "shooter" layout in spec §2.1, read through a binding table that is a pure function of the button and axis state, the way `intentFromKeys` is for keys.
>    - Left stick: Y is throttle and X is steer, with a radial deadzone that outputs an exact 0.
>    - Right stick: X is turret yaw rate, with a deadzone and a response curve of exponent about 2, peaking near 1.6 rad/s.
>    - `PlayerIntent` does not change. If it seems to need to, stop and raise it.
>    - The smoke check is a Vitest file for the mapping. It must cover the deadzone's exact 0.
> 2. **Input-aware pause.** Pointer-lock loss pauses the match only while keyboard and mouse is the active input.
> 3. **Menu focus navigation and glyphs** on every DOM screen: title, clubhouse/loadout, settings, results and pause.
>    - The D-pad and left stick move focus. A confirms, B goes back, and the focus ring is visible.
>    - Glyphs follow the last input used.
>    - Focus movement is a pure function with one Vitest check.
> 4. **Aim assist.** It lives on the render or input side, and it only scales `aimDelta`, measured from the turret's yaw. It is off for keyboard and mouse. The golden must not move. Show that it doesn't.
> 5. **KTX2 conversion and the size budget.**
>    - A script converts `public/textures/terrain/` to KTX2: UASTC for normal maps, ETC1S for colour and roughness.
>    - Keep the CC0 sources out of the shipped `public/`.
>    - Write `docs/ASSET_BUDGETS.md`, and add a check under 15 s that fails when `dist/` is over budget, or any single file is over 5 MB.
>    - If `toktx` is not available where you are, say so and leave the script runnable for the user.
> 6. **Capacitor iOS shell.**
>    - The project, a "Connect a controller" screen, and the 120/60 governor (spec §3). The governor must allocate nothing per frame.
>    - The Xcode and TestFlight steps run on the user's Mac. Produce the project and step-by-step instructions, and don't claim anything about a device you have not seen.
> 7. **Headless Blender CLI and one CC0 HDRI**, last. Neither blocks iOS. The CLI's export must be byte-identical: `git diff --stat src/entities/graphs/` must come back empty. Record the HDRI in `LICENSES.md`.
>
> ### The golden fingerprint
> Nothing in this stage should move it: input, render and tooling only. If it moves, find out why before going on. It is Linux x64's (`docs/DECISIONS.md`). A cloud session is Linux x64 and can check it directly; on the Mac, show that the Mac's value is unchanged instead.
>
> ### CI runs Node 22
> Before you call a slice done, run `npm test` and `npx -y node@22 node_modules/vitest/vitest.mjs run tools/simAllocation.test.mjs`.
>
> ### Rules
> - Use `git commit -s` on every commit, including merges. Put no AI metadata in git, and stage files by name.
> - Keep `src/sim/**` and `src/physics/**` free of `three` and DOM imports. Aim assist and the governor must not reach into either.
> - **See every new smoke check fail once** (break the thing, watch it go red, restore it) before you trust it. Read the red line: the turn-bleed check in Stage 4 first passed with the bleed set to 0, because its expected value read the same constant.
> - Push the branch and open a draft PR to `main`. Put the check outputs in it, plus a play-test list with each item 60 s or less at `?match=60`:
>   - drive, aim, charge-fire, cancel and cycle clubs on the pad;
>   - title → loadout → match → results with the pad only;
>   - on iPhone, two matches back to back, watching the governor.
> - Mark each spec §6 VERIFY item as verified, or still open with the reason.
> - Rewrite `docs/HANDOFF.md` and this file. Then **STOP** for the user's play-test. Don't merge, and don't start Stage 5.

---

## D. One cart in both games, and hole flags in free drive (cloud, three PRs)

> You are building one PR of **the shared cart and hole flags** for TeeTimeTurrets: Turrets (the arena game, `src/`: three 0.185 WebGL, Rapier 0.20) and free drive (Chill and Joyride, `drive/`: its own pnpm workspace, three 0.186 WebGPU, Rapier 0.21). The design is decided in `docs/superpowers/specs/2026-11-25-shared-cart-and-hole-flags-design.md`. **Those are user decisions; do not relitigate them.** Build the next unbuilt PR from its §3–§5, in this order, and only that one:
> 1. **PR 1, the Tee Time Links logo** (§3). It has a stop point in the middle: render the SVG variants and **wait for the user's approval** before wiring anything.
> 2. **PR 2, hole flags and tee signs in free drive** (§4).
> 3. **PR 3, the shared cart** (§5).
>
> Check `main` and the open PRs to see which ones are done. If the previous PR is not merged, stop and ask.
>
> ### Where to work
> Branch from the latest `origin/main`. Run `npm ci` at the root, and `pnpm install` in `drive/` for PRs 2 and 3. Commit with `git commit -s` on every commit. Put no AI or session metadata in commits, PR titles or bodies. Stage files by name, never `git add -A`.
>
> ### Read first
> - `AGENTS.md`: the testing policy (one smoke check of 15 s or less per change, `npm test` under 60 s), the licence split, and the `NOTICE` rule for ported code.
> - `drive/CLAUDE.md`:
>   - free drive's rules: shaders are TSL only;
>   - every tunable goes in `cartTuning.ts` or `surfaces.ts`;
>   - Rapier is pinned;
>   - physics runs headless in Node.
> - `docs/DECISIONS.md`, "Free drive lives in drive/", and `drive/docs/handoff/M2.md`, Part F ("Joyride is driving only").
> - The spec, in full, and `docs/TEST-AND-SPEC-PITFALLS.md` before writing a test.
>
> ### Rules that bite
> - **Never import a `src/` module that imports `three` into `drive/`.** It loads a second three core beside `three/webgpu`. Share data (the graph JSON, the SVG) and build it with drive's own code.
> - **PR 3 touches `src/` for the wheels only, and render only.** The golden fingerprint must not move. A cloud session is Linux x64 and can check it directly (`src/sim/arenaGolden.test.ts`).
> - **Do not lower Joyride below 20 m/s** without asking. If it rolls at full lock, tune the centre of mass, the rear grip and the rollover assist first.
> - **See every new smoke check fail once** (break the thing, watch it go red, restore it) before you trust it.
> - **Headless browser checks are unusable in a cloud container,** which renders at about one frame a second. Don't treat their failures as regressions without comparing against a `main` worktree in the same container.
>
> ### Finish
> - Run `tsc` (root, and `drive/` for PRs 2 and 3), root `npm test`, and for PRs 2 and 3 `pnpm -r test` in `drive/`.
> - Push and open a draft PR to `main` containing:
>   - the check outputs;
>   - the spec's play-test list for that PR, each item 60 s or less.
> - Update `docs/HANDOFF.md`, `docs/SPEC-QUEUE.md` and this prompt's list of which PR is next. Then **STOP** for the user's play-test.

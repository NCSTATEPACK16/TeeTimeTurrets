# Next-session prompt

Written 2026-10-04, after #84 and #85 merged. The next session is **Stage 4**, and it can run locally or in the cloud. Paste the quoted block below into a fresh Claude Code session; it stands alone. The clubhouse and barn v3 prompt that preceded it is done, so it has been removed; its record is `docs/art/specs/clubhouse.md` and `team-barn.md`, "As built, v3".

---

## Stage 4: handling feel and arena zone (local or cloud)

> You are building **Stage 4** of TeeTimeTurrets, a browser golf-combat game (three.js, Rapier, TypeScript): issues **#49–#53**, milestone "Stage 4". The design is decided in `docs/REVAMP-PLAN.md` § Stage 4. Build it, and ask only if a fact in the code contradicts the plan.
>
> ### Where to work
> Work on a new branch **`stage-4-handling-zone`** from `origin/main`, which includes #84 and #85 (the clubhouse and barn v3 art, and a CI fix). Locally, use a worktree `../TeeTimeTurrets-stage4` and run `npm ci`. Never commit the main checkout's untracked `.scratch/` or `tools/zzshots.mjs`.
>
> ### Read first
> - `AGENTS.md`, including the testing policy: one smoke check of 15 s or less per change, every automated check under 60 s, and the user play-tests at `?match=60`.
> - `docs/HANDOFF.md`
> - `docs/REVAMP-PLAN.md` § Stage 4
> - `docs/DECISIONS.md`, "The golden fingerprint is Linux x64's"
> - `docs/TEST-AND-SPEC-PITFALLS.md`
> - Then each issue: `gh issue view 49` through `53`.
>
> ### The slices, in this order (one commit or more each; close each issue from the PR with `Closes #n`)
> 1. **#49, mobility table:**
>    - Write `src/sim/mobility.ts`, wrapping `src/vendor/cot/terrainMobility.ts`. This is MIT-licensed; keep the `NOTICE` entry current.
>    - Map each `SurfaceId` to a resistance and grip, with tyres feeding grip.
>    - The max climb comes from accel × grip and replaces the flat `CART_MAX_SLOPE_CLIMB_DEG` in the KCC climb check.
>    - Speed scale comes from resistance.
>    - The tests are the plan's three cases.
> 2. **#50, cart feel** in `Cart.ts`, every value in `CART_TUNING` and unit-tested:
>    - Throttle spool: about 25% instant, full at about 0.6 s.
>    - Turn speed-bleed.
>    - A downhill bonus capped at 1.15×.
> 3. **#51, visual suspension and camera.** Render only, so the sim transform stays untouched.
>    - **Suspension:** `render/cartSuspension.ts` samples `heightAt` at the 4 wheel contacts, fits pitch and roll, and runs a critically damped spring at about 2 Hz, plus a landing bounce.
>    - **Camera:** Stage 2's trauma drives the shake. Terrain look-ahead keeps the eye above rises, and the FOV rises with speed.
>    - **Framing now has an art target:** `docs/concept/reference/chase-target-01.jpg` and shot 03. Show the cart from lower and slightly to the side, with the seat well and side panel visible; today the camera looks down onto the canopy.
>      - Today `CHASE_HEIGHT` is 3.6 at `CHASE_DISTANCE` 6.5 (`src/render/chaseCamera.ts`).
>      - Start around 2.6–3.0 m high at 6–6.5 m back, with the horizon about a fifth of the way down the frame (`docs/art/STYLE-RESEARCH.md` P6). The user tunes it by feel.
> 4. **#52, the six-hole arena zone** (holes 1, 9, 10, 14, 15 and 18, around the clubhouse):
>    - `src/sim/arenaZone.ts` builds a padded union of the six holes' corridors plus the clubhouse pad.
>    - Each cart carries an OOB timer: an immediate warning, then 1 HP every 2 s.
>    - `clampToPlayable` becomes the zone plus 30 m. Bot targets clamp into the zone.
>    - Render instanced white stakes every 15 m with a rope between them, plus a HUD warning.
>    - **`placePickupSites` already takes an optional `zone`.** Pass it from `arenaFromCourse` and `main.ts` together, because both must place identical sites.
>    - Read the hand-off comment on #52 from Stage 5a: the course kit's zone stake is exported in `course_kit.json`.
> 5. **#53, checkpoint:** `tsc`, `npm test` under 60 s, the PR description and the play-test list.
>
> ### The golden fingerprint
> Any sim change (#49, #50, #52) moves the **Linux x64** golden. Don't update it on the Mac. Push, read the `expected N to be M` line from the failing CI run, record N in a follow-up commit, and say so in both commit messages. On the Mac, show that render-only slices (#51) leave the Mac value unchanged.
>
> ### CI runs Node 22
> The Mac runs Node 26, and V8-sensitive tests can pass there while timing out on CI. On 4 Oct, `tools/simAllocation.test.mjs` took 9 s on 26 and 112 s on 22. Before you call a sim change done, run `npx -y node@22 node_modules/vitest/vitest.mjs run tools/simAllocation.test.mjs` as well as `npm test`. Every sim slice can move that test, because it checks that the tick allocates nothing.
>
> ### Rules
> - Use `git commit -s` on every commit, including merges. Put no AI metadata in git, and stage files by name.
> - Keep `src/sim/**` and `src/physics/**` free of `three` and DOM imports, seeded randomness only, and no per-tick allocation. `tools/simAllocation.test.mjs` checks the last one.
> - Every new smoke check must be seen to **fail** once (break the thing, watch it go red, restore it) before you trust it.
> - Push the branch, open a **draft PR** to `main` with the check outputs and a play-test list (each item 60 s or less at `?match=60`), and rewrite `docs/HANDOFF.md` and this file. Then **STOP** for the user's play-test. Don't merge and don't start Stage 5.
> - **Play-test list:** besides Stage 4's own items, carry over the clubhouse v3 items. #85 merged without its own play-test. At High and at Med, does the hub read like `docs/concept/reference/clubhouse-hero-01.jpg`, with the hip roof outlined by its caps? From about 150 m, does the cupola still identify the building? Do the barns' fascias still say which team is which? The new chase camera (#51) is the first time anyone will see the hub from the intended angle.

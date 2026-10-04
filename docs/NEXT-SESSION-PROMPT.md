# Next-session prompts

Two prompts, written 2026-10-04. **Prompt A is done** (branch `clubhouse-v3`, draft PR) and is kept for reference. **Prompt B, Stage 4, is next**, once the user has play-tested the v3 PR and says to start. Prompt A was the clubhouse and barn v3 Blender pass. It must run **locally**, because it needs Blender over the MCP. **Prompt B** is the one after it: Stage 4. It can run locally or in the cloud. Paste one prompt into a fresh Claude Code session. Each prompt stands alone.

---

## Prompt A: clubhouse and barn v3 (local, Blender MCP)

> You are finishing the art-direction v2 work on TeeTimeTurrets, a browser golf-combat game (three.js, Rapier, TypeScript). Your job is the **clubhouse and team-barn v3 pass in Blender**. The specs are written and approved; build what they say. Every design decision is already made, so don't reopen any. If a spec is wrong about a fact in the code, stop and ask me.
>
> ### Where to work
> - Repo: `/Users/johnbradner/Documents/ClaudeWork/GolfofDuty/TeeTimeTurrets` (`main` includes PR #83 and the handoff PR #84).
> - Make a worktree `../TeeTimeTurrets-clubhouse3` on a new branch **`clubhouse-v3`** from `origin/main`, and run `npm ci` in it. Don't work in the main checkout: it holds my untracked `.scratch/` and `tools/zzshots.mjs`, which must never be committed.
>
> ### Pre-flight (report each)
> 1. **Ask me** to run `uvx mcp-for-blender install-addon`, restart Blender, enable the add-on and click Start MCP Server. Then call `get_addon_status`, which should report up to date (on 3 Oct it was protocol 11 against 13), and `get_scene_info`. Blender is 5.2 LTS.
> 2. **Before opening any file in Blender, check `bpy.data.is_dirty`.** If it is true, stop and ask me; another session's file may be open.
> 3. **Read, in this order:**
>    - `AGENTS.md`
>    - `docs/HANDOFF.md`
>    - `docs/TEST-AND-SPEC-PITFALLS.md`
>    - `docs/art/specs/00-pipeline.md` (the Style rule and Budgets)
>    - `docs/art/STYLE-RESEARCH.md`
>    - `docs/art/SHEET-REVIEW-2026-10-03.md`
>    - the **"v3 amendments (approved 3 Oct 2026)"** sections at the end of `docs/art/specs/clubhouse.md` and `docs/art/specs/team-barn.md`
>    - `art/stage7_kit.py`, `art/kit_common.py`, `art/ttt_authoring.py`
>    - `art/cart_v3_kit.py`, as an example of the last pass
> 4. **Look at the sheets** with the Read tool, all in `docs/concept/reference/`:
>    - `clubhouse-hero-01.jpg`, the target
>    - `clubhouse-breakdown-01.jpg`, the modules
>    - `clubhouse-distance-01.jpg`, the silhouette at 150 m
>    - `hub-kit-01.jpg`, barn **details only**. Its 3-bay, gable-end-open barn is not our layout.
>    - `style-bible-01.jpg`
>
> ### Step 1: prove the kit before changing it (the smoke for the exporter)
> The clubhouse set is built **from scratch** by `art/stage7_kit.py` into `art/clubhouse-exterior.blend`, and the script is the source.
> - Load `ttt_authoring.py` and `stage7_kit.py` (each `execute_blender_code` call is a fresh namespace, so re-`exec` both every time). Run `build_all()` into a new scratch file, then `export_all(REPO)`.
> - `git diff --stat src/entities/graphs/` must show **no change**. If anything differs, the exporter or the kit has drifted: fix that first and tell me. The cart pass proved this the same way on 3 Oct.
>
> ### Step 2: edit `art/stage7_kit.py` (never the `.blend` by hand)
> **Clubhouse** (`build_clubhouse`):
> - **`rbox`** (`[w, h, d, radius]`; the radius must be under half the shortest side, or the graph throws at load) on:
>   - `cb_plinth` r 0.10
>   - `cb_walls` r 0.08
>   - `cb_cupola` r 0.06
>   - `cb_chimney` and `cb_chimney_cap` r 0.05
>   - all 14 `cb_post*` r 0.03
>   - the 3 `cb_step*` r 0.04
> - **Fascia boards:** 7 thin `rbox` boards (0.08 × 0.24 × the edge length, r 0.03, `cb_trim`) under every exposed roof edge. That is 4 on the main hip roof and 3 on the verandah roofs. Roof planes stay `prism`; the boards carry the highlight line.
> - **Post bases:** a plain `box` 0.32 × 0.30 × 0.32 under each post. A plain box, not an `rbox`; that's a budget choice.
> - **Roof pitch:** raise `RIDGE_Y` so the pitch goes from about 17° to about **25°** (`RISE = RUN·tan 25° ≈ 2.75`, so a ridge at about 7.35). Move the cupola and its roof up with the ridge. Check in the viewport that the chimney still clears the roof surface, and raise it if it doesn't.
>   - **`PITCH` is shared with `build_team_barn`**, so the barn roof steepens too. That is intended, because team-barn.md first asked for 30°. Check that the barn still reads.
> - **Unchanged:** windows and trim stay plain `box`, and the weathervane stays cut.
>
> **Barn** (`build_team_barn`):
> - The 5 posts become `rbox` r 0.03, each on a plain-`box` base 0.34 square.
> - 8 knee braces: thin `prism` wedges at 45°, from about 0.8 m below the eave to the fascia. Two per inner post and one per end post, on the inner side. Slot `cb_door`.
> - A 0.9 m-high `cb_brick` knee wall along the inside of the back wall and both end walls, 0.04 proud.
> - `tb_fascia` becomes an `rbox` r 0.04, keeping slot `team_trim`.
>
> **Not touched:** the colliders in `src/sim/clubhouse.ts` (they stop at 6.4 m, and the roof was never collidable), the placement, the slots and their colours. Don't touch anything under `src/sim/**`.
>
> ### Step 3: export and check
> - Run `build_all(); export_all(REPO)` and save the `.blend`.
> - **Smoke check:** `npx vitest run src/entities/clubhouseGraph.test.ts`.
>   - Raise the bounds deliberately and say so in the commit: clubhouse **≤ 4,000** triangles, barn **≤ 900** (both already in `00-pipeline.md`).
>   - The clubhouse's `max.y` assertion (7.6, the old cupola top) must change to the new cupola top. Write the new number from the kit's constants, not from the test's output.
> - Run `npx tsc --noEmit`, then `npm test`. The full suite must pass in under 60 s.
> - **Watch for `tools/simAllocation.test.mjs`.** It was hardened on 4 Oct against V8 re-optimization churn. If it fails, read its header before touching it.
>
> ### Step 4: review, then stop
> - **Viewport:** screenshots of the clubhouse from the front three-quarter view and of one barn. Show them to me beside `clubhouse-hero-01.jpg`.
> - **In game:**
>   - Pre-seed `localStorage["teetimeturrets.settings"] = '{"version":2,"quality":"high","seenControls":true}'`, open `/?match=60`, and screenshot the hub at High and at Med.
>   - The desktop browser pane shows stale frames when hidden, so wait two `requestAnimationFrame`s before each screenshot.
> - Add an **"As built (date)"** section to both specs. Record triangle counts, the final pitch and ridge, and anything you changed from the spec, with the reason.
> - Commit with `git commit -s`, staging files by name, never `git add -A`. No AI metadata anywhere: no co-author trailers, session links or "generated with".
> - Push and open a **draft PR** to `main`. In it, list the checks with their output, and a play-test list where each item takes 60 s or less at `?match=60`. Cover:
>   - whether the hub reads like the hero image at High and Med
>   - whether the cupola still identifies the building from far away
>   - whether the barns still say which team is which
> - Rewrite `docs/HANDOFF.md`, since it is a baton and not a log, and then **STOP** for my play-test. Don't merge, and don't start Stage 4.

---

## Prompt B: Stage 4, handling feel and arena zone (local or cloud)

> You are building **Stage 4** of TeeTimeTurrets, a browser golf-combat game (three.js, Rapier, TypeScript): issues **#49–#53**, milestone "Stage 4". The design is decided in `docs/REVAMP-PLAN.md` § Stage 4. Build it, and ask only if a fact in the code contradicts the plan.
>
> ### Where to work
> Work on a new branch **`stage-4-handling-zone`** from `origin/main`. Locally, use a worktree `../TeeTimeTurrets-stage4` and run `npm ci`. Never commit the main checkout's untracked `.scratch/` or `tools/zzshots.mjs`.
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
> ### Rules
> - Use `git commit -s` on every commit, including merges. Put no AI metadata in git, and stage files by name.
> - Keep `src/sim/**` and `src/physics/**` free of `three` and DOM imports, seeded randomness only, and no per-tick allocation. `tools/simAllocation.test.mjs` checks the last one.
> - Every new smoke check must be seen to **fail** once (break the thing, watch it go red, restore it) before you trust it.
> - Push the branch, open a **draft PR** to `main` with the check outputs and a play-test list (each item 60 s or less at `?match=60`), and rewrite `docs/HANDOFF.md`. Then **STOP** for the user's play-test. Don't merge and don't start Stage 5.

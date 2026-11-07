# Next-session prompt

Written 2026-11-07, at the end of the Stage 4 session. Stage 4 (handling feel and arena zone, #49–#53) is in a draft PR waiting for the user's play-test. **Run this only after the user has play-tested Stage 4 and said to go on.** The next stage is **4b, iOS and gamepad**; Stage 5 comes after it. Paste the quoted block below into a fresh Claude Code session; it stands alone. The Stage 4 prompt that preceded it is done, so it has been removed; its record is the Stage 4 PR and `docs/HANDOFF.md`.

---

## Stage 4b: iOS and gamepad (cloud first, then Xcode on the Mac)

> You are building **Stage 4b** of TeeTimeTurrets, a browser golf-combat game (three.js, Rapier, TypeScript): a gamepad on the web, then a Capacitor iOS shell for TestFlight, plus KTX2 terrain textures and a CI size budget. The design is decided in `docs/superpowers/specs/2026-11-07-ios-gamepad-and-asset-adoption-design.md`, and `docs/REVAMP-PLAN.md` § Stage 4b summarises it. **Those are user decisions; do not relitigate them.** Build it, and ask only if a fact in the code contradicts the spec.
>
> ### Where to work
> Work on a new branch **`stage-4b-ios-gamepad`** from `origin/main`. Stage 4 must be merged first; if it isn't, stop and ask. Locally, use a worktree `../TeeTimeTurrets-stage4b` and run `npm ci`. Never commit the main checkout's untracked `.scratch/` or `tools/zzshots.mjs`.
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

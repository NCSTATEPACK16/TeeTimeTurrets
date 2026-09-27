# Handoff — next session

Rewritten 2026-09-27, at the end of the cloud session that finished Stage 1. Rewrite this file at the end of each session: it is a baton, not a log.

---

## Read first

1. `AGENTS.md`: the rules, the Claude of Tanks license note, and the "see red first" testing rule.
2. **`docs/REVAMP-PLAN.md`: the master stage order and each stage's contents.** It supersedes older plans.
3. `docs/DECISIONS.md`: the two newest sections are the 2026-09-27 revamp and "The golden fingerprint is Linux x64's".
4. `docs/TEST-AND-SPEC-PITFALLS.md` before writing a test or a spec.

## The direction (set by the user; do not relitigate)

- **Arena is the only mode.** Stroke play and race mode are gone.
- **Format:** 4v4 (the player plus 3 bot allies against 4 bots), 3 minutes. Reaching 0 HP costs your team a stroke; the fewest strokes wins.
- **The arena zone is holes 1, 9, 10, 14, 15 and 18** around the clubhouse. It is marked with white stakes, and leaving it drains HP. This lands in Stage 4. Until then the whole course is playable.
- **Friendly fire is off.** Carts are fast, and the putter is a close-range pistol.
- Blender authors primitive-graph JSON only, in a **new** `.blend`. Never touch `art/clubhouse-and-cart.blend`.
- **Cloud sessions:** work one stage, run the checkpoint, push, update the draft PR, rewrite this file, then **STOP** for the user's play-test. Never merge. Never re-baseline the gate without the user's approval. Never start the next stage without the user saying so.

## Where things stand

| # | Stage | Branch | Status |
|---|---|---|---|
| 1 | Finish: 1.8 wiring, 1.9 rematch, checkpoint (#29–#31) | `arena-only` (draft PR #28 → `main`) | **done; waiting on the user** (below) |
| 2 | Juice and audio | `stage-2-juice` | next, once the user says so |
| 3 | Foundations: performance and render base | `stage-3-foundations` | — |
| 4 | Handling feel and arena zone | `stage-4-handling-zone` | — |
| 5 | Environment | `stage-5-environment` | — |
| 6 | navGraph | `stage-6-navgraph` | — |
| 7 | Clubhouse in Blender (**local only**) | `stage-7-clubhouse` | — |
| 8 | Economy | `stage-8-economy` | — |
| 9 | Refactor | `stage-9-refactor` | — |
| 10 | Docs | `stage-10-docs` | — |

- The milestones "Stage 1" to "Stage 10" each hold that stage's issues (#29–#68, labelled `ready-for-agent`; each lists what blocks it). Close issues from the PR (`Closes #n`).
- **Branching.** Each later stage branches from `main` once the previous PR has merged. If it hasn't merged, branch from the previous stage's branch and say so in the PR.
- **Archived work.** Tag `archive/wonderful-edison` keeps an old branch's `courseTrees.ts` (`cbfedd5`), `courseProps.ts` (`1c49b15`) and clubhouse-in-arena (`cb039b6`) commits. Stages 5 and 7 start from them (see `REVAMP-PLAN.md`). **Do not merge the tag.** Lift files from it with `git show <sha>:<path>`.

### Stage 1 checkpoint, at `f4332ef` (outputs are in PR #28's description)

- `tsc` clean. **912 tests pass** on a bare `vitest run`; CI's `test` job is green.
- **Smoke passes**, including new mouse-fire, pointer-lock and turret-camera checks.
- **Gate: 17 of 18 pass.** `cart-putter` drifted with the putter's loft; the user re-baselined it after, and at `becd6b8` the gate passes 18 of 18.
- **Probe: runs again.** It failed only the driver distance check, which the user retargeted after; at `becd6b8` every probe check passes, tunnelling included.

### Waiting on the user

1. **The play-test.**

Settled since the checkpoint above:
- **`cart-putter` re-baselined** (`ff2832b`), for the putter's 1° loft.
- **The probe's driver check** now holds the arena driver to its measured carry and total (`74c44f8`).
- **The ball pool no longer refuses the player's shots** (`becd6b8`). When every ball is in flight, `BallPool.acquire` recycles the oldest one rolling on the ground. It still refuses only when all 32 are up in the air: in a measured minute of 4v4 that happened 6 times across eight carts, and to the player 0 times out of 48 (it was 32 out of 64).

## What Stage 1 did this session

- **CI settled first.**
  - `vitest.config.ts` has `testTimeout: 30_000`, so `--testTimeout` is no longer needed.
  - **The golden fingerprint is recorded on Linux x64**, the platform CI runs. An Apple Silicon Mac computes a different one because V8's `Math.sin`, `Math.cos` and `Math.atan2` round a few inputs one ulp apart on arm64. That was measured, not guessed: an emulated arm64 Node reproduced the Mac's exact number, and swapping 361 `Math` results for x64's made it match x64 on every tick. See `DECISIONS.md`. **Expect `matches the recorded fingerprint` to fail on the user's Mac; that is by design.**
- **#29 Bots use their minds.** `CartRig.mind`, a skill per bot from `BOT_SKILL_CHANNEL`, and the nearest off-cooldown bucket or landed ball written in when a bot is empty.
  - `botMind.test.ts`'s refill test had the bot shove the player onto the bucket, so the bot now starts off to the player's side.
  - A third test covers "a landed ball, not a bucket on cooldown".
- **#30 Rematch.**
  - The buzzer tick is simulated in full.
  - `Sim.reset()` rebuilds the Rapier world through `buildPhysics()`, in `create()`'s order; the heights are kept, so a reset takes 2–8 ms.
  - `reset()` also clears bucket cooldowns and `simTime`, and calls `Cart.rearm()` for each cart. Ammo no longer survives a rematch.
  - A rematch now replays the first match bit for bit (`arenaGolden.test.ts`).
- **#31 Checkpoint.**
  - Smoke checks mouse fire (the click that takes the pointer lock does not fire, the left button fires, a right-click drops the charge), the turret camera, and that the results screen leaves the pointer free.
  - Smoke and the gate no longer leave orphaned `vite preview` servers behind, and they refuse a port something else is already serving.
  - The probe was ported to fire through the cart and the ball pool.

## Next session: Stage 2, only when the user says so

`REVAMP-PLAN.md` "Stage 2: juice, audio and feedback". Branch `stage-2-juice` from `main` if #28 has merged, otherwise from `arena-only`, and say which in the PR. Three things in this repo bear on it:
- **`Sim.events` replaces `hitEvents`.** The hit-marker pool, `hitEventEpoch`, and `killCart`/`creditHit` in `world.ts` are the current producers.
- **Hit markers show a fake "+50".**
- **A refused shot is still silent.** It is rare now (all 32 balls in the air), but Stage 2's audio can give it a dry-fire click.

## Audit findings still open (from 2026-09-26)

- **Performance** (Stage 3):
  - Nameplate line of sight runs up to about 3,500 `heightAt` calls per frame.
  - The heightfield is rebuilt on every PLAY (though no longer on a rematch), and `CourseGround` on every match. `Sim.create` takes about 5 s on the full course in Node.
  - The smoke counts 705 meshes in a match scene (the audit said about 545), and each cart costs about 78 draw calls.
  - Near tiles are never evicted.
  - The sim allocates every tick. That includes Rapier's `translation()`, which the new ammo search calls per landed ball while a bot is empty.
  - DPR is 2 with MSAA.
  - The bundle is one 3.6 MB chunk.
- **Economy bug** (Stage 8): `clubhouseState.ts` rebuilds owned items from the equipped set, so an earlier purchase is lost when you switch items.
- **Paint and skin** never reach the match renderer (Stage 8).
- **Cross-platform sim determinism** (unscheduled): see `DECISIONS.md`, "Open: a sim that computes the same bits everywhere". It is also `RESEARCH-NEEDED.md` item 5, now partly answered by measurement: `Math.sin`/`cos`/`atan2` do differ by architecture, and Rapier's WASM did not across one 40 s match.

## Traps

- **See every new test fail before trusting it, and read the red.** This session caught three inert checks by mutation, each green with the thing it guarded removed:
  - The smoke's "a pooled ball is in flight" passed on a bot's ball.
  - "The click that takes the lock does not fire" passed because a full pool refused the shot.
  - "The release after a cancel fires nothing" passed for the same reason, and was dropped.
- **Vitest hides `console.log`** unless you run with `--silent=false --reporter=verbose`.
- **The golden is Linux x64's.** Re-record it only from Linux x64 (cloud sessions and CI are), and in the same commit as the change that moves it.
- **Smoke and the gate in a cloud container:**
  - Chrome renders with SwiftShader, so both scripts wait on sim state or `__gate.ready`, never on `networkidle0` or fixed sleeps.
  - The smoke holds the player at full health until MATCH OVER, because bots kill an idle player within the control checks.
  - `node tools/smoke.mjs` reuses `dist/`. After a mutation experiment, rebuild with `npm run smoke`, or you are testing the mutant.
- **Killing preview servers from Bash:** `ps | grep 'vite preview' | kill` matches the shell running it. Kill by PID in a separate command.
- **`tools/feelProbe.ts` is not type-checked** (it needs Node types that `tsconfig.json` does not load), which is how it rotted unnoticed. Build it with `npm run probe` after any `Sim` API change.
- **Test cart-on-cart and ball-on-cart hits by teleporting once**, never by pinning a kinematic body every tick.
- **Coordinates:** +z is north.
  - The road (`southBoundary`) runs about 30 m south of the clubhouse.
  - `AUTHORED_CLUBHOUSE` is `{x:-241.2, z:-477.3}`.
  - Hole centres are `AUTHORED_PLACEMENTS` in `authoredLayout.ts`.
- **Rough scales cart speed by 0.72,** and most ground near the clubhouse is rough.
- **Git hygiene.**
  - Never put AI-session metadata in commits or PRs.
  - Always use `git commit -s`.
  - Never `git add -A`: the user's local tree has a modified `.blend` and a `.scratch/` folder that must never be committed.

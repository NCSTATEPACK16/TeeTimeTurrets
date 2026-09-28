# Handoff — next session

Rewritten 2026-09-28, at the end of the cloud session that took the revamp from Stage 2 through Stage 10 (Stage 7 skipped: it is local Blender work). Rewrite this file at the end of each session: it is a baton, not a log.

---

## Read first

1. `AGENTS.md`: the rules, the Claude of Tanks license note, and the "see red first" testing rule.
2. `docs/REVAMP-PLAN.md`: the stage order and each stage's contents.
3. `docs/DECISIONS.md`: the newest section, "What the 2026-09-28 session decided", records the choices made while building Stages 3–9.
4. `docs/TEST-AND-SPEC-PITFALLS.md` before writing a test or a spec.

## Verification, as the user now wants it

The user asked on 2026-09-28 to stop running the long local checks between changes. **CI (`tsc --noEmit` and `npm test`, about 30 s) is the gate on commit and merge.** A browser run, when one is needed at all, is a short drive of 30 seconds at most. `npm run smoke`, `npm run probe` and the full checkpoint are available but are no longer run per stage.

## Where things stand

Everything below is on `claude/teetimeturrets-stage-1-y612dx`, stacked on `arena-only`, in one PR.

| Stage | What landed | Left over |
|---|---|---|
| 2 Juice and audio | kill feed, damage flash, vignette, score strip, effects, shake, speed FOV, audio, pause, map, settings | — |
| 3 Foundations | baked sim grids; nameplate LOS at 10 Hz; ground and treeline built once per course; carts merged per slot (17 draws); no per-tick sim allocation; quality presets (Low/Med/High, auto never picks High); Rapier and GLTFLoader out of the entry chunk; frame readout on the dev hook; sky dome + PMREM env + FogExp2 from the horizon readback; ACES; texel-snapped single shadow (Med) and CSM (High); High-only post (GTAO, bloom, SMAA) | the gate subjects stayed inside the threshold, so no re-baseline was made |
| 4 Handling and zone | `sim/mobility.ts` (per-cart climb limit from the vendored rule); throttle spool, turn bleed, downhill cap 1.15×; `sim/arenaZone.ts` (hull of holes 1/9/10/14/15/18 + clubhouse, 45 m pad, 1 HP per 2 s outside, clamp at +30 m, bots never chase out); stakes and rope; OUT OF BOUNDS HUD line; `render/cartSuspension.ts`; camera clears banks along its sight line | — |
| 5 Environment | photo-detail ground (4 CC0 textures at 512 px, anti-tiled, distance fade) and slope rock; course trees (archived scatter, fixed to thin evenly to the preset cap) and props (archived); ponds with shore fade and ripples; grass carpet round the camera; `sim/cartPaths.ts` with a 1.12 speed scale and drawn strips; golden-hour title sky | `SurfaceId.Tee`; deleting `render/ground.ts` (still used by the title backdrop and the gate harness); tree sight-line dither and far impostors; a `course-dressing` gate subject |
| 6 navGraph | `sim/navGraph.ts`: 8 m zone grid, A* adapted from the vendored planner, water and banks closed, mobility-limited steps, path-cheap costs, taut routes; bots use it beyond 80 m or without a clear line, replan at most 1 Hz | — |
| 8 Economy | `sim/scoring.ts` score/coins/XP/levels; `Sim.tally`; `sim/upgrades.ts` + `applyLoadout` (armour, ball bag, quick hands; driver at level 2); `app/profile.ts` (versioned localStorage, starts at 0 coins); the owned-items bug fixed; upgrades in the clubhouse; rewards on the results screen; player and bots wear loadouts in the match | — |
| 9 Refactor | `tools/importDirection.test.mjs` | **deleting the generator** (15 test files and `tools/feelProbe.ts` still build courses with it); moving `validateHole`; renaming the probe; splitting `world.ts` (now about 1,100 lines); `sim/vec.ts` |
| 10 Docs | this file, DECISIONS | ROADMAP's Arena section and ARCHITECTURE still describe the pre-revamp shape |

The golden fingerprint is **1521208831** (Linux x64). It moved twice this session, each time with the cause in the commit: the spool, zone and climb limits (15855569 → 3600764298), then cart paths (→ 1521208831).

## Suggested next steps

1. The user play-tests the PR's build: feel (spool, bleed, climb), the zone edge, bots routing round ponds, rewards and upgrades.
2. Finish Stage 9's leftovers, starting with the generator deletion: move the tests onto `miniCourse` and the probe onto the authored course, then delete.
3. Stage 7 in a local session with Blender.

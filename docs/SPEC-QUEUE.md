# Spec queue

Written 2026-11-15. What is left in `REVAMP-PLAN.md`, sorted by how much design it still needs
before someone can build it. The plan's entries are bullet lists of decisions; some are enough to
build from and some are not. A stage marked **needs a spec** should get a design in
`docs/superpowers/specs/` and a task-by-task plan in `docs/superpowers/plans/` first, in the form
the existing files there use. Build order is unchanged: 3.5b, 3.5c, 4b, 5, 6, 8, 9, 10.

## Ready to build from what is written

| Work | Where it is specified | Note |
|---|---|---|
| 3.5b sand: bunker texture, rim lip, drift sprites | `NEXT-SESSION-PROMPT-3.5.md` item 3 | Small. Reuses `EffectsLayer.smoke`. |
| 3.5b assets: Kenney sprites into the 4 × 2 atlas | same file, item 5 | Fetch from opengameart.org; kenney.nl refuses scripted requests. |
| 3.5b ambient life: birds, sprinklers, flag cloth, motes | same file, item 6 | Optional. Each is one small render module. |
| Stage 10 docs | `REVAMP-PLAN.md` § Stage 10 | Last. |

## Needs an implementation plan (the design is decided)

| Work | Design | What the plan must settle |
|---|---|---|
| **4b gamepad, controller navigation, iOS shell** | `specs/2026-11-07-ios-gamepad-and-asset-adoption-design.md` | There is no plan file for it. Split it into slices with a play-test stop each. Say which slices can run in a cloud session and which need a Mac with Xcode (the Capacitor shell and TestFlight do). Carry the two Stage 4 constraints in `HANDOFF.md`: the deadzone must hand the sim a clean 0, and aim assist measures from the turret's yaw. |
| **3.5b ground splat and KTX2** | `REVAMP-PLAN.md` § Stage 5, first bullet; 4b spec, assets | The two stages collide: 4b says compress the terrain sets to KTX2 *before* they are wired, and 3.5b wires them first. Decide the order. Then: how five texture sets reach a shader that today gets one mask per tile through the material's `map` slot (texture array or atlas), the sampler count on Low, the bundle budget, and how the domain warp is shared with the CPU. |
| **3.5b grass carpet** | § Stage 5, grass bullet | Blade count per cell at each `grassDensity`, the draw and triangle budget on Med, how cells are cached without allocating per frame, and how it reads `surfaceAt` cheaply. |
| **Stage 9 refactor** | § Stage 9 | The order of the `world.ts` split, with the golden unchanged after every step. Branch `claude/modest-brahmagupta-alqfjt` holds 48 unmerged commits of this work (`vec.ts`, `credit.ts`, `snapshot.ts`), written before Stage 3.5a and 4 changed `world.ts`. Decide whether to rebase it or redo it. |

## Needs a spec (decisions are still missing)

In priority order.

1. **3.5c, mortar and capture flags.** The plan gives the rules in six lines. Missing:
   - Mortar: how the owner aims it, the telegraph (what the target sees and for how long), the
     barrage's seeded spread, damage per ball, whether it uses the ball pool, and what a bot does
     with one.
   - Flags: which three greens, capture state per flag, how "contested" is counted, how the stroke
     bleed joins the existing stroke scoring and the match end, and the events the HUD and audio
     hear.
   - Bots: when they go for a flag instead of a target. Stage 6's routing does not exist yet, so say
     what they do without it.
   - HUD and map elements, against `UI-SPEC.md`.
   - It moves the golden once: say which commit records it.
2. **Stage 6, navGraph.** Missing: the cell size over the zone, how a cell's passability is derived
   from the Stage 4 mobility table (the climb limit now depends on tyre and surface, so "passable"
   differs per cart), how woods count now that trees stand in clumps (`woodsPlacement.ts`), the
   replan schedule without per-tick allocation, and how a route replaces the bots' current
   steer-at-target and zone-edge behaviour.
3. **Stage 5 remainder: tee boxes and cart paths.** `SurfaceId.Tee` and `sim/cartPaths.ts` are sim
   changes. Missing: the path polylines' source, the speed bonus as a mobility resistance, how
   paths cross the zone edge, and the golden. The render parts (impostors past 250 m, sight-line
   dither, the 12 outer holes' lower LOD, the golden-hour title) need only a plan.
4. **Stage 8, economy.** The formulas are decided. Missing: the profile's schema and its migration
   from today's saved state, the `UPGRADES` table's actual numbers and prices, how `applyLoadout`
   reaches every rig, and the results screen's layout.
5. **Cross-platform sim determinism.** Unscheduled (`DECISIONS.md`, "The golden fingerprint is Linux
   x64's"). It needs a decision before any multiplayer work: fix it, or keep one authoritative
   platform.
6. **Performance audit items** still open in `HANDOFF.md` (nameplate line of sight, draw calls per
   cart, the single 3.6 MB chunk). Each needs a measured target before it is worth a plan.

## Found while building 3.5b, not yet decided

- **Hole 18's pond polygon is larger than its water.** Part of the polygon is fairway that the
  course blend gives to a neighbouring hole, and the ground there sits about 0.3 m below the water
  level. The sim treats it as dry fairway, so the water surface is not drawn there
  (`waterMesh.ts`). The result is a dry hollow beside the pond. Fixing it means changing the
  authored polygon or the blend, which moves the golden.
- **Water costs 18.5k triangles** in one transparent draw. Not measured on a real GPU yet.

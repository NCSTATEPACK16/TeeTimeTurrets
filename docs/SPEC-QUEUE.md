# Spec queue

Written 2026-11-15. What is left in `REVAMP-PLAN.md`, sorted by how much design it still needs
before someone can build it. The plan's entries are bullet lists of decisions; some are enough to
build from and some are not. A stage marked **needs a spec** should get a design in
`docs/superpowers/specs/` and a task-by-task plan in `docs/superpowers/plans/` first, in the form
the existing files there use. Build order is unchanged: 3.5b, 3.5c, 4b, 5, 6, 8, 9, 10.

## Ready to build from what is written

| Work | Where it is specified | Note |
|---|---|---|
| **The Caswell look and detailed grass** (user, 15 Nov): ground detail textures, one Piedmont palette, first cut, bunker lips, dark ponds with cattails, pine straw, grass tufts, loblolly pines | `specs/2026-11-15-caswell-look-and-grass-detail-design.md`, `plans/2026-11-15-caswell-look-and-grass-detail-implementation.md` | **In progress.** Slices A (detailed grass, #90) and B (one Piedmont course, the pond shader, cattails, #91) are merged. Slice C (pine straw, grass tufts, #92) is merged too; the old "grass carpet" entry is done with it. D (loblolly pines, local Blender) remains: `NEXT-SESSION-PROMPT.md`, prompt A. Four slices, a play-test stop after each. It absorbs the old "ground splat" and "grass carpet" entries and 3.5b's sand item. The water becomes the hole 13 pond shader from GolfCartSimulator. Open questions are in the spec's §6; build to the defaults. Slice D needs a local Blender session. |
| **One cart in both games, and hole flags in free drive** (user, 25 Nov): the Turrets cart in Chill and Joyride, a Tee Time Links logo, waving hole flags and tee signs | `specs/2026-11-25-shared-cart-and-hole-flags-design.md` | **Done.** Three PRs: the logo (#95), flags and tee signs (#96), and the shared cart (#98, merged 27 Nov; `plans/2026-11-26-shared-cart-implementation.md`). |
| 3.5b sand drift sprites | `NEXT-SESSION-PROMPT-3.5.md` item 3 | Small. Reuses `EffectsLayer.smoke`. The bunker texture and lip are in the Caswell plan. |
| 3.5b assets: Kenney sprites into the 4 × 2 atlas | same file, item 5 | Fetch from opengameart.org; kenney.nl refuses scripted requests. |
| 3.5b ambient life: birds, sprinklers, flag cloth, motes | same file, item 6 | Optional. Each is one small render module. |
| Stage 10 docs | `REVAMP-PLAN.md` § Stage 10 | Last. |

## Needs an implementation plan (the design is decided)

| Work | Design | What the plan must settle |
|---|---|---|
| **4b gamepad, controller navigation, iOS shell** | `specs/2026-11-07-ios-gamepad-and-asset-adoption-design.md` | **Built as draft #101** (28 Nov) straight from prompt C's seven slices, without a separate plan file, at the user's direction. Waits on the play-test and the Mac steps in `docs/IOS.md`. |
| **Stage 9 refactor** | § Stage 9 | The order of the `world.ts` split, with the golden unchanged after every step. Branch `arena-only` holds 48 unmerged commits of this work (`vec.ts`, `credit.ts`, `snapshot.ts`; merged there as #86), written before Stage 3.5a and 4 changed `world.ts`. Decide whether to rebase it or redo it. |

## Needs a spec (decisions are still missing)

In priority order.

1. **3.5c, mortar and capture flags.** **Specified, answered and planned on 27 Nov**, so it is
   ready to build: `specs/2026-11-27-mortar-and-capture-flags-design.md` (every default
   answered yes) and `plans/2026-11-27-mortar-and-capture-flags-implementation.md`, three slices.
   **Built and merged as #100 (28 Nov).**
   What the spec had to settle:
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
2. **Stage 6, navGraph.** **Merged as #103 (28 Nov).** Specified and built on 28 Nov:
   `specs/2026-11-28-stage-6-navgraph-design.md`, two slices, waiting on the play-test. What the
   spec had to settle: the cell size over the zone, how a cell's passability is derived
   from the Stage 4 mobility table (the climb limit now depends on tyre and surface, so "passable"
   differs per cart), how woods count now that trees stand in clumps (`woodsPlacement.ts`), the
   replan schedule without per-tick allocation, and how a route replaces the bots' current
   steer-at-target and zone-edge behaviour.
3. **Stage 5 remainder: tee boxes and cart paths.** **Specified and built as a draft PR on
   28 Nov:** `specs/2026-11-28-stage-5-tees-cart-paths-and-woods-design.md`, four slices, waiting on
   the play-test. Impostors past 250 m stay open (§4.1). What the spec had to settle:
   `SurfaceId.Tee` and `sim/cartPaths.ts` are sim changes. Missing: the path polylines' source, the speed bonus as a mobility resistance, how
   paths cross the zone edge, and the golden. **Merged as #102 (28 Nov).** The render parts (impostors past 250 m, sight-line
   dither, the 12 outer holes' lower LOD, the golden-hour title) need only a plan.
4. **Stage 8, economy.** **Specified and built as a draft PR on 28 Nov:**
   `specs/2026-11-28-stage-8-economy-design.md`, four slices, waiting on the play-test. It settled
   what was missing: the profile's schema (v1; nothing was saved before, so there is nothing to
   migrate), the `UPGRADES` numbers and prices, how `applyLoadout` reaches the player (bots keep
   the default kit and get a seeded look), and the results screen's earnings block.
5. **Surveyed Caswell terrain.** The user's other project, `NCSTATEPACK16/GolfCartSimulator`, has
   a GIS pipeline (lidar heights, traced outlines, sculpting, cart paths, tree scatter) and one
   finished packet: **hole 1 only**. Holes 2–18 are not traced. Using surveyed ground here means
   tracing them there first, then replacing this game's generated terrain, surfaces, colliders,
   zone and spawns, and re-recording the golden. Missing: whether to do it at all, the packet-to-sim
   adapter, and the data licences ("NC public data; terms to confirm"; OpenStreetMap is ODbL).
   See the Caswell spec's §3.10.
6. **Cross-platform sim determinism.** Unscheduled (`DECISIONS.md`, "The golden fingerprint is Linux
   x64's"). It needs a decision before any multiplayer work: fix it, or keep one authoritative
   platform.
7. **Performance audit items** still open in `HANDOFF.md` (nameplate line of sight, draw calls per
   cart, the single 3.6 MB chunk). Each needs a measured target before it is worth a plan.

## Found while building 3.5b, not yet decided

- **Water drawn versus water ruled.** After the water-float fix (per-pond spill levels in `waterMesh.ts`), ponds are drawn at the level their basin can hold, but `courseSurfaces.surfaceAt` still labels water from the owning hole's polygon at the constant `waterLevel`. In the arena zone about 6,500 m² (the holes 14, 15 and 18 pits) is drawn as water but drivable, and about 1,900 m² is the reverse. Options: (1) relabel pits as water wherever the render draws it ("pond wins"): +63% water, 16 to 60% of fairway centrelines on holes 12 to 15 and 18 get wet, moves the golden (measured and reverted; patch not kept in the repo); (2) fix the basin carving so each pond is carved to one level, or fix the hole 12/13/16 layout overlap; (3) leave it. Needs the user's decision.

- **Hole 18's pond polygon is larger than its water.** Part of the polygon is fairway that the
  course blend gives to a neighbouring hole, and the ground there sits about 0.3 m below the water
  level. The sim treats it as dry fairway, so the water surface is not drawn there
  (`waterMesh.ts`). The result is a dry hollow beside the pond. Fixing it means changing the
  authored polygon or the blend, which moves the golden.
- **Water costs 18.5k triangles** in one transparent draw. Not measured on a real GPU yet.

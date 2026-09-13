# An authored course routing, in yards

Written 2026-09-12. Replaces the procedurally routed eighteen holes with a routing traced from a
real plat map, and the metric hole lengths with a real US scorecard. Prompted by the user's
judgement that the generated layout does not read as a golf course; the measurement below is what
turned that judgement into a specification.

**Source material.** A plat map of a real eighteen-hole course with adjacent housing lots — two
returning nines, clubhouse on the southern boundary against County Home Road, three ponds — and its
scorecard. **Only the White tees are used.**

---

## Problem Statement

The course is generated. `generateCourse(seed, 18)` drafts eighteen holes against per-par length
bands and `solveCourseLayout` places them by physics relaxation into two returning loops around a
clubhouse at the world origin. It works, it is deterministic, and the result does not look like a
golf course.

**That is a taste judgement, and underneath it is a measurement that is not.** Against the White
tees of a real par-72 course:

| Par | `CORRIDOR_BAND` (m) | Band in yards | Real White (yd) | Verdict |
|---|---|---|---|---|
| 3 | 70–125 | 77–137 | 147–180 | every real par 3 is **longer than the band's maximum** |
| 4 | 135–250 | 148–273 | 320–405 | every real par 4 is **longer than the band's maximum** |
| 5 | 265–375 | 290–410 | 450–508 | every real par 5 is **longer than the band's maximum** |

**Not one of the eighteen holes on a real scorecard is legal under the generator's own bands.** The
par-4 band's *minimum*, 148 yards, is shorter than every par 3 on the card. The course this repo
builds is roughly two-thirds the length of a real one, hole for hole, and a course made of holes
that are all a third too short reads as a miniature of a golf course rather than as one. That is
most of what "does not look good" is measuring.

`FIELD_FOR_PAR` has the same gap and a harder consequence. A par-4 field is a 220 m square whose
diagonal is 311 m; the longest real par 4 here is 370 m. A par-5 field is 300 m, diagonal 424 m,
against a longest real par 5 of 465 m. **The longest holes on the card do not fit inside their
field at any bearing**, so lengthening the bands alone would produce holes the validator rejects.

Three further structural mismatches, none of which the generator can express:

1. **The clubhouse is at the world origin with corridors converging on it from every side.** On the
   plat it sits on the southern boundary with a public road behind it. The apron is a half-disc
   against an edge, not a full disc in open ground.
2. **There is no barrier at the course edge.** `COURSE_MARGIN_M` puts 40 m of rough beyond the
   outermost field and then the heightfield stops. The ball has an out-of-bounds rule
   (`world.ts:1425`); a cart has nothing.
3. **Everything is metric.** A US course is measured in yards, and the repo already half-knows
   this — `props.ts` places "the 150, 100 and 50 yard posts" at `MARKER_DISTANCES_M = [137, 91, 46]`,
   which is those yardages converted and then never named as such again.

## Solution

**Author the routing; keep the seed underneath it.** Eighteen holes' par, White yardage, tee, cup
and control points become data traced from the plat. Everything below that stays generated from a
seed: terrain noise, green shaping, bunker detail, tree scatter, rough. The course stops being
*discovered* by a solver and starts being *described*, which is what a routed golf course is.

**Lengths are authored in yards, simulated in metres, displayed in yards.** One exact conversion at
each boundary — `1 yd = 0.9144 m` — and no physics constant moves. The engine, Blender, the
colliders, `topSpeed`, the heightfield and every existing test baseline stay metric. The player and
the tee signs see yards, because that is what the course is measured in.

**Field size becomes per-hole and derived**, not a per-par constant. A 147-yard par 3 and a
508-yard par 5 have no business claiming the same square, and deriving the field from the authored
corridor's own extent is both tighter and impossible to get wrong.

**The clubhouse moves to the southern boundary**, the apron becomes the half-disc in front of it,
and the road behind it becomes a barrier: carts stop, and a treeline is drawn beyond so the horizon
continues past the edge of play.

### The authored card

Par 72, 6,215 yards from the White tees — front 3,219 (par 36), back 2,996 (par 36).

| # | Par | White (yd) | Metres | Region on the plat | Plays |
|---|---|---|---|---|---|
| 1 | 5 | 508 | 464.5 | south, along the road | east, away from the clubhouse |
| 2 | 4 | 381 | 348.4 | far east edge | north |
| 3 | 4 | 381 | 348.4 | far east edge, upper | north |
| 4 | 3 | 180 | 164.6 | north-east, at the small pond | west, over water |
| 5 | 4 | 342 | 312.7 | east | south |
| 6 | 3 | 171 | 156.4 | east-centre | short |
| 7 | 4 | 393 | 359.4 | east-centre | north |
| 8 | 5 | 458 | 418.8 | east-centre | south |
| 9 | 4 | 405 | 370.3 | south-centre | **west, returning to the clubhouse** |
| 10 | 3 | 178 | 162.8 | south-west | short |
| 11 | 4 | 320 | 292.6 | west edge | north |
| 12 | 4 | 368 | 336.5 | north-west | east |
| 13 | 4 | 322 | 294.4 | north-west, at the large pond | south |
| 14 | 5 | 450 | 411.5 | west-centre | south |
| 15 | 4 | 380 | 347.5 | west-centre | north |
| 16 | 4 | 371 | 339.2 | north-west, along the pond | south |
| 17 | 3 | 147 | 134.4 | north-centre | short |
| 18 | 5 | 460 | 420.6 | centre | **south, returning to the clubhouse** |

Three water features, touching five holes: a large pond north-west (13, 16, with 12 adjacent), a
smaller pond west-centre (15, 18), and a small pond north-east (4). The generator currently leaves
eleven of eighteen holes dry, which is a comparable ratio and needs no change in kind.

**Confidence is not uniform and the plan must treat it that way.** Hole order, region and which
holes touch water are read directly off the plat and are high confidence. Bearings are medium.
**Dog-leg shapes and exact control points are not extractable from a plat at this resolution** and
are the implementing session's job to trace, hole by hole, against the map.

## User Stories

1. As a player standing on a tee, I want the hole to be as long as the sign says, so that the club
   in my hands is the club a real golfer would pull.
2. As a player, I want yardages in yards, so that the numbers mean what they mean on every US
   course I have played.
3. As a player, I want each hole to have a shape somebody chose, so that eighteen holes are
   eighteen holes rather than eighteen samples.
4. As a player finishing the ninth, I want to arrive back at the clubhouse, so that the round has
   the shape a round has.
5. As a player driving in arena, I want the course to stop at the road, so that the world has an
   edge I can see rather than one I fall off.
6. As a player looking past the road, I want trees on the horizon, so that the boundary reads as
   the end of the property rather than the end of the map.
7. As a player, I want the clubhouse where the plat puts it, so that the most contested ground in
   arena is a real place rather than the middle of a field.
8. As a developer, I want hole geometry to be data I can read and correct, so that fixing a hole
   that plays badly is an edit rather than a re-roll.
9. As a developer, I want the authored yardage and the built corridor checked against each other,
   so that a typo in the card cannot ship as a hole that is fifty yards wrong.
10. As a developer, I want terrain, bunkers, greens and trees to stay seeded, so that the course is
    still reproducible from a small number and the server argument still holds.
11. As a developer, I want one conversion at each boundary rather than a mixed-unit codebase, so
    that no constant is ambiguous about what it measures.
12. As a developer, I want the field size derived from the corridor it has to hold, so that a
    147-yard par 3 does not reserve the same square as a 508-yard par 5.
13. As a maintainer, I want to know what the relaxation solver is still for, so that ~940 lines do
    not sit in the tree with no stated purpose.
14. As a maintainer, I want the course footprint and heightfield cost measured after the change,
    so that longer holes do not quietly triple the arena's memory.

## Implementation Decisions

**The routing is authored data; everything below it stays seeded.** A new module holds eighteen
entries of `{ index, par, whiteYards, tee, cup, control[], placement }`. `generateHole`'s drafting
and `validateHole`'s corridor checks no longer choose the centreline — they check the authored one.
Terrain noise, green ellipse shaping, bunker placement, tree scatter and the course rough all keep
their existing channels and keep drawing from `HoleSpec.seed`. **Rejected:** authoring hazards and
greens too, which would make the course a level format and give up the reproduce-from-a-seed
property for the 90% of the geometry nobody needs to hand-place.

**`CORRIDOR_BAND` and `FIELD_FOR_PAR` stop being the source of length.** The authored yardage is.
Both constants survive as *validation bounds* — widened to admit a real card, and used to catch a
typo rather than to choose a number. **Rejected:** deleting them, which would leave an authored
`58` where `580` was meant with nothing to catch it.

**`fieldSize` is derived per hole from the authored corridor's extent plus its own half-width and
blend band**, rather than looked up by par. This is what makes the longest holes fit at all: a
465 m par 5 needs a field its 300 m square cannot provide at any bearing. **Rejected:** one global
field size at the largest hole's requirement, which would make every par 3 carry a 540 m
heightfield.

**Yards at the boundaries, metres in the middle.** Authored data is in yards and converted once,
at hole construction. Display converts back. `1 yd = 0.9144 m` exactly, as one exported constant
with one definition. **Rejected outright:** converting the simulation to yards. `topSpeed`,
`CART_COLLIDER`, `COURSE_CELL_M`, every Blender asset, every gate baseline and every probe control
are metric, the physics engine is unitless-but-conventionally-metric, and the change would be a
whole-repo rewrite whose only visible effect is already achievable with one multiply at the HUD.
`MARKER_DISTANCES_M = [137, 91, 46]` becomes `[150, 100, 50]` yards converted at use, which is what
it always meant.

**The clubhouse moves to the southern boundary and the apron becomes a half-disc.** `clubhouse` is
no longer `{x: 0, z: 0}` by definition; it is authored with the routing, and the origin moves to the
course centre. **Everything that assumes the clubhouse is at the origin has to be found and
changed** — that is a search, not an assumption, and the plan says so.

**The road is a barrier, not a hazard.** An invisible wall along the southern boundary that a cart
cannot cross, with a treeline drawn beyond it. **Rejected:** making the road drivable, which the
user explicitly excluded; making it lethal, which punishes a player for finding the edge of the
map; and letting carts fall off, which is the present behaviour and is a bug rather than a design.

**The relaxation solver is retired from the shipped course and kept.** `solveCourseLayout` and
`courseRelaxation.ts` are roughly 940 lines with two specs behind them, and an authored routing
needs neither — placements are read off the plat. They stay in the tree because generating a
*different* course from a seed is still a thing this project may want, and because deleting a
working solver to save bytes is not a trade. **They must be marked as not on the shipped path**, or
the next person will spend a day debugging a solver nothing calls.

## Testing Decisions

**The failure the yardage test must detect:** an authored hole whose built corridor length does not
match its card yardage — a typo, a bad conversion, or a control point traced into the wrong place.

**What else would satisfy a naive assertion.** "Every hole is longer than 100 yards" is true of
anything. "The corridor length equals the authored yardage" is circular if the corridor is *built*
from the yardage. The assertion that bites measures the **arc length of the built spline through
the authored control points**, in metres, converts it back to yards, and compares against the card
within a tolerance — because a dog-leg's centreline is longer than its tee-to-cup line, and the
card measures the played route. A hole traced with a control point in the wrong place produces an
arc length that disagrees with its card entry, and nothing else does.

**Par and yardage must agree, and the check is not the band.** Totals are the cheap catch: front
nine 3,219 yards and par 36, back nine 2,996 and par 36, total 6,215 and par 72. Four numbers,
asserted directly, that a single mistyped hole breaks.

**The clubhouse-return test.** Hole 9's cup and hole 18's cup both finish within a stated distance
of the clubhouse. This already exists in the layout inspector and must survive the change — it is
the one structural property of a returning nine, and an authored routing can break it as easily as
a solver can.

**Corridor separation must still be asserted.** The solver guaranteed non-adjacent corridors stayed
apart; authored data guarantees nothing. The existing clearance check runs against the authored
placements, and the apron exemption becomes a half-disc against the southern edge rather than a
disc at the origin.

**The barrier test asserts a cart cannot cross, not that a wall exists.** A collider that exists but
sits at the wrong height, or is a sensor, or is on a layer the cart does not collide with, satisfies
"a wall was created" and fails the thing it is for. Drive a cart at the southern boundary at top
speed for long enough to cross it, and assert its Z is still inside. Assert the same at two more
points along the edge, because a wall with a gap passes a single-point test.

**Every unit conversion is asserted at both ends.** 508 yards is 464.5 metres and 464.5 metres is
508 yards. A conversion applied twice, or in the wrong direction, is the classic failure and it is
invisible at a glance because the numbers stay plausible.

**The gate re-baselines completely, and that is not evidence of anything.** Every course subject's
picture changes. The gate is a render check; its acceptance is a human review of whether the course
*looks like the plat*, which is the one thing a person can judge and a test cannot.

**`npm run probe:terrain` is the memory guard and is expected to move.** Longer holes mean larger
fields mean a larger course heightfield. The current measurement is 374k cells at 82 MB. The plan
measures it again and states the number; if it has grown past roughly 1.5×, the cell size is the
lever, not the routing.

## Out of Scope

- **The housing lots, roads and cul-de-sacs on the plat.** The map is a subdivision plan; only its
  golf routing is being traced. Eighty numbered lots are not coming into this game.
- **The practice range.** Visible on the plat, no mechanic behind it, and it is not a hole.
- **Blue, Gold and Red tees.** The card carries four sets. Only White is authored. The other three
  are data the same structure could hold later and no code should be written for now.
- **Regenerating the concept art or the hole-plan SVGs as design artifacts.** `npm run plan` will
  produce new pictures because the holes changed; reviewing them is in scope, redesigning what a
  plan drawing shows is not.
- **The flat course rough.** An eighteen-hole course is still only about 8% taller than a three-hole
  one, and course-scale macro relief remains its own decision.
- **Stage E's clubhouse footprint decision.** The building's 34 × 20 m footprint is unaffected by
  where the routing puts it; only its position moves.

## Further Notes

**This change reorders the queue.** Stage D scatters pickups across the course, and its site
placement reads the clubhouse position and every cup. Landing it against a routing that is about to
be replaced means verifying a scatter over a course nobody will play. The recommended order is:
the hazard tie-break first (a rule fix, independent of layout), then this, then Stage D.

Stage D survives the change better than it might have, because its assertions were written
comparatively rather than absolutely — *"packs tighter near cups than out in the rough"* holds on
any routing, where *"produces 50 sites"* would not, and the site-count assertion is already a band.
**One line does need changing**: `pickupScatter.ts`'s radius function treats `Math.hypot(x, z) <
CLUBHOUSE_APRON_M` as the apron, which assumes the clubhouse is at the origin. It should read the
clubhouse position from the layout instead — a one-line fix that makes it survive this change, and
it should be made whichever order the two land in.

**The hazard tie-break's acceptance number is course-specific and this invalidates it.** The fix
restores 8,824 m² of water measured on the current routing at seed 2026. The *rule* is unaffected —
its test is per-polygon and structural — but the area figure recorded in `DECISIONS.md` will be
measuring a course that no longer exists. Re-measure and amend after this lands.

**What the scorecard says about the current generator, beyond length.** The real card's par
distribution is 4 × par 3, 10 × par 4, 4 × par 5. Its shortest hole is 147 yards and its longest is
508 — a range of 3.5×. Whether the generator's par mix and spread match is not measured here and is
worth a look while the authored data is being entered, because if they differ the generator was
producing a *differently shaped* course as well as a shorter one.

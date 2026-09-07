# Course Design Pipeline — 18 holes, from intent to geometry

**Status:** built end to end. The plan renderer (§6), Tier 1 and Tier 2 (§5), the `HoleBrief`
schema and its eighteen briefs (§3, §4), the generator that reads them, and dog-leg-aware routing
(§9). The two defects §5.1 was written about are fixed and re-measured, and a brief's shape now
reaches the centreline as well as its hazards. What remains is a failed brief that names its own
impossible constraint (§9 step 8).
**Supersedes:** `docs/concept/hole-shot-prompts.md` (per-hole teebox/aerial concept art).
**Related:** `ASSET_PIPELINE.md` (3D assets), `superpowers/specs/2026-09-01-procedural-course-design.md` (the shipped generator).

---

## 1. Why the concept-art loop produced nothing usable

Two Gemini images were generated for hole design — a teebox shot and an "aerial" that turned out
to be the teebox shot tilted up. Neither was usable. `hole-shot-prompts.md` diagnosed that as a
prompting failure and fixed it carefully: it locked an art-style block, split teebox and aerial
into structurally different camera specs, and gave every hole a distinct biome so no two could
collapse. All of that is sound work on the wrong problem.

**The real constraint was schema capacity.** This is what the game could represent about a hole
when this document was written:

```ts
seed, index, fieldSize, cells, tee, cup, control[3], par (derived), waterLevel
```

That was the whole expressive surface. Specifically — and all three of these are now fixed, by
Tier 1 and Tier 2 respectively; they are kept in the past tense because the *argument* is what
matters, not the snapshot:

- **There are no bunkers.** Sand is a noise threshold evaluated across the entire field —
  `SAND_FREQUENCY = 0.055`, `SAND_THRESHOLD = 0.72` (`src/sim/surfaces.ts:95`). Nothing places a
  bunker anywhere, and nothing can.
- **There is no water body.** Water is any point whose terrain height falls below
  `waterLevel = -0.72`, and `validateHole` check 6 (`course.ts:189`) *rejects* any hole whose
  centreline dips below it. Water is a byproduct of noise, never a designed hazard.
- **There are no trees, biomes, or mowing stripes.** `buildGroundMesh` (`src/render/scene.ts:261`)
  is one `PlaneGeometry` with a single flat `0x4caf50` `MeshStandardMaterial`.

So a prompt asking for "a pine forest creek corridor with a stone footbridge and two greenside
bunkers" describes a hole the engine cannot represent in any field. There is nowhere to put that
information. **A better prompt could never have fixed this**, and a perfect image would have been
just as unusable as the two that prompted this document.

There is a second, independent problem. `draftHole` (`course.ts:291`) picks a random bearing,
takes whatever straight run the field allows, then solves for a *single* perpendicular apex offset
that lands the corridor length in the par band. Every hole is a symmetric single-bend arc with one
free parameter. Rotate any two generated holes into alignment and they are the same hole with
different noise. Eighteen draws from a one-parameter family is not a course.

### The images have no consumer

`docs/concept/README.md:3` states it plainly: *"nothing in this directory is loaded by the game."*
The concept images are terminal nodes in the pipeline. Nothing reads them, nothing derives from
them, and no build step consumes them. They are documentation of intent, which is a legitimate
thing to be — but it means no amount of image quality can move the project forward on its own.

**The rule this document adopts:** a generated image must either be *convertible to data* or
*explicitly marketing*. An image that is neither is a decoration with a maintenance cost.

---

## 2. The pipeline, reversed

Today: `text prompt → Gemini → JPG → (nothing)`.

Proposed:

```
  HoleBrief          generator          HoleSpec          plan render
  (authored)   ──▶   + course seed ──▶  (validated) ──▶   (SVG / PNG)  ──▶  human review
      ▲                                                                          │
      └──────────────────── iterate on the DATA ◀────────────────────────────────┘
                                                                │
                                                                ▼
                                             Gemini — downstream, decorative, optional
```

The load-bearing insight is that `terrain.heightAt(x, z)` and `surfaces.surfaceAt(x, z)` are pure,
DOM-free, Node-runnable functions — that is the `AGENTS.md` invariant that keeps `src/sim/**`
serializable to a server. So a Node script can rasterize a **true orthographic plan** of any hole
with no browser and no Three.js, in milliseconds.

That plan is **correct by construction**: it shows the hole the physics will actually simulate,
because it reads the same functions the physics reads. A Gemini aerial can never be that. It is a
plausible painting of a hole that does not exist.

### What this means for prompting

The two images that started this collapsed into each other because they were two independent
*text-to-image* draws from nearly identical prompts. Gemini 2.5 Flash Image is fundamentally an
image-**editing** model — its strength is conditioning on an input image.

**So: stop giving it text, and start giving it the engine's own plan render as a conditioning
image.** Two holes with different conditioning images cannot converge on the same output. The
failure mode is structurally eliminated rather than discouraged by wording. See §7.3.

---

## 3. `HoleBrief` — the authoring unit. **Built.**

`src/sim/briefs.ts` holds the schema below and the eighteen briefs of §4; `src/sim/briefs.test.ts`
checks them; and **`generateHole` reads them** — corridor widths come from `cover`, and every
bunker and water hazard is resolved from its declarative placement by `src/sim/placement.ts`.

Landing the data one step before the generator that consumes it was the right order: design intent
became reviewable before any generator work, and Tier 2 had something to be checked against rather
than polygons hand-tuned against nothing.

Decision: **authored brief → generated geometry.** You author intent; the generator produces
coordinates. This keeps the properties that make the current system good (a hole is reconstructible
from a `uint32`, so multiplayer ships a seed rather than a level file; rejection sampling
guarantees playability) while giving real design control over what each hole *is*.

```ts
export type Archetype =
  | 'straightaway' | 'dogleg' | 'cape' | 'double-dogleg'
  | 'island-green' | 'forced-carry' | 'drivable';

export type BiomeId = 'parkland' | 'links' | 'marsh';

/** Combat axis. Tree density in the rough — how much cover a cart fight has. */
export type Cover = 'open' | 'moderate' | 'dense';

export interface HazardSchema {
  readonly bunkers: {
    readonly count: number;
    readonly placement: readonly (
      | 'greenside-left' | 'greenside-right'
      | 'fairway-elbow' | 'landing-zone' | 'carry')[];
  };
  readonly water: null | {
    readonly form: 'crossing' | 'lateral-left' | 'lateral-right' | 'inside-elbow' | 'island';
  };
}

export interface HoleBrief {
  readonly number: number;                 // 1..18
  readonly parTarget: 3 | 4 | 5;
  readonly archetype: Archetype;
  readonly dogleg: { dir: 'none' | 'left' | 'right' | 's-curve'; severity: number }; // 0..1
  readonly biome: BiomeId;
  readonly corridor: { start: number; mid: number; end: number };  // half-widths, metres
  readonly cover: Cover;
  readonly hazards: HazardSchema;
  readonly signature: boolean;
  readonly note: string;    // strategic intent, for humans; never read by code
}
```

**Declarative, not geometric.** A brief says `placement: 'fairway-elbow'`; the generator resolves
that to coordinates using the seed and the routing it drew. This is the whole trick — it is what
lets a human specify *"a bunker where the aggressive line lands"* without hand-tuning polygons, and
what keeps two different course seeds from producing two identical courses.

**A failed brief names itself.** Today an exhausted sampler throws
`generateHole(seed, 7) exhausted 32 attempts`, which tells you nothing actionable. With briefs, the
error can say *"hole 7's cape archetype needs ≥180 m of corridor and severity 0.8 leaves only
140 m in a 220 m field"* — a statement you can act on. **Not built**; it arrives with step 6, when
the generator starts reading briefs and can therefore fail on one.

**What the test suite actually checks, and why it is written the way it is.** The briefs are
eighteen hand-typed literals transcribed from a markdown table, so a test that reads a field back
out of the same literal proves nothing — the failure this repo has a documented history of
(`docs/TEST-AND-SPEC-PITFALLS.md`). Every assertion therefore checks the briefs against something
written independently: `parTarget` against `PAR_MIX`, `biome` against `BIOME_ROUTING`, the
adjacent-dogleg rule from §4, and — the only one that can fail on plausible numbers rather than on
a typo — whether an authored corridor half-width still leaves the generator room to reach its par
band, against the exported `CORRIDOR_BAND` and `FIELD_FOR_PAR`.

That last check was a no-op when first written: it imported `BLEND_WIDTH` from `course.ts`, which
imports the constant but does not re-export it, so it arrived `undefined`, `half` was `NaN`, and
`NaN < min` is false for every hole. Vitest transpiles without type-checking, so nothing complained.
It was caught by deliberately widening the corridor to an unbuildable 30 m and watching the test
*not* fail. The check now asserts its own arithmetic is finite before trusting its verdict — and the
general lesson is the one already in `TEST-AND-SPEC-PITFALLS.md`: **get the test to fail for the
right reason before you make it pass.**

---

## 4. The course bible — 18 holes

### Structure

The superseded table gave all 18 holes a different biome: pine forest, seaside cliff, desert
canyon, alpine, tropical lagoon, autumn woodland, prairie, volcanic badlands, snowy highlands,
bamboo grove, canyon rim, orchard, marshland, vineyard, coastal dunes, redwood, sunset mesa,
clubhouse. **Eighteen climates in one round.** That reads as a theme park rather than a course, and
it costs 18 tree species, 18 palettes and 18 prop sets — the exact multiplication `ASSET_PIPELINE`
warns about.

Three biomes, in contiguous stretches, with parkland reused for the closing run:

```
   1  2  3  4  5 │ 6  7  8  9 10 11 │ 12 13 14 15 │ 16 17 18
   ─── parkland ─│─── links/dunes ──│─── marsh ───│── return ──
   gentle opener │ build            │ hard stretch│ comeback → test → reachable
```

Par 72. Front `[4,3,4,5,4,3,4,4,5]`, back `[4,5,4,3,4,4,3,4,5]` — both sum to 36, and `PAR_MIX` is
now an 18-entry card rather than a nine-hole mix cycled twice. Both nines summed to 36 either way,
so the change is not in the total: it is that the back nine no longer replays the front nine's
rhythm hole for hole. **Built**, and a test asserts every generated hole's derived par matches the
card — which also proves the corridor bands can actually hit this sequence rather than the card
being a fiction the generator ignores.

The biome routing is **built** too: `biomeForIndex` in `src/sim/course.ts`, verified across all 18
plans.

### Corridor width follows cover

`HoleBrief.corridor` is three half-widths in metres and the table below has no column for them,
because they are not eighteen independent judgement calls — they are a function of the combat axis,
and `COVER_CORRIDOR` in `src/sim/briefs.ts` is the single place they are written:

| `cover` | start / mid / end | holes | why this number |
|---|---|---|---|
| `dense` | 11 / 10 / 12 | 5, 12, 17 | The knife fights. Narrow enough that a cart cannot disengage. |
| `moderate` | 15 / 14 / 15 | eleven holes | **Exactly today's `HALF_WIDTH`** (`terrain.ts`), i.e. every hole as currently built. |
| `open` | 19 / 18 / 19 | 1, 6, 7, 9, 13, 18 | The shooting galleries. Wide enough that cover is a choice, not a given. |

Two properties of this table are load-bearing:

- **`moderate` sits on the shipped constant deliberately.** When Tier 2 lands and the generator
  finally varies corridor width, the eleven moderate holes must come out byte-identical to today or
  something is wrong — which turns a change touching all eighteen holes into one reviewable hole at
  a time.
- **Every setting pinches in the middle.** A corridor that narrows through the landing zone and
  reopens at the green is what makes a drive a decision. A constant width is a hallway.

### The 18

| # | Par | Biome | Archetype | Dogleg | Hazards | Cover | Strategic idea |
|---|-----|-------|-----------|--------|---------|-------|----------------|
| 1 | 4 | parkland | straightaway | none | 2 bunkers, landing zone | open | Wide, gentle opener. Nothing punitive. |
| 2 | 3 | parkland | forced-carry | none | water crossing, short | moderate | Small carry over the creek. First real decision. |
| 3 | 4 | parkland | dogleg | left 0.4 | 2 bunkers, fairway elbow | moderate | Cut the corner, or lay back to the wide side. |
| 4 | 5 | parkland | double-dogleg | s-curve 0.5 | 1 carry bunker, 2 greenside | moderate | Three-shot hole. Reachable only from the inside line. |
| 5 | 4 | parkland | straightaway | none | 1 bunker, greenside right | **dense** | Narrow tree corridor — the round's first knife fight. |
| 6 | 3 | links | straightaway | none | 3 pot bunkers, greenside | open | Exposed. Wind and a small target. |
| 7 | 4 | links | **cape** | right 0.8 | water inside elbow, 2 greenside left | open | **SIGNATURE.** Carry as much as you dare. |
| 8 | 4 | links | **drivable** | none | 2 bunkers, landing zone | moderate | Short, blind over a dune ridge. Eagle or trouble. |
| 9 | 5 | links | straightaway | none | lateral water right | open | Long and dead straight — a shooting gallery in combat. |
| 10 | 4 | links | dogleg | left 0.5 | 1 bunker, fairway elbow | moderate | Turn around the dune. Position over power. |
| 11 | 5 | links | straightaway | none | 2 bunkers, carry + greenside | moderate | Longest on the card. The hard stretch begins. |
| 12 | 4 | marsh | straightaway | none | lateral water left | **dense** | Narrow, boardwalk crossing. Claustrophobic. |
| 13 | 3 | marsh | **island-green** | none | water, island | open | **SIGNATURE.** All carry, no bail-out. |
| 14 | 4 | marsh | dogleg | right 0.6 | lateral water right | moderate | The whole right side is wet. Hug it or bail left. |
| 15 | 4 | marsh | forced-carry | none | water crossing, long | moderate | Full carry over wetland. Last of the hard stretch. |
| 16 | 3 | parkland | straightaway | none | 2 bunkers, greenside | moderate | Downhill and receptive. The comeback hole. |
| 17 | 4 | parkland | dogleg | left 0.7 | 2 bunkers, elbow + greenside | **dense** | Tightest driving hole on the course. The test. |
| 18 | 5 | parkland | double-dogleg | s-curve 0.3 | 1 water crossing, 2 greenside | open | **SIGNATURE.** Reachable finisher past the clubhouse. |

### Four design rules this table encodes

1. **No two adjacent holes share a dogleg direction.** Direction used to be a per-hole coin flip
   (`random() < 0.5 ? -1 : 1`), so a run of four same-way doglegs had probability 1/16 in any given
   window — likely to appear at least once across 18 holes. `draftHole` now reads `dogleg.dir`, and
   because the eighteen authored directions already satisfy this rule among themselves, honouring
   them makes it true by construction. An s-curve names no direction, so it takes the opposite of
   the hole before it, which is the rule applied rather than an exception to it.
2. **A combat axis.** `cover` and `corridor` widths are *arena* parameters, not just golf ones. A
   300 m dead-straight par 5 at 15 m half-width is a shooting gallery; a tight dogleg with dense
   cover is a knife fight. This game is the only one where that axis exists, and it was entirely
   absent from the old table.
3. **A difficulty arc**, not uniform difficulty — gentle open, build, a hard stretch at 11–15, a
   comeback at 16, the test at 17, a reachable finisher at 18.
4. **Three signature holes** (7, 13, 18). They carry the round's memory and absorb the expensive
   features, which lets the other fifteen be honest and cheap.

---

## 5. What `HoleSpec` must grow

Split into two tiers because they cost very different amounts, and the cheap tier delivers most of
the perceived result.

### Tier 1 — render-only. **Built.**

| Field | Consumer | Why |
|---|---|---|
| `biome: BiomeId` | `src/render/biomes.ts` palette | The hook that makes 18 holes look like three places. |
| `stripeAngle: number` | `src/render/ground.ts` shader | Mowing stripes are *the* signature look in concept images 03 and 05. Largest visual return per line of code in the project. |
| prop seed channel | `src/render/Trees.ts` `InstancedMesh` | Channel 3, alongside height (0), sand (1), layout (2) and stripes (4). Trees are what make a corridor read as a corridor. |

`biome` and `stripeAngle` are fields on `HoleSpec`, but **nothing in the simulation branches on
either**, so neither can alter a trajectory or a hole's playability.

**What shipped, and the three decisions worth knowing:**

1. **The ground reads the physics' own blend weights.** `src/sim/surfaces.ts` now publishes
   `weightsAt(x, z, out)` — the green and corridor falloffs `tuningAt` blends rolling resistance
   with, plus hard sand and water flags. `src/render/ground.ts` bakes those into an RGBA mask
   texture at 0.5 m per texel and colours the ground from it in a `MeshStandardMaterial`
   `onBeforeCompile` pass. The renderer therefore cannot draw a corridor edge in a different place
   from where the physics puts one, because it is not computing one — it is reading the same
   function. A colocated test asserts the two agree at every sampled point.
2. **Stripes track the playing line.** `stripeAngle` is the tee-to-cup bearing plus a seeded
   jitter of at most 22.5° (`STRIPE_JITTER`), so bands run *across* the fairway rather than at an
   arbitrary diagonal — that is the difference between reading as mowing and reading as texture.
   Greens are mown at a right angle to their fairway and at 1.5 m rather than 4 m, which is what
   makes a green read as a distinct surface from across the hole before any colour registers.
3. **Trees are one instanced draw.** One merged geometry with baked vertex colours per biome, one
   `InstancedMesh` for the whole wood, placed on a jittered grid and rejected unless the point is
   deep in rough (`corridorWeight ≥ 0.92`), clear of sand and water, and above the water line.
   Placement is seeded from channel 3, so a hole grows the same wood on every machine.

**Placeholder retired.** The palettes in `src/render/biomes.ts` are no longer hand-picked: all
three are sampled from §7.1's biome sheets with `npm run swatches`, with six fields corrected for
legibility and each correction documented in place.

### Tier 2 — sim-side. **Built.**

Landed as one change, because the four fields share module constants and each one on its own would
have left the others reading a global that no longer meant anything.

| Field | What replaced what |
|---|---|
| `corridor: number[]` per control point | `HALF_WIDTH` was read by `terrain.ts` (`budgetAt`, the `heightAt` mask), `surfaces.ts` (`corridorWeight`) and `course.ts` (check 2's room, check 4's arm, `draftHole`'s box). All five now go through `halfWidthAt(spec.corridor, t)`. |
| `green: Ellipse` | `GREEN_RADIUS` was read by `terrain.ts` (the green pad, `budgetAt`), `surfaces.ts` (`greenWeight`, `surfaceAt`) and `course.ts` (check 5). All now measure against the ellipse. |
| `bunkers: Ellipse[]` | The `SAND_FREQUENCY`/`SAND_THRESHOLD` noise field, deleted outright. Bunkers are placed and dished (`BUNKER_DEPTH`). |
| `water: Polygon[]` | "terrain below `waterLevel`", deleted as a classifier. `waterLevel` survives only as an elevation: the height the water plane renders at and the floor a basin is cut to. |

Geometry lives in `src/sim/hazards.ts` (ellipse and polygon point queries), placement in
`src/sim/placement.ts` (brief → coordinates), and `generateHole` places hazards on each drafted
candidate *before* validating it — so a hole whose water lands somewhere unplayable is a hole the
sampler redraws, rather than one that passes its checks and then has hazards added on top.

#### Three decisions that are not what §5 originally proposed

1. **Check 6 is not "the centreline is never inside a water polygon".** That was this document's
   own proposal and it is unsatisfiable: holes 2, 13 and 15 are forced carries and an island green,
   whose entire design is a centreline that crosses water. Under that wording they would have been
   exactly as unbuildable as under the old rule, just for a new reason. What a player actually
   needs is that the water be *carryable*. So check 6 is now: **the tee is dry, and no contiguous
   wet run along the centreline exceeds `DRIVER_CARRY_M` (69.5 m).** There is deliberately no
   matching check on the cup — the green beats water in `isWaterAt`, so a cup is dry by
   construction, and what makes an over-watered green unplayable is the carry it demands, which the
   wet-run rule already measures.
2. **Checks 3 and 4 skip samples inside water.** The bank of a legal crossing is a cliff by design
   — `WATER_DEPTH` over `WATER_SHORE` is a 0.25 grade against check 3's 0.11 limit — so sampling
   across it would reject every forced carry as a *slope defect* rather than judging it as a carry.
   Checks 3 and 4 ask whether the playing surface is fair; water is not a playing surface.
3. **The green beats water, where water used to beat everything.** The old order was justified by
   water being height-defined and therefore not overridable by a mowing pattern. Once water is
   placed, that reasoning is gone, and hole 13 needs the green to win or the archetype cannot
   exist. `isWaterAt` in `course.ts` is the single definition both `surfaceAt` and `validateHole`
   call — a validator that tested the raw polygons would find the island green's cup underwater and
   reject the hole.

### 5.1 The two defects the plan renderer found — **fixed, and measured**

Both were invisible before §6 existed, and neither is the kind of thing concept art can reveal.
Measured the same way both times: all 18 holes of course `0x7ee7c0` at 200×200 samples per hole.

| Surface | Before Tier 2 | After |
|---|---|---|
| green | 0.9% | 0.9% |
| fairway | 16.5% | 16.3% |
| rough | 42.8% | **77.5%** |
| sand | 2.4% | 0.2% |
| **water** | **37.5%** | **5.2%** |

- **Over a third of the course was underwater**, holes 10 and 16 over 55%. It passed validation
  because check 6 only sampled the *centreline* — the corridor stayed dry while the field around it
  flooded. `A_MACRO` works out to ~4.9 m of amplitude (`terrain.ts`), which comfortably clears the
  −0.72 water line once a field is large enough to span a macro period.

  **Now:** water appears on exactly the eight holes whose briefs ask for it (2, 7, 9, 12, 13, 14,
  15, 18) and is 0.0% on the other ten. The 5.2% that remains is placed hazard.
- **Bunkers appeared inside the fairway** — 3.6% of the mown corridor classified as sand, scattered
  as speckles rather than placed hazards.

  **Now:** the course total is 0.2%, and it is the bunkers the briefs asked for and nothing else.

**Sand geography, added after a review pass.** The first Tier 2 cut placed bunkers correctly
*relative to the line of play* and still let them drift out among the trees, because the offset was
`half + clearance + radiusZ` with nothing capping the far rim. Sand in the woods is not a hazard
anybody plays around — it is a sand patch in a forest. Bunkers are now bounded by the **tree line**:

| Where the sand is | Share |
|---|---|
| on the fairway | 92.0% |
| on the rough's first cut | 8.0% |
| **in the woods** | **0.0%** — zero cells across all 18 holes |

The bound is derived rather than written down. `WOODS_WEIGHT` (0.92) lives in `surfaces.ts` and has
two consumers that must agree: `render/Trees.ts` plants at or above it, and `sim/placement.ts` keeps
every bunker's far rim strictly below it. Change the blend and the sand line follows the tree line
automatically; there is no distance constant to fall out of step.

**The same pass found a second defect, and it is the more interesting one.** Sand loses to both the
green and water in `surfaceAt`, so a bunker overlapping either produces *no sand at all* — hole 7's
two greenside bunkers landed inside its inside-elbow water and were completely invisible while the
spec cheerfully reported `bunkers.length === 2`. Placement now runs after water on each candidate
and searches along the corridor for ground clear of both. The test that caught it asserts a hole
placing bunkers must actually *show* sand, which is the kind of claim that is easy to assume and
was false on 1 hole in 18.

Neither was a rendering bug. Both were the honest output of the old generator, and both are the
argument for Tier 2 that nobody had evidence for until the plans existed.

---

## 6. The plan renderer — built

`tools/holePlan.ts`, run with `npm run plan`. Follows the existing `feelProbe` pattern exactly: a
vite SSR build (`tools/holePlan.vite.config.ts`) emits a Node-runnable ESM bundle, then Node runs
it. It imports the real `src/sim` modules — no copies, no reimplementation — which is what makes
its output authoritative rather than merely plausible.

```
npm run plan                                  # 18 holes → docs/course/plans/hole-NN.svg
npm run plan -- --seed=0x1234 --holes=9       # a different course
npm run plan:png                              # SVG → tools/.plan-png/hole-NN.png, for §7.3
```

`plan:png` is a separate script rather than a step inside `plan` because `npm run plan` must stay
pure: it writes the committed SVGs and its clean-`git diff` determinism check below is a house
rule. It runs `tools/planPng.mjs --scale=2`, giving 2256 px PNGs from the 1128 px SVGs — an image
model wants the larger raster, and the SVG rasterizes losslessly at any scale.

**The PNGs land in `tools/.plan-png/`, a sibling of `tools/.plan-out/` and not a child of it.**
That is load-bearing rather than tidy: `holePlan.vite.config.ts` sets `emptyOutDir: true` on
`tools/.plan-out`, so every `npm run plan` wipes that directory. The PNGs originally defaulted
inside it, which meant regenerating the plans silently deleted the conditioning images §7.3 tells
you to attach — and since the directory is gitignored, the deletion looked exactly like never
having run the tool.

Each plan draws:

- **surface fill** by sampling `surfaces.surfaceAt` on a 200×200 grid, run-length encoded into
  horizontal rects (one rect per sample would be 40,000 elements per hole)
- **elevation contours** by marching squares over `terrain.heightAt`, at a "nice" interval chosen
  per hole to land near nine lines
- **the centreline spline and corridor edges**, offset by `HALF_WIDTH` along the spline normal
- **distance rings from the tee at 69.5 m (driver carry) and 129 m (`REFERENCE_CARRY_M`, total)** —
  the feature that makes this a design tool rather than a picture. Every hazard-placement decision
  is really a question about where a drive lands, and these rings answer it directly.
- tee and cup markers, green circle, scale bar, north arrow
- a title block: hole number, par, corridor length, tee-to-cup separation, field size, contour
  interval, seed

**SVG, not PNG**, because it is diffable in git, needs no dependency, and stays legible at any zoom.
The 18 plans are ~2.9 MB of text that git stores as ~0.55 MB compressed. `tools/planPng.mjs`
rasterizes them via Puppeteer (already a devDependency, used by the scene gate and the smoke check)
when a raster is needed for §7.3.

**The PNGs are not committed** — `tools/.plan-out/` is gitignored, because they are an image
model's input rather than documentation, and they regenerate from the SVGs in seconds. That is the
right call and it has one cost, paid once already: a reader who finds §7.3's `[Attach: …hole-NN.png]`
and goes looking for the directory finds nothing, with no indication whether it is missing or
merely unbuilt. Hence the pointer in §7.3.

**Determinism.** The default seed is fixed, so `npm run plan` twice produces a clean `git diff`. A
wall-clock or random default would make every run a spurious change.

---

## 7. What to give Gemini

Four jobs. Each states its consumer — that is the §1 rule made operational.

Keep the **art-style block** from `hole-shot-prompts.md` §1 verbatim in every prompt below. It is
genuinely well-built and hard-won, and it is the one part of that document that survives. Discard
its camera specs and its 18-biome table.

### 7.1 Biome style sheets → *consumer: `BIOMES` in `src/render/biomes.ts`*

The highest-value image job in the project. Three images that change what ships, versus 36 scene
paintings that change nothing.

**Nine swatches per biome, not six.** An earlier draft of this section asked for six and included
*out of bounds* — which is not a surface this game has (`SurfaceId` is green, fairway, rough, sand,
water). It also never asked for the sky or the three foliage tones, which `BiomePalette` does
consume. So it specified one colour nothing could use and omitted four the renderer needs. The
mapping from swatch label to field is:

| Swatch label | `BiomePalette` field | parkland | links | marsh |
|---|---|---|---|---|
| PUTTING GREEN | `green` | `0xa2db31` | `0xccbf89` † | `0xa3c240` |
| FAIRWAY | `fairway` | `0x5fa53a` | `0xb3aa74` | `0x58863b` |
| ROUGH | `rough` | `0x59823f` | `0x968f64` † | `0x506441` |
| SAND | `sand` | `0xddbf84` | `0xe5cd9d` | `0x979283` † |
| WATER | `water` | `0x4a91aa` | `0x6a8c98` | `0x564735` † |
| SKY | `sky` | `0x55b1ef` | `0xd0d1d2` | `0x939e90` |
| FOLIAGE LIGHT | `foliageLight` | `0x669f34` | `0xc5b884` | `0x949f62` |
| FOLIAGE DARK | `foliageDark` | `0x446327` | `0x8a8359` | `0x404f2b` |
| TRUNK | `trunk` | `0x654e3e` | `0x654f42` | `0x423a33` † |

**Done — these are the shipped values**, sampled from the three sheets with `npm run swatches`.
Six fields marked † were corrected off the sheet for legibility; `src/render/biomes.ts` records
each one with its before/after numbers and its reason. `treeDensity`, `treeHeight` and `treeForm`
are **tuned, not sampled** — a sheet must never change them.

**Retired: asking the model to print hex codes under the swatches.** An earlier version of these
prompts did, on the theory that a printed value beats eye-droppering a JPEG. On the first real
parkland sheets, *not one printed code matched its swatch*: several were the literal string
`#RRGGBB` copied out of the prompt, several contained non-hex characters (`#899G42`, `#0UEGBF`),
several were seven characters long, and the ones that were valid hex named entirely different
colours -- a magenta `#C11ACF` printed under a sky-blue swatch. Image models draw text as pixels
and cannot encode precise alphanumerics.

**Read the colours with `npm run swatches` instead** (`tools/readSwatches.mjs`). It detects the
swatch rectangles, takes the median over the middle of each -- exact, repeatable, and immune to
both JPEG ringing and to whichever pixel a human would have clicked -- runs contrast checks on the
pairs that carry gameplay meaning, and prints the `biomes.ts` entry ready to paste:

```
npm run swatches -- <image> --biome=parkland
npm run swatches -- <image> --inspect            # just list what it found
```

The swatch *labels* do come through correctly, and are what the field mapping is read from. When a
sheet pads its layout by duplicating a swatch, the tool refuses to guess and asks for an explicit
`--map=<index>:<field>,...`.

**What the first real run of this actually needed**, so the next one is not a surprise:

- **The sheets come back as two stacked panels** — swatches above, prop silhouettes on their own
  darker ground below — which is what the prompt asks for. The tool now finds that seam itself and
  reads only the panel above it. (It did not originally, and failed loudly but confusingly:
  `grid 1 x 1 = 1 swatches`, because the silhouette ground won the background vote.)
- **A 5-across-then-4 layout detects as a 5×2 grid of ten cells**, the tenth being the empty slot
  beside TRUNK. Ten is not nine, so the tool refuses to guess and wants a map. For all three
  sheets so far that map is simply the canonical order:
  `--map=0:green,1:fairway,2:rough,3:sand,4:water,5:sky,6:foliageLight,7:foliageDark,8:trunk`.
  Read the labels off the image and confirm before trusting it — a sheet that reorders or
  duplicates a swatch is exactly what the refusal exists to catch.
- **Contrast is checked, not assumed.** Expect `LOW` results and treat them as a prompt to look
  at the sheet in the game, not as an automatic rejection — see the legibility note below.

These use a trimmed style preamble rather than the full art-style block from
`concept/hole-shot-prompts.md`. That block describes a *scene* — carts, fairway stripes, cone
trees, clouds — and these sheets explicitly forbid a scene, so carrying it in whole would fight
the rest of the prompt. This is a deliberate exception to the "keep the block verbatim" rule in
§7, not an oversight.

The three prompts are long and are meant to be pasted unmodified. They live in full in the
published artifact for this document, with a copy button on each; the parkland one is reproduced
here so the repo is self-sufficient, and links and marsh differ from it only in the biome
description paragraph, the nine swatch descriptions, and the shrub/reed form in the bottom region.

**Prompt 1 of 3 — parkland:**

```
Produce a flat colour specification sheet for the PARKLAND biome of a stylised low-poly
arcade golf game. This is a technical colour reference sheet, NOT a scene, NOT a landscape
and NOT an illustration.

Style: flat saturated cartoon colour. No gradients, no texture, no shading, no lighting,
no naturalistic colour grading, no photographic detail anywhere in the image.

PARKLAND means a lush inland tree-lined golf course in temperate summer: rich saturated
grass greens, deep pine and broadleaf woodland, a clear bright blue sky, and clean blue
water. It is the most colourful and most conventionally "golf course" of the three biomes.

TOP REGION — exactly NINE flat colour swatches, laid out as five across the top row and
four across the second row. Each swatch is a plain rectangle of a single solid uniform
colour: no gradient, no texture, no shading and no lighter or darker edge anywhere in it,
including in the SKY swatch. Beneath each swatch print its NAME in small clean sans-serif
type, exactly as written below. Print the name and nothing else — no hex code, no number.

There must be exactly nine swatches. Do not repeat a swatch to pad out the layout, do not
add a tenth, and do not change their order.

The nine swatches, in reading order:
  1. PUTTING GREEN   the mown putting surface. The brightest, most yellow-green.
  2. FAIRWAY         mown fairway turf. Clearly darker than PUTTING GREEN.
  3. ROUGH           unmown grass. Clearly darker and duller than FAIRWAY.
  4. SAND            bunker sand.
  5. WATER           pond and creek water.
  6. SKY             the sky at the horizon.
  7. FOLIAGE LIGHT   the lit tone of tree foliage.
  8. FOLIAGE DARK    the shadow tone of the same foliage. Clearly darker.
  9. TRUNK           tree trunk and branch colour.

Requirements: PUTTING GREEN, FAIRWAY and ROUGH must be three clearly distinguishable
values that step consistently darker in that order. FOLIAGE DARK must be clearly darker
than FOLIAGE LIGHT. All nine must read as one harmonious palette and must belong
unmistakably to PARKLAND.

BOTTOM REGION — on a plain neutral mid-grey background, a row of five conifer and
broadleaf tree silhouettes native to parkland woodland, drawn as simple flat-shaded
low-polygon forms using only the FOLIAGE LIGHT, FOLIAGE DARK and TRUNK colours above.
Front elevation only. True orthographic projection, no perspective, no foreshortening.
No ground plane, no cast shadows, no environment. Evenly spaced with clear space between
them. These are silhouette references for 3D modelling.

Do NOT include: a golf cart, a fairway, a horizon, a rendered sky, characters, a title,
a watermark, or a decorative border.
```

**Prompt 2 of 3 — links.** Same skeleton, with:
- *Biome paragraph:* an exposed treeless coastal dune course under heavy overcast — pale sandy
  soil, bleached tan-green marram grass instead of lush turf, flat grey-white sky, cold grey-blue
  sea. Explicitly: **must not look like a sunny inland course with lighter grass.**
- *ROUGH:* unmown marram and fescue — tan-green, **not** a deep green. *WATER:* cold grey-blue sea.
  *SKY:* flat overcast. *FOLIAGE:* low coastal scrub and gorse.
- *Bottom region:* five **LOW WIDE** shrub silhouettes, wider than tall, **not trees**; add "tall
  trees" to the do-not-include list.

**Prompt 3 of 3 — marsh.** Same skeleton, with:
- *Biome paragraph:* humid lowland wetland in hazy still air — muted darker greens, peaty
  brown-teal standing water rather than blue, dull grey-green haze instead of blue sky, tall reeds
  and willows. Darker and more muted than parkland, and noticeably **greener and warmer than links**.
- *SAND:* damp, greyer than dry sand. *WATER:* peaty brown-teal, **not blue**. *SKY:* hazy
  grey-green. *FOLIAGE:* reed and willow.
- *Bottom region:* five **TALL NARROW** reed-clump and willow silhouettes, much taller than wide;
  add "broad round trees" to the do-not-include list.

**Applying the results.** Hand the three images to a fresh session with the handoff prompt in the
published artifact. It maps labels to fields, tells the session to use `npm run swatches` and to
trust neither the printed codes nor its own eye, forbids touching the tuned fields, and specifies
the verification order — `tsc`, `npm test`, `npm run build`, then `npm run plan`, where **the plans
must come back byte-identical**: `biomes.ts` is render-only, so a changed plan means something
leaked into `src/sim/`. Finish by screenshotting one hole per biome (1, 7, 13) from the running
game; the contrast numbers are a filter, not the verdict.

**The legibility failure worth expecting.** The links sheet came back with `green`, `fairway` and
`rough` within 18 luminance of each other. That reads as three plausible shades on the sheet and as
*one flat khaki field with no corridor edge at all* from the chase camera — only the mowing stripes,
a 7% sheen that washes out with distance, said where the fairway was. It is the biome most at risk,
because a real links course genuinely is monochrome; the prompt's "must not look like a sunny inland
course with lighter grass" pushes toward exactly this. **A sheet is not finished until a hole in
that biome has been looked at.** The corrections, and the rule used to decide them, are documented
in `src/render/biomes.ts`:

- Judge same-hue-family pairs (turf against turf, foliage against foliage) on luminance. That is
  what the tool's three built-in checks are, and why they are the right three.
- Do **not** apply a luminance threshold across hue families. Parkland's blue water sits 15.3 from
  its green rough and reads instantly.
- Hue only separates a pair when both colours carry enough saturation to show it. Marsh's sampled
  `sand` was 52° off its fairway but at sat 0.13, and read as patches of mist on the turf.
- Correct by scaling all three channels uniformly. Hue and saturation hold; only value moves.
### 7.2 Prop silhouette sheet → *consumer: the modelling pass in `ASSET_PIPELINE.md`*

**Run once: `docs/concept/reference/prop-silhouettes-01.jpg`**, eight props, with its deviations
recorded in that folder's README. Two are worth carrying here because they will recur on any re-run:

- **"Uniform scale across all props" does not survive.** Each prop is scaled to fill its own cell,
  so a 2.5 m flagstick and a 0.3 m tee marker come back the same height. Treat the sheet as
  proportion *within* a prop and never as scale *between* props. If relative scale is what you
  need, ask for the props standing on one shared ground line with a human figure or a cart for
  scale — that is a different sheet, and it is a scene, so it fights the rest of this block.
- **Anything with a deck or a span reverts to three-quarter view.** The footbridge and the boardwalk
  came back in perspective with receding planks despite "FRONT ELEVATION ONLY". This is arguably the
  model being right — a span read dead-on is a line — but it means the deck width they show is a
  perspective artefact, not a measurement.

```
[ART-STYLE BLOCK]

Produce an orthographic silhouette reference sheet for 3D modelling. This is a modelling
reference, NOT a scene.

Plain neutral mid-grey background. A grid of the following props, each drawn in FRONT
ELEVATION ONLY — true orthographic projection, no perspective, no foreshortening, no cast
shadow, no ground plane, no environment. Each prop is a simple flat-shaded low-polygon form
in two or three flat tones. Label each in small clean sans-serif type beneath it.

Props: [PROP LIST — e.g. flagstick with pennant, tee marker, bunker rake, ball washer,
distance post, wooden footbridge, boardwalk section, cart-path sign]

Uniform scale across all props, consistent lighting direction, evenly spaced on the grid with
clear space between items. No golf cart. No characters. No sky. No decorative border.
```

### 7.3 Hole styling, image-to-image → *consumer: mood and marketing only*

**This is the prompt that replaces both of the images that started this document.** It takes the
plan PNG from §6 as a conditioning image, so the layout is the engine's, not the model's.

**First, run `npm run plan:png`.** `tools/.plan-png/` is gitignored and regenerable, so on a
fresh clone it does not exist — an empty directory here means unbuilt, never missing. The three
signature holes (7, 13, 18) are the ones worth an image model's time.

```
[Attach: tools/.plan-png/hole-NN.png]

[ART-STYLE BLOCK]

The attached image is an exact top-down architectural plan of hole [N] of a golf course. It is
a technical drawing, and its geometry is authoritative.

Re-render this EXACT layout as a stylised low-poly bird's-eye illustration. You must preserve,
without alteration:
  - the precise shape and curvature of the fairway corridor
  - the position of the tee (white square) and the green (white circle with flag)
  - the position, shape and extent of every water region (blue) and sand region (tan)
  - the overall proportions and orientation of the hole

Replace only the presentation: render the flat plan colours as stylised low-poly terrain with
visible facets and a mown zig-zag stripe pattern on the fairway and green; add simple
flat-shaded cone trees in the rough areas; add a soft flat-gradient sky at the horizon.

Remove from the output: the dashed distance rings, the dashed corridor edges, the contour
lines, all text labels, the title block, the scale bar, the north arrow, and the legend.

Do NOT redesign the hole. Do NOT move, resize, add or remove any hazard. Do NOT straighten or
simplify the fairway shape. The layout is fixed; only the rendering style changes.
```

Label every output of this prompt as illustration. It is downstream of the design, never an input
to it.

### 7.4 Key art → *consumer: `public/`, an `og:image`, a store page*

Ordinary marketing generation. No pretense of being a spec, no per-hole variants, and it ships from
`public/` rather than `docs/` per `docs/concept/README.md`'s rule.

---

## 8. What never to ask Gemini for

- **Layout and routing.** That is §6. Correct by construction, regenerable, diffable, free.
- **Teebox sightlines** — *"can the player read this hole from the tee?"* This is the one that looks
  like an art question and is not. It is a camera question about real geometry, and only the built
  hole can answer it. `tools/sceneGate.mjs` already exists and `npm run gate` is wired into
  `npm run build`; point a fixed camera at the tee position and screenshot. A painted teebox view
  tells you whether an *imagined* hole reads well, which is not a fact about the game.
- **Anything you intend to trace for geometry.** See `ASSET_PIPELINE.md` §7 — AI raster output is a
  reference to model over, and `docs/concept/README.md` records why this folder is tracked by
  provenance rather than licensed.

---

## 9. Build order

1. ~~**`npm run plan` against today's generator.**~~ **Done.** It established the §5.1 baseline and
   is the review surface for everything below.
2. ~~**Tier 1 fields** (§5) — biome palette, mowing stripes, tree instancing.~~ **Done**, along
   with the 18-hole par card.
3. ~~**§7.1 biome sheets** for the three biomes, sampled into `src/render/biomes.ts`.~~ **Done.**
4. ~~**`HoleBrief` schema and the 18 briefs** (§3, §4) as data.~~ **Done.** `src/sim/briefs.ts`.
5. ~~**Tier 2 fields** (§5) — corridor widths, elliptical greens, placed bunkers, water polygons.~~
   **Done**, as one change. §5.1 re-measured: water 37.5% → 5.2%, fairway sand 3.6% → 0.00%.
6. ~~**The generator consumes the briefs.**~~ **Done**, and it landed with Tier 2 rather than after
   it — without it the four new fields existed and were always empty, which is the "data with no
   consumer" problem this whole document is about.
7. ~~**Archetype-aware routing.**~~ **Done**, and it turned out to be *dog-leg-aware* routing:
   `dogleg.dir` and `dogleg.severity` fully specify a centreline, so `archetype` stays what it was,
   a hazard-placement input. An archetype switch on top of the two fields that already say the
   shape would have been a second and contradictory source of it.

   **What was actually wrong was worse than "every centreline is a single-bend arc".** The apex
   offset was solved *backwards* out of the length residual — take whatever straight run the box
   allowed, then `sqrt((target/2)² − (straight/2)²)` for the rest, on a coin-flipped side — so the
   bend's existence, direction *and* size were accidents of how the box happened to clip the
   corridor length. Measured against the briefs: seven of the eight straightaways bent (hole 11 by
   116 m on a severity-0 brief), three of the four dog-legs bent against their stated direction, and
   hole 7 — the signature cape at severity 0.8 — came out dead straight. `severity` was read by
   nothing at all.

   The solve is now shape-first. `severity × DOGLEG_MAX_TURN` (45°) is the angle each leg makes with
   the tee-to-cup line, which fixes the lateral offset and the tee-to-cup distance together and
   leaves the polyline exactly `target` long, so par stays pinned to the brief. An s-curve gets four
   control points and starts opposite the hole before it, which makes design rule 1 of §4 true by
   construction rather than by a 1-in-16 coin flip. `src/sim/routing.test.ts` asserts the mapping —
   the recovered angle against `severity × DOGLEG_MAX_TURN`, not merely that more severity bends
   more.

   **Two things fell out of building it, both worth knowing:**

   - **The band and the field contradict each other for a straight par 5.** `CORRIDOR_BAND[5]` runs
     to 375 m, but a par 5 with a 19 m corridor has 242 m of room axis-aligned in its 300 m field
     and 342 m on the diagonal. The top of that band describes a hole no par-5 field can hold
     straight, at any bearing. The old generator hid this by bending — hole 11's 116 m dog-leg *was*
     this contradiction wearing a disguise. `draftHole` now chooses its bearing from the arc that
     fits (1° resolution, because the worst case's feasible arc is under a degree wide) and, only
     when nothing fits at any bearing, squeezes the whole routing to the tightest orientation. The
     squeeze keeps a par 5 a par 5 — 375 m squeezes to 342, well over `derivePar`'s 258 m threshold
     — but the honest fix is in the authored numbers, either a larger `FIELD_FOR_PAR[5]` or a lower
     `CORRIDOR_BAND[5].max`, and that is a design call rather than a generator one.
   - **The box is now stated once.** `draftHole` used to compute its own `reach` and clamp against
     it while `validateHole` check 2 walked the spline against a separately-written box. Both now
     call `corridorBox`, so a bearing the draw believes is legal is one the check accepts.

   Acceptance rate is unchanged and slightly better: over 720 hole draws, mean 1.19 attempts either
   side of the change, worst case 6 → 4, zero exhaustions.
8. **A failed brief that names itself** (§3). ← *next.* Still unbuilt. Now that the generator reads
   briefs it can say *which constraint* was impossible instead of `exhausted 32 attempts`.

Re-run `npm run plan` after every step. A course change that does not show up in the plans either
did nothing or did something you did not intend.

### Known rough edges in what shipped

- **Hazard outlines are rectangles.** `placement.ts` draws water as a band in the centreline's
  local frame and the island as a square. It is honest geometry and correct to the metre, but a
  real hazard has an irregular bank. Jittering the polygon vertices is cheap and purely cosmetic;
  it is deliberately not done yet because a rectangle makes a placement bug obvious in a plan and
  a lobed blob hides one.
- **A greenside bunker may end up on the other side.** When neither bank at any sampled `t` is
  clear of water, placement takes the opposite side rather than shipping an invisible bunker. It
  is a compromise on the brief's intent. Step 7 was expected to relieve this by giving the water
  somewhere less greedy to go, and on hole 7 it visibly does — the lake now fills a real elbow
  rather than sprawling across a straight corridor — but the compromise path still exists and is
  still reachable.
- **`fixedHoleSpec()` is deliberately hazard-free.** It is what the cart, ballistics and probe
  suites run against, so a physics regression is never confused with a hazard landing under the
  ball. Any test whose subject *is* sand or water builds its own spec.
- **`ellipseEdgeDistance` is an approximation.** Exact for a circle — the case that had to stay
  byte-identical — and under-estimates by at most the axis ratio elsewhere. The exact distance to
  an ellipse needs a quartic solve, which does not belong in `heightAt`.

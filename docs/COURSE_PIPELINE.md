# Course Design Pipeline — 18 holes, from intent to geometry

**Status:** the plan renderer (§6) and all of Tier 1 (§5) are built and running. The `HoleBrief`
schema (§3) and Tier 2 (§5) are still specifications.
**Supersedes:** `docs/concept/hole-shot-prompts.md` (per-hole teebox/aerial concept art).
**Related:** `ASSET_PIPELINE.md` (3D assets), `superpowers/specs/2026-09-01-procedural-course-design.md` (the shipped generator).

---

## 1. Why the concept-art loop produced nothing usable

Two Gemini images were generated for hole design — a teebox shot and an "aerial" that turned out
to be the teebox shot tilted up. Neither was usable. `hole-shot-prompts.md` diagnosed that as a
prompting failure and fixed it carefully: it locked an art-style block, split teebox and aerial
into structurally different camera specs, and gave every hole a distinct biome so no two could
collapse. All of that is sound work on the wrong problem.

**The real constraint is schema capacity.** Here is everything the game can represent about a
hole, from `HoleSpec` (`src/sim/course.ts:30`):

```ts
seed, index, fieldSize, cells, tee, cup, control[3], par (derived), waterLevel
```

That is the whole expressive surface. Specifically:

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

## 3. `HoleBrief` — the authoring unit

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
140 m in a 220 m field"* — a statement you can act on.

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

1. **No two adjacent holes share a dogleg direction.** Today direction is a per-hole coin flip
   (`course.ts:319`, `random() < 0.5 ? -1 : 1`), so a run of four same-way doglegs has probability
   1/16 in any given window — likely to appear at least once across 18 holes.
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

### Tier 2 — sim-side. Expensive; lands as one change.

These share module constants, so they cannot be done independently.

| Field | Blast radius |
|---|---|
| `corridorWidth: number[]` per control point | `HALF_WIDTH` is read by `terrain.ts` (`budgetAt`, `heightAt` mask), `surfaces.ts` (`corridorWeight`), and `course.ts` (`validateHole` room, `draftHole` half). Widest of the set. |
| `green: { center, radiusX, radiusZ, rotation }` | `GREEN_RADIUS` is read by `terrain.ts` (pads, `budgetAt`), `surfaces.ts` (`greenWeight`, `surfaceAt`), `course.ts` (check 5). |
| `bunkers: Ellipse[]` | Terrain depression + hard classification in `surfaces.ts`. Replaces the noise scatter — see §5.1. |
| `water: Polygon[]` | **Requires relaxing `validateHole` check 6** from *"centreline never below `waterLevel`"* to *"centreline never inside a water polygon"*. Without this, holes 2, 13 and 15 are unbuildable by construction. |

### 5.1 Two defects the plan renderer found immediately

Both were invisible before §6 existed, and neither is the kind of thing concept art can reveal.
Measured across all 18 holes of course `0x7ee7c0` at 200×200 samples per hole:

| Surface | Share of course |
|---|---|
| green | 0.9% |
| fairway | 16.5% |
| rough | 42.8% |
| sand | 2.4% |
| **water** | **37.5%** |

- **Over a third of the course is underwater.** Holes 10 and 16 exceed 55%. This passes validation
  because check 6 only samples the *centreline* — the corridor stays dry while the field around it
  floods. `A_MACRO` works out to ~4.9 m of amplitude (`terrain.ts:70`), which comfortably clears
  the `-0.72` water level once a field is large enough to span a macro period. The fixed test hole
  is 160 m and shows 1.4% water; the generated 300 m par 5s show 25–46%.
- **Bunkers appear inside the fairway.** 3.6% of the mown corridor classifies as sand, scattered as
  small speckles rather than placed hazards — visible as tan confetti across every plan. A noise
  threshold produces texture, not bunkers.

Neither is a rendering bug. Both are the honest output of the current generator, and both are
arguments for Tier 2 that no one had the evidence for until the plans existed.

---

## 6. The plan renderer — built

`tools/holePlan.ts`, run with `npm run plan`. Follows the existing `feelProbe` pattern exactly: a
vite SSR build (`tools/holePlan.vite.config.ts`) emits a Node-runnable ESM bundle, then Node runs
it. It imports the real `src/sim` modules — no copies, no reimplementation — which is what makes
its output authoritative rather than merely plausible.

```
npm run plan                                  # 18 holes → docs/course/plans/hole-NN.svg
npm run plan -- --seed=0x1234 --holes=9       # a different course
node tools/planPng.mjs                        # SVG → PNG, for image-model conditioning
```

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

```
[Attach: tools/.plan-out/png/hole-NN.png]

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
   with the 18-hole par card. Render-only, cannot break the sim, and delivers most of the
   perceived "18 distinct holes".
3. ~~**§7.1 biome sheets** for the three biomes, sampled into `src/render/biomes.ts`.~~ **Done.**
   All three sheets generated, read with `npm run swatches`, six fields corrected for legibility.
4. **`HoleBrief` schema and the 18 briefs** (§3, §4) as data, with the generator still ignoring
   most fields. Cheap, and it makes the intent reviewable before any generator work. ← *next, and
   it needs no image model — the 18 briefs are the §4 table transcribed.*
5. **Tier 2 fields** (§5), one at a time, each re-verified with `npm run plan`. Water polygons
   first — the 37.5% finding is the most serious thing in this document.
6. **Archetype-aware generation** — the generator finally consumes the briefs.

Re-run `npm run plan` after every step. A course change that does not show up in the plans either
did nothing or did something you did not intend.

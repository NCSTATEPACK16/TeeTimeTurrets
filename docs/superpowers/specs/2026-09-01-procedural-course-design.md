# Procedural Course Generation — Design

**Date:** 1 Sep 2026 · **Status:** approved, not yet implemented · **Roadmap slot:** Phase 2.5

Source research: `docs/RESEARCH-TERRAIN.md`. Read its "Reconciliation with this codebase"
section before implementing anything here — this spec adopts the research's *architecture* and
rejects its *constants*.

## 1. Decision

Adopt the research's §4 (slope budgets) and §5 (spline corridor, carving, rejection sampling),
plus the seed refactor that both depend on. **Defer** §1.2/§2/§3 — the decoupled Delaunay
render mesh, hierarchical jitter, and Voronoi biome colouring — to a later phase.

Three reasons the split falls here:

1. The committed target is 9 → 18 holes → multiple courses. All of that lives in §4/§5. None of
   it is in §1–§3, which is aesthetics.
2. §1–§3 produces exactly the geometry `tools/sceneGate.mjs` exists to guard, and that gate is
   still unbuilt (`ROADMAP.md` Phase 1, open since Phase 1). This phase changes no rendering,
   so the missing gate does not bite, and it buys time to build the gate before the geometry
   that needs it arrives.
3. This phase is verifiable headlessly with tooling that already exists. `npm run probe`
   already reports terrain slope statistics; the rejection sampler is that measurement turned
   into an assertion.

**Consequence for the asset pipeline.** Nothing in this phase touches Blender. The deferred
§1–§3 work is where the visual language gets locked, so the Blender primitive-graph prop
exporter pairs with *that* phase, not this one. The two tracks run in parallel with no shared
files.

### A course is nine holes, not one nine-hole map

Each `HoleSpec` owns its own field, terrain, and surfaces. Playing a round loads one hole at a
time. A course is an ordered list of specs; a second course is a second list. This is what makes
"multiple courses, one selected at a time" fall out of the data model rather than needing
streaming, chunking, or a level format.

## 2. The measured constant

The research's §4.1 gives the per-octave max gradient as `A · f · k` with `k ≈ 2.5`;
`src/sim/terrain.ts` gives the same relation with `k = 2π`. Measured directly against the
installed `simplex-noise` build (central differences at `h = 1e-4`, 1,002,001 samples over a
20 × 20 domain at 0.02 spacing):

| statistic of ‖∇S‖ | value |
|---|---|
| **max** | **7.333** |
| rms | 2.955 |
| mean | 2.672 |

Neither source is correct; the research's 2.5 is the *mean* gradient. Cross-checked against
shipped terrain, sum-of-max at `k = 7.333` predicts 13.6° max / 5.1° mean against the probe's
measured 12.5° / 4.3° — conservative by ~9%, because octave peaks rarely coincide, which is the
right direction for a budget.

`k` is a property of the installed dependency and can change under a version bump, silently
invalidating every amplitude below. It is therefore an assertion in `npm run probe`, not a
number in a document. See §7.

## 3. Data model

New module `src/sim/course.ts`. Plain data, DOM-free, no Rapier, no Three.

```ts
export interface Vec2 { readonly x: number; readonly z: number }

export interface HoleSpec {
  /** uint32. Every derived noise channel and layout choice hashes from this. */
  readonly seed: number;
  /** 0-based position within the course. Part of the channel hash, so hole 3 of two
   *  different courses with the same course seed still differ. */
  readonly index: number;
  /** Square field, metres. Per-hole rather than global — a par 5 needs more room. */
  readonly fieldSize: number;
  /** Heightfield rows == cols. Cell size is fieldSize / cells and must stay near 1.0 m:
   *  a coarser cell makes triangle seams big enough for the 0.15 m ball to trip over. */
  readonly cells: number;
  readonly tee: Vec2;
  readonly cup: Vec2;
  /** Corridor centreline control points, tee first and cup last, length >= 3.
   *  Interior points are dog-leg apexes. */
  readonly control: readonly Vec2[];
  /** Derived from corridor length by generateHole. Never authored. See §6. */
  readonly par: number;
  readonly waterLevel: number;
}

export interface Course {
  readonly id: string;
  readonly name: string;
  readonly seed: number;
  readonly holes: readonly HoleSpec[];
}
```

### Terrain and surfaces become factories

`src/sim/terrain.ts` stops exporting module constants and exports:

```ts
export interface Terrain {
  readonly spec: HoleSpec;
  heightAt(x: number, z: number): number;
  buildHeightfield(): Float32Array;
  readonly teePosition: Vec3;
  readonly cupPosition: Vec3;
}
export function createTerrain(spec: HoleSpec): Terrain;
```

`src/sim/surfaces.ts` likewise:

```ts
export interface Surfaces {
  /** Discrete. Feeds HUD readout, Phase 4's minimap, and render colouring. */
  surfaceAt(x: number, z: number): SurfaceId;
  /** Continuous. Writes into a caller-owned scratch object — see the allocation note. */
  tuningAt(x: number, z: number, out: MutableSurfaceTuning): void;
}
export function createSurfaces(spec: HoleSpec, terrain: Terrain): Surfaces;
```

**A closure, not a class.** `heightAt` must remain a pure function of `(x, z)` for a given
hole — that is what lets the authoritative server evaluate it without replicating any mesh or
spatial index (research §1.3). A closure over immutable spec data preserves that; an object
with mutable state would not.

**`tuningAt` must not allocate.** `Sim.step` calls it every tick, and `AGENTS.md` forbids
per-frame allocation in the fixed-tick hot loop. Today it returns a reference into the frozen
`SURFACES` table, which is free; a *blended* result is a new value and would allocate. It
therefore writes into a caller-supplied scratch object, matching the existing
`Sim.muzzle(out: Vec3)` idiom. `SurfaceTuning` stays `readonly`; a `MutableSurfaceTuning`
sibling type is added for the scratch.

### Seeding

`Math.random()` remains banned in `src/sim/**` and `src/physics/**`. `src/sim/rng.ts` gains
`mulberry32(seed)` and `hashChannel(seed, ...ints)` (research §2.4). Three channels derive from
`HoleSpec.seed`:

| channel | consumer |
|---|---|
| `hashChannel(seed, index, 0)` | height noise (Micro/Meso/Macro share it at different frequencies) |
| `hashChannel(seed, index, 1)` | sand placement — separate so bunkers do not correlate with hills |
| `hashChannel(seed, index, 2)` | layout: tee, cup, and dog-leg apex selection |

This replaces the hardcoded `createNoise2D(() => 0.42)` and `(() => 0.77)` literals.
`BACKLOG.md #5` (seeded aim spread) consumes the same `mulberry32` — one port, two callers.

## 4. Height formulation

Three octaves at the **corrected** amplitudes, solving `A = G / (f · k)` with `k = 7.333`:

| layer | frequency `f` | target max grad `G` | **amplitude `A`** | role |
|---|---|---|---|---|
| Micro | 0.100 | 0.03 (1.7°) | **0.0409 m** | surface ripple |
| Meso | 0.020 | 0.07 (4.0°) | **0.4773 m** | undulating contour |
| Macro | 0.005 | 0.18 (10.2°) | **4.9093 m** | regional elevation |

For comparison, the research publishes 0.12 / 1.40 / 14.40 m — 2.9× larger, which would yield
Micro 0.088 (busting the green's 0.06 budget on its own) and Micro + Meso 0.293, about 16.3°,
past even the rough's 12.4° ceiling. That is steeper than the terrain Phase 0 already had to
fix once, so the published table is a regression and is not used.

### Budget-driven masking

The research masks Macro by distance to the spline and leaves Meso alone, which cannot satisfy
its own green budget. Instead, derive the masks from a continuous *budget field* and let each
octave take what remains:

```
tGreen    = smoothstep01((|(x,z) - cup| - GREEN_RADIUS) / GREEN_BLEND)   // 0 on green, 1 off
tCorridor = smoothstep01((d - HALF_WIDTH) / BLEND_WIDTH)                 // 0 on corridor, 1 in rough

budget    = lerp(lerp(GRAD_GREEN, GRAD_FAIRWAY, tGreen), GRAD_ROUGH, tCorridor)

remaining  = budget - G_MICRO                       // Micro is never masked
mesoScale  = smoothstep01(remaining / G_MESO)
remaining -= mesoScale * G_MESO
macroScale = smoothstep01(remaining / G_MACRO)

H_noise(x, z) = A_MICRO * S0(f_micro·x, f_micro·z)
              + A_MESO  * S0(f_meso·x,  f_meso·z)  * mesoScale
              + A_MACRO * S0(f_macro·x, f_macro·z) * macroScale
```

`GRAD_GREEN = 0.06`, `GRAD_FAIRWAY = 0.11`, `GRAD_ROUGH = 0.28`. `GREEN_BLEND = 6 m`.

The green and fairway figures are `tan θ` of the `crr` values already in `SURFACES` — the rest
condition `crr ≥ tan(θ)` that `surfaces.ts` already documents.

**`GRAD_ROUGH` is deliberately 0.28, above the rough's own rest threshold of 0.22.** It is the
unmasked octave sum (0.03 + 0.07 + 0.18), so the rough simply runs unbudgeted. A ball on a
steep rough patch will therefore keep rolling rather than settle — which is wanted: it runs out
of the rough onto flatter ground instead of parking on a hillside. The §6 checks police the
corridor and the green only, for the same reason.

**`smoothstep01`, not `clamp`, on the scale terms.** A raw clamp is C⁰ but not C¹, and a mask
whose derivative steps produces a slope discontinuity in `H` — the exact ramp failure §5.2 of
the research warns about. `smoothstep01` has zero derivative at both ends, so `H` stays C¹.

**Accepted approximation.** `smoothstep01(t) > t` for `t > 0.5`, so the transition band can sit
slightly over budget. This is acceptable because the budget already assumes every octave peaks
at the same coordinate, which is far more conservative than the overshoot. **The budget is the
design target; the rejection sampler in §6 is the enforcement.**

**Domain warping is banned outright** on playable surfaces (research §4.3) — it destroys slope
predictability via the chain rule. It is not used anywhere in this phase, including on boundary
terrain, because boundary mountains are not in scope here.

## 5. The corridor

New module `src/sim/spline.ts` — pure, DOM-free, no dependencies:

```ts
export interface Spline {
  /** Centripetal Catmull-Rom, alpha = 0.5. */
  pointAt(t: number): Vec2;
  /** Shortest distance from (x, z) to the curve, and the parameter where it occurs. */
  nearest(x: number, z: number): { distance: number; t: number };
  readonly length: number;
}
export function createSpline(control: readonly Vec2[]): Spline;
```

Centripetal parameterisation (α = 0.5) rather than uniform: uniform Catmull-Rom produces cusps
and self-intersection when control points are unevenly spaced, and a cusp in the corridor
centreline is a fold in the terrain.

`nearest` searches a polyline sampled at 1 m. Cost is covered in §8.

### Carving

```
{ distance: d, t: tStar } = spline.nearest(x, z)
M       = smoothstep01((d - HALF_WIDTH) / BLEND_WIDTH)
H_final = lerp(H_spline(tStar), H_noise(x, z), M)
```

**`H_spline(t) = H_noise(spline.pointAt(t))`.** Evaluating the noise *at the centreline point*
rather than inventing a separate corridor height means every point sharing a `t` gets the same
height — so **lateral camber inside the corridor is exactly zero by construction**, while the
longitudinal profile is inherited from the noise and stays interesting. No new constants, and
the camber check in §6 only has to police the blend band, where camber is nonzero by design.

This is not circular. `H_noise` at the centreline is evaluated with that point's *own*
coordinates, where `d = 0` and therefore `tCorridor = 0` — the corridor budget, not the budget
at the querying point. An implementation that reuses the caller's masks here will produce a
corridor that inherits rough-grade undulation and will fail the §7 camber test.

Tee and green keep an additional local flattening on top of the corridor — a putting surface
needs to be flatter than the corridor alone delivers. This reuses the existing `PADS` smoothstep
mechanism, now sourced from `spec.tee` / `spec.cup` instead of module constants.

`HALF_WIDTH = 15 m`, `BLEND_WIDTH = 10 m` (research §5.2). Full rough therefore begins at 25 m,
against today's hard `FAIRWAY_HALF_WIDTH = 26` — so the playable corridor is about as wide as it
is now, but with a graded edge instead of a step.

### Continuous physics, discrete visuals

Research §3.4, and it maps onto the two functions `surfaces.ts` already has:

- **`surfaceAt` stays discrete** and keeps its current priority order (water → green → sand →
  fairway → rough). It feeds the HUD readout, Phase 4's minimap, and render colouring, all of
  which want a crisp answer.
- **`tuningAt` becomes continuous.** `rolling`, `bounceScale`, and `cartSpeedScale` are
  smoothstep-blended across the green↔fairway and fairway↔rough boundaries using the same
  `tGreen` / `tCorridor` weights the height field uses, so the visual edge and the physical
  gradient are derived from one source.

This fixes a defect in shipped code: `tuningAt` currently returns a discrete row, so `crr` steps
from 0.11 to 0.22 in one tick at the fairway edge and the solver sees an acceleration
discontinuity. Phase 1.5's gate passed with it, so it is latent rather than fatal — but it is
real, and it gets fixed here rather than tracked.

Sand and water keep hard edges. A bunker lip and a water margin are *supposed* to be abrupt, and
blending them would make a ball drift to a halt in a bunker rather than stop in it.

## 6. Generation and validation

```ts
export function generateHole(courseSeed: number, index: number): HoleSpec;
export function generateCourse(courseSeed: number, holeCount: number): Course;
```

`generateHole` loops: hash `(courseSeed, index, attempt)` into a seed, draw tee, cup, and one
dog-leg apex from `mulberry32`, build a candidate `HoleSpec`, construct its terrain, and run
every check below. On rejection, increment `attempt`. On exhausting `MAX_ATTEMPTS = 32`, throw —
deterministic and bounded, never an unbounded search.

| # | check | threshold |
|---|---|---|
| 1 | Tee-to-cup straight-line separation | ≥ `MIN_HOLE_LENGTH` (60 m) |
| 2 | Corridor fits the field: every centreline sample ± (`HALF_WIDTH` + `BLEND_WIDTH`) inside `fieldSize/2` | with `EDGE_MARGIN` = 6 m |
| 3 | **Longitudinal** gradient along the centreline, sampled at 1 m | ≤ tan(6.27°) |
| 4 | **Lateral camber**, sampled perpendicular at ±(`HALF_WIDTH` + `BLEND_WIDTH`/2) | ≤ tan(4.0°) |
| 5 | **Green**: max gradient within `GREEN_RADIUS` of the cup | ≤ tan(3.43°) |
| 6 | **Corridor not flooded**: no centreline sample below `waterLevel` | — |
| 7 | **Reachable**: corridor length | ≤ 3 × `REFERENCE_CARRY_M` (387 m) |

`REFERENCE_CARRY_M = 129`, the driver's full carry as measured by `npm run probe` in Phase 0.

### Field size scales with intended par

Checks 2 and 7 interact, and the interaction is the design rather than a conflict. In a 160 m
field the usable box after `HALF_WIDTH + BLEND_WIDTH + EDGE_MARGIN` is about 100 × 100 m, which
caps a dog-legged corridor near 200 m — a par 4. Check 7 never binds there; check 2 does.

`fieldSize` is therefore chosen per hole from the par being aimed at, which is the reason it
lives on `HoleSpec` rather than being global:

| intended par | corridor length | `fieldSize` | `cells` |
|---|---|---|---|
| 3 | up to 129 m | 160 | 160 |
| 4 | up to 258 m | 220 | 220 |
| 5 | up to 387 m | 300 | 300 |

`cells` tracks `fieldSize` to hold the cell near 1.0 m, for the reason `terrain.ts` already
documents: a coarser cell makes heightfield triangle seams large enough for the 0.15 m ball to
trip over. `generateCourse` picks the par mix, and hence the field sizes, before generating.

Checks 3–5 are the research's. Checks 1, 2, 6, and 7 are additions this project needs and the
research does not have:

- **Reachability (7).** A hole can pass every slope check and still be unplayable at 400 m
  against a 129 m driver. Slope validity is not playability.
- **Flooding (6).** Water here is height-derived, not authored, so a carved corridor can dip
  below `waterLevel` and wall the hole off with a hazard that has no carry.
- **Field containment (2).** `fieldSize` is per-hole and the corridor is a curve, so "fits" is
  a real check rather than a given.

### Par is derived, not authored

```
par = clamp(3 + floor(corridorLength / REFERENCE_CARRY_M), 3, 5)
```

`REFERENCE_CARRY_M` is a named constant in `course.ts` documenting the driver's measured full
carry, **not** a second copy of `CLUB_STATS`. `AGENTS.md` forbids a second source of truth for
club stats, and carry is not a field in that table — it is an emergent result of the ballistics
integration. The link is closed by a probe assertion (§7) that measured driver carry stays
within ±15% of `REFERENCE_CARRY_M`, so a club-balance change that invalidates par fails the
probe instead of silently mis-parring every hole.

### Why the dog-leg is load-bearing

A straight corridor in a 160 m field caps out around 155 m, which is a par 3 and nothing else.
A dog-leg fits a longer corridor into the same box. The spline is the mechanism for having more
than one kind of hole, not decoration.

## 7. Verification

**Vitest** (`src/**/*.test.ts`, node environment — the DOM-free rule made executable):

- `spline.test.ts` — α = 0.5 produces no cusp on adversarial unevenly-spaced control points
  (compare against uniform parameterisation, which should); `nearest` agrees with brute-force
  sampling to 1 cm; `length` is monotone in control-point spread.
- `terrain.test.ts` — the mask is C¹: numeric derivative of `H` across `d = HALF_WIDTH` and
  `d = HALF_WIDTH + BLEND_WIDTH` has no step beyond a stated tolerance. Lateral camber inside
  the corridor is zero to within float error.
- `course.test.ts` — `generateHole(s, i)` is byte-identical across repeated calls and across
  call order; each of the seven checks rejects a hand-built spec that violates only it;
  exhausting `MAX_ATTEMPTS` throws rather than returning an invalid hole.
- `surfaces.test.ts` — `tuningAt` writes into the scratch and allocates nothing; blended
  `rolling` is monotone across the fairway→rough band and matches `SURFACES` exactly at both
  extremes.

**`npm run probe`** gains four assertions:

1. **`k` band.** Re-measure max ‖∇S‖ and assert 7.333 ± 5%. Catches a `simplex-noise` bump
   invalidating all three amplitudes.
2. **Driver carry band.** Assert measured full-power driver carry is within ±15% of
   `REFERENCE_CARRY_M`, closing the par derivation loop.
3. **Per-hole playability.** Generate a 9-hole course and assert every hole passes all seven
   checks — the generator's own criteria re-run from outside it.
4. **Acceptance rate.** Generate 200 candidate seeds and report the accepted percentage. The
   research claims 80–85%, computed from its miscalibrated amplitudes; that figure carries no
   weight here and the real number is recorded from this run.

**Re-baselining.** Terrain changes and `crr` becomes continuous, so Phase 0 and Phase 1.5 probe
figures — carry, roll, settle time, surface mix — will move. They are re-baselined with the
cause recorded in `ROADMAP.md`, not quietly overwritten. The Phase 0 tunneling check (full-power
shot, ball Y stays bounded) is re-run unchanged and must still pass.

## 8. Blast radius, cost, and migration

Five files import `terrain.ts`:

| file | change |
|---|---|
| `src/sim/world.ts` | `Sim.create(hole: HoleSpec)`; module-level `restTransform` / `cartSpawnPosition` / `restCartTransform` read the spec instead of module constants; new `Sim.loadHole(spec)` |
| `src/sim/surfaces.ts` | becomes a factory; `distanceToFairwayLine` → spline `nearest`; `tuningAt` gains the scratch parameter |
| `src/render/scene.ts` | takes terrain from the sim rather than importing `FIELD_SIZE` / `NCOLS` / `NROWS` / `heightAt` |
| `src/sim/world.cart.test.ts` | constructs a fixed test `HoleSpec` instead of importing constants |
| `tools/feelProbe.ts` | same, plus the four new assertions |

`src/main.ts` constructs a `Course` and passes hole 0 to `Sim.create`.

**Cost.** `spline.nearest` scans a ~200-segment polyline. `buildHeightfield` calls `heightAt`
25,921 times, so about 5.2M segment tests once at load — tens of milliseconds, acceptable. The
per-tick path makes a handful of calls, which is negligible. **No acceleration structure is
built.** If load time becomes a problem the fix is a uniform-grid cache of nearest-`t`, but that
is speculative until measured, and the deferred Delaunay render mesh is the change that would
actually make it matter.

**Ordering.** §3 (data model) lands first and alone as a **provably** behaviour-preserving
refactor: it ships with a `legacyHoleSpec()` fixture whose derived channels reproduce today's
hardcoded `0.42` and `0.77` noise seeds and today's tee, cup, field size, and pad radii exactly,
so the existing probe numbers must come out unchanged. That fixture is the refactor's test, and
it is deleted once §4 lands.

Without it the refactor is not behaviour-preserving at all — moving the seed from a literal to
a hash changes the terrain, which would mean the data-model change and the terrain change land
together with no way to tell which caused a regression.

§4 and §5 then change terrain and physics together, which is when the probe numbers legitimately
move. §6 lands last, because rejection sampling cannot validate terrain that does not exist yet.

## 9. Out of scope

Stated so they are not smuggled in:

- Delaunay render mesh, hierarchical grid jitter, hexagonal base grid, Voronoi biome colouring
  (research §1.2, §2, §3) — the deferred phase, and where the Blender prop pipeline pairs.
- `tools/sceneGate.mjs` — a prerequisite for that deferred phase, tracked in `ROADMAP.md`
  Phase 1, built on a parallel track.
- Boundary mountains and the envelope function `E(x, z)` (research §4.3) — they exist only to
  frame the view, which is a rendering concern.
- Multi-hole *round* state: par tally, scorecard, and the results screen are Phase 1.75. This
  phase produces holes with a `par` field; it does not score them.
- Club rebalancing. The driver's 0.86 roll/carry ratio is a known open item needing a play
  session (`ROADMAP.md` Phase 0), and changing `loftDeg` here would confound the re-baseline.

## 10. Roadmap placement

New **Phase 2.5 — The Course**, after Phase 2 (done) and independent of Phase 1.75, so the two
may land in either order. `BACKLOG.md #2` (multi-hole course) is promoted into it and its row
updated to point here.

**Gate:** all Vitest suites green; `tsc --noEmit` clean; the four new probe assertions pass; a
generated 9-hole course has every hole satisfy all seven checks; the Phase 0 tunneling check
still passes; and the re-baselined carry/roll/settle figures are recorded in `ROADMAP.md` with
the cause, not silently replaced.

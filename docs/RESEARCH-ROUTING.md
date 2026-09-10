# TeeTimeTurrets — Research: Golf Course Routing

Hand this file to a research-capable LLM (web search / deep research mode) as-is. It is
self-contained — no access to prior conversation or the codebase is assumed. Written 2026-09-10
after six failed attempts at the problem in § "What was tried", which are recorded with their
measurements so the research does not repeat them.

---

## Project context

TeeTimeTurrets is an open-source browser game: Three.js rendering, Rapier (WASM) physics, Vite +
TypeScript, **zero external 3D assets** — all geometry is procedural. It has two modes. Stroke play
is 18 holes of arcade golf. Arena is a timed team-combat mode fought over all eighteen holes joined
into one contiguous piece of drivable ground.

Everything in `src/sim/**` is **DOM-free and deterministic**: no `Math.random()`, every stochastic
value comes from a seeded PRNG (`mulberry32`) so a seed reproduces a course exactly. This is not a
style preference — a headless Node tool chain (`npm run plan`, `npm run probe:terrain`) imports the
sim unmodified and would break otherwise.

### How a course is built today, in order

1. **`src/sim/course.ts` — `generateCourse(seed, 18)`** invents eighteen holes independently. Each
   `HoleSpec` owns a **square field centred on its own local origin** and knows nothing about any
   other hole. It fixes the hole's par, its tee and cup positions in local coordinates, and its
   corridor centreline control points.
2. **`src/sim/courseLayout.ts` — `solveCourseLayout(holes)`** decides where each hole's local frame
   sits in a shared course frame: an `(offsetX, offsetZ, rotation)` per hole. **This module is the
   subject of this document.** It moves holes rigidly. It cannot reshape or rescale one.
3. **`src/sim/courseTerrain.ts`** blends the placed holes into a single heightfield.

**The ordering matters and may be the whole problem — see Question 4.** Hole lengths are decided
in step 1 and are immutable inputs to step 2.

### The data the layout solver gets and produces

```ts
interface LayoutHole {
  index: number;              // 0-based, play order
  tee: Vec2;                  // in the hole's own local frame
  cup: Vec2;
  control: readonly Vec2[];   // corridor centreline, tee first, cup last
}

interface HolePlacement { index: number; offsetX: number; offsetZ: number; rotation: number; }
```

A hole's **length** is `|cup - tee|` and is **fixed**. The solver's only free variables are the
placements — and because a hole is placed by laying its tee-to-cup line along a chosen line, the
real degrees of freedom are **one bearing and one anchor point per hole**, with the anchors chained
by the walk rule below.

### The hard constraints, with their shipped values

| Constant | Value | Meaning |
|---|---|---|
| `TRANSITION_M` | 30 m | Green to the next tee. Every consecutive pair, no exceptions today. |
| `CORRIDOR_CLEARANCE_M` | 35 m | Two non-consecutive corridors closer than this is a **conflict**. |
| `CLUBHOUSE_APRON_M` | 140 m | Inside this radius corridors may converge; conflicts are forgiven. |
| `CLUBHOUSE_GAP_M` | 90 m | Wanted separation between the 1st tee and the 10th. |

Hole lengths from the synthetic test fixture: **par 3 = 82 m, par 4 = 216 m, par 5 = 313 m**. The
real generator produces a spread around these. A typical 18 is par 72, nine holes per nine.

Field sizes (the square each hole owns): par 3 = 160 m, par 4 = 220 m, par 5 = 300 m. **Fields are
expected to overlap** and blend into shared rough; only corridors must stay clear.

### What the test suite pins (these are the acceptance criteria)

`src/sim/courseLayout.test.ts` asserts **properties, never coordinates**:

- every hole placed exactly once
- hole 1 tees off at the clubhouse; **hole 9's cup ≤ 31 m from it**; hole 10 tees off beside the
  1st but not on it; **hole 18's cup ≤ 121 m from it**
- longest green-to-next-tee walk ≤ `TRANSITION_M` + ε
- the two nines occupy opposite sides of the clubhouse
- a placement is a **rigid motion** — it must not move, stretch or mirror a hole
- deterministic: same input, same output
- `inspectLayout` reports **zero corridor conflicts** on the real generated course
- **NEW, and the point of this work:** each nine contains **≥ 2 pairs of holes whose bearings are
  within 30° of anti-parallel and whose midpoints are within 150 m of each other**

That last one is a measurable stand-in for "looks like a real routing" — see § "The target".

---

## The problem

### What ships today: two circles, and it is provably golf-correct

`solveCourseLayout` lays each nine as **nine chords around a circle**. The radius that closes a
loop of fixed-length chords is found by bisection (a chord `c` on radius `r` subtends
`2·asin(c/2r)`; the sum falls monotonically in `r`, so one bisection lands it). The front nine's
circle is centred south of the clubhouse and the back nine's north, so the loops meet only at the
clubhouse.

Measured on the shipped seed (2026), and **identical on every seed tested** (2026, 7, 1337, 4242,
88) because these are structural properties of the construction rather than of the random draw:

- footprint 728 × 1231 m
- longest green-to-tee walk **30.0 m**
- hole 9 finishes **30.0 m** from the clubhouse; hole 18 finishes **120.0 m**
- closest two corridors off the apron **126.2 m**
- **conflicts 0**

Only footprint (720–764 × 1184–1284 m) and closest-corridor spacing (113.7–148.5 m) vary by seed.

**So the routing already satisfies every classical test of a golf routing**: returning nines, a
central clubhouse, short green-to-tee transitions, no corridor conflicts.

### What is wrong with it

It **looks** synthetic from above — two rounded polygons. The cause is precise: nine chords at even
angular steps around a circle means every corridor points ~40° off its neighbour and **no two
corridors ever run parallel**. Real courses are full of holes running alongside each other in
opposite directions.

### The target

Three reference routings were supplied: Augusta National, an unnamed aerial with a central
clubhouse, and **Pinehurst No. 2** (Donald Ross, 1907), which is the clearest signal. Their shared
structure:

- corridors **radiate from a central clubhouse in lobes / fingers**, not around a ring
- within a lobe, holes run **out-and-back in adjacent, near-parallel pairs** — Pinehurst's 1 and
  18 run alongside each other; so do its 3/4/5 and its 12/13/14
- the outer boundary is an **irregular blob**, never a circle or rectangle
- holes 1, 9, 10 and 18 all touch the clubhouse

A three-hole lobe going **out, across the end, and back** is the recurring figure. Augusta's
11-12-13 ("Amen Corner") is exactly that shape.

---

## What was tried, and the numbers each attempt produced

All six ran against the real generated course, seed 2026. `walk` is the longest green-to-tee
transition; `h9`/`h18` are each nine's finishing distance from the clubhouse (targets ≤ 31 and
≤ 121); `closest` is the nearest approach between two non-consecutive corridors off the apron
(target ≥ 35).

| # | Approach | footprint (m) | walk | h9 | h18 | closest | conflicts | pairs |
|---|---|---|---|---|---|---|---|---|
| 0 | **Shipped: chords on a circle** | 728 × 1231 | 30.0 | **30.0** | **120.0** | **126.2** | **0** | **0** |
| 1 | Chords fitted to a lobed polar curve `r(θ)=base(1+0.5·cos 3θ)` | 758 × 1017 | 30.0 | 269.4 | 116.6 | **36.5** | **0** | 0 |
| 2 | Explicit legs; out along lobe bearing, across at 90°, back **aimed at the hub** | 663 × 701 | 30.0 | 86.8 | 66.3 | 16.0 | 1 | — |
| 3 | As 2, plus per-lobe **necks** on a 90 m ring; crossing leg solved by circle-circle intersection so the return lands exactly on the next neck | 603 × 684 | 30.0 | **0.0** | 90.0 | 1.6 | 9 | — |
| 4 | As 3, choosing the intersection root **farther from the hub** | 600 × 675 | 30.0 | **0.0** | 90.0 | 10.5 | 4 | front nine fails |
| 5 | Fixed 110 m leg separation, back leg strictly anti-parallel, **fan angle scanned** for closure (25–95°) | 1078 × 1104 | 30.0 | 359.7 | 386.3 | 9.6 | 2 | **passes** |
| 6 | As 5, fan scanned 25–150° | 585 × 686 | 30.0 | 274.1 | 371.2 | 0.3 | 7 | — |

**The branch `course-routing` currently holds attempt 6.** It is a spike: six layout tests red and
two dead functions (`placeNine`, `chordsOf`) that `tsc` flags. It is committed for reference, not
to merge.

### Why attempt 1 failed

A nine has to carry ~2,000 m of holes plus transitions, which forces a mean radius near 300 m — the
same order as a par 5 (313 m). Every chord then cut **straight across** a lobe instead of running
along one. Lobes must be longer than they are wide, and that is a statement about legs, not radii.

### Why attempts 3–4 failed

Solving the crossing leg for closure made closure exact (`h9 = 0.0 m`) but left the **gap between a
lobe's out and back legs** to be whatever closure did not consume — so it collapsed to 1.6 m.

### Why attempts 5–6 failed

Fixing the separation at 110 m fixed the shape (both shape tests pass) but each lobe then leaves a
**residual displacement**: net `(L_out − L_back)` along the lobe bearing plus 110 m laterally. Over
three lobes those residuals accumulate and the nine ends 274–360 m from where it started. The
lateral residuals only cancel when the three lobe bearings are ~120° apart, which spreads a nine
over 240° of the compass and makes the two nines overlap.

### The structural read

Nine holes of **fixed length**, chained by a **fixed 30 m** walk, leave only the bearings free.
Four constraints are then asked of those bearings simultaneously: closure on the clubhouse, a
minimum lateral separation within a lobe, a global minimum corridor clearance, and the two nines on
opposite sides. Each construction attempted satisfies whichever constraint it solves *last* and
sacrifices the rest. The trade-off is visible along the table above as a frontier, not as a series
of bugs.

---

## Questions for the research session

**Q1 — What is the standard algorithmic formulation for golf course routing?** Is it posed in the
literature (landscape architecture, procedural content generation, operations research) as a
constrained optimisation, a constructive/grammar method, or something else? Is there a canonical
formulation of "route N holes of given lengths through a site, returning to the clubhouse"?

**Q2 — Is the problem as posed here actually feasible?** Given nine fixed-length segments chained
by fixed 30 m transitions, with only bearings free, can closure on a point, a within-lobe lateral
separation, and a global 35 m corridor clearance be satisfied simultaneously? If it is generically
infeasible, **which constraint should be relaxed first**, and is there a principled answer rather
than a taste one?

**Q3 — Should transitions be allowed to vary?** Real courses have uneven green-to-tee walks, and
some are long. Our 30 m everywhere is an invented uniformity. If transitions could range, say,
20–120 m, does closure become easy? What do real courses actually measure here — is there published
data on green-to-tee distances?

**Q4 — Should holes be shaped *after* routing rather than before?** Today `generateCourse` fixes
eighteen hole lengths, then the layout places them. Real architects route to the land and shape
holes to fit what the routing needs. **Would inverting the order — route a skeleton of lobes first,
then generate each hole to fit the leg it must occupy — dissolve the closure problem entirely?**
What are the costs of that inversion (par distribution control, hole variety, determinism)?

**Q5 — If a solver is the answer, what formulation converges?** Local search / simulated annealing
over nine bearings: what cost terms and weights, what neighbourhood moves, what schedule? Is there
a formulation with a **deterministic** result from a seed (a hard requirement here) that still
escapes local minima? Would a constraint solver or a physics-style relaxation (treat corridors as
mutually repelling rods with a spring to the clubhouse) be better suited?

**Q6 — Is there an exact constructive method for a branching/lobed closed loop?** The circle case
has one (bisection on radius, monotone). Does an analogous closed form exist for a rosette or
lobed loop of fixed-length chords — or a proof that it does not?

**Q7 — What actually makes a routing read as a real course from above?** Our test asserts ≥ 2
near-anti-parallel pairs within 150 m per nine. **Is out-and-back pairing really the dominant
visual signal**, or is it corridor irregularity, dogleg shape, varied corridor widths, or the tree
belts between holes? If it is one of the latter, this whole geometric effort may be aimed at the
wrong feature and the fix belongs in rendering, not routing.

**Q8 — What is a realistic corridor clearance?** Our 35 m minimum and 110 m target separation were
chosen, not derived. What separation do real courses use between adjacent fairways, and what is the
safety standard (there is a real literature on errant-shot risk and corridor widths)?

**Q9 — How do real routings handle the return constraint?** Do returning nines close exactly on the
clubhouse, or is "returns to the clubhouse" satisfied loosely — within a few hundred metres, with
the walk absorbed by the practice area and car park? Our ≤ 31 m may be far stricter than reality.

**Q10 — Are there published, reproducible procedural golf-course generators** (academic or
open-source) whose routing stage can be read? Prior art would be worth more than a derivation.

---

## Not research questions — flag these back, don't try to answer from literature

- **Which seed to ship.** A product decision, already made (2026).
- **Whether to use Three.js / Rapier / TypeScript.** Settled, and not revisitable.
- **Whether the sim may use `Math.random()`.** It may not. Any proposed algorithm must be
  seed-deterministic; this is enforced by the test suite and by headless tooling.
- **Whether hole *fields* may overlap.** They may, and do. Only corridors must stay clear.
- **Anything requiring an external 3D asset or a new runtime dependency.** The project ships
  procedural geometry only.
- **Rewriting `courseTerrain.ts` or the arena mode.** Out of scope; the layout produces placements
  and everything downstream consumes them unchanged.

---

## What a good answer changes

`solveCourseLayout` is ~120 lines and has one caller shape. A better formulation lands as a
replacement for that function, keeps the `LayoutHole → HolePlacement[]` signature, and turns the
existing property tests green — including the new pairing test. Everything downstream (terrain
assembly, surfaces, spawns, the map, the arena ground) already consumes placements and does not
care how they were chosen.

**Re-baselining cost, so the answer can be weighed against it:** any routing change moves every
hole on every seed, which regenerates the 18 committed plan SVGs, moves the `course-ground` scene
gate baseline, and changes the terrain probe's recorded course dimensions (currently 1056 × 1613 m,
426k cells at 2 m). That is a known, one-time cost and is why this work was sequenced before the
arena wiring rather than after.

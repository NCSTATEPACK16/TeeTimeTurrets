# Physics-Relaxation Course Routing — Design

**Date:** 10 Sep 2026 · **Status:** approved, not yet implemented · **Branch:** `course-routing`

Source research: `docs/RESEARCH-ROUTING.md`. Read its "What was tried" table before touching
`solveCourseLayout` — six prior constructive-geometry attempts are recorded there with their
measurements so this design does not repeat them.

## 1. Decision

Keep `generateCourse` → `solveCourseLayout` → `courseTerrain` in that order (reject the
route-then-shape inversion from RESEARCH-ROUTING.md §Q4). Replace the constructive-geometry body
of `solveCourseLayout` with a **deterministic Verlet relaxation solver**, per RESEARCH-ROUTING.md
§Q5, seeded from the course's own `mulberry32` stream so a seed still reproduces a course exactly.

Reasons this beats the route-then-shape inversion for this codebase specifically:

1. `LayoutHole → HolePlacement[]` is `solveCourseLayout`'s entire contract with the rest of the
   sim (terrain assembly, surfaces, spawns, map, arena ground). A relaxation solver keeps that
   signature; inverting the pipeline would touch `course.ts`'s hole generation too, which
   RESEARCH-ROUTING.md flags as out of scope ("Rewriting `courseTerrain.ts` or the arena mode" —
   the same argument extends to rewriting how holes are authored).
2. The six failed attempts on `course-routing` already built most of the pieces a relaxation
   solver reuses as its **initial condition**: `placeNineAsLobes`/`layNine`'s fan-and-lobe
   construction gets a nine into roughly the right shape before relaxation ever runs. Discarding
   that construction (as the inversion would) throws away the one part of six attempts that
   worked (the pairing test passed in attempt 5).
3. Losing "strict a priori control over individual hole shape" (the inversion's stated cost) is
   real friction here: `course.ts` derives `par` from corridor length and is depended on by
   `courseLayout.test.ts`'s `eighteen()` fixture (par 3/4/5 lengths, line 41). Keeping hole
   generation untouched means that fixture — and everything it exercises — needs no changes.

## 2. What changes about the hard constraints

| Constant | Today | Becomes | Why |
|---|---|---|---|
| `TRANSITION_M` | `30`, used as an exact chord length | `TRANSITION_TARGET_M = 30` (spring rest length) | Unchanged intent, renamed to make clear it is now a target, not a bound. |
| *(new)* | — | `TRANSITION_MIN_M = 15`, `TRANSITION_MAX_M = 100` | RESEARCH-ROUTING.md §Q3: real green-to-tee walks vary; a fixed 30 m consumed the only slack the chain had. This is the "slack variable" §Q2 says the overconstrained system needs. |
| `CORRIDOR_CLEARANCE_M` | `35` | unchanged | §Q8 gives 60–90 m as the *target* separation for a safe visual buffer, but 35 m is already framed in this codebase as the hard **minimum** (a conflict, not a comfort line) and `LOBE_WIDTH_M = 110` already sits well inside the realistic range as the construction's target. No change needed. |
| `CLUBHOUSE_GAP_M` | `90` | unchanged | Not one of the constraints the six attempts failed against; leave it. |
| `CLUBHOUSE_APRON_M` | `140` | unchanged | Same. |
| test: `maxTransitionM` assertion | `≤ TRANSITION_M + ε` | `≤ TRANSITION_MAX_M` | Follows directly from the constant split above. |

`frontReturnM ≤ 31` / `backReturnM ≤ 121` (the existing `courseLayout.test.ts` acceptance
thresholds) are **not relaxed**. RESEARCH-ROUTING.md §Q9 suggested these could loosen further, but
the shipped construction already lands at 30.0 / 120.0 — within 1 m of the current ceiling — on
every seed tested. That is headroom the relaxation solver's attractor spring (§4) should aim to
preserve, not headroom to spend on a looser test.

## 3. Initial condition: reuse attempt 6's construction, don't relax from scratch

A relaxation solver's biggest determinism risk is landing in a different local minimum on a code
change that shouldn't matter. Starting from a good initial layout makes the search short (bounded
iteration count, not a variable one) and keeps the result close to a human-recognisable routing.

`placeNineAsLobes` / `layNine` (courseLayout.ts:305, :344 — the `course-routing` branch's attempt
6) already produce a lobed, out-and-back fan for one nine, `FAN_STEPS = 400` scanned between
`FAN_MIN`/`FAN_MAX`. Reuse this unchanged as the seed layout:

- Run `layNine` at its already-chosen fan angle (whatever attempt 6's scan currently picks) to get
  a starting `HolePlacement[]` for each nine. This replaces attempt 6's closure-by-fan-scan, which
  is what actually failed (RESEARCH-ROUTING.md's "Why attempts 5–6 failed"), with closure-by-relaxation.
- Delete the two dead functions RESEARCH-ROUTING.md flags (`placeNine`, `chordsOf` at
  courseLayout.ts:204/402) only if the relaxation solver ends up not calling them — check at
  implementation time; `chordsOf` builds the chord list `loopRadius` needs, which the old
  circle-only path (`§ shipped: two circles`) still uses as a fallback per Task 6 below.

## 4. The relaxation pass

One relaxation runs per nine (front, back), independently, both anchored at the clubhouse.

**Particles.** Two per hole: `p_tee`, `p_cup`, in course-frame metres. Hole 1's `p_tee` and hole
10's `p_tee` are **pinned** (not integrated) — hole 1 at the clubhouse origin, hole 10 at
`clubhouse + (CLUBHOUSE_GAP_M, 0)` rotated to the back nine's side, matching the existing "hole 10
tees off beside the 1st but not on it" test. Every other particle starts at the position `layNine`
gave it and is free.

**Constraints, applied once per iteration in this order (Gauss-Seidel style, standard for Verlet
cloth/rope solvers — order matters for convergence, not for correctness of the final state once
converged):**

1. **Rigid hole length** — for each hole, project `p_tee`/`p_cup` apart or together along their
   current line until `|p_cup − p_tee|` exactly equals the hole's fixed length (`chordOf`,
   courseLayout.ts:282). This is a hard constraint, never a spring: hole length must never change,
   matching the existing "a placement is a rigid motion" test.
2. **Transition slack** — for each `(cup_i, tee_{i+1})` pair, if their distance is outside
   `[TRANSITION_MIN_M, TRANSITION_MAX_M]`, pull/push both points half the excess back toward the
   nearer bound. Inside the range, apply no force — this is the "prismatic joint" from
   RESEARCH-ROUTING.md §Q3, not a spring toward `TRANSITION_TARGET_M`; a spring toward a fixed
   target would just reintroduce the original rigidity in softer form.
3. **Corridor repulsion** — for every pair of non-consecutive holes' corridor polylines
   (`polylineClearance`, courseLayout.ts:455) closer than `CORRIDOR_CLEARANCE_M` and outside
   `CLUBHOUSE_APRON_M` of the clubhouse, push both corridors' nearest points apart along the
   separating axis until clearance is met. This reuses the existing clearance/apron math verbatim
   instead of reimplementing it — `inspectLayout` and the solver must agree on what a conflict is,
   or the solver can converge to a state its own test suite still flags red.
4. **Clubhouse attractor** — a single step pulling hole 9's `p_cup` and hole 18's `p_cup` a
   fraction (damped, e.g. 10% per iteration — tune during implementation, not fixed here) of the
   remaining distance toward the clubhouse. This is the only unconstrained force in the system;
   everything else is a hard or bounded constraint, so it is what actually closes the loop.

**Determinism.** No RNG inside the relaxation loop itself — `layNine`'s existing seeded fan-angle
choice is the only randomness, and it runs once before relaxation starts. Iterate a **fixed** step
count (e.g. 200, matching RESEARCH-ROUTING.md §Q5's suggestion), not until some convergence
threshold — a threshold-based stop is a second source of run-to-run variation risk (floating-point
order-of-operations differences across platforms) that a fixed count avoids entirely. Recompute
`rotation` for each hole from its final `p_tee`/`p_cup` bearing once, after the loop, not per
iteration.

## 5. What must NOT regress

Every existing `courseLayout.test.ts` property must still hold after the constant changes in §2:
every hole placed exactly once, rigid-motion-only placement, determinism, zero corridor conflicts
on the real generated course, both return distances at their (unchanged) thresholds, and the
pairing test (≥ 2 near-anti-parallel pairs within 150 m per nine, `OPPOSED_TOLERANCE`/`NEIGHBOUR_M`
at courseLayout.test.ts:289/291). None of these assertions change shape — only `maxTransitionM`'s
threshold moves, per §2's table.

**Pitfall to design the test against, not just implement against** (see
`docs/TEST-AND-SPEC-PITFALLS.md` §1 — the recurring defect on this repo is an assertion loose
enough to pass against a broken implementation). A relaxation solver invites exactly this failure
mode: it is tempting to assert "closure within tolerance" with a tolerance wide enough that a
solver which never ran the attractor step (§4.4) would still pass, because `layNine`'s initial
condition alone already lands within ~120 m on some seeds. Before trusting green:

- Confirm red-first: comment out step 4 (the attractor) alone and re-run `courseLayout.test.ts`.
  `frontReturnM ≤ 31` must fail. If it doesn't, the test isn't discriminating the attractor from
  the rest of the solver and needs a tighter bound or a seed where the initial condition alone is
  known to fail.
- Confirm the transition-slack bound is load-bearing the same way: temporarily clamp
  `TRANSITION_MAX_M` back to `30` and confirm the suite goes red (this is the reproduction of the
  original bug — RESEARCH-ROUTING.md's six failed attempts — and should fail the same way attempt
  6 did, not merely fail).

## 6. Fallback

If relaxation does not converge to zero conflicts within the fixed iteration budget on some seed
(discoverable only empirically, across the five seeds RESEARCH-ROUTING.md already measured: 2026,
7, 1337, 4242, 88), fall back per-nine to the shipped circle construction (`loopRadius` +
`placeNine`, courseLayout.ts:184/204) for that nine only, and log which seeds took the fallback.
This bounds the worst case to "looks synthetic" (the original, already-shipped, already-tested
behaviour) rather than "broken" (a layout the invariant tests reject). Losing the pairing test on a
fallback seed is an acceptable, visible degradation; a corridor conflict or a non-rigid placement
is not.

## 7. Re-baselining cost

Unchanged from RESEARCH-ROUTING.md's estimate: any routing change moves every hole on every seed,
regenerating the 18 committed plan SVGs, moving the `course-ground` scene gate baseline, and
changing the terrain probe's recorded course dimensions (currently 1056 × 1613 m, 426k cells at
2 m). One-time cost, already budgeted by sequencing this before arena wiring.

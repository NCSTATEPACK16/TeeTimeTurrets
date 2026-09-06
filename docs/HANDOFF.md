# Handoff — next session

Written 2026-09-06, at the end of the session that landed the biome palettes (PR #6).
Rewrite this file at the end of each session; it is a baton, not a log.

---

## Where things stand

`biome-palettes-from-sheets` (PR #6) is open against `main` and carries the whole course pipeline —
generated hole specs, surfaces, ground, trees, the biome palettes, `npm run plan` and
`npm run swatches`. Most of it had been sitting uncommitted; `src/render/biomes.ts` was itself
untracked, so it all landed together.

**Verified at that commit:** `tsc` clean · 354 tests / 23 files · `npm run build` + scene gate pass
(5/5, mean delta 0.00) · all 18 hole plans byte-identical across the palette change · holes 1, 7, 13
screenshotted.

`COURSE_PIPELINE.md` §9 build order is the authority on what comes next. Steps 1–3 are done.

---

## Next: step 4 — `HoleBrief` schema and the 18 briefs

**Needs no image model.** It is `COURSE_PIPELINE.md` §4's table transcribed into typed data, plus
the schema in §3 (already written out in full there — `Archetype`, `Cover`, `HazardSchema`,
`HoleBrief`). The generator keeps ignoring most fields for now.

Why it is the right next step: it is cheap, it makes design intent reviewable before any generator
work, and it is the input Tier 2 (step 5) consumes. Doing Tier 2 first would mean hand-tuning
polygons with nothing to check them against.

Two things to get right, both stated in §3:

- **Declarative, not geometric.** A brief says `placement: 'fairway-elbow'`; the generator resolves
  that to coordinates from the seed. A brief that names coordinates has defeated the point — the
  whole system exists so a hole is reconstructible from a `uint32` and multiplayer ships a seed
  rather than a level file.
- **A failed brief should name itself.** Today an exhausted sampler throws
  `generateHole(seed, 7) exhausted 32 attempts`. With briefs it can say which constraint was
  impossible and why.

### Then: step 5 — Tier 2, water polygons first

`COURSE_PIPELINE.md` §5.1 is the reason. **37.5% of the course is currently underwater** — holes 10
and 16 exceed 55% — because `validateHole` check 6 only samples the centreline, so the corridor
stays dry while the field around it floods. Bunkers have the same shape of problem: a noise
threshold produces tan confetti across the fairway, not placed hazards.

Note the ordering constraint in §5: check 6 must be relaxed from *"centreline never below
`waterLevel`"* to *"centreline never inside a water polygon"* **before** holes 2, 13 and 15 are
buildable at all. Tier 2 shares module constants and lands as one change, not four.

---

## What still needs a human with an image model

This is the part a fresh session cannot do for you. `COURSE_PIPELINE.md` §7 and
`ASSET_PIPELINE.md` §8 hold the prompt blocks; both name their consumer, which is the rule that
decides whether an image is worth generating at all.

| Prompt | Where | Consumer | Status |
|---|---|---|---|
| §7.1 biome style sheets ×3 | `COURSE_PIPELINE.md` | `BIOMES` in `src/render/biomes.ts` | **Done.** Only re-run if a biome's look is being changed. |
| §7.2 prop silhouette sheet | `COURSE_PIPELINE.md` | the modelling pass in `ASSET_PIPELINE.md` | **Not run.** Blocked behind nothing, but nothing consumes it until the asset pipeline starts. |
| §7.3 hole styling, image-to-image | `COURSE_PIPELINE.md` | mood and marketing only | **Not run.** Never an input to design. |
| §7.4 key art | `COURSE_PIPELINE.md` | `public/`, `og:image`, store page | **Not run.** Ordinary marketing. |
| §8.1 orthographic turnaround | `ASSET_PIPELINE.md` | the §5 blockout, or §7 image-to-3D | **Not run.** The image job the concept folder is missing entirely. |
| §8.2 image-to-3D | `ASSET_PIPELINE.md` | a Blender reference object, never the repo | **Not run.** Optional; only when a blockout stalls. |

**None of these blocks the next code step.** Step 4 is data entry against a table that already
exists. If you want to spend image-model time productively between sessions, §8.1 is the one with
the most downstream value — `ASSET_PIPELINE.md` §10 step 4 (model the cart) needs it, and sixteen
existing concept paintings are all dramatic perspective shots, none usable as modelling reference.

### How to prompt, in short

- **Paste the prompt blocks unmodified.** They are long on purpose and each has been through at
  least one failure that shaped its wording.
- **Open every prompt with the art-style block** from `concept/hole-shot-prompts.md` §1 — that
  document is superseded, but that one block survives and is used verbatim. Discard its camera
  specs and its 18-biome table. **The §7.1 biome sheets are the deliberate exception**: they use a
  trimmed preamble, because the art-style block describes a *scene* and those sheets forbid one.
- **Never ask for a hex code.** Retired, with evidence: on the first parkland sheets not one
  printed code matched its swatch — several were the literal string `#RRGGBB` copied out of the
  prompt, several contained non-hex characters (`#899G42`, `#0UEGBF`), and a magenta `#C11ACF` was
  printed under a sky-blue swatch. Image models draw text as pixels.
- **Never ask for layout, routing, or teebox sightlines** (§8). Layout is `npm run plan`, which is
  correct by construction and diffable. Sightlines are a camera question about real geometry and
  only the built hole can answer them.
- **Nothing generated ships as geometry.** AI raster output is reference to model over.

### If you re-run the biome sheets

Read `COURSE_PIPELINE.md` §7.1 first — it now records what the first real run needed. The short
version: the sheets arrive as two stacked panels and the tool handles that itself now; a
5-across-then-4 layout detects as ten cells, so pass the explicit map after checking the labels;
and **a sheet is not finished until you have looked at a hole in that biome**. Links is the one at
risk — the sheet that came back read as three plausible greens on paper and as one flat khaki field
with no corridor edge from the chase camera.

---

## Loose ends carried forward

- **Driver roll/carry ratio is 0.63 where real golf is ~0.15.** Open since Phase 0, still open.
  (Phase 0 measured 0.86; Phase 2.5's terrain and continuous `crr` moved it to 65.3 m carry /
  41.0 m roll — better, not fixed.) The cause is loft, not damping: at 13° the trajectory is
  near-symmetric so the ball lands at a 13° descent angle and skips. Raising `loftDeg` toward
  18–20° is the lever. It is club balance, so it wants a play session rather than more arithmetic.

  **`npm run probe` exits 1 on this one check alone** — verified this session:
  `driver distance FAIL - 106.4 m total (65.3 carry + 41.0 roll) vs REFERENCE_CARRY_M 129,
  drift 17.6% (limit 15%)`. Everything else in the probe passes. Do not read a red probe as a
  regression without checking it is still only this line.
- **`docs/course/plans/` is 2.9 MB of generated SVG**, committed as reviewable design docs while
  `tools/.plan-out/` is gitignored. Flagged on PR #6; say the word and it gets ignored too.
- **Links' corridor edge is now present but soft** — 26.6 luminance on a near-identical hue is what
  the threshold buys. Worth a look in play before calling it settled.
- **Marsh `water` and `trunk` are a judgement call, not a metric one**, and `biomes.ts` says so.
  Both pass every contrast check as sampled; they were changed because near-black bog read as a
  hole in the world from the chase camera. Reversible if you disagree.
- **`terrainMobility.ts` port** (Phase 2, 159 lines, MIT) is still open, now a tuning refinement
  rather than a prerequisite. Needs a `NOTICE` entry when ported.

---

## House rules that catch people

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment. It
  is what lets `npm run probe`, `npm run plan` and the server import the sim unmodified.
- **A render check is never evidence about simulation** (`AGENTS.md`). `npm test` and
  `npm run probe` settle physics; `npm run gate` and `npm run smoke` settle presentation.
- **`npm run plan` after every course change.** A change that does not show up in the plans either
  did nothing or did something you did not intend. Conversely, a render-only change that *does*
  move a plan means something leaked into `src/sim/`.
- **Read `docs/TEST-AND-SPEC-PITFALLS.md`.** This repo has a documented history of tests that pass
  for the wrong reason. Get a test to fail for the right reason before you make it pass.
- **Read `DECISIONS.md` before touching ragdolls.** Several plausible Rapier fields are inert
  no-ops in the JS bindings and tuning them does nothing.

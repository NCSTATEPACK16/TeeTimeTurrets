# Stage E — Blender landmarks: the clubhouse and 18 tee signs

**Status: part-grilled, 2026-09-12.** Eleven of the thirteen open decisions are settled or have been
shown not to arise. Two remain open and are listed last. This is now a decision log rather than a
stub — it records what was chosen and what was rejected, which is what stops a later session
re-deriving it.

Not yet a design document. Four settled answers to thirteen questions is not a design, and writing
one before the last two are settled would mean inventing them.

---

## The feature, as stated

A clubhouse model and 18 tee signs. From `docs/HANDOFF.md`:

> `docs/ASSET_PIPELINE.md` forbids `.glb` for anything with a collider, enforced by
> `tools/decorBoundary.test.mjs`. The user chose a detailed `.glb` shell **plus** a proxy-box
> `PrimitiveGraph` collider, **both exported from one `.blend` in one pass** by `ttt_authoring.py`.
>
> Sign faces are a **third asset class**: a PNG texture, not primitives and not mesh.

**Both halves of that plan were put to the user and both were dropped.** What replaces them is
below.

---

## What the codebase already provides

**`.glb` loading exists.** `src/render/decor.ts:32` `loadDecor(url)` is async, never rejects, returns
`null` on failure, supplies a `dispose()`. One consumer: `showroom.ts:42`, the menu turntable
backdrop.

**A clubhouse `.glb` already exists — but it is the wrong one.** 29 boxes, 324 triangles, 16 KB, an
*interior* authored as that backdrop. `decor.ts:41-45` hard-disables its shadows.

**`ttt_kind` / `ttt_params` / `ttt_slot` are already the export contract** (`art/README.md:21-29`).
An object missing any of the three fails the export loudly.

**`tools/decorBoundary.test.mjs` enforces five things**, all textually via `node:fs`: no mesh file
under `src/`; every mesh file repo-wide under `^public/models/`; `GLTFLoader` imported in exactly one
module, hard-coded to `src/render/decor.ts`; no mesh extension string or `GLTFLoader` anywhere under
`src/sim/**` or `src/physics/**`; `public/models/` under **500 KB** (currently 15,768 B — 3% used).

**`tools/planPng.mjs` already takes `--in` and `--out`** (`:24`, `:31`). *Verified.* The stub
previously listed growing an input-dir mode as work; it is not.

**Tee furniture placement is the direct precedent for a sign.** `LayoutHole` carries no stored
orientation; yaw is derived at `src/render/props.ts:122`. The ball-washer / cart-path-sign loop at
`:131-141` places props behind the tee at `teeHeading + Math.PI`, with `TEE_FURNITURE_BACK = 4.5`
and `TEE_FURNITURE_SIDE = 3.0`. `MAX_PROPS_PER_HOLE = 20` (`:41`) is a hard cap `put()` enforces.

---

## Load-bearing facts

1. **`ttt_authoring.py` is not a repo file.** It is a Text datablock *inside* the binary
   `art/clubhouse-and-cart.blend`. Neither diffable nor reviewable, and `art/README.md:43-47` warns
   that the design copy printed in `ASSET_PIPELINE.md` §4.3 **differs from the working one**.
2. **The pipeline is entirely manual.** No npm script, no CI step, no build step touches Blender.
   `LICENSES.md:90`: *"there is no asset build step."*
3. **Nothing at all is drawn on the course in arena.** *Verified at `src/render/scene.ts:192-199`:*
   `trees`, `flagstick` and `props` are all `null` in that mode; only the ground tiles are built. So
   18 tee signs are not an addition to a course-wide prop pass — **they would be the first one**, and
   the gap is wider than signs. This is the same missing layer Stage D hit.
4. **`decorBoundary` assertion 3 pins importers, not signatures.** *Verified.* Growing
   `loadDecor(url, options)` does not move the test. The stub's fear that a shadow option collides
   with it was overstated.
5. **Assertion 4 matches mesh extensions as substrings** in `src/sim/**` and `src/physics/**`. A
   comment mentioning `.glb` in a sim file fails it, and `.obj` would match a member access like
   `.objects`. A live landmine, currently unstruck.

---

## Settled

**1. The clubhouse is decoration. You drive past it, not into it.** Playable is its own later stage.
This closes the `.glb`-plus-proxy question rather than answering it: with no collider there is no
proxy, so `ASSET_PIPELINE.md` §1 needs no amendment, there is no `PrimitiveGraph`→Rapier adapter to
invent, and there is no shell-and-proxy drift for an absent CI step to fail to catch. *Rejected:*
playable now, which would have made a graph-to-collider adapter first-class scope under time
pressure — nothing exists to plug it into.

**2. Carts will drive through it, and that is accepted as a named loose end.** The precedent is
railings, which are decoration a cart drives through. The difference in scale is real and recorded:
this building sits at world origin inside `CLUBHOUSE_APRON_M = 140`, where holes 1, 9, 10 and 18
converge — the most-driven ground on the map. **This is the decision most likely to want revisiting
after the first play session.** The fallback, if it does, is a hand-written box collider in
`src/sim` on the flagstick's route: no mesh, no rule amendment, and it was offered and set aside
rather than overlooked.

**3. A second export, not a replacement.** A new `exterior` collection in the same `.blend` →
`public/models/clubhouse-exterior.glb`. The existing interior stays exactly as it is. *Rejected:*
replacing it with one model serving both, which would re-baseline the menu gate subject for no gain.

**4. The 500 KB budget does not move.** An exterior at 1,500–2,500 triangles quantized is roughly
60–140 KB against 15,768 B used. It fits with room.

**5. Shadows for the in-world building come from an option on `loadDecor`.** `loadDecor(url, {
shadows: true })` — same module, same single importer, test unmoved. The unconditional disable is
correct for a backdrop sitting outside the key light's shadow camera and wrong for a building
standing on the ground.

**6. `ttt_authoring.py` is extracted to `art/ttt_authoring.py`** and sessions `exec` the repo file.
It is the one thing in the export contract that no reviewer can currently see.

**7. Sign faces are a runtime `CanvasTexture`, not a PNG. There is no third asset class.** The face
is drawn from the live `HoleSpec` — hole number, `spec.par`, yardage off the spline. *Rejected:* the
handoff's offline PNG pipeline, on one specific failure — **a committed PNG says "PAR 4" while the
seed says par 5** the moment the course regenerates, and nothing fails when it does. A runtime
texture cannot drift from the course because it reads it.

This one answer closes four open questions at once: the third class's boundaries, a texture size
budget, `.png` rules in `decorBoundary`, and committed-versus-regenerated. None of them arise.

**8. A sign face shows hole number, par and yardage. Text only.** Real tee signs mostly are exactly
that. A hole diagram would have forced the PNG route back open; it can be added later by swapping
the texture source, with no rewrite.

**9. Sign dimensions.** 1.25 m to the top of the board, board 0.55 × 0.40 m, tilted 15° back,
100–150 triangles, origin at ground contact. Full brief and the Gemini sheet prompt are in the
session's modelling-sheet artifact.

**10. Both models are authored in Blender**, in new collections: `exterior` for the clubhouse GLB,
and the tee sign joining the existing `props` primitive-graph set.

---

## Still open

**A. Sign placement against `MAX_PROPS_PER_HOLE = 20`.** Reuse `derivePlacements`' tee-furniture
pass and spend one of the twenty, or place signs in a separate pass? And do signs get colliders — a
0.55 m board at knee height that a cart passes through is a smaller offence than a clubhouse, but it
is the same question asked eighteen times. Note that `derivePlacements` runs per hole and **props do
not exist in arena at all** (fact 3), so "reuse the tee-furniture pass" means reusing its geometry,
not its call site.

**B. Does the model dictate the footprint, or do the constants?** `courseLayout.ts:438` has
`clubhouse: Vec2 = {x: 0, z: 0}` and `courseGeometry.ts:128` has `CLUBHOUSE_APRON_M = 140`, both
consumed by the routing relaxation. A 34 × 20 m building is assumed in the modelling brief; whether
that number is the authority or a placeholder the layout later overrides is unsettled.

---

## Depends on Stage D

The **course-wide instanced prop path** is one of the two pieces
`docs/superpowers/specs/2026-09-12-stage-d-pickups-design.md` builds deliberately as shared
infrastructure. Eighteen tee signs are its second consumer. Stage E should not build its own.

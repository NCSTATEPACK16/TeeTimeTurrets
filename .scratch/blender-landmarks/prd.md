# Stage E — Blender landmarks: the clubhouse and 18 tee signs — working stub

**Status: pre-grilling.** Feature statement, what the codebase already provides, and the decisions
that are still open. No user stories, no implementation decisions, no acceptance criteria — those
are outputs of grilling.

Item 3 of 4 in this session's queue.

---

## The feature, as stated

A clubhouse model and 18 tee signs. From `docs/HANDOFF.md`:

> `docs/ASSET_PIPELINE.md` forbids `.glb` for anything with a collider, enforced by
> `tools/decorBoundary.test.mjs`. The user chose a detailed `.glb` shell **plus** a proxy-box
> `PrimitiveGraph` collider, **both exported from one `.blend` in one pass** by `ttt_authoring.py`
> — one file, one edit, two outputs, so they cannot drift. Add a `collision` collection of crude
> invisible proxies tagged `ttt_kind`/`ttt_params`/`ttt_slot` inside the detailed model.
>
> Sign faces are a **third asset class**: a PNG texture, not primitives and not mesh. `npm run plan`
> already renders each hole's plan and `tools/planPng.mjs` already rasterises SVG to PNG — extend
> it to emit 18 sign-sized images. Record the new class in `ASSET_PIPELINE.md`.

---

## What the codebase already provides

**`.glb` loading exists.** `src/render/decor.ts:2` imports `GLTFLoader`; `loadDecor(url)` (`:32-65`)
is async, never rejects, returns `null` on failure, and supplies a `dispose()`. One consumer today:
`src/render/showroom.ts:42`, `BACKDROP_URL = "models/clubhouse.glb"`, loaded after first paint. No
new loading layer is needed.

**A clubhouse `.glb` already exists — but it is the wrong one.** 29 boxes, 324 triangles, 16 KB, an
*interior* authored as the menu turntable backdrop. `decor.ts:41-45` hard-disables its shadows.

**`ttt_kind` / `ttt_params` / `ttt_slot` are already the export contract** (`art/README.md:21-29`) —
an object missing any of the three fails the export loudly. Tagging collision proxies reuses an
existing convention rather than inventing one. A GLB export path from the same `.blend` also
already exists (`art/README.md:9`, `:52-60`): four collections export to
`src/entities/graphs/{cart,driver,props}.json` plus `public/models/clubhouse.glb`.

**`PrimitiveGraph` is render-only.** `src/entities/primitiveGraph.ts:42-48`. `buildGraph` (`:68`)
makes THREE meshes; `mergeGraph` (`:155`) bakes world-space geometry and per-slot vertex colours
into one mesh; `mergeGraphInstances` (`:185`) does n copies. **All three touch zero Rapier.**
Colliders today are hand-written per entity (`Pin.ts`'s `PIN_SHAPE`, `ballShape.ts`).

**`tools/decorBoundary.test.mjs` enforces five things**, all textually via `node:fs`:

| # | Line | Rule |
|---|---|---|
| 1 | `:34` | no mesh file under `src/` |
| 2 | `:39` | every mesh file repo-wide must match `^public/models/` |
| 3 | `:50` | `GLTFLoader` imported in exactly one module — hard-coded `["src/render/decor.ts"]` |
| 4 | `:59` | no mesh extension string **or** `GLTFLoader` anywhere in `src/sim/**` or `src/physics/**` |
| 5 | `:69` | `public/models/` total **< 500 KB** (currently 15,768 B — 3% used) |

**`ASSET_PIPELINE.md` §1 (`:63-70`) defines exactly two classes by path.** Playable: procedural
primitives only, no mesh files ever — *"anything with a collider, anything the server reconstructs,
anything whose dimensions the sim reads."* Decorative: authored `.glb` permitted — *"never collided
with, never replicated, never read by `src/sim/**`."* The mechanical test at `:69-70`: *"if removing
the asset entirely would change a single simulation result, it is playable."* §1 `:96` names
primitive-graph as an existing sub-kind. **There is no texture/PNG class today.**

**`tools/planPng.mjs` is already fully generic.** It reads every `.svg` in `docs/course/plans/`
(19 today), parses `width`/`height` off the SVG root (`:46-47`), sets a Puppeteer viewport and
screenshots to `tools/.plan-png/<name>.png`. It is a separate npm script (`plan:png`), **not** part
of `npm run plan`. Emitting 18 sign images needs a *producer of 18 sign SVGs*, not a change to the
rasteriser — plus an `--in`/`--out` or a second invocation.

**No clubhouse geometry exists in the course or sim at all.** It is a pure layout attractor:
`courseLayout.ts:438`, `clubhouse: Vec2 = {x: 0, z: 0}` at world origin, consumed by
`courseRelaxation.ts`. `CLUBHOUSE_APRON_M = 140` (`courseGeometry.ts:128`) is the radius inside
which corridors may converge.

**Tee furniture placement is the direct precedent for a sign.** `LayoutHole` carries no stored
orientation; yaw is derived — `src/render/props.ts:122`, `headingFrom(spec.tee, spec.control[1] ??
spec.cup)`. The ball-washer / cart-path-sign loop at `:131-141` already places props behind the tee
at `teeHeading + Math.PI`, with `TEE_FURNITURE_BACK = 4.5`, `TEE_FURNITURE_SIDE = 3.0`.
`MAX_PROPS_PER_HOLE = 20` (`:41`) is a hard cap `put()` enforces; props are dropped on sand/water.

---

## Load-bearing facts that reshape the design

1. **`ttt_authoring.py` is not a repo file.** It is a Blender Text datablock *inside* the binary
   `art/clubhouse-and-cart.blend`, executed per session over the Blender MCP
   (`art/README.md:31-48`). It is neither diffable nor reviewable, and `art/README.md:43-47` warns
   that the design copy printed in `ASSET_PIPELINE.md` §4.3 **differs from the working one**. The
   "one file, one edit, two outputs" guarantee rests on a script no reviewer can see.
2. **The pipeline is entirely manual.** No npm script, no CI step, no build step touches Blender.
   `LICENSES.md:90` states it outright: *"there is no asset build step."* So nothing can verify a
   committed `.glb` and a committed `.json` came from the same export — the anti-drift claim is an
   authoring intent, not an enforceable one.
3. **The plan is in tension with `ASSET_PIPELINE.md` §1 as written.** By the mechanical test, a
   clubhouse you collide with is playable, and playable forbids mesh files entirely. "The shell is
   decorative, the proxy is playable" may be a legitimate reading, but it is a reading — the rule
   does not currently say it. Assertion 4 also fails on any `.glb` *substring* in `src/sim/**`.
4. **PrimitiveGraph → Rapier collider does not exist and is wholly new work.** The handoff's plan
   treats the proxy graph as though it plugs into something; nothing is there to plug into.
5. **Assertion 3 pins `GLTFLoader` to exactly one module**, and `loadDecor` hard-disables shadows —
   fine for a menu backdrop, probably wrong for a building in the world. Growing an option or
   adding a loader both collide with an existing test.

---

## Decisions this design needs

Open. None are mine to settle.

1. **Does the clubhouse become playable at all** — do you drive into it, or is it decoration you
   pass by? This decides whether the `.glb`-plus-proxy question even arises.
2. **If playable: how is §1's rule amended** to permit a decorative shell over a playable proxy,
   and what stops that reading from being used to smuggle mesh into the sim later?
3. **Where does a PrimitiveGraph→Rapier collider adapter live**, given `src/sim/**` must stay
   Node-runnable and mesh-free?
4. **How do shell and proxy stay provably in sync**, given nothing in CI can check it — or is drift
   simply accepted and caught by eye?
5. **Should `ttt_authoring.py` be extracted to a tracked repo file** so it is diffable, and does the
   Blender step gain any automation?
6. **The third asset class's boundaries**: what a sign PNG may and may not do; whether textures get
   a size budget; whether `decorBoundary.test.mjs` gains `.png` rules; whether sign PNGs are
   committed or regenerated.
7. **Who generates the 18 sign SVGs** — extend `tools/holePlan.ts`, a new tool, or hand-authored —
   and **what a sign face actually shows** (number, par, yardage, hole diagram, or some subset).
8. **Sign dimensions and resolution**, and whether `planPng.mjs` grows an input-dir mode.
9. **Sign placement**: reuse `derivePlacements`' tee furniture and spend one of the 20-prop budget,
   or a separate pass — and **do signs get colliders?**
10. **Is the existing 16 KB interior clubhouse reused, extended, or replaced** by a second exterior
    model?
11. **The 500 KB `public/models/` budget** — does an exterior clubhouse plus 18 sign textures fit,
    and does the cap move?
12. **Shadow policy** for an in-world building, against `loadDecor`'s hard-disable and assertion 3's
    single-loader rule.
13. **Is `clubhouse = {x:0,z:0}` with `CLUBHOUSE_APRON_M = 140` the authority for the building's
    footprint**, or does the model dictate and the constants follow?

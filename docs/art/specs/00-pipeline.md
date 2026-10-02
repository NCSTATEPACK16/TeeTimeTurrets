# 00 — Stage 7 authoring pipeline

Settled 2026-09-28 in a grilling session. It applies to every spec in this folder, and where they disagree it overrides `docs/ASSET_PIPELINE.md` and `.scratch/blender-landmarks/prd.md`.

## What changed from the old process

| Old | New |
|---|---|
| `ttt_authoring.py` lived only inside `art/clubhouse-and-cart.blend`, where nobody could diff or review it | Extracted to **`art/ttt_authoring.py`**. Every session runs `exec(open(REPO + '/art/ttt_authoring.py').read(), globals())` |
| One `.blend` held everything | **`art/clubhouse-exterior.blend`** holds the clubhouse kit, food cart, pickups and tee sign. **`art/cart-v2.blend`** holds the cart and driver, appended from the old file. `art/clubhouse-and-cart.blend` is **frozen**: never opened for writing again |
| Six primitive kinds | Seven: **`prism`** is added (see below) |
| The clubhouse was going to be a decorative GLB that carts drive through (landmark PRD) | The clubhouse is a **primitive graph with sim colliders**. `public/models/clubhouse.glb`, the interior used as the menu backdrop, stays exactly as it is |
| Sheets were read literally | Each spec carries a **critique** of its sheet. The sheet gives proportions only; the spec's numbers win |
| Scene Gate subject for every asset, full suites | **Testing policy below**: one smoke check per slice, 15 s or less, and human play-testers judge the look |

## Environment facts

- **Blender version:** Blender 5.2 LTS (`/Applications/Blender.app`); `ASSET_PIPELINE.md` still says 4.x.
- **MCP addon:** outdated. Before the session, run `uvx mcp-for-blender install-addon`, restart Blender, then Start MCP Server.
- **Integrations:** Hyper3D, Hunyuan, Tripo, Sketchfab and Poly Haven are all **off**, and none is needed. AI geometry is never shipped (AGENTS.md).
- **Validating on 5.2:** before any new authoring, append `Collection` (the cart) into a scratch file and run the old `export('chassis_pan', …, graph_name='cart')` into a temp path. **`diff` the output against `src/entities/graphs/cart.json`.** Any difference means 5.2 broke the exporter; fix that first. This is slice 1's smoke check.
- **Headless read-only inspection works:** `/Applications/Blender.app/Contents/MacOS/Blender -b file.blend --python-expr "…"`.

## The `prism` kind

This is a 2D polygon extruded straight. It covers hip roofs, gables, wedges, scalloped awning edges and sign boards, none of which the six existing kinds can make without non-uniform scale, which the exporter disallows.

- **`params`** is `[depth, x0, y0, x1, y1, …, xn, yn]`. The polygon lies in the node's local **Three XY plane**, is counter-clockwise, and has at least 3 points. It is extruded along local **+Z** by `depth` and **centred on z** (so from −depth/2 to +depth/2), matching the way Box and Cylinder are centred.
- **Three side, `primitiveGraph.ts`:**
  - Add the kind: `"prism"`.
  - Geometry: `new THREE.ExtrudeGeometry(new THREE.Shape(points), { depth, bevelEnabled: false, steps: 1 })`, then `.translate(0, 0, -depth / 2)`.
  - Validate: an odd-length point list, fewer than 3 points, or `depth <= 0` throws when the graph loads, never mid-frame.
- **Blender side, `art/ttt_authoring.py`:**
  - Add `'prism'` to `KINDS`.
  - In `make()`, build the vertices from the polygon at `z = ±depth/2` in Three space. Convert them with Three→Blender `(x, y, z) → (x, −z, y)`, then build faces with bmesh (two caps plus one quad per side).
  - Use `make(name, 'prism', [depth, *flat_points], slot, …)`.
- **Collision:** colliders are **never** prisms. A sim collider is always a box or cylinder written in `src/sim/clubhouse.ts` (see `sim-slices.md`).
- **Smoke check, 15 s or less:** one Vitest case builds a triangular prism, checks that its bounding box equals the polygon's bounds by depth, and checks that a bad param list throws.

## Conventions (unchanged, repeated so no one has to hunt for them)

- **Units and axes:**
  - 1 Blender unit = 1 m.
  - Blender Z-up becomes Three Y-up under `(x, y, z) → (x, z, −y)`.
  - In cart space −Y is forward; the vehicle's left is +X.
- **Transforms:**
  - Object scale stays `(1,1,1)`, and size lives in `ttt_params`.
  - Rotation uses **X plus at most one of Y or Z**. Any other rotation exports wrong without any error.
- **Update before reading:** call `bpy.context.view_layer.update()` before reading `matrix_local` or `matrix_world`, and before placing a child against a parent made in the same script.
- **Origins:** at ground contact for every static asset, and at the pivot for anything that moves.
- **Slot names are unique per graph set.** New slot sets are listed in each spec. `export()` writes only the slots a graph actually uses.
- **Style:** match `docs/concept/03CartTurretChasecam.jpg`. *(Under review since 2 Oct 2026: `../STYLE-RESEARCH.md` P1 proposes replacing the two sub-points below with a soft-bevelled rule. They stand until the user approves it.)*
  - Flat shading, deliberately large facets, no textures, no bevels, and never decimate.
  - The premium look comes from lighting, not from geometry.

## Review loop, per asset

1. Read the asset's spec, then open its source sheet from `docs/concept/reference/`. Full-resolution originals are in `../concept-originals-fullres/`, outside the repo.
2. Block out with `make()` in the asset's own collection. Place the camera orthographically, front and side. Take `get_viewport_screenshot()` and show the sheet beside it.
3. Fix proportions against the sheet and the spec's numbers, **not** the sheet's printed dimensions.
4. Check the triangle count against the budget: `sum(len(p.vertices)-2 for o in coll.objects for p in o.data.polygons)`.
5. Export the JSON, run the slice's smoke check, run `tsc --noEmit`, and commit.
6. At the end of each slice group, **stop** for a human play-test.

## Testing policy (user decision, 2026-09-28)

- **Budget:** each slice gets **one** small smoke check that finishes in **15 s or less**: a single targeted Vitest file, the export diff, or a quick headless load. There will be no new Scene Gate subjects, no feel probes and no broad new suites.
- **Quality:** look, feel and balance are judged by **human play-testers**, at the stop at the end of each slice group.
- **Always:** run `tsc --noEmit`. Existing CI must stay green. If the arena golden fingerprint moves because of a sim slice, take the new value from the failing Linux CI run.

## Budgets for this stage

| Asset | Triangles | Draws in-world |
|---|---|---|
| Cart v2 (whole cart) | 2,000–3,000 (unchanged) | per-slot, same as today (Stage 3 merges) |
| Clubhouse | ≤ 3,000 | merged, one per slot-colour mesh via `mergeGraph` |
| Team barn (each) | ≤ 800 | 1 (`mergeGraph` with team slot override) |
| Lamp post | ≤ 120 | 1 for all four (`mergeGraphInstances`) |
| Lot striping | ≤ 100 | 1 |
| Food cart | ≤ 400 | 1 |
| Pickup item (each type) | ≤ 150 | 1 per type, instanced |
| Tee sign frame | 100–150 | 1 for all 18, plus the face quads |

The whole clubhouse kit comes to about 8 draw calls, and `public/models/` is not touched.

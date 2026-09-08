# Blender sources

The authoring end of `docs/ASSET_PIPELINE.md`. **This is the source; the files it produces under
`src/entities/graphs/` and `public/models/` are build output.** Re-author here and re-export — do
not hand-edit a `cart.json` or a `.glb`, because the next export silently reverts it.

| File | Contains |
|---|---|
| `clubhouse-and-cart.blend` | Two collections: `Collection` — the 47-object cart (§4 primitive graph, exported to `src/entities/graphs/cart.json`); `backdrop` — the 29-object clubhouse interior (§6 decorative GLB, exported to `public/models/clubhouse.glb`). |

`.blend1` is Blender's own rollback of the previous save. It is ignored, not tracked.

## Opening it

Open the `.blend` normally. Everything is plain primitives with no modifiers, no armatures and no
textures, so nothing needs to be resolved on load.

**The cart's custom properties are the export contract.** Select any cart object and look at
Object Properties → Custom Properties:

- `ttt_kind` — one of `box` `cylinder` `cone` `sphere` `capsule` `torus`
- `ttt_params` — the arguments for the *matching THREE geometry constructor*, in that
  constructor's order (§4.2). For a box this is `[width, height, depth]` in **Three's** axes, so
  it is the Blender dimensions with Y and Z swapped.
- `ttt_slot` — one of the eight material slots in §2.1

An object without all three fails the export loudly rather than silently dropping out.

## Re-exporting

Both exports run from a Claude Code session over the Blender MCP; the exporter source is in
`docs/ASSET_PIPELINE.md` §4.3 (cart) and the step list in §6 (backdrop). Two things that will bite
if they are done by hand instead:

- The exporter must call `bpy.context.view_layer.update()` before reading `matrix_local`, or it
  reads pre-parenting transforms that look plausible and are wrong.
- The GLB must be optimised with `--compress quantize`, never the default `meshopt`, which a plain
  `GLTFLoader` cannot decode.

Both, and the rest of the traps, are written up in `docs/ASSET_PIPELINE.md`.

## Conventions

- 1 Blender unit = 1 metre. Cart ~2.4 m long.
- Cart space: origin at ground-contact centre, **−Y is forward**, +Z is up. That maps to Three's
  +Z forward and +Y up under `(x, y, z) → (x, z, −y)`.
- Object scale stays `(1,1,1)` on anything with children; size lives in the mesh data.
- `turret_pivot` sits at exactly `TURRET_GEOMETRY.pivotHeight` and `head_slot` at exactly
  `barrelLength` from `barrel_pitch`. **The sim owns those two numbers**
  (`src/sim/entities/Cart.ts`) — the model matches them, never the other way round, because
  `computeMuzzle` decides where a shot actually originates.
  `src/entities/cartGraph.test.ts` fails if a re-export breaks either.

# Team cart barns (×2)

**Route:** graph `team_barn` in the `clubhouse.json` set (see `clubhouse.md`).
**Source:** `art/clubhouse-exterior.blend`, collection `team_barn`.
**Sheet:** none. This spec is the brief. An optional image prompt is at the end.
**Replaces:** REVAMP's single 16×10 m "cart barn". The grilling session chose two team barns for 4v4.

## Role

Each team's spawn row gets a barn just outboard of it, so a cart visibly "rolls out of the garage". It:
- marks which side of the clubhouse is whose, from far away
- gives spawns cover from the side
- mirrors the clubhouse's architectural language, so the three buildings read as one complex

## Layout (world, relative to `AUTHORED_CLUBHOUSE` = C)

- Team 0 (west) barn: centre (C.x − 33, C.z + 10.5). Team 1 (east) barn: centre (C.x + 33, C.z + 10.5). The z centre is the midpoint of the 4 pad slots at z + 0, 7, 14, 21.
- **Open side faces the clubhouse:** +x for the west barn, −x for the east. The same graph is placed with yaw 0 and π.
- **Clear gap:** the pads are at x ±25 and the barn's open face at ±29, which leaves a 4 m apron in front of the barn.

## Dimensions (graph space: origin at ground contact at the centre; the open face is at +x before yaw)

- **Footprint:** 8 (x, depth) × 24 (z, length). Four 6 m bays, each aligned to one pad slot.
- **Walls:** a back wall at x = −4 and two end walls at z = ±12, all 0.3 thick and 3.2 high, on a 0.3 m brick plinth. The open front has 5 timber posts (0.25 m square) at z = −12, −6, 0, 6 and 12.
- **Roof:** a gable with its ridge along z at +5.4 m (the clubhouse's pitch, about 30°) and eaves at +3.5, overhanging 0.4 m.
  - Built from two thin `prism` planes (rotation X only in graph space).
  - The gable ends are two `prism` triangles filling each end above the wall.
- **Fascia:** a 0.5 m-tall board along the open-front eave, slot **`team_trim`**.
  - On it, bay numbers 1–4, each built as a simple box glyph from about 3–5 thin boxes and centred over its bay. Slot `cb_trim`.
  - They are optional if the budget is tight. The fascia colour alone carries the team.

## Slots

It reuses `cb_wall`, `cb_roof`, `cb_brick` and `cb_trim` from `clubhouse.md`, plus:

| Slot | Default | Runtime |
|---|---|---|
| `team_trim` | `0x888888` | `mergeGraph(graph, { team_trim: TEAM_CANOPY[team] })` from `src/render/teamColors.ts` |

## Budget

**800 triangles or fewer.** Two merged meshes, one per team override, which is 2 draw calls.

## Colliders (`src/sim/clubhouse.ts`)

- The back wall, 2 end walls and 5 front posts are boxes: 8 colliders per barn.
- The roof has no collider. A ball over the eave height of 3.5 m flies over, which is fine.

## Smoke check

This is covered by the same `clubhouseGraph.test.ts`, with one added assertion: the barn footprint AABB is 8 × 24 within 0.1 m, and it has 800 triangles or fewer.

## Acceptance

- A human play-tester can tell, from a spawn, which barn is theirs.
- A cart spawned at any pad drives out without clipping a post.

## Optional sheet prompt (only if the blockout looks wrong)

> Orthographic modelling sheet on flat mid-grey. Four panels: FRONT, SIDE, REAR, TOP-DOWN, on a shared ground line with no perspective. The subject is a low-poly flat-shaded open-fronted golf cart barn: 24 m long and 8 m deep, with a cream rendered back wall on a brick plinth, a sage-green gable roof with a 30° pitch, five square timber posts along the open front, and a coloured fascia board above the opening with large numbers 1 2 3 4. It matches a colonial golf clubhouse. Include no carts, no people, no terrain and no text other than the panel labels and the fascia numbers.

## As built (28 Sep 2026)

- **Roof pitch:** 17°, to match the clubhouse. The ridge is at about 4.85, not the 5.4 above.
- **Floor:** grey paving (`lot_paving`), not brick. In game a brick floor read as a big red slab.
- **Bay numbers:** not built. The fascia colour carries the team.
- **Triangles:** 160.

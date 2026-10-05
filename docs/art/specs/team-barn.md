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
- **Bay numbers:** dropped for good (29 Sep 2026). Nothing in the game names a pad, so a number would label nothing; the fascia colour carries the team.
- **Triangles:** 160.

## v3 amendments (approved 3 Oct 2026)

Source: `docs/concept/reference/hub-kit-01.jpg` for its details only. The sheet draws a 3-bay barn open at the gable end; this spec's 4-bay barn, open along its long side and facing the clubhouse, stays.

- **Posts:** the 5 front posts become `rbox` (r 0.03), each on a 0.34 square base block (plain `box`).
- **Knee braces:** two 45° timber braces per post, from about 0.8 m below the eave to the fascia, each a thin `prism` wedge, slot `cb_door` (the timber brown). The end posts take one brace, on their inner side, so there are 8 braces in all.
- **Brick knee wall:** a 0.9 m-high `cb_brick` band along the inside of the back wall and both end walls, proud of the wall by 0.04.
- **Fascia:** `team_trim`, now an `rbox` (r 0.04) so it catches the edge highlight that carries the team colour.
- **Budget:** about 160 → 830. **Raise the barn budget from 800 to 900**, and the assertion in `clubhouseGraph.test.ts` with it. It is still 1 draw call per barn.

## As built, v3 (4 Oct 2026)

Built by `art/stage7_kit.py` (`build_team_barn`).

- **Triangles:** 1,004 per barn after the detail pass (budget raised to 1,100; it was 896 before that pass and 160 before v3). Still one `mergeGraph` with the team-slot override.
- **Roof:** shares the clubhouse `PITCH`, now 24.99°, so the ridge is at 5.55 (was 4.84).
- **Posts:** 5 `rbox` r 0.03, each on a plain box base 0.34 × 0.30 × 0.34.
- **Brick knee wall:** `tb_brick_back` and `tb_brick_n/s`, 0.9 high and 0.04 proud of the inside faces. The end pieces stop short of the end posts.
- **Fascia:** `tb_fascia` is an `rbox` r 0.04, slot `team_trim`.
- **Changes from the spec, with reasons:**
  - **The knee braces are triangles, not four-point strips.** A strip prism costs 12 tris, which put the barn at 928. The triangle wedge (8 tris) tapers from 0.25 m on the post to a tip.
  - **The braces leave the post 0.8 below the fascia's bottom edge (y 2.2), not 0.8 below the eave (2.7).** The fascia covers 3.0–3.5 in front of the post line, so a brace from 2.7 hid almost entirely behind it. Each runs at 45° up behind the fascia to the eave (3.5), so from the yard it reads as meeting the fascia, as in `hub-kit-01.jpg`.
- **Detail pass (4 Oct 2026):** a rounded ridge cap (`rbox` r 0.06, 24.8 long, `cb_roof`), matching the clubhouse's. The 3× A/B test also tried a rounder roof, barge boards and coping on the knee wall; none of them read at play distance.

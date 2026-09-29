# Parking lot: striping and lamps

**Route:** graphs `lot_stripes` and `lamp_post` in the `clubhouse.json` set.
**Source:** `art/clubhouse-exterior.blend`, collections `lot` and `lamp_post`.
**Sheet:** none; this spec is the brief.

## Layout (world, relative to `AUTHORED_CLUBHOUSE` = C)

- **Where:** behind the clubhouse, on the −z side, toward County Home Road.
  - The lot's north edge is at C.z − 9, which leaves 2 m behind the rear wall.
  - It is 8 bays across (x, from C.x − 10 to C.x + 10) and 1 row deep: bays of 2.5 × 5 m, so the lot is 20 × 5 m. A 6 m drive aisle sits between the lot and the building.
- **Boundary check (required):** every corner of the lot and every lamp must satisfy `metresNorthOfBoundary(x, z) ≥ 5` (`src/sim/courseBarrier.ts`).
  - If they do not, drop to 6 bays.
  - If 6 bays still fail, drop to 4 bays.
  - Record the result in the PR.
- **Lamps:** 4 lamps at the lot corners and the aisle ends, at (C.x ± 11, C.z − 9) and (C.x ± 11, C.z − 15).

## `lot_stripes`

- **Paving:** one flat paving box, 21 × 0.04 × 6 m, top at +0.02, slot `lot_paving` (`0x5C5F63`, roughness 0.95).
- **Stripes:** 9 bay-line boxes, 0.12 × 0.02 × 4.6 m, top at +0.045, slot `lot_paint` (`0xF2F2EA`).
- **Collider:** none. It is flush with the ground.
- **Budget:** 100 triangles or fewer; 1 draw via `mergeGraph`.
- **Terrain note:** it is placed at the terrain height of the lot centre. If the ground under it varies by more than 0.1 m, the render slice may split the paving into strips, one per bay, each at its own terrain height. The stripes follow. Judge this from a screenshot, not from a test.

## `lamp_post`

- **Parts:**
  - base: a cylinder, radius 0.18, height 0.4
  - post: a cylinder, radius 0.07, height 5.0 (6 segments)
  - arm: a box reaching 0.6 m toward the lot
  - head: a box 0.5 × 0.18 × 0.3, slot `lamp_glow`
- **Slots:**
  - `cb_trim` is not used here. The post uses **`lamp_metal`** (`0x2F3336`, roughness 0.5, metalness 0.6).
  - The head uses **`lamp_glow`** (`0xFFE3A0`). After the merge, the render slice gives the lamp mesh a small emissive using the head's vertex colour. The simplest way is a second 1-part graph for the head, so that only the head material gets `emissive`.
- **Budget:** 120 triangles or fewer; the 4 lamps together are 1–2 draws via `mergeGraphInstances`.
- **Colliders (user decision):** one **cylinder** per lamp, radius 0.18, height 5.4 (`src/sim/clubhouse.ts`).

## Smoke check

Covered by `clubhouseGraph.test.ts`: the lamp has 120 triangles or fewer, and its height AABB is 5.4 within 0.1. The boundary check is a single assertion in the sim slice's test (`sim-slices.md`).

## Acceptance

- The lot reads as a parking lot from chase-cam.
- Carts stop on lamp posts instead of passing through them.

## As built (28 Sep 2026)

- **Triangles:** the stripes and paving come to 120, because each box is 12. It is still 1 draw.
- **Lamp:** the post is 68 triangles. The head is a one-node `lamp_head` graph, so only it takes the emissive.

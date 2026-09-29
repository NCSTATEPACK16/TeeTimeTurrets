# Clubhouse dressing

**Route:** primitive-graph set → `src/entities/graphs/dressing.json`, authored in collection `dressing`.
**Purpose:** it makes the spawn complex, and the golden-hour title orbit (#60), read as a lived-in clubhouse rather than a model on a lawn.
**Colliders:** none. These are small decoration that carts pass through, like the railings. The spawn lanes must stay clear.

## Items (origin at ground contact, front facing +z)

| Graph | Build | Slots |
|---|---|---|
| `bench` | Park bench, 1.6 m long and 0.45 m seat height. Two cast-iron end frames (box + prism leg profile), 3 seat slats, 2 back slats | `dr_timber`, `dr_iron` |
| `flagpole` | White pole, 8 m tall, radius 0.06, with a ball finial. The club flag is a `prism` swallowtail 1.4 × 0.9 m, **cb_roof sage with a cream stripe**, and it is not a national flag | `dr_white`, `dr_flag`, `dr_flag_stripe` |
| `planter` | Timber planter 1.2 × 0.5 × 1.2 holding a clipped round shrub (sphere 8 × 5) | `dr_timber`, `dr_shrub` |
| `bag_rack` | Steel rack 1.6 m long with two golf bags leaning on it (tapered cylinders at a 10° lean about X, 3 club heads poking out of each). Bags are red and navy | `dr_iron`, `dr_bag_a`, `dr_bag_b`, `dr_white` |
| `welcome_sign` | Two posts carrying a 1.6 × 0.6 m board. The text is a runtime CanvasTexture reading "TEE TIME TURRETS · GOLF CLUB", using the same technique as the tee sign in `src/render/teeSigns.ts` | `dr_timber`, `dr_board` |

The palette follows the clubhouse's (`cb_*` in `stage7_kit.py`):

| Slot | Colour |
|---|---|
| `dr_timber` | `0x8A5A32` |
| `dr_iron` | `0x2F3336` |
| `dr_white` | `0xF3EEDC` |
| `dr_flag` | `0x7F9A88` |
| `dr_flag_stripe` | `0xF3EEDC` |
| `dr_shrub` | `0x446327` |
| `dr_bag_a` | `0xB0352A` |
| `dr_bag_b` | `0x23355E` |
| `dr_board` | `0x1F4D2E` |

## Placement (in this stage)

Add a `DRESSING_PLACEMENTS` table to `src/sim/clubhouseLayout.ts`. Offsets are from the clubhouse centre; +z is its front.

| Item | Offset (dx, dz) | Yaw |
|---|---|---|
| bench ×2 | (±7.5, 8.5) | 0 |
| planter ×2 | (±2.6, 8.4), flanking the steps | 0 |
| flagpole | (−10, 11) | 0 |
| bag rack | (10, 10) | π |
| welcome sign | (0, 30), facing the course | π |

Each piece must stay **at least 1.5 m clear of every pickup pillar**: the depot ring has radius 6 around (0, 16), and each pillar has radius 1.5. Assert that in the smoke test.

**Rendering:** `src/render/clubhouse.ts` draws each kind with `mergeGraphInstances` (one draw per kind). The flag gets a small vertex-shader flutter or a simple yaw sway in `update(t)`. That is optional; drop it if it costs more than a few lines.

## Smoke check

`src/entities/dressingGraphs.test.ts`:
- every graph builds within budget
- `bench` seat height is 0.45 ± 0.05
- `flagpole` height is 8.0 ± 0.2
- no placement comes within 1.5 m of any depot pillar edge

## Acceptance

The spawn looks inhabited from chase-cam, and the flag and sign read on the title orbit.

# Clubhouse (exterior)

**Route:** a primitive-graph **set** → `src/entities/graphs/clubhouse.json`. The set holds `clubhouse`, `team_barn`, `lamp_post`, `lot_stripes` and `food_cart`, and is exported once with `export_set`.
**Source:** `art/clubhouse-exterior.blend`, collection `clubhouse`.
**Sheet:** `docs/concept/reference/clubhouse-exterior-01.jpg` (a 34×20×9 m pavilion with a true roof plan).
**Supersedes:** `.scratch/blender-landmarks/prd.md` decisions 1–3 and 10. The clubhouse is **not** a decorative GLB; it is a graph with sim colliders. The interior `public/models/clubhouse.glb` stays as the menu backdrop, untouched.

## Role in play

This is the arena spawn hub. Both teams spawn on pads either side of it (`src/sim/spawn.ts`: `PAD_OFFSET_M = 25`, 4 slots 7 m apart running +z, team 0 at −x). It is also the most-driven ground on the map. The building has to:
- block carts and balls, which is what the colliders are for
- block sightlines between spawns (`sim-slices.md`, LOS)
- read as "clubhouse" from anywhere on the course. The cupola is the silhouette that does that.

## Sheet critique, and the better design

| Sheet | Change | Why |
|---|---|---|
| 34×20×9 m | **24 × 14 m footprint including verandahs, 7.6 m to the cupola top** | REVAMP size. The spawn pads at ±25 m get 13 m of clearance to the wall |
| 7 window bays per side | **5 front bays** (door in the centre, 2 windows each side); 3 at the rear; 2 at each end | Fewer, larger reads better at 50–150 m and halves the part count |
| Louvred shutters on every window | **None.** Each window is a dark inset box with a cream trim box | Shutters are about 12 tiny parts per window and read as noise at game distance |
| Rooster weathervane | **Cut** | A sub-metre detail that reads as nothing. The cupola carries the silhouette |
| Wrap-around verandah on all sides | **Front (+z) and both ends (±x).** The rear (−z) gets none | The rear faces the lot; the ends face the spawn pads, where cover and shade matter |
| Clerestory window band | Keep as **one** dark band box per side | Cheap, and it reads as the sheet's second storey |
| Chimney | Keep, rear-right | Asymmetry helps orientation: the chimney is on the east side |
| Hip roof (roof plan panel) | Keep, pitch about 30° | Built from `prism` planes (see Parts) |

## Dimensions (Three space, origin at ground contact at the building centre, +z = front)

- **Main block:** 20 (x) × 11 (z). Its centre is offset −1.5 z so that the 3 m front verandah fits inside 14.
- **Plinth:** brick, from −1.0 to +0.6. It extends 1 m below the origin to hide the apron slope.
- **Ground-floor walls:** +0.6 to +3.6. Clerestory band +3.6 to +4.6. Eaves at +4.6.
- **Main hip roof:** ridge at about +6.4 m. Ridge length 20 − 11 = 9 m, so the hips are equal-pitch.
- **Cupola:** a 1.6 × 1.6 box from +6.2 to +7.0, then a 4-sided pyramid roof to +7.6. That pyramid is a `cone` with 4 segments, rotated 45° about Three Y.
- **Chimney:** 1.0 × 1.0, rising from inside the roof to +7.2, at (x +6, z −3).
- **Verandahs:**
  - Front is 3 m deep and each end is 2 m deep. The deck is the top of the plinth (+0.6).
  - The lean-to roof runs from +3.6 at the wall down to +3.1 at the posts.
  - Posts are 0.22 m square boxes: 7 across the front and 4 down each end, 15 in all.
- **Steps:** 3 stacked boxes centred on the front door, 3 m wide.

## Parts (at most about 70 nodes)

| Part | Kind | Slot |
|---|---|---|
| plinth | box | `cb_brick` |
| wall block | box | `cb_wall` |
| clerestory bands ×4 | box, thin, proud of the wall by 0.05 | `cb_glass` |
| windows ×14 and door ×1 | box, inset 0.05 into the wall, with a 0.06 trim box around each | `cb_glass` / `cb_trim` / door `cb_door` |
| main roof | **4 thin `prism` planes**, 0.12 thick: 2 trapezoids (front and back) and 2 triangles (hips), plus 1 flat soffit box closing the underside at the eaves | `cb_roof`, soffit `cb_trim` |
| verandah roofs | 3 thin `prism` or box planes | `cb_roof` |
| posts ×15, steps ×3 | box | `cb_trim` |
| cupola base and roof | box and 4-segment cone | `cb_trim` / `cb_roof` |
| chimney, plus a cap box | box | `cb_brick` |

**Rotation rule:** every roof plane uses X only (front and back) or X then Y (hips). No plane needs Z. A Three-Z tilt is always expressible as X then Y about the plane's own axes, so check it in the viewport, never assume.

## Slots (the `cb_` prefix is unique to this set)

| Slot | Colour | Roughness / metalness |
|---|---|---|
| `cb_wall` | `0xE9DDB0` cream | 0.85 / 0 |
| `cb_roof` | `0x7F9A88` sage | 0.7 / 0.05 |
| `cb_brick` | `0xA8583A` | 0.9 / 0 |
| `cb_trim` | `0xF3EEDC` | 0.7 / 0 |
| `cb_glass` | `0x2E3F52` | 0.25 / 0.1 |
| `cb_door` | `0x6B4A2E` | 0.8 / 0 |

## Budget

**3,000 triangles or fewer.** Rendered as `mergeGraph(graph)`, which is one merged mesh with vertex colours, so 1 draw call. It needs no repaint, which is why merging is allowed here.

## Colliders (written in `src/sim/clubhouse.ts`, see `sim-slices.md`)

- **`clubhouse_block`:** box, main block 20 × 11, height 6.4, centred at (0, 3.2, −1.5).
- **`clubhouse_verandah`:** box over the full 24 × 14 footprint, height 3.6, centred at (0, 1.8, 0). Carts cannot drive onto the verandah. That is deliberate: a 0.6 m step is a KCC edge case not worth owning.

## Placement

- `src/render/clubhouse.ts` at `AUTHORED_CLUBHOUSE` (`src/sim/authoredLayout.ts`), yaw 0, y equal to the terrain height at the centre.
- Replace the stand-in decorative `clubhouse.glb` that commit `cb039b6` loads into the arena through `loadDecor`. The **menu showroom** keeps its own `loadDecor('models/clubhouse.glb')`.

## Smoke check (15 s or less)

One Vitest file, `src/entities/clubhouseGraph.test.ts`, checks four things:
1. The set parses.
2. Every node builds.
3. The clubhouse's world AABB footprint is 24 × 14 within 0.1 m.
4. The triangle count is 3,000 or fewer.

## Acceptance

- Front, side and top viewport screenshots sit beside the sheet. The proportions read as the sheet's pavilion, and the cupola is visible.
- In-game it is visible from the far tees. The human play-tester judges this.

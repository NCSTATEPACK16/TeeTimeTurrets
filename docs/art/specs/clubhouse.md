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

## As built (28 Sep 2026)

- **Built by `art/stage7_kit.py`** (`build_clubhouse`), which is the source to edit. The model is 696 triangles.
- **Roof:** pitch 17°, from an eave at 4.6 to a ridge at 6.4, as the dimensions above imply. The hip planes use X-then-Y rotations, which exposed an exporter bug that is now fixed (`art/README.md`, Rotations).
- **Steps** stand outside the 14 m plinth, so the AABB is x ±12.2 (verandah eaves), z −7.4 … +7.9. That needs a **third collider for the steps**; see `sim-slices.md`.
- **Posts:** 14 in all: six across the front, and four more down each end.

## v3 amendments (approved 3 Oct 2026)

Source: `docs/concept/reference/clubhouse-hero-01.jpg` (target), `clubhouse-breakdown-01.jpg` (modules) and `clubhouse-distance-01.jpg` (silhouette at 150 m). The hero confirms the layout above, so only these change. See `../SHEET-REVIEW-2026-10-03.md`.

- **Bevels:** these become `rbox`:
  - the plinth (r 0.10)
  - the wall block (r 0.08)
  - the cupola base (r 0.06)
  - the chimney and its cap (r 0.05)
  - all 14 posts (r 0.03)
  - the 3 steps (r 0.04)
- **Fascia boards** carry the roof's highlight lines. Roof planes stay `prism`, because a prism can't be rounded. Under every exposed roof edge, add a thin `rbox` board: 0.08 × 0.24 × the edge's length, r 0.03, slot `cb_trim`. There are 4 for the main hip roof and 3 for the verandahs. This is what makes the hero's roof edges read soft.
- **Posts** get a square base block as in the breakdown sheet: a plain `box`, 0.32 × 0.30 × 0.32, because a bevel there would cost 96 triangles × 14 for nothing visible. There are no caps; the fascia board does that job.
- **Roof pitch:** the as-built 17° reads flat beside the hero, whose hip roof is the dominant mass. Raise it toward **about 25°**: the ridge goes to about 7.2 and the cupola rides up with it. Collision doesn't change, because the colliders stop at 6.4 and the roof was never collidable above that. Judge the result in the viewport beside the hero.
- **Windows and trim** stay plain `box`. At game distance a bevel on a 0.06 m trim is invisible, and there are 15 of them.
- **Weathervane:** still cut, although 3 of the 4 sheets drew it.
- **Budget:** the as-built clubhouse is 696 triangles. 29 `rbox` nodes (+96 each) and 14 plain base boxes land near 3,650. **Raise the clubhouse budget from 3,000 to 4,000.** It is still 1 draw call (`mergeGraph`).
- **Smoke check:** the same `clubhouseGraph.test.ts`, with its triangle bound raised to 4,000.

## As built, v3 (4 Oct 2026)

Built by `art/stage7_kit.py` (`build_clubhouse`), exported to `src/entities/graphs/clubhouse.json`. Before any edit, the unchanged kit was rebuilt into a fresh file and re-exported; every graph came out byte-identical.

- **Triangles:** 3,732 (budget 4,000; was 696). Still one `mergeGraph`.
- **Pitch and ridge:** `RIDGE_Y` 7.35, so the pitch is 24.99° (`RUN` 5.9 × tan 25° = 2.75). The spec's "about 7.2" would be 23.6°; the prompt's 25° target won.
- **rbox:** the plinth, walls, cupola, chimney and cap, 14 posts and 3 steps at the radii above.
- **Fascia:** 7 boards (`cb_fascia_f/b/e/w` on the hip, `cb_fascia_vf/ve/vw` on the verandahs), 0.08 × 0.24, r 0.03. Each hangs 0.08 below its edge and sits flush *inside* it, so the footprint the smoke check pins (24.4 wide, rear −7.4) doesn't move.
- **Post bases:** 14 plain boxes 0.32 × 0.30 × 0.32 on the deck (y 0.6–0.9).
- **Changes from the spec, with reasons:**
  - **Cupola base 1.0 tall (was 0.8)**, centred at ridge + 0.1, so it reaches 0.4 below the ridge. At 25° the slopes fall 0.37 across its half-width, and the old 0.2 embed left a gap under its front and back faces. The top stays at ridge + 0.6, the roof cone at ridge + 0.9, and the tip at **8.55** (the smoke check's `max.y`; was 7.6).
  - **Chimney raised with the ridge (+0.95, centre 7.05, cap top 8.30).** At the old height it still cleared the hip (6.65 at its centre), but stood only 0.55 proud and read as a stub behind the steeper roof. It keeps its old 0.8 above the ridge.
- **Colliders unchanged** (`src/sim/clubhouse.ts` stops at 6.4 m; the roof was never collidable).

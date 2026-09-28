# Cart v2: team canopy and shot-03 turret

**Route:** primitive graph → `src/entities/graphs/cart.json`, the same file, re-exported.
**Source:** a new file, `art/cart-v2.blend`. Append collection `Collection` from `art/clubhouse-and-cart.blend` (File → Append; never open the old file for writing).
**Style target:** `docs/concept/03CartTurretChasecam.jpg`. Consult the sheet `docs/concept/reference/cart-turnaround-02.jpg` for layout only.

## Why this changes

Arena is 4v4. Nothing on a cart currently says which team it belongs to (`src/render/**` has no team colour at all), and teams can't be relied on to use the chassis for this: chassis paint is a **purchased loadout cosmetic** (`src/sim/loadout.ts` `CHASSIS_PAINTS`). Team colour therefore goes on surfaces the loadout never touches.

## Sheet critique

- `cart-turnaround-02` is smooth-shaded, and its top-down panel still has perspective. The turret is a green tank-style box, which reads as "tank", not "golf".
- Shot 03 is better: a **red rectangular block on a round blue-grey pivot**, with the club shaft coming straight out of the front. That is the silhouette to copy.
- `cart-turnaround-01` is superseded; ignore it.

## Changes, and nothing else

1. **New slot `canopy`,** holding only the `canopy` box (1.48 × 0.09 × 2.28). Its default colour is `0xF5F4EF`.
   - At runtime it takes the team colour.
   - `roof` keeps the posts and windscreen rails. `CHASSIS_PAINTS` still sets `roof`; that is fine, because it is now trim.
   - The slot count goes from 8 to **9**. Update the exact-list assertion in `src/entities/cartGraph.test.ts` and the §2.1 list in `docs/ASSET_PIPELINE.md`.
2. **Turret housing, reshaped to shot 03.** Only these nodes change: `turret_pedestal`, `housing_pitch`, `turret_mantlet`, plus at most 3 new `turret_housing`-slot children.
   - **Body:** `housing_pitch` becomes a **box** of about 0.36 w × 0.30 h × 0.78 d, centred 0.12 m behind `barrel_pitch`. Slot `turret_housing`, so the loadout skin still applies.
   - **Nose:** `turret_mantlet` becomes a **prism** wedge tapering the front 0.20 m of the body down to the shaft.
   - **Pivot:** `turret_pedestal` stays a cylinder but becomes squatter (radius about 0.20). Add two **prism** half-disc cheeks either side of `barrel_pitch`. These are the yoke in shot 03.
   - Budget: 300 triangles or fewer for the whole turret, unchanged.
3. **Rider:** no geometry change. `shirt` takes the team colour at runtime and `cap` stays as it is. Nothing is re-exported for `driver.json`, and the rider is not appended into `cart-v2.blend`.

## Must not change (the sim owns these)

- `turret_pivot` position (Three 0, 1.65, 0.47), `barrel_pitch`, `swing_yoke`, `swing_arm`, `head_slot`, `shaft` and all three club heads: names, positions and params.
- `TURRET_GEOMETRY.pivotHeight`, `pivotForward` and `barrelLength` in `src/sim/entities/Cart.ts`.
- Wheel and rim node names (`cartGraph.test.ts` addresses `wheel_fl`/`rim_fl`), and the known `_l`/`_r` naming wart.
- Overall dimensions and the chassis.

## Runtime team colour

- **New `src/render/teamColors.ts`:**

  | Constant | Team 0 (player's team, west pads) | Team 1 |
  |---|---|---|
  | `TEAM_CANOPY` | blue `0x2F7BE0` | orange `0xF07A1A` |
  | `TEAM_SHIRT` | `0x2560B8` | `0xC85F12` |

  - Confirm in `src/sim/spawn.ts` and `src/sim/world.ts` that the player is on team 0. If not, key the colours by *friendly* versus *enemy*, so that friendly is always blue.
- **Apply them** with `GolfClub.setSlotColor('canopy', …)` and the rider's `shirt`, where each cart is created in `src/render/scene.ts`. Since the loadout never touches `canopy` or `shirt`, the order they are applied in does not matter.
- **Showroom:** `src/render/showroom.ts` shows the player's team colour.
- **Note for Stage 8:** the `sunset` (orange) and `marshal` (blue) chassis paints come close to the team hues. Stage 8 should avoid selling pure team hues. Record this in `docs/BACKLOG.md`; do not change it now.

## Export

```python
export('chassis_pan', REPO + '/src/entities/graphs/cart.json', graph_name='cart')
```

## Smoke check (15 s or less)

`npx vitest run src/entities/cartGraph.test.ts src/entities/GolfClub.test.ts`. Both already exist; update the slot list to 9. Together they cover the turret contract and muzzle-to-`head_slot` alignment, so a turret reshape that moves the pivot fails here.

## Acceptance

- A viewport screenshot beside shot 03: the turret reads as block-on-pivot.
- Cart triangles within 2,000–3,000; turret at 300 or fewer.
- In a match, orange and blue canopies can be told apart at chase-cam distance. A human play-tester judges this at the stop.

# Cart v3: soft-bevelled body, shorter canopy, slate frame

**Status:** draft, 3 October 2026. It depends on proposals P1–P5 in `../STYLE-RESEARCH.md`, as amended by `../SHEET-REVIEW-2026-10-03.md`. Do not build it until the user approves those.
**Route:** primitive graph → `src/entities/graphs/cart.json`, the same file, re-exported. **Source:** `art/cart-v2.blend`, saved as a new `art/cart-v3.blend`. Never write to the v2 file again.
**Style target:** `docs/concept/reference/cart-v3-hero-01.jpg`, panel A. **Proportion:** `cart-v3-ortho-01.jpg`. **Parts:** `cart-v3-breakdown-01.jpg`. **Turret motion:** `turret-swing-02.jpg`.
**Supersedes:** `cart-v2.md` for the body, canopy, seats, wheels and turret housing. Everything cart-v2 lists under "Must not change" still holds and is repeated below.

## Sheet critique

- **Hero A is the target**: a white body, slate frame, blue full canopy, red turret and navy bag. The grey-body variant (`cart-v3-hero-02.jpg`) loses the white-on-green value step, so it is rejected.
- **The breakdown sheet's part list is right**: hood, tub, chassis, canopy, turret housing, tyres and steering wheel. Its chassis is a moulded tray with recesses that primitives can't make; the slate floor slab below does the same job.
- **The ortho sheet** is good for proportion. Its wheels are smaller than ours (about 19% of the cart's length against our 27%), and its canopy stops just behind the seat back. Its turret is about 0.6 m long. Its dimensions are not a measurement; the numbers below win.
- **The swing sheet** gets the mount, the backswing and the impact right. Its follow-through panel shows the club *above* horizontal; the shipped follow-through is 37° *below*. Ignore that panel.
- **The turret across all sheets:** a red rounded-box housing with a round **collar** where the shaft enters, on a slate yoke. The current prism nose wedge isn't drawn on any sheet; the collar replaces it.

## Changes

All rounded boxes use the new `rbox` kind (P2), `params` `[w, h, d, radius]`, at 108 triangles each. The radius has to be under half the smallest side.

### Body: three white rounded volumes and a slate floor

The stepped look came from 8 hard boxes. It becomes 3 white volumes on one slate slab, with the footwell left open.

| Node | Change | Kind | Slot |
|---|---|---|---|
| `chassis_pan` (root) | **Same size and position**, so the rider's feet still rest on its top. It becomes the visible slate floor and side sill | `rbox`, r 0.06 | `frame` |
| `hood` | Absorbs `nose`. One block from the windscreen to the front bumper, about 1.20 w × 0.42 h × 0.92 d, its top rounded hard | `rbox`, r 0.10 | `chassis` |
| `body_tub` | The seat pedestal only. **Its max z must stay below 0** (`driverGraph.test.ts`) | `rbox`, r 0.08 | `chassis` |
| `rear_deck` | Over the rear wheels, carrying the bag | `rbox`, r 0.07 | `chassis` |
| `dash` | Unchanged size | `rbox`, r 0.05 | `chassis` |
| `bumper_front`, `bumper_rear` | Same size | `rbox`, r 0.06 | `frame` |
| `nose`, `arch_fl/fr/rl/rr` | **Deleted.** The arches were the steps; the gap between the volumes reads as the wheel arch now | — | — |

### Canopy: covers the seats only

- `canopy`: `rbox` 1.48 × 0.09 × **1.92**, r 0.04, slot `canopy` (team colour, unchanged).
- **The front edge stays at z = 1.20** (local). The swing-clearance arithmetic in `TURRET_GEOMETRY` uses the front edge at 1.18, so it must not move forward.
- The rear edge moves from −1.08 to **−0.72**. That exposes the rear deck and the bag, as every sheet draws them.
- The rear posts `post_rl` and `post_rr` move to z ≈ −0.66, just behind the seat backs.
- **Canopy y doesn't change.** `driverGraph.test.ts` holds the rider's cap within 0.2 m of the canopy's underside.

### Frame slot: `roof` becomes `frame`

- Rename slot `roof` → **`frame`**, default **slate `0x5E6C7C`**, roughness 0.6, metalness 0.1.
- It holds the four canopy posts, the windscreen posts and rails, `chassis_pan` and both bumpers.
- **`CHASSIS_PAINTS` stops setting it.** Every paint keeps the slate frame, so the two-tone look is constant and the paint changes only the white body. This is a one-line change per paint in `src/sim/loadout.ts`.
- The slot count stays **9**. Update the exact-list assertion in `cartGraph.test.ts` (`roof` → `frame`) and the §2.1 list in `ASSET_PIPELINE.md`.

### Seats

- `seat_base` and `seat_back_l/_r` become `rbox`, r 0.05–0.06, at unchanged sizes.
- The `seats` slot goes from dark grey `0x494F56` to **tan `0xD9B98A`**, as on the breakdown, ortho and style bible sheets. A tan seat against the white body is a value step that the dark grey seat merged into the seat-well shadow.

### Wheels

- The tyre diameter goes from 0.68 to **0.60** (radius 0.30) and the width from 0.22 to 0.24. The rim radius goes from 0.20 to 0.18.
- **The wheel centre drops 0.04** (local y −0.06 → −0.10), so the tyre bottom stays at world y = 0. The cart-on-the-ground test still holds.
- This is visual only: no sim code reads the wheel radius. Wheel and rim **names don't change**.

### Turret housing

- `housing_pitch` becomes an `rbox`, 0.36 × 0.30 × **0.66** (was 0.78), r 0.06. It stays centred on the pivot.
- `turret_mantlet` becomes a **cylinder collar**: radius 0.075, length 0.14, axis along the barrel, sitting flush on the housing's front face. Slot `turret_housing`. The node keeps its name.
- The cheeks and pedestal are unchanged; they already match the sheets' yoke.

## Must not change (the sim owns these)

- `turret_pivot`, `barrel_pitch`, `swing_yoke`, `swing_arm`, `head_slot`, `shaft` and the three club heads: names, positions and params.
- `TURRET_GEOMETRY` (`pivotHeight`, `pivotForward`, `barrelLength`) in `src/sim/entities/Cart.ts`.
- The canopy's front edge (z 1.20), its height and its thickness.
- `chassis_pan`'s top surface, because the rider's feet stand on it.
- The wheel and rim node names, including the known `_l`/`_r` wart.
- The overall length (bumper to bumper) and width.

## Budget

Twelve `rbox` nodes add about 1,150 triangles. Deleting 5 boxes removes 60. **The cart lands near 3,050 against the new 3,000–4,500 budget (P5).** Draw calls are per slot, so there are no new ones.

## Smoke check (15 s or less)

```bash
npx vitest run src/entities/cartGraph.test.ts src/entities/driverGraph.test.ts src/entities/GolfClub.test.ts
```

The three files cover the turret contract, the muzzle-to-head alignment, the rider's feet and cap, the footwell, the slot list and the wheel and rim names.

## Acceptance (the user judges at the stop)

- A Blender viewport screenshot beside `cart-v3-hero-01.jpg` A: the body reads as one rounded white form on a slate frame, not a stack of blocks.
- In a match at `?match=60` (High preset): the bag and rear deck show from the chase camera, and the canopy is no longer the biggest shape on screen.
- Blue and orange canopies can be told apart at 40 m, as in `cart-v3-distance-01.jpg`.

# Food cart (depot centrepiece)

**Route:** graph `food_cart` in the `clubhouse.json` set.
**Source:** `art/clubhouse-exterior.blend`, collection `food_cart`.
**Sheet:** `docs/concept/reference/food-cart-01.jpg`, which is labelled at 1.40 × 2.60 × 2.10 m.

## Role

It stands at the pickup depot in front of the clubhouse and explains where the hot dogs and drinks come from. The depot ring of 6 pickups (`pickups.md`) surrounds it.

## Placement (world)

- At (C.x, C.z + 16): on the clubhouse's centre line, 9 m in front of the verandah steps.
- Its long axis runs along x, with the serving side facing +z, toward the course.
- **Clear of the spawn pads:** it sits at x = C.x, and the pads are at C.x ± 25.

## Sheet critique

- **Stray drawing:** the rear panel contains an extra small side view, which the reference README logs as a deviation. **Ignore it.**
- **Scalloped canopy edge:** keep it. Build it as one `prism` per canopy side, with the scallop polygon cut into the bottom edge, 5–6 scallops per long side. This is the most recognisable feature.
- **Stripes:** build them as alternating panels, 7 across the length, in slots `fc_stripe_a` and `fc_stripe_b`. Do not add a texture.
- **Cup rack and cooler:**
  - The cooler is kept as one box.
  - The cup rack is simplified to one box with 5 small cylinders, or cut if over budget.
- **Wheels:** 4 cylinders, 8 segments each. The cart is static, so the wheels do not need separate nodes for rotation.

## Dimensions

1.40 (w) × 2.60 (l) × 2.10 (h to the canopy peak). The origin is at ground contact at the centre. The counter top is at +1.05. Each canopy is a shallow hip, built from `prism` planes, from +1.85 to +2.10.

## Slots (the `fc_` prefix)

| Slot | Colour |
|---|---|
| `fc_body` | `0x3FBF9A` teal |
| `fc_stripe_a` | `0xE0336B` pink |
| `fc_stripe_b` | `0xF6F0E0` cream |
| `fc_timber` | `0x8A5A32` |
| `fc_metal` | `0xB8BCC0` |
| `fc_tire` | `0x1F1F1F` |

## Budget

400 triangles or fewer; 1 draw (`mergeGraph`).

## Collider

One static box, 1.4 × 2.1 × 2.6 m (`src/sim/clubhouse.ts`). A cart hitting it stops.

## Smoke check

Covered by `clubhouseGraph.test.ts`: the AABB is 1.4 × 2.1 × 2.6 within 0.1, and the model is 400 triangles or fewer.

## Acceptance

A screenshot beside the sheet reads as the same cart, and the scallops are visible from chase-cam.

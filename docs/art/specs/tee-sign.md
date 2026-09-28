# Tee sign (×18)

**Route:** a single graph → `src/entities/graphs/tee_sign.json`.

It is not part of `props.json`. That set is exported from the frozen `art/clubhouse-and-cart.blend`, and re-exporting it would mean writing to the old file.

**Source:** `art/clubhouse-exterior.blend`, collection `tee_sign`.
**Sheet:** `docs/concept/reference/tee-sign-01.jpg`.
**Settled earlier and still binding:** `.scratch/blender-landmarks/prd.md` decisions 7, 8 and 9. The face is a runtime `CanvasTexture` showing hole number, par and yardage, text only. The dimensions are below.
**Settled 2026-09-28:**
- Signs get their own course-wide pass on the shared instanced-prop path, one per tee.
- They do not count against `MAX_PROPS_PER_HOLE`.
- They have **no collider**.

## Frame

- **Height:** 1.25 m to the top of the board.
- **Board:** 0.55 × 0.40 m, **tilted 15° back** (rotation about X only).
- **Posts:** two timber posts, 0.08 × 0.08 m boxes, 0.40 m apart, at a slight tilt so they meet the board edge. A cap rail sits over the board.
- **Board frame:** a 0.04 m-deep box in `prop_timber_dark`.
- **Face:** a separate plane placed 2 mm proud of the frame. It is not part of the graph; the render code adds it, see below.
- **Origin:** at ground contact.
- **Triangles:** 100–150.
- **Slots:** `prop_timber` (`0x9A6B40`) and `prop_timber_dark` (`0x5E3F24`). These are the same names and colours as `props.json`, so the frame matches the course props, but they are declared in this graph's own `slots`.

## Sheet critique

The sheet is sound. Two changes:
- Don't model the carved hole numeral. It is in the texture.
- Posts are plain boxes, not turned cylinders.

## Face (render)

- **Texture:** one `CanvasTexture` atlas, 1024 × 512, holding 18 cells of 170 × 128 px each. Each cell is drawn from the live `HoleSpec`:
  - hole number in a large type
  - "PAR n"
  - yardage from the hole spline
- **Mesh:** one `InstancedMesh` of 18 face planes using the atlas. Each instance's UV offset is set with an instanced attribute, or with 18 small geometries merged into one, whichever is simpler.
- **Draws:** 2 in total, the frames and the faces.
- **Disposal:** dispose the texture, geometry and material together on teardown.

## Placement

- **Pass:** a new course-wide pass, `placeTeeSigns(world)`, in the shared instanced-prop module that pickups create (Stage D's "course-wide instanced prop path").
- **Position:** use the same tee-heading derivation as `src/render/props.ts:123`, where `teeHeading = headingFrom(spec.tee, spec.control[1] ?? spec.cup)`.
  - Place the sign **on the tee centre line, 6.0 m behind the tee**, with side offset 0.
  - The ball washer and cart-path sign already take both ±3.0 m sides at 4.5 m back (`props.ts:139-141`), which is why the sign goes on the centre line.
  - Export the tee-heading helper and the constants from `props.ts` rather than duplicating them.
- **Facing:** the face points toward the tee.
- **Arena:** it renders in arena, the first course prop that does.

## Smoke check (15 s or less)

`src/render/teeSigns.test.ts` checks three things:
1. There are 18 placements.
2. Each one is 6.0 m behind its tee on the centre line, within 0.1.
3. The atlas cell for hole 7 shows that hole's par. Verify this by reading the text the cell was drawn with, not pixels.

## Acceptance

A play-tester can read the hole number from a cart stopped at the tee.

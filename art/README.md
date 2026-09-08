# Blender sources

The authoring end of `docs/ASSET_PIPELINE.md`. **This is the source; the files it produces under
`src/entities/graphs/` and `public/models/` are build output.** Re-author here and re-export — do
not hand-edit a `cart.json` or a `.glb`, because the next export silently reverts it.

| File | Contains |
|---|---|
| `clubhouse-and-cart.blend` | Three collections: `Collection` — the 52-object cart (§4 primitive graph → `src/entities/graphs/cart.json`); `driver` — the 26-object seated rider (§4 primitive graph → `src/entities/graphs/driver.json`); `backdrop` — the 29-object clubhouse interior (§6 decorative GLB → `public/models/clubhouse.glb`). |

`.blend1` is Blender's own rollback of the previous save. It is ignored, not tracked.

## Opening it

Open the `.blend` normally. Everything is plain primitives with no modifiers, no armatures and no
textures, so nothing needs to be resolved on load.

**Custom properties are the export contract**, on the rider exactly as on the cart. Select any
object and look at Object Properties → Custom Properties:

- `ttt_kind` — one of `box` `cylinder` `cone` `sphere` `capsule` `torus`
- `ttt_params` — the arguments for the *matching THREE geometry constructor*, in that
  constructor's order (§4.2). For a box this is `[width, height, depth]` in **Three's** axes, so
  it is the Blender dimensions with Y and Z swapped.
- `ttt_slot` — a material slot: one of the cart's eight (§2.1) or one of the rider's four
  (`skin` `shirt` `trousers` `cap`). The two sets share no names, deliberately — see below.

An object without all three fails the export loudly rather than silently dropping out.

## `ttt_authoring.py`

A Text datablock **inside the `.blend`**, holding the helpers a session uses to build and export:
`make()` (creates a primitive whose Blender mesh matches what the THREE constructor would produce,
and stamps the three custom properties as it goes), `material()`, `node()` and `export()`.

Load it at the top of any `execute_blender_code` call:

```python
exec(bpy.data.texts['ttt_authoring.py'].as_string(), globals())
```

It is checked in with the `.blend` rather than pasted per session because a helper that stamps the
export contract is part of the contract. **It is the working exporter**; `ASSET_PIPELINE.md` §4.3
prints the design, and §4.3's own list of where the printed version differs is worth reading before
trusting a hand-run copy.

## Re-exporting

Both graph exports run from a Claude Code session over the Blender MCP:

```python
export('chassis_pan',   '.../src/entities/graphs/cart.json',   graph_name='cart')
export('driver_pelvis', '.../src/entities/graphs/driver.json', graph_name='driver')
```

The clubhouse GLB is a different path — the step list in `ASSET_PIPELINE.md` §6. Things that bite:

- `bpy.context.view_layer.update()` before reading `matrix_local`, or the export records
  pre-parenting transforms that look plausible and are wrong. This bites *during authoring* too:
  a child positioned relative to a parent created earlier in the same script reads that parent at
  the origin and lands at double its intended offset.
- The GLB must be optimised with `--compress quantize`, never the default `meshopt`, which a plain
  `GLTFLoader` cannot decode.

## Conventions

- 1 Blender unit = 1 metre. Cart ~2.4 m long.
- Cart space: origin at ground-contact centre, **−Y is forward**, +Z is up. That maps to Three's
  +Z forward and +Y up under `(x, y, z) → (x, z, −y)`.
- **The vehicle's left is +X**, in both spaces: forward × left = up. The cart is US left-hand
  drive, so `steer_wheel`, `steer_column` and the rider are all at +X.
  *Known wart:* the `_l`/`_r` suffixes on `seat_back_*`, `wheel_*`, `rim_*`, `arch_*` and `post_*`
  label −X as "l", which is the vehicle's **right**. They are wrong and are left alone on purpose —
  `cartGraph.test.ts` addresses `wheel_fl`/`rim_fl` by name, so renaming costs a test edit and a
  gate re-baseline for nothing a player can see.
- Object scale stays `(1,1,1)` on anything with children; size lives in the mesh data.
- **Rotations use X plus at most one of Y or Z.** Not style: the §4.3 exporter converts a Blender
  Euler to Three's by component swap, `(x, y, z) → (x, z, −y)`, and that is only *exact* for those
  shapes. Blender XYZ order builds `Rz·Ry·Rx` and the basis change turns it into `Ry(c)·Rz(−b)·Rx(a)`,
  where the Three Euler it is written as evaluates `Rz(−b)·Ry(c)·Rx(a)` — equal only when `b` or `c`
  is zero. A limb needing all three exports to a pose that is plausible and wrong.
- **A graph root carries its own world offset.** `chassis_pan` sits at Three `(0, 0.4, −0.02)`, so
  a coordinate read out of `cart.json` is *local to it* and 0.4 m below where the part actually
  sits. The rider was first authored against those local numbers and came out sitting on the floor.
  Measure off `matrix_world`, and in the tests off `getWorldPosition`.

## The two contracts a re-export can break

**The turret, which the sim owns.** `barrel_pitch` sits at exactly `TURRET_GEOMETRY.pivotHeight`
and `pivotForward`, and `head_slot` at exactly `barrelLength` from it. Those numbers live in
`src/sim/entities/Cart.ts` — the model matches them, never the other way round, because
`computeMuzzle` decides where a shot actually originates. `src/entities/cartGraph.test.ts` fails if
a re-export breaks any of them.

> **`pivotHeight` names `barrel_pitch`, not `turret_pivot`.** It used to name the yaw ring, which
> is the node the turret *rotates* on and not the node the club *pivots* about — and the two were
> 0.26 m apart, so every ball left that far below the club head on screen. Both of the old
> assertions were individually true, which is why two green tests missed it for a whole release.
> The check that catches it now compares `computeMuzzle` against `head_slot` in world space and
> lives in `GolfClub.test.ts`; nothing between the two ends is asserted, on purpose.

**The pedestal is load-bearing, not decoration.** A club swinging in a near-vertical plane crosses
the roof plane at `pivotForward + (pivotHeight − 2.05) · cot(φ)` for a club φ below horizontal, and
clears the canopy's front edge at z = 1.18 only while that is larger. **The club's length does not
appear** — no shorter club buys clearance, only a higher and more forward pivot. 0.55 m of pedestal
and 0.45 m of forward offset is what pays for a 35° follow-through; on the chassis axis the same
follow-through would want a 3.2 m cart.

**The swing rig, which the renderer poses.** `swing_yoke` and `swing_arm` must stay **below**
`barrel_pitch`:

```
turret_pivot          yaw ring on the roof at y 2.05, set from the sim's turretYaw
 ├ turret_pedestal    the 0.55 m post that makes a golf plane possible at all
 ├ housing_pitch      rotation.x = SWING.housingShare x the swing. A SIBLING: see below
 │  └ turret_mantlet
 └ barrel_pitch       THE PIVOT: y 2.60, z 0.45. Loft elevation, set from the club's loftDeg
    └ swing_yoke      rotation.z = the swing-plane tilt, 0.25 rad, authored here and never animated
       └ swing_arm    rotation.x = the swing, driven by GolfClub.setSwing; 0 is address
          ├ shaft
          └ head_slot   THE MUZZLE. Counter-rolls the yoke's tilt so the face is upright at address
             ├ hosel                                   the shaft's bend into the heel
             └ head_driver / head_iron / head_putter   hung off the hosel, not centred on the shaft
```

A yoke rotation about the barrel axis leaves +Z fixed, so **swing angle 0 is a no-op on the
muzzle** — which is the only reason an animation is safe to hang here at all. Bolt the swing above
`barrel_pitch` instead and the loft is applied inside a tilted frame: the barrel elevates sideways,
still measures 1.75 m, and the ball leaves at an angle to where the club points.
`src/entities/GolfClub.test.ts` fails on that.

**`housing_pitch` is a sibling of `barrel_pitch`, and that is the whole of its safety.** The
housing tips back on its trunnion as the club goes up — `swing-sequence-01.jpg` draws it that way
and it is what makes the mechanism legible — but being a sibling means no value of
`SWING.housingShare`, and no bug in it, can reach the muzzle. `cartGraph.test.ts` asserts the
parentage and `GolfClub.test.ts` asserts the consequence by rotating the housing to something
absurd and checking the club head does not move.

**The 0.25 tilt and the 0.65 follow-through are forced by the cart, not chosen.** A perfectly
vertical plane has no room for the shaft's own radius or for the rider, and a longer
follow-through puts the club through the roof. The binding club is the **putter**, not the driver:
it addresses at 3° of loft rather than 13°, so at the same `swing_arm` angle its head is 10°
further below horizontal and it reaches the canopy first. The shaft touches at 0.71 rad; 0.65
leaves 4.7 cm at the closest point of the whole swing. Change any of the four numbers — pivot
height, pivot forward, tilt, follow-through — and re-run `GolfClub.test.ts`, which samples every
charge and every reload value of all three clubs against the canopy and the rider's boxes and is
what measured these. A three-quarter render cannot settle it: the camera looks from the rider's own
side, so a club a metre clear of him still lands on top of him in the picture.

**The heads hang off a hosel at the heel.** From `club-heads-01.jpg`, whose most useful content is
the thing its prompt never asked for: on all three clubs the shaft bends into the head at the heel
rather than meeting it dead centre. Centre-mounted heads with no hosel are most of why the shipped
clubs read as blocks on sticks. `head_slot` is still the muzzle — the head is what moved.

## The rider

`driver_pelvis` is the graph root and every other part is its direct child — a flat hierarchy,
because the rider is a fixed pose rather than something that articulates. He is a **separate
graph** rather than more nodes in `cart.json` for three reasons: `cartGraph.test.ts` asserts the
cart declares *exactly* the eight §2.1 slots; the clubhouse loadout paints in that eight-slot
vocabulary and a rider is not a cart cosmetic; and a separate graph is what lets
`new GolfClub(club, {}, { rider: false })` build a cart without one.

He is posed against the cart's own measurements — seat top, wheel rim, footwell floor, canopy
underside — and none of those are in his file. `src/entities/driverGraph.test.ts` is what keeps the
two agreeing: it reads the cart's boxes and checks he is on the seat, on the floor, under the roof
and holding the wheel. Re-export either graph and run it.

**His joints are derived, not eyeballed.** `driver-mannequin-01.jpg` shows the visible ball joints
§2.2 has always described, and the first rider did without: his limbs were plain capsules butted
end to end. The eleven parts added for them — `driver_neck`, and shoulder / elbow / hand / hip /
knee on both sides — are placed in Blender by reading each limb capsule's own axis endpoints, so a
re-posed arm carries its joints with it instead of leaving them behind. `driverGraph.test.ts`
checks each ball still touches *both* limbs it joins, which is the failure a three-quarter render
will not show you.

**His blue polo stays**, and that is a deviation on purpose: the sheet's wood-toned torso
disappears against the cart's near-white bodywork.

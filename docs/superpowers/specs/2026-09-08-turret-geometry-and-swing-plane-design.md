# Turret geometry and the swing plane — design

**Status:** **implemented in full, 8 September 2026** — Phase A and Phase B, both decisions D1–D6.
Written the same day against the four reference sheets. Kept as the record of the argument; the
shipped state is described in `art/README.md`.

**Three things this spec got wrong, found by building it.** None changed the design; all three
changed a number or an expectation, and they are worth reading before trusting §2 or §5 again.

1. **§2's arithmetic is the driver's, and the driver is not the binding club.** φ is the club's
   angle below horizontal, and at the same `swing_arm` rotation the *putter* is 10° lower, because
   it addresses at 3° of loft against the driver's 13°. It reaches the roof first. §2's proposed
   pivot is right and its 37° limit is right; the follow-through that fits under it is
   **0.65 rad**, not the 0.87 the driver's geometry suggests. The clearance test had only ever run
   the driver, which is how a driver-shaped assumption survived; it now runs all three.
2. **§5's criterion 4 expects `npm run probe` to move, and it cannot.** `tools/feelProbe.ts` fires
   the free ball from `sim.reset()` and sets its velocity directly — it never calls
   `computeMuzzle` and never reads `TURRET_GEOMETRY`. Raising the muzzle 0.55 m therefore changed
   the probe by nothing at all, and the output is byte-identical including the one known-red
   driver-distance line. The criterion is met; the prediction behind it was wrong about the tool.
3. **The change does reach one test the spec did not anticipate**, and for the right reason.
   `world.cart.test.ts` parks the cart six metres from a target and putts; a muzzle 0.55 m higher
   clears a 0.82 m torso at that range. The standoff moved to 10 m, mid-band of the 6.5–14 m that
   still connects.
**Reference:** `docs/concept/reference/swing-sequence-01.jpg`, `cart-turnaround-02.jpg`,
`club-heads-01.jpg`, `driver-mannequin-01.jpg` — read that folder's `README.md` deviation lists
first, because two of the four are illustrations rather than blueprints.
**Touches:** `src/sim/entities/Cart.ts` (`TURRET_GEOMETRY`), `art/clubhouse-and-cart.blend`,
`src/entities/graphs/*.json`, `src/entities/GolfClub.ts`.

---

## 1. Why

Three things that are individually small turn out to be one problem, and the swing sheet is what
made that visible.

**The ball does not come from the club head.** `computeMuzzle` measures `barrelLength` from a pivot
at `TURRET_GEOMETRY.pivotHeight` (2.05 m). The model measures it from `barrel_pitch`, which sits
0.26 m higher at 2.31 m. So every shot originates 0.26 m below the head the player is watching.
This predates the swing work and shipped with the cart in PR #9. `cartGraph.test.ts` did not catch
it because both its turret assertions are individually true — the yaw ring *is* at `pivotHeight`,
and the head *is* `barrelLength` from `barrel_pitch` — and nothing asserted those were the same
origin.

**The swing is a flat sweep, and the sheet says it should be a golf swing.**
`swing-sequence-01.jpg` draws the club rotating in a near-vertical plane and passing back through
address at impact. The shipped rig swings 1.15 rad (66°) off vertical, which reads as a scythe. That
was not a preference: a vertical plane sweeps the shaft through the canopy and the rider, and
`GolfClub.test.ts` proves it. **The reason it fouls is the pivot clearance — the same 0.26 m.**

**The sheet's turret has a pedestal.** In the drawing the trunnion sits well above its mount, and
that is exactly why a vertical plane works there and not here. The sheet is not a measurement (its
mount is a four-legged table, not a cart roof), but the mechanism it shows is the answer.

So: one number, `pivotHeight`, is simultaneously the muzzle bug, the swing-plane constraint, and
the thing the reference says to change. Fixing them separately means moving a simulation constant
twice and re-reading `npm run probe` twice.

## 2. The constraint, as arithmetic

Worth writing down because it is what decides the numbers, and because it is not obvious that the
current geometry admits *almost no* follow-through at all.

Let the pivot sit `Δ` above the canopy top surface and `z_p` back from the canopy's front edge
`z_f`. A club swinging in a vertical plane and passing `φ` below horizontal crosses the roof plane
at

```
z_cross = z_p + Δ · cot(φ)
```

and clears the roof only when `z_cross > z_f`, i.e.

```
Δ > (z_f − z_p) · tan(φ)
```

**The club length does not appear.** Shortening the club does not help; this is entirely about how
high and how far forward the pivot is.

Today: canopy top `y = 2.05`, front edge `z_f = 1.18`, pivot at `y = 2.31`, `z = 0` — so `Δ = 0.26`
and `z_p = 0`. That permits

```
φ_max = atan(0.26 / 1.18) = 12.4°
```

Twelve degrees below horizontal. From an address of +13° (driver loft) that is 25° of total travel
past the ball before the shaft is inside the roof. There is no vertical-plane follow-through
available on the shipped cart, which is why the shipped swing is flat.

For the sheet's follow-through (~45° below horizontal) at `z_p = 0`, `Δ` would have to be
`1.18 · tan(45°) = 1.18 m` — a 3.2 m tall golf cart. So the pivot has to move **forward as well as
up**, and the follow-through has to be more modest than the drawing's.

### A working combination

Starting proposal, to be confirmed in Blender rather than trusted from here:

| | Now | Proposed |
|---|---|---|
| Pivot height (`pivotHeight`) | 2.05 (ring) / 2.31 (actual) | **2.60** |
| Pivot forward offset | 0 | **+0.45** |
| Swing plane tilt | 1.15 rad off vertical | **0.25 rad** (near-vertical) |
| Follow-through below horizontal | n/a (flat plane) | **35°** |
| Backswing travel | 155° | **100°**, per the sheet |

Check: `Δ = 2.60 − 2.05 = 0.55`; required `(1.18 − 0.45) · tan(35°) = 0.73 · 0.700 = 0.51 < 0.55`. ✓
Margin is 4 cm, so **keep a small plane tilt (0.25 rad) rather than a perfectly vertical one** — it
buys lateral clearance for the shaft's own radius and for the rider, at a tilt small enough to still
read as golf.

A 0.55 m turret on a 2.05 m roof is about a quarter of the cart's height, which is roughly what
`cart-turnaround-02.jpg` draws. Do not read that as confirmation — that sheet's panels are not to a
shared scale — but it is not contradicted either.

## 3. Decisions this spec makes

**D1. `pivotHeight` becomes the barrel's pitch axis, not the yaw ring.** The sim's number is where a
shot *originates*, so it must name the node the club actually rotates about. `barrel_pitch` moves to
sit exactly at `pivotHeight`; the yaw ring and drum sit below it on a pedestal. This closes §1's
0.26 m defect by construction rather than by adjustment.

**D2. `TURRET_GEOMETRY` gains `pivotForward`.** `computeMuzzle` currently assumes the pivot is on
the cart's yaw axis at the chassis origin. A forward offset means the muzzle also depends on
`cart.heading`, which `Cart` already has. This is the only new coupling and it is contained.

**D3. The swing plane goes near-vertical and the housing pitches with it.** The sheet's backswing
tilts the whole housing back on its trunnion, not just the club inside a fixed housing. Adopt it:
it is one more node to pose and it is what makes the mechanism legible.

**D4. The ball still leaves at the top of the backswing.** Unchanged, and still deliberate — the sim
fires on the release edge and delaying it buys accuracy with input latency. Recorded here only so
the next session does not re-litigate it. See `SWING.downswingSeconds`.

**D5. Club heads get hosels and heel mounting.** `club-heads-01.jpg`'s most useful content is the
thing the prompt never asked for: on all three clubs the shaft bends into the head at the heel
rather than meeting it dead centre. The shipped heads are centre-mounted with no hosel, which is
most of why they read as blocks on sticks. `head_slot` stays the muzzle; the head hangs off it.

**D6. The rider gets joints, hands, a neck and shoes.** `driver-mannequin-01.jpg` shows the visible
ball joints `ASSET_PIPELINE.md` §2.2 has always described and the shipped rider does not have — his
limbs are plain capsules butted end to end. His blue polo **stays**: the sheet's wood-toned torso
disappears against the cart's near-white bodywork, and that was a deliberate deviation.

## 4. Scope

**Phase A — the coupled change.** D1, D2, D3. This is the only part that touches `src/sim/**`, and
it is the part that must land as one commit: the model, the constant and the muzzle math are three
views of one number.

**Phase B — fidelity, no sim.** D5, D6. Pure geometry and graph re-export. Independent of Phase A
and safely deferrable; do not let it delay A.

**Explicitly out of scope**

- The cart's bodywork. `cart-turnaround-02.jpg` draws a smoother vehicle with headlights, tail
  lights and a glazed windscreen. It is also a smooth-shaded illustration rather than the flat
  low-poly §2.1 commits to, so it is not evidence for re-styling the cart. Leave the bodywork alone.
- `CHASE_HEIGHT`. The rider is invisible from the default chase camera because the canopy is at
  2.005 and the camera is 3.6 m up. Raising the turret does not change that. It is a camera-feel
  decision and wants its own session and a play test.
- The driver roll/carry ratio. Still the oldest open item and still a club-balance question.

## 5. Acceptance criteria

1. `computeMuzzle`'s output and the world position of `head_slot` agree to **1 cm** for all three
   clubs, at turret yaw 0 and at a non-zero yaw with a non-zero chassis heading. This is the test
   that does not exist today and is the reason the defect shipped.
2. The club clears the canopy and the rider across the **entire** swing — every charge value and
   every reload value, as `GolfClub.test.ts` already samples. Non-negotiable; it is what constrains
   the numbers in §2.
3. At swing angle 0 the club lies along the lofted barrel with no lateral component, unchanged from
   today. The swing nodes stay **below** the loft node.
4. `npm run probe` shows **no new failing line**. Expect the driver-distance number to move: raising
   the muzzle ~0.55 m adds carry, and since that check currently fails 17.3% *short*, it should move
   toward the reference. **Do not treat an improvement there as licence to skip re-reading it** —
   the same change moves putter and iron too.
5. `npm run plan` byte-identical. Course generation must not see any of this.
6. `npm run gate` re-baselined **after looking at the diffs**, with `cart-backswing` and
   `cart-followthrough` visibly showing a near-vertical swing rather than a flat sweep.

## 6. Test plan

The red-before-green rule applies with unusual force here, because the defect this spec closes is
one that two existing green tests failed to see.

- **Muzzle agreement (new, `cartGraph.test.ts`).** Build the graph, pose it, and compare against
  `computeMuzzle` directly rather than against `pivotHeight` and `barrelLength` separately. Confirm
  it fails on the *current* graph by 0.26 m before changing anything — that is the whole point, and
  it is a one-line check that the current suite cannot make.
- **Clearance (existing, `GolfClub.test.ts`).** Already samples the swing against the canopy and
  rider boxes and already bites: setting `followThroughRadians` to 1.5 reports
  `shaft inside canopy`. Re-run it against each candidate `(Δ, z_p, tilt, follow-through)` and let
  it, not a screenshot, decide the numbers. A three-quarter render looks from the rider's own side
  and will show a club that is a metre clear of him sitting on top of him.
- **Yaw and heading (new).** The muzzle test must cover a non-zero `pivotForward` under both a
  turret yaw and a chassis heading, or D2's new coupling is untested in exactly the case it was
  added for.
- **Blender.** `get_viewport_screenshot` at address, top of backswing, impact and follow-through,
  compared against `swing-sequence-01.jpg` panel for panel.

## 7. Risks

- **Moving a sim constant to fix a visual defect is the wrong direction of causality**, and
  `art/README.md` says so: the sim owns those numbers and the model matches them. The justification
  for inverting it here is that `pivotHeight`'s *current* value does not describe anything real —
  it names a yaw ring that is not where shots come from. D1 makes the constant true rather than
  bending the sim to the art.
- **Raising the turret raises the cart's bounding box**, which the chase camera frames and the gate
  measures. Expect `bbox.y` to move on all six cart subjects.
- **A 4 cm clearance margin is thin.** If Blender disagrees with §2's arithmetic, trust Blender and
  the clearance test, and take the follow-through down before taking the tilt up — the tilt is what
  makes it read as golf.

## 8. What is genuinely next, and why this rather than the flagstick

It is close to a coin flip and worth stating plainly.

**The flagstick is the highest player-visible item in the project.** The cup renders as *nothing* on
all eighteen holes; `src/render/scene.ts` has no flag, no pin, no cup geometry. It is unblocked,
independent, and small.

**This spec goes first anyway**, for one reason: it is the last piece of art work that will move a
simulation constant. The flagstick, the other seven props, and any further cart fidelity all sit on
top of a settled turret. Doing them first means re-baselining the gate twice and re-reading `probe`
twice for no gain.

If a visible win matters more than that ordering, do the flagstick first — nothing here depends on
it, and this spec keeps.

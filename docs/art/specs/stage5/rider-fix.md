# Rider pose fix (re-export `driver.json`)

## Background

Three's Euler XYZ is `Rx·Ry·Rz`; Blender's is `Rz·Ry·Rx`. The old exporter copied components across, which is exact only for a single-axis rotation. `driver.json` was exported that way, so **six limb nodes** that rotate about X plus a second axis are posed differently in the game than in `art/clubhouse-and-cart.blend`, by up to 0.30 rad. They are `driver_upperArmL/R`, `driver_lowerArmL/R` and `driver_upperLegL/R`. The exporter was fixed in Stage 7 (`_three_euler` in `art/ttt_authoring.py`), but the rider was never re-exported. See `art/README.md`, Rotations.

## Do

1. **Re-export headlessly from the frozen file.** Read it and never save it:
   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender -b art/clubhouse-and-cart.blend --python-expr "exec(open('art/ttt_authoring.py').read(), globals()); export('driver_pelvis', 'src/entities/graphs/driver.json', graph_name='driver')"
   ```
2. **Diff the result.** Only the `rotation` arrays of those six nodes may change. Any other change means stop and investigate.
3. **Smoke check:** `npx vitest run src/entities/driverGraph.test.ts src/entities/GolfClub.test.ts`. The swing-clearance cases keep the club clear of the rider through the whole swing, so they are what catches a limb moving into the club's path. If one fails, stop and show the user; don't patch the pose by hand.
4. **Render before and after.** Run `npm run gate` and show the user the `cart-*` renders in `tools/.gate-out` beside the current baselines. **Wait for approval,** then run `npm run gate -- --update-baseline` and commit only the cart subjects.
5. **Update docs.** Change the Rotations paragraph in `art/README.md`, which says "four limbs" and should say six, to record that the rider is now exported with the exact conversion.

## Acceptance

The rider's hands sit on the wheel the way the Blender file shows, and a play-tester notices nothing wrong.

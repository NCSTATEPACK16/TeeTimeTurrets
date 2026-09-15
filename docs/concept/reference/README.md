# Modelling reference

Orthographic reference sheets for the 3D asset pipeline. **Nothing in this directory is loaded by
the game**, and the same rule as the parent folder applies: these document what procedural geometry
should *look like*, they are never traced, imported or shipped.

## Why this is a separate folder from `../`

The sixteen images in `../` are a closed set of **mechanic and UI shots**, numbered `00`–`15` after
a shot list, and `../README.md` states outright that the set is complete. These are a different
kind of thing: **technical modelling reference**, orthographic, with no scene, no camera drama and
no HUD. They also differ in a way that matters more — their prompts *are* checked in, in
`../../COURSE_PIPELINE.md` and `../../ASSET_PIPELINE.md`, where the 00–15 shot list is not.

So the naming here is not `NN` + a name. It is **`<subject>-<NN>.jpg`**, and every image is indexed
below with the prompt block that produced it and the consumer that reads it. That pairing is the
`COURSE_PIPELINE.md` §1 rule made concrete: *an image that is neither convertible to data nor
explicitly marketing is a decoration with a maintenance cost.*

Same encoding rule as `../`: **2048 px wide, JPEG quality 88, under 800 KB.** Full-resolution
originals (2816 px) live outside the repo in `concept-originals-fullres/`, alongside the working
tree, because they are regenerable.

## Index

| File | Prompt block | Consumer |
|---|---|---|
| `prop-silhouettes-01.jpg` | `../../COURSE_PIPELINE.md` §7.2 | `../../ASSET_PIPELINE.md` §2 manifest, row "Course props"; the §5 modelling pass |
| `cart-turnaround-01.jpg` | `../../ASSET_PIPELINE.md` §8.1 | **Superseded** by `cart-turnaround-02.jpg`. Kept as the record of what the cart was blocked out from (§10 step 4) |
| `cart-turnaround-02.jpg` | `../../ASSET_PIPELINE.md` §8.4a | The turret-geometry pass (`docs/superpowers/specs/2026-09-08-turret-geometry-and-swing-plane-design.md`). **Consumed** — for the turret's proportions only; the sheet's bodywork was ruled out of scope |
| `driver-mannequin-01.jpg` | `../../ASSET_PIPELINE.md` §8.4b | The rider's second pass — joints, hands, neck. Same spec. **Consumed**; his blue polo was kept against the sheet, deliberately |
| `swing-sequence-01.jpg` | `../../ASSET_PIPELINE.md` §8.4c | The swing plane and the pivot height. Same spec, and the sheet that drove it. **Consumed** — the plane, the pedestal, the 100° backswing and the pitching housing all came from here |
| `club-heads-01.jpg` | `../../ASSET_PIPELINE.md` §8.4d | Club-head shapes and hosels. Same spec. **Consumed** — the hosel and heel mounting shipped; the scale grid was not usable |
| `pickup-items-01.jpg` | `../../ASSET_PIPELINE.md` §8.5a | Stage D's three pickup items → the `pickups` collection and `src/entities/graphs/pickups.json`. Task 7 of the Stage D plan |
| `pickup-pedestal-01.jpg` | `../../ASSET_PIPELINE.md` §8.5b | The glow cylinder's three states → `src/render/coursePickups.ts`. A **state sheet, not a turnaround** — the cylinder is radially symmetric |
| `food-cart-01.jpg` | `../../ASSET_PIPELINE.md` §8.5c | The refreshment cart → the `props` collection. Its collider question is still open and the sheet does not depend on it |
| `clubhouse-exterior-01.jpg` | `../../ASSET_PIPELINE.md` §8.5d | Stage E's clubhouse → a new `exterior` collection and `public/models/clubhouse-exterior.glb`. The only sheet here whose asset ships as a mesh |
| `tee-sign-01.jpg` | `../../ASSET_PIPELINE.md` §8.5e | Stage E's tee sign **frame**. The board face is a runtime `CanvasTexture` from `HoleSpec`, so the sheet is about the post and mount, not the face |

Note for anyone planning to automate this: **image models are not on Google's free API tier.** Every
sheet here came from the Gemini / AI Studio web UI by hand, which is free; the API path needs
billing. See `../../ASSET_PIPELINE.md` §8.4.

---

## The five Stage D / Stage E sheets

All five ran twice, 12 September 2026. **Only the second generation is filed** — per the naming rule
above, iterations and rejects stay out of the repo, which is why these are `-01` and no `-01` of
round one exists. The first generation is recorded here anyway, because what it got wrong is what
the shipped prompt blocks are written against, and because two of its failures were new to this
folder:

- **`FRONT`, `SIDE` and `REAR` came back as the same elevation.** The food cart's long profile was
  drawn three times, so its 1.40 m width was documented nowhere. The hot dog did the same.
  §8.5's blocks now state which axis each view looks along and say outright that if FRONT and SIDE
  share a silhouette the view set is wrong.
- **An environment appeared despite an explicit ban.** The tee sign came back standing on a
  grass/sand/water terrain slab in all four panels, and in TOP-DOWN the slab filled the frame so
  completely the sign was a thumbnail inside a landscape. The block now bans ground by name
  — grass, turf, sand, water, soil, slab, plinth — and states that the plan view being mostly empty
  is *correct*.

Round one also produced the wrong subject entirely on the pedestal sheet (a blue household pail
where a green range-ball bucket was described), a clubhouse drawn as a tall farmhouse against a
34 × 9 m brief that is nearly 4:1, and stripes that changed colour between elevation and plan. All
four are fixed in the filed sheets.

### `pickup-items-01.jpg`

Three pickup items — range-ball bucket, foil-wrapped hot dog, lidded cup — each in four views.

**What it is good for:** the closest style match in the whole folder. Flat cel shading with clean
outlines, genuinely flat tones, and every silhouette detail that makes an item readable at 60 m
present — the wire handle, the balls heaped proud of the rim, the foil twist, the mustard zig-zag,
the straw. The hot dog's REAR is a true end-on view of the sausage in its bun, which is the first
time any sheet in this folder has drawn two genuinely different elevations of a long object.

#### Known deviations from §8.5a

- **Cross-object scale is still wrong, by roughly a quarter.** The block asked for a 1.00 m scale
  bar and got one on rows 1 and 3 — but the bucket is drawn filling it at 1.00 m when it is 0.80 m,
  the cup likewise at 1.00 m when it is 0.90 m, and the hot dog reads about 26% longer than the cup
  is tall when the two are both 0.90 m. Row 2 has no bar at all. This is the same *per-cell scaling*
  deviation `prop-silhouettes-01.jpg` recorded, surviving a prompt written specifically against it.
  **Take proportion within an object; take no dimension between objects.** The real numbers are in
  the Stage D plan's Task 5 and the modelling brief.
- **The hot dog's FRONT is still its long profile**, not the end-on view asked for. Only REAR
  differs. Half the fix took.

### `pickup-pedestal-01.jpg`

The glow cylinder in CHARGED / TAKEN / RECHARGING, side elevation, on one ground line.

**What it is good for:** the sheet's only real job, done. **RECHARGING reads as present and empty at
the same time** — a faint outline with no item and a thin ground ring — which is the state that
makes a sixty-second global cooldown learnable rather than arbitrary. The item is now correct: a
green truncated cone with a wire handle and white balls heaped above the rim, matching
`pickup-items-01.jpg`. Dimensions annotated and internally consistent: the bucket is drawn at
roughly a third of the cylinder's height, which is what 0.80 m against 2.6 m should look like.

#### Known deviations from §8.5b

- The glow is closer to a soft gradient than the flat banded colour asked for. Harmless as
  reference; the renderer's cylinder is a `MeshBasicMaterial` at fixed opacity and does not attempt
  this.

### `food-cart-01.jpg`

The refreshment cart in four views, with plan dimensions annotated.

**What it is good for:** the view set, which is what round one could not produce. FRONT is narrow at
1.40 m, SIDE is wide at 2.60 m, REAR is its own narrow view showing the cup rack, and TOP-DOWN is a
real plan. Stripe colour holds across all four panels. All six named parts appear. The wheels read
as cart wheels rather than the off-road tyres round one drew.

#### Known deviations from §8.5c

- **A stray second drawing sits inside the REAR cell** — a small duplicate side view crammed at its
  lower right, unlabelled and at a different scale. Ignore it; it is not a fifth view.
- **The canopy has a scalloped valance along its lower edge.** Fabric, not faceted geometry. Model
  the canopy as a flat plate; the scallop is not affordable and is not in the brief.

### `clubhouse-exterior-01.jpg`

The clubhouse in four views at 34 × 20 × 9 m, with dimensions annotated on every panel.

**What it is good for:** **the best TOP-DOWN in this folder.** A true roof plan — hip planes, ridge,
cupola, chimney, verandah outline and entrance steps — where every previous sheet's plan view
carried enough residual perspective to be unusable as a footprint. The proportion problem from round
one is fixed: the front elevation now reads as a long low pavilion at roughly 3:1 rather than a tall
farmhouse, and the verandah runs the full width, which is what makes the building read as a
clubhouse from 100 m on the ground.

#### Known deviations from §8.5d

- **Windows have mullions and divided panes**, against a block asking for flat inset rectangles with
  neither. The upper clerestory is drawn as a ribbon of many small divisions. **Simplify in Blender**
  — this is the single largest triangle cost on the sheet and the asset has a 2,500 budget.
- **The building resolved as single-storey with a clerestory band**, not the two storeys the brief
  described. It is arguably the better answer at 3.8:1 and is kept.
- Ground lines are shared between FRONT and SIDE but REAR sits on its own. No dimension crosses that
  boundary.

### `tee-sign-01.jpg`

The tee sign in four views plus a square-on BOARD FACE panel.

**What it is good for:** clean, with the terrain slab that ruined round one gone entirely. The 15°
board tilt is clearly readable in SIDE, all four parts are named, and the BOARD FACE panel is
square-on with 0.55 × 0.40 m annotated — which is the only panel that gives the face's true aspect
ratio for the runtime `CanvasTexture`.

#### Known deviations from §8.5e

- **TOP-DOWN is labelled `ONLY`.** The block reads "shows ONLY the top edge of the signboard", and
  the model lettered the word. This is the *label a prompt word* failure from `cart-turnaround-01`
  recurring in a new form — there, it lettered a grid position; here, an emphasis word. The panel
  itself is correct.
- **The `BOARD FACE` header is printed twice**, once over the empty upper-right cell and once over
  the panel it belongs to.
- FRONT and REAR sit on different ground lines, and REAR draws the board noticeably wider than FRONT
  does. Proportion within a panel only.

---

## `cart-turnaround-02.jpg`

Re-run of §8.1 with the three amendments folded in, plus the three things `01` was missing: US
left-hand drive, a seated rider, and the `club_bag` slot.

**What it is good for:** the first sheet where all eight §2.1 material slots are present and
separable, and the first with the rider in place so his scale can be read against the cart.

### Known deviations from §8.4a

- **The style is a smooth-shaded illustration, not flat low-poly.** Gradients on the bodywork,
  soft shading on the roof. The prompt asked for "flat-shaded low-polygon forms, two or three flat
  tones per surface" and got a rendered look closer to `../11ClubhouseLoadout.jpg` than to
  `../03CartTurretChasecam.jpg`. Use it for **silhouette and proportion only** — the §2.1 art-style
  choice is unchanged, and nothing here argues for re-lighting the game.
- **Still not a measured blueprint.** The ground line is drawn across FRONT, SIDE and REAR this
  time, but the SIDE panel is again noticeably larger than the other two. Do not take a dimension
  across panels. Cart length is ~2.4 m per `../../ASSET_PIPELINE.md` §4.4.
- **Heavy perspective in TOP-DOWN** — wheel sides, seat backs and the bag's interior are all
  visible, which a true orthographic top-down would not show.
- **The cart is a different vehicle from the shipped one**: swept bodywork, headlights, tail lights,
  a glazed windscreen and a full-width bench. The shipped cart is boxier. That is a gap to close
  deliberately or not at all, not an error in the sheet.

## `driver-mannequin-01.jpg`

**What it is good for:** the seated proportions, and — the reason to re-run the rider —
**visible ball joints at shoulders, elbows, hips and knees**, plus a neck, fists and separate
shoes. That is the "segmented mannequin with visibly separated joints" `../../ASSET_PIPELINE.md`
§2.2 has always described and the shipped rider does not have: his limbs are plain capsules butted
end to end.

**First sheet in this folder to meet the baseline requirement.** Ground line across FRONT, SIDE and
REAR, plus the requested second line at seat height. Both usable.

### Known deviations from §8.4b

- **TOP-DOWN is not top-down.** It is the seated figure drawn lying on its side. Unusable; read the
  plan proportions off the cart sheet instead.
- **Only three of the four colours separate.** Torso and arms are the same wood tone, so `skin` and
  `shirt` are one colour on the sheet. Only `trousers` and `cap` read as their own slots.
  *The shipped rider deliberately differs*: he wears a blue polo, because an off-white shirt
  disappears against the cart's near-white bodywork. That is a decision, not a mismatch to fix.
- The hands are fists with no fingers, as asked — worth noting because the shipped rider has no
  hands at all, just forearm capsules ending near the rim.

## `swing-sequence-01.jpg`

**The sheet that changed a shipped decision.** See the spec cited in the index.

**What it is good for:** the timing, which is what it was asked for and what it delivers — ADDRESS
and IMPACT are drawn as the same pose, both carrying the same horizontal reference line, which is
the sheet's whole point and the invariant `GolfClub.test.ts` asserts.

**And one thing that was not asked for and is better than what shipped:** the housing itself pitches
back on its trunnion during the backswing. The shipped rig rotates only the club inside a fixed
housing.

### Known deviations from §8.4c

- **The mount is a four-legged table, not a cart roof**, against a prompt asking for "the turret and
  the top of the cart roof". Harmless as a drawing, load-bearing as a measurement: **the pedestal
  height in this sheet is not the cart's.** The turret sits proportionally much higher above its
  table than the shipped turret does above the canopy, and that difference is exactly why a
  vertical swing plane works in the drawing and fouls the roof in the game.
- **The backswing is ~100°, not the ~155° asked for.** The follow-through is ~60°, which matches.
- The ADDRESS arrow points down onto the head rather than along the travel direction.

## `club-heads-01.jpg`

**What it is good for:** three heads that are unmistakably three different clubs, and **a hosel on
each** — the shaft bends into the head at the heel rather than meeting it dead centre. The prompt
never asked for a hosel; it is the most useful thing on the sheet, and the shipped heads have none.

### Known deviations from §8.4d

- **Scale is not consistent across the grid.** The driver is drawn much larger than the iron, which
  is true to life and was asked for — but the putter's TOP-DOWN is drawn at a different scale from
  its own FACE, so the shared shaft-axis line does not let you measure across the whole grid.
- **Smooth-shaded, not "chunky facets".** Same style deviation as the cart sheet. Silhouette
  reference, not facet reference.

---

## `prop-silhouettes-01.jpg`

Eight course props in front elevation on neutral ground: flagstick with pennant · tee marker ·
bunker rake · ball washer · distance post · wooden footbridge · boardwalk section · cart-path sign.

**What it is good for:** the form and proportion of each prop taken on its own, and the flat
two-or-three-tone treatment the whole set shares. All eight read as the same object family, which is
the point — one prop set dresses three biomes.

### Known deviations from §7.2

Recorded so they are not mistaken for the spec.

- **Scale is per-cell, not uniform.** §7.2 asks for "uniform scale across all props". The flagstick
  (~2.5 m in reality) and the tee marker (~0.3 m) are drawn at comparable heights, because each
  prop is scaled to fill its own cell. **The sheet gives proportion *within* a prop and never scale
  *between* props.** Real dimensions come from the modeller against cart height, not from this
  image.
- **The footbridge and the boardwalk are not front elevation.** §7.2 asks for "FRONT ELEVATION
  ONLY — true orthographic projection, no perspective". Both are drawn in three-quarter view with
  visibly receding deck planks. They are still usable — arguably more usable, since a span read
  head-on is a line — but they are not the projection that was asked for, and the deck width they
  imply is a perspective artefact rather than a measurement.

Everything else in the block held: neutral mid-grey ground, no cast shadows, no ground plane, no
environment, no cart, no characters, no border, clean sans-serif labels.

---

## `cart-turnaround-01.jpg`

Four views of the golf cart with its roof-mounted turret, in a 2×2 grid.

**Panel mapping, which the sheet does not state correctly — see the first deviation:**

|  | left | right |
|---|---|---|
| **top** | **FRONT** (labelled `TOP-LEFT`) | **SIDE**, facing left (labelled `SIDE`) |
| **bottom** | **REAR** (labelled `REAR`) | **TOP-DOWN** (labelled `TOP-DOWN`) |

**What it is good for:** silhouette, the flat-faceted gameplay-fidelity look (it matches
`../03CartTurretChasecam.jpg`, not the glossy `../11ClubhouseLoadout.jpg` — the §2.1 art-style
choice, correctly followed), and the separability of the material slots. Seven of the eight §2.1
slots are distinct and readable: `chassis` · `roof` · `turret_housing` · `turret_barrel` · `tires` ·
`rims` · `seats`.

### Known deviations from §8.1

- **The labels print grid positions, not view names.** They read `TOP-LEFT`, `SIDE`, `REAR`,
  `TOP-DOWN` — so the front view is labelled by where it sits on the page and is never labelled
  `FRONT`. The prompt described the layout positionally ("TOP-LEFT: FRONT view") and the model
  lettered the position word. Use the mapping table above.
- **The SIDE view faces left**, where §8.1 asks for "SIDE view (facing right)". The TOP-DOWN agrees
  with it — the barrel points left there too — so the sheet is internally coherent, just mirrored
  from the spec. **Mirror once, consistently, or the cart comes out backwards.**
- **No shared baseline and no uniform scale across panels.** This is the one measurable requirement
  in §8.1 — "the four views must align on a shared horizontal baseline so heights match exactly" —
  and it is the one the model dropped. The SIDE panel is drawn noticeably larger than FRONT and
  REAR, and no two panels share a ground line. **Consequence: this sheet is proportion and
  silhouette reference, not a measured blueprint. Do not take a dimension across panels.** Cart
  length is ~2.4 m per `../../ASSET_PIPELINE.md` §4.4; everything else is measured against that in
  Blender.
- **The `club_bag` slot is absent.** §2.1 names eight material slots and no bag appears in any of
  the four views — the rear deck is empty where image `../03CartTurretChasecam.jpg` carries one. The
  blockout authors the bag from `03`, or the sheet is re-run with all eight slots named in the
  subject line.
- **Residual perspective in the TOP-DOWN panel.** Wheel sides and the seat back are visible, which a
  true orthographic top-down would not show. Minor; the footprint proportions still read.

Correct and worth recording as such: flat tones with clean outlines, uniform ambient lighting, no
cast shadow, no ground plane, no sky, no environment, and no 3/4 "hero" view.

**If you re-run this sheet**, the fixes are written into `../../ASSET_PIPELINE.md` §8.1 rather than
here — that is where the prompt lives.

---

## Provenance and rights

Generated with Google Gemini from the prompt blocks cited in the index above, September 2026.

Same stance as `../README.md`, and for the same reason: these are **tracked by provenance rather
than licensed**. Copyright in purely AI-generated images is unsettled — in the US, material without
human authorship is not copyrightable — so this project does not claim a licence it may not be able
to grant. The `CC-BY-SA-4.0` line in `../../../LICENSES.md` covers assets authored by contributors,
not these.

Practical consequence for anyone forking: reference documentation, not art you have been granted
rights to ship. Regenerate your own from the prompt blocks — they are checked in, which is the whole
advantage this folder has over `../`. Nothing in the game depends on any of it.

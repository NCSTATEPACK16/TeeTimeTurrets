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
| `cart-turnaround-01.jpg` | `../../ASSET_PIPELINE.md` §8.1 | `../../ASSET_PIPELINE.md` §5 cart blockout (§10 step 4); optionally §8.2 image-to-3D |

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

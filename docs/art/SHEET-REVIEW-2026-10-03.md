# Sheet review, 3 October 2026

This reviews the 16 images generated from `GEMINI-PROMPTS-v2.md` and gives a verdict on proposals P1–P6 in `STYLE-RESEARCH.md`. **Approved by the user on 3 October 2026, all as recommended.** The specs that follow from them are `specs/cart-v3.md` and the v3 amendments at the end of `specs/clubhouse.md` and `specs/team-barn.md`.

The images are filed in `docs/concept/reference/` (2048 px, quality 88). The originals are in `../concept-originals-fullres/` under the names they were saved with; the mapping is in `docs/concept/reference/README.md`.

## The short version

**The new style block worked.** Every sheet made with it reads like shots 01 and 03: rounded forms, highlight lines on the edges, ambient occlusion and soft contact shadows. That confirms the diagnosis: the look comes from bevels plus lighting, and it can be built from about a dozen rounded primitives per asset.

## Per sheet

| File | Sheet | Verdict | Notes |
|---|---|---|---|
| `style-bible-01.jpg` | S1 | **Keep: the style anchor** | Every object reads. The trees are smooth, not faceted, which amends P1 (below) |
| `style-bible-grey-01.jpg` | S1 greyscale | Keep | **Turret red, pivot slate, fairway green and roof sage share a mid-grey.** The turret separates from the grass by hue only. Acceptable, because the white canopy and body under it carry the value step. Don't darken the canopy |
| `cart-v3-hero-01.jpg` | S2 | **Keep: the cart target (panel A)** | A white body, slate frame, canopy over the seats only, and the club out of the front |
| `cart-v3-hero-02.jpg` | S2 variant | Reference only | A grey body. It loses the white-on-green value step, so it is rejected |
| `cart-v3-distance-01.jpg` | S2 at 40 m | **Decides the team colour** | Full canopies (A, C) read at a glance; trim only (B, D) is close to invisible. **Keep the full team canopy**: the Stage 7 rule stands |
| `turret-swing-02.jpg` | S2b | Keep | The mount and backswing are right. **Its follow-through panel is wrong**: the club is above horizontal, where the shipped follow-through is 37° below |
| `cart-v3-breakdown-01.jpg` | S3 | Keep | The part list matches what we can build. The moulded chassis tray is approximated by a slate slab |
| `cart-v3-ortho-01.jpg` | S4 | Keep: proportion | The labels, facing and shared baseline are all correct, the first sheet to get all three. Its wheels are smaller than ours |
| `clubhouse-hero-01.jpg` | S5 | **Keep: the clubhouse target** | It matches `clubhouse.md`'s re-spec almost exactly (24 × 14, 5 bays, clerestory band, cupola, rear-right chimney). The barns face the camera rather than the clubhouse; the spec's layout wins |
| `clubhouse-distance-01.jpg` | S5 at 150 m | Silhouette proof only | The cupola and chimney identify the building at 150 m. Off-style otherwise: photographic grass, lens flare, invented golfers, and the weathervane again |
| `clubhouse-breakdown-01.jpg` | S6 | Keep | Posts are square with a base block, not cylinders as labelled. It brings the weathervane back, which stays cut |
| `hub-kit-01.jpg` | S7 | Keep: lamp, food cart, tee sign and barn details | The barn is drawn gable-end-open with 3 bays. Take its timber posts with **knee braces** and its brick knee wall; keep the spec's 4-bay, long-side-open layout. Its golf cart is the old 01 design; ignore it |
| `restyle-chase-01.jpg` | S8 | **Keep: the environment target** | Gemini moved the camera and changed the cart, so it is not a restyle of our frame. Its terrain is exactly what Stage 5 needs: raised bunker lips, a fairway/rough edge, clumps of conifers on the rough, rolling hills and AO. **Its water is slate grey; don't copy that.** Keep shot 03's teal |
| `restyle-chase-grey-01.jpg` | S8 greyscale | Keep | Fairway is light, rough is mid, water is dark, and the cart is white. That is the value structure Stage 5 should hit |
| `restyle-chase-golden-01.jpg` | S8 golden hour | Keep: a title-screen mood | A target for #60 (backdrop and title), not for the match |
| `chase-target-01.jpg` | Saved as "option clubhouse" | Keep: the chase-camera target | It is shot 03 redrawn with the club pointing forward. It is the framing reference for P6 (#51) |

## Proposal verdicts (approved 3 Oct 2026)

| | Proposal | Recommendation |
|---|---|---|
| **P1** | Soft-bevelled style rule | **Approve, amended:** smooth shading is the default for **everything, trees included**. The style bible's and the restyle's trees are smooth cones and smooth lumpy spheres. Distant terrain may keep gentle facets. Trees need more segments to read smooth: this is Stage 5 #56's job, not this pass's |
| **P2** | `rbox` kind (108 tris) | **Approve.** Every breakdown part labelled "rounded box" maps to it |
| **P3** | Smooth shading with a crease, per-slot `flat` flag | **Approve, amended:** creased smooth shading (about 40°) is the default for every slot; `flat: true` is the opt-in. Nothing currently needs the opt-in |
| **P4** | AO on High, contact shadows on Low/Medium | **Approve.** Every keeper relies on it. Check the licence before adopting N8AO |
| **P5** | Cart re-proportion | **Approve as `specs/cart-v3.md`.** Full team canopy kept; body white; `roof` slot becomes slate `frame`; seats tan; wheels 0.60 m; canopy over the seats only |
| **P6** | Chase-camera input for #51 | **Approve** as input only. `chase-target-01.jpg` is the framing reference |

## Clubhouse, barn and hub kit

The existing `clubhouse.md` re-spec is confirmed by `clubhouse-hero-01.jpg`, so it is amended rather than rewritten (see the v3 section at its end). The changes are bevels on the big forms, fascia boards to carry the edge highlights, and a budget rise. `team-barn.md` gains knee braces and a brick knee wall. The lamp post, food cart and tee sign sheets are consistent with their existing specs, so nothing changes there.

## Weathervane

Gemini drew it in 3 of 4 clubhouse images, against the prompt and the spec. **It stays cut**: below a metre, it reads as nothing at game distance. If the user wants it back, it is a sub-30-triangle silhouette for a later polish pass.

## Build order once approved

1. **Code slice, any session:** P2 `rbox`, P3 creased smooth shading as the default, and P4 AO. One smoke check each.
2. **Blender session, high effort:** the cart (cart-v3), then a play-test stop.
3. **Blender session, medium effort:** the clubhouse and barn v3 amendments, then a play-test stop.
4. **Stage 5's remaining issues**, with `restyle-chase-01.jpg` and its greyscale as the environment target.

# Gemini prompt pack v2: the soft-bevelled toy style

Written 2 October 2026, alongside `STYLE-RESEARCH.md`, which explains why it exists. These prompts **replace the style block** in `docs/concept/hole-shot-prompts.md` §1 for every asset sheet. That block asked for flat facets, black outlines and no soft shadows, and it steered every sheet away from shots 01 and 03.

What changes from the earlier sheets:
- **Style is set by attached images, not by words alone.** Every first turn attaches shots 01 and 03.
- **Every asset gets a hero view at game distance before any orthographic sheet.** The old sheets were blueprints, and we modelled blueprints. A hero view shows what the model has to look like in play.
- **A build-breakdown sheet replaces dimension callouts.** It shows each asset as the few rounded primitives we can actually build. That is the step the old sheets never gave the modeller.
- **The prompts describe what to include** and keep a short ban list, because positive description is what the Gemini guidance recommends. The ban list keeps the specific failures recorded in `docs/concept/reference/README.md`.

## How to run them

1. **App and model:** in the Gemini app, use **Nano Banana Pro (Gemini 3 Pro Image)**. It renders label text best and accepts up to 6 object reference images. The Gemini API's image models need billing, so use the web app; `docs/concept/reference/README.md` says the same.
2. **One chat thread per sheet group** (S1, S2–S4, S5–S7, S8–S9). Gemini keeps a design consistent across turns in one thread, and loses it across threads.
3. **On every first turn, attach:** `docs/concept/01Formlanguagesheet.jpg` and `docs/concept/03CartTurretChasecam.jpg`. Attach any further images each prompt names.
4. **Paste the style block, then the turret block if the sheet shows the cart, then the sheet prompt**, in one message.
5. **Aspect ratio 16:9**, at the highest resolution offered.
6. **If a result misses,** reply in the same thread with a single correction ("same image, but the canopy covers only the seats"). Don't regenerate from scratch; that loses consistency.
7. **File the keeper:**
   - Save the original to `../concept-originals-fullres/`.
   - Re-encode a copy into `docs/concept/reference/` (2048 px wide, quality 88). The command is below.
   - Add a row to `docs/concept/reference/README.md`, naming the prompt block (`GEMINI-PROMPTS-v2.md` S*n*) and its consumer.

```bash
sips -Z 2048 -s format jpeg -s formatOptions 88 IN.png --out docs/concept/reference/OUT.jpg
```

## The style block (paste first, every time)

> **Style:** match the two attached reference images exactly. This is a stylized 3D game render in a soft **"vinyl toy" low-poly** style. Objects are built from a small number of chunky, simple shapes: rounded boxes, cylinders and wedges. **Every exposed edge has a visible soft bevel** that catches a thin highlight line. Shading is smooth within each part, with clean solid colours and no textures. Lighting: a warm sun from the upper left, a soft sky fill, gentle ambient occlusion darkening creases and the undersides of overhangs, and soft contact shadows where things meet the ground. Palette: cream white, signal red, slate blue-grey, golf-course greens, warm sand tan, brick red and sage green, saturated but not neon. Detail comes from a few mid-sized features (lights, bumpers, cushions, trim), never from small clutter.
>
> **Avoid:** black outlines or cel-shading ink lines, photographic textures, hard faceted flat-shaded surfaces, tiny greebles, bolts or panel lines, lens flare, depth-of-field blur, and any text, logos or wordmarks other than the labels this prompt asks for.

## The turret block (paste after the style block on every sheet that shows the cart)

Added 2 October 2026, after the first S2 run put the club on the back of the turret. The block describes the **shipped** mechanism (`docs/superpowers/specs/2026-09-08-turret-geometry-and-swing-plane-design.md`; `SWING` in `src/entities/GolfClub.ts`: backswing 1.75 rad, follow-through 0.65 rad, plane tilt 0.25 rad). It is not a new design. Use it in S2, S2b, S3, S4 and S8.

> TURRET (draw exactly this): the turret sits on the canopy roof, slightly forward of the roof's centre. From the bottom up:
> 1. A short, round, slate blue-grey pedestal with a yaw ring. The whole turret can turn 360° on it.
> 2. Above the pedestal, a horizontal pivot pin held between two slate side cheeks, like a small cannon on its mount.
> 3. On the pin, a red rounded-box housing about 0.8 m long, 0.36 m wide and 0.30 m tall, lying lengthways and pointing the same way as the cart's nose.
> 4. ONE golf club, coming straight out of the FRONT end of the housing and continuing its line: a 1.75 m steel shaft that reaches out past the cart's front bumper, ending in an iron club head mounted at its heel, face square to the direction of aim.
> Nothing sticks out of the back of the housing, and the club is never on the rear of the cart. The rider does not hold this club; the turret is its only mount.
>
> How it moves: to shoot, the whole housing tilts back on its pivot pin and swings the club up and back over the turret in a near-vertical plane along the aim line, about 100° back. It then whips forward and down through the start position, and the ball flies forward from the club head along the aim line. The follow-through stops about 37° below horizontal, above the canopy. It is a centre-line swing like a pendulum or catapult. It never swings sideways around the rider, and it has no left- or right-handed version.

---

## S1. Style bible (thread A)

**Consumer:** P1 in `STYLE-RESEARCH.md`. It becomes the single image every later prompt and every Blender session checks against. **File:** `style-bible-01.jpg`.

> Create a single "form language" line-up sheet in the style of the attached references, on a plain warm-grey studio background with a soft floor shadow. Left to right, at true relative scale, each with a short label underneath in clean sans-serif capitals:
> 1. **THE CART:** a white golf cart, 2.4 m long, with big soft black tyres on slate-grey rims, a low rounded body tub, a thin white canopy over the two seats only (the rear deck behind the seats is open and carries a navy golf bag), and on the canopy a red rounded-box turret on a round slate-blue-grey pivot with a long golf-club shaft coming straight out of its front.
> 2. **THE RIDER:** a seated-height wooden-mannequin golfer in a blue polo and a cap.
> 3. **TWO TREES:** a two-tier cone conifer and a round broadleaf tree with a ball-shaped canopy of 3–4 soft lumps.
> 4. **THE CLUBHOUSE (miniature):** a cream single-storey pavilion with a sage-green hip roof, a white cupola, a brick plinth and a front verandah on white posts.
> 5. **A PICKUP:** a hot dog on a small glowing pedestal.
> 6. **A PIN FLAG** in a hole cup.
>
> Below the line-up, add a row of 10 flat colour swatch chips with name labels: CART WHITE, TURRET RED, PIVOT SLATE, TYRE BLACK, FAIRWAY GREEN, ROUGH GREEN, SAND, CLUBHOUSE CREAM, ROOF SAGE, BRICK.

**Follow-up turn (same thread):**
> Same image, rendered in greyscale only, so I can check that each object separates by lightness alone.

---

## S2. Cart hero and team-colour options (thread B)

**Consumer:** P5 (re-proportion and the team-colour question). **File:** `cart-v3-hero-01.jpg`. **Also attach:** `.scratch/shots-2026-10-01/parkland-woods.png` from the main checkout, which is our current in-game frame.

> The third attached image is our current in-game screenshot. Our cart in it looks bulky and blocky, and the large blue roof dominates. Redesign the cart in the style of the first two references, keeping its layout: a golf cart about 2.4 m long and 1.5 m wide, wheels 0.68 m in diameter, canopy top at 1.65 m, and the turret described in the TURRET block above. The body is CART WHITE with a slate blue-grey chassis and bumpers, as in the attached form-language cart; only the team-colour parts change between panels. Make the body one low rounded tub with a rounded hood and nose, two soft seat cushions, a steering wheel and a navy golf bag standing on the open rear deck. The canopy is thin (about 9 cm) with rounded edges and covers the seats only.
>
> Show **four panels in a 2×2 grid** on a fairway background, all from the same chase-camera angle: behind the cart and slightly to its right, about 3 m up and 6 m back, looking down about 15°. Label each panel underneath:
> - **A: TEAM BLUE, FULL CANOPY:** the whole canopy in team blue.
> - **B: TEAM BLUE, TRIM ONLY:** a white canopy with a blue band around its edge, and the rider in a blue shirt.
> - **C: TEAM ORANGE, FULL CANOPY**
> - **D: TEAM ORANGE, TRIM ONLY**

**If the club comes out of the back** (it did on the first run):
> Fix: the golf club is on the back of the turret. Same four panels, but the club must come out of the FRONT of the red housing, pointing the same way as the cart's nose, with the shaft reaching out past the front bumper and the club head at its far end. Nothing sticks out of the back of the housing. Make the cart body white with a slate blue-grey chassis, as in the form-language reference.

**Follow-up turns:**
> Same four panels from 40 m away, as a small figure in the middle of a fairway, so I can judge which team reading survives at distance.

> Same image in greyscale.

---

## S2b. Turret swing sequence (thread B, after S2)

**Consumer:** confirms the club's mount and motion before the cart is re-blocked. It replaces `swing-sequence-01.jpg` as the look of the swing; the angles are the shipped ones. **File:** `turret-swing-02.jpg`.

> Using the same cart and the same chosen colours, make a 4-panel swing sequence in one row, all seen from the cart's right side at the same scale (SIDE view, nose pointing right), on a plain mid-grey background with a simple ground line. Show the turret mechanism described in the TURRET block, with a dashed arc for the club head's path. Label each panel underneath:
> - **AIM:** the club level and pointing forward past the front bumper.
> - **TOP OF BACKSWING:** the housing tilted back on its pivot pin, the club raised up and back over the turret about 100° in a vertical plane, head high above and behind the pivot.
> - **IMPACT:** the club back at the aim position, a golf ball just leaving the club head, flying forward.
> - **FOLLOW-THROUGH:** the club about 37° below horizontal, still above the canopy roof.
>
> The rider stays seated and does not move.

---

## S3. Cart build breakdown (thread B, after S2)

**Consumer:** the `cart-v3.md` spec and the Blender re-block. It shows every part as a primitive we can build. **File:** `cart-v3-breakdown-01.jpg`.

> Using the cart you chose above (I will name the panel), make a **build-breakdown sheet** on a plain mid-grey background, with no ground, no grass and no environment.
>
> **Left half:** the assembled cart in a clean three-quarter front view.
>
> **Right half:** an **exploded view** of the same cart, with its parts pulled apart along their natural directions and thin leader lines back to where they sit. The cart must break down into **no more than 16 parts**, each one a single simple shape: a **rounded box**, a **cylinder**, a **sphere**, a **torus** or a **wedge**. Label each part with its name and shape, for example "BODY TUB — ROUNDED BOX", "TYRE — CYLINDER", "HOOD — ROUNDED BOX", "TURRET HOUSING — ROUNDED BOX", "NOSE — WEDGE", "STEERING WHEEL — TORUS". Draw the bevel on every rounded box clearly, so its corner radius can be judged against the part's size.
>
> Keep the colours from the chosen panel.

**Follow-up turn:**
> Same sheet, but add a small inset close-up of one corner of the body tub, showing how large the rounded edge is relative to the panel's thickness.

---

## S4. Cart orthographic set (thread B, last)

**Consumer:** the dimension pass in Blender. This is proportion only: the spec's numbers win, as before. **File:** `cart-v3-ortho-01.jpg`.

These lines carry the fixes that `docs/concept/reference/README.md` records for `cart-turnaround-01`.

> Using the same cart, make an **orthographic** reference sheet on a plain mid-grey background with no ground, no grass, no sky and no environment, and no cast shadow. Show three views **side by side in one row, all at exactly the same scale, standing on one shared horizontal baseline**, so the roof heights line up across the row:
> - **FRONT:** looking at the cart's nose, so the two headlights face the viewer.
> - **SIDE:** looking at the cart's right side, **with the nose pointing to the right of the page**.
> - **REAR:** looking at the back, so the golf bag faces the viewer.
>
> Print the **view name** under each panel: FRONT, SIDE, REAR. Do not print grid positions. FRONT and SIDE must have clearly different silhouettes: the front view is narrow and the side view is long. Use true orthographic projection with no perspective.

---

## S5. Clubhouse at game distance (thread C)

**Consumer:** the clubhouse spec rewrite. This is the view that matters, because players see the building from a cart, never in elevation. **File:** `clubhouse-hero-01.jpg`. **Also attach:** `docs/concept/reference/clubhouse-exterior-01.jpg`, for its layout.

> The third image is our old elevation sheet; use it for layout only. Render the clubhouse in the style of the first two references, as a player in a golf cart sees it on arrival.
>
> **The building:** a single-storey pavilion, **24 m wide and 14 m deep including its verandahs, 7.6 m to the top of the cupola**. It has:
> - cream walls on a brick plinth
> - a sage-green hip roof at about 30°, with a dark clerestory window band just below the eaves
> - 5 front bays: a double door in the centre and 2 large windows on each side, each window a dark glass inset in a cream trim frame, with no shutters
> - a 3 m-deep front verandah on 7 square white posts, wrapping 2 m around both ends
> - a white cupola with a pyramid roof centred on the ridge
> - one brick chimney at the rear right
>
> Every roof edge, post and trim board has a soft bevel.
>
> **The setting:** a paved cart apron in front, with four parking pads either side of the building. Two smaller matching cart barns sit 33 m to each side: open-fronted, gable-roofed and 24 m long, the left barn with a **blue** fascia board and the right with an **orange** one. There are a few round broadleaf trees behind.
>
> **Camera:** from cart height, about 3 m up and 60 m in front, looking straight at the entrance, in morning sun. Label nothing.

**Follow-up turns:**
> Same scene from 150 m away, at a low angle across the fairway, so I can see whether the cupola still identifies the building.

> Same first image in greyscale.

---

## S6. Clubhouse build breakdown (thread C, after S5)

**Consumer:** the Blender re-block. **File:** `clubhouse-breakdown-01.jpg`.

> Using the same clubhouse, make a build-breakdown sheet on a plain mid-grey background with no ground and no environment.
>
> **Top half:** the assembled building in a clean three-quarter view.
>
> **Bottom half:** an exploded view of **one front bay module** (window, trim frame, wall section, verandah post and the matching slice of verandah roof) and of the **cupola**, with every part labelled by name and shape (ROUNDED BOX, CYLINDER, WEDGE, PYRAMID). Draw the bevel size clearly on the posts, trim and roof edges.
>
> The building is assembled from these repeated modules, so the module must be simple: no more than 8 parts per bay.

---

## S7. Hub kit (thread C, last)

**Consumer:** the team barn, lamp post and food cart specs. **File:** `hub-kit-01.jpg`.

> In the same style, a line-up sheet on a plain warm-grey studio background with soft floor shadows, each object labelled underneath:
> - **TEAM BARN:** an open-fronted cart barn, 24 m long and 8 m deep, with a 30° gable roof, cream walls on a brick plinth, 5 square timber posts across the open front, and a team-coloured fascia board along the front eave. Show the blue version.
> - **LAMP POST:** a 4 m clubhouse lamp post with a single lantern head.
> - **FOOD CART:** a small striped-awning refreshment cart on two wheels, with a hot dog sign.
> - **TEE SIGN:** a small wooden sign frame on two posts, with a blank face.
>
> Show them at true relative scale to one another, with a golf cart beside them for scale.

---

## S8. Restyle our real frame: chase camera (thread D)

**Consumer:** the lighting and environment target for Stage 3b and Stage 5. It is the most useful single image in this pack, because it keeps **our** layout and asks only for **the look**. **File:** `restyle-chase-01.jpg`. **Attach:** the two style references plus `.scratch/shots-2026-10-01/match-high.png`.

> The third image is a frame from our game. Re-render **this exact frame**, with the same camera, terrain shape, water, and cart position and size, in the style of the first two references. Keep the HUD out. Show what the scene should look like:
> - mowing stripes on the fairway, with a clearly darker rough beside it
> - sculpted sand bunkers with a raised grass lip
> - clumps of 3–7 trees on the rough edges
> - soft rolling hills on the horizon
> - gentle ambient occlusion and soft cart shadow on the grass
> - the cart redesigned as in the references, with a rounded body, a thin canopy over the seats only and a red turret
>
> Do not add buildings that are not in the frame.

**Follow-up turns:**
> Same image in greyscale.

> Same image at golden hour, with the sun low from the left.

---

## S9. Restyle our real frame: the hub (thread D, optional)

**File:** `restyle-hub-01.jpg`. **Attach:** a screenshot of the arena clubhouse hub from about 40 m away. Take it in-game, or ask Claude to capture one.

> Re-render this frame from our game, with the same camera and the same building positions, in the style of the references. Give the buildings soft bevels, warm morning light, ambient occlusion under the verandah roofs and soft shadows on the apron. Keep the layout; change only the look.

---

## Reviewing what comes back

Check each image against this list before filing it. Note any miss in `docs/concept/reference/README.md` under "Known deviations", the way the earlier sheets were recorded.

- [ ] Rounded edges with highlight lines are visible on the main forms, and nothing is outlined in black.
- [ ] Ambient occlusion and contact shadows are present (hero and restyle sheets only).
- [ ] The cart canopy covers the seats only, and the rear deck and bag are visible.
- [ ] **S3, S6:** every part is a single buildable shape, within the part limit.
- [ ] **S4:** labels are view names, the side view faces right, panels share one baseline, and FRONT ≠ SIDE.
- [ ] **S5:** the cupola reads from 150 m.
- [ ] **Greyscale turns:** the cart, turret, seat well and canopy separate from the grass by lightness.
- [ ] No extra props, text or wordmarks were invented.

## Provenance

The same rule as `docs/concept/reference/README.md`: these images are AI-generated reference, tracked by provenance and not licensed. They are never traced, imported or shipped.

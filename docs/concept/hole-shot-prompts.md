# Hole shot prompts

> **SUPERSEDED by `../COURSE_PIPELINE.md`.** Do not generate from this document.
>
> The two holes produced from these templates were unusable, and the cause was not the prompts.
> `HoleSpec` (`src/sim/course.ts:30`) has no field that can hold a creek, a footbridge, or a placed
> bunker — sand is a field-wide noise threshold and water is a byproduct of terrain height, so a
> hole described here cannot be built. See `COURSE_PIPELINE.md` §1.
>
> Layout review is now `npm run plan` (`COURSE_PIPELINE.md` §6), which renders a true orthographic
> plan from the same functions the physics reads. Gemini's remaining jobs, with prompt blocks, are
> `COURSE_PIPELINE.md` §7.
>
> **The art-style spec in §1 below survives and is still used verbatim** in every image prompt. The
> camera specs and the 18-biome table in §3 are retired — the biome table assigned 18 different
> climates to one round; the replacement uses three in contiguous stretches.
>
> Kept for the art-style block and as the record of why this approach was abandoned.

Prompt templates for per-hole terrain concept art: one **teebox** shot and one **aerial** shot
per hole, 18 holes. This is a different shot list from `README.md`'s 00–15 index — those are
generic UI/mechanic reference shots; these are course-layout reference shots, used to sanity-check
that a hole's routing, hazards, and mood read clearly before it gets built (procedurally, per
`../superpowers/specs/2026-09-01-procedural-course-design.md`).

Same status as the rest of this folder: reference-only, nothing here is loaded by the game, and
none of it is a step toward shipping bitmap assets. See `README.md`'s Provenance section for the
copyright caveat on AI-generated images — it applies here too.

## Why this document exists

The first two holes generated (`Hole1Teebox.jpg`, `Hole1Aerial.jpg`, `Hole2Teebox.jpg`,
`Hole2Aerial.jpg`) came out nearly identical: same forest-corridor-with-one-lake composition, and
each hole's "aerial" was really just its teebox shot tilted slightly higher — not a true layout
view. That happened because there was no template: prompts were typed ad hoc and never saved, so
nothing forced two different holes, or two different shot types, to look different.

This document fixes three failure modes:

1. **Every prompt opens with a locked art-style spec** (§1) so results stay low-poly/flat-shaded
   concept art — matching the original reference sheet and the low-poly cart/cone-tree look in
   the source images — instead of drifting toward photorealism.
2. **Teebox and aerial are locked to two structurally different camera specs** (§1) so an image
   model can't blend them into the same shot twice.
3. **Every hole gets a distinct biome/hazard/dogleg** (§3) so holes can't collapse into the same
   default "forest + one lake + one bunker" scene.

## 1. Fixed specs

Paste these verbatim into every hole's prompt — do not paraphrase them per-hole, that's what let
the shots drift last time. Order per prompt: **art style, then hole description, then the
matching camera spec.**

**Art style spec** (open every prompt with this):
> Art style: low-poly stylized 3D concept art for a casual arcade golf game — flat-shaded,
> faceted low-polygon geometry throughout. This is not a photograph and not photorealistic.
> Trees are simplified geometric cone shapes in flat two-tone green, not detailed photographic
> foliage. Fairways show visible flat polygon facets and a mown zig-zag stripe pattern, not
> photographic grass texture. Bold clean black outlines on the golf cart and on major silhouettes.
> Saturated flat cartoon color palette — bright grass green, clean flat blue water, warm tan sand
> — no naturalistic color grading. Sky is a soft flat gradient with simple rounded cartoon clouds
> outlined in the same style. The golf cart is toy-like, with simple flat-shaded panels and a
> visible outline. No photographic textures, no realistic lighting gradients or soft shadows, no
> depth-of-field blur, no lens flare, no fine individual grass blades — flat or two-tone cel
> shading only, matching a mobile/indie low-poly game aesthetic.

**Teebox spec** (player-at-the-tee view):
> Ground-level camera positioned at the tee, camera height 1.8-2.2m (golf cart eye level),
> 60-70 degree field of view, looking down the fairway toward the green. The golf cart occupies
> the lower third of the frame. This is a player's-eye view standing at the tee — the green and
> far hazards may be small, partially obscured by terrain, or not fully visible. Do not show the
> entire hole layout in this shot.

**Aerial spec** (full-layout view):
> True bird's-eye / high three-quarter camera, 55-75 degree downward tilt, altitude high enough
> that the entire hole is visible in one frame: tee, complete fairway shape, every hazard, the
> green, and all bunkers. No golf cart in frame, or the cart rendered small and incidental. This
> is a layout/routing view, not a ground-level view — do not reuse the teebox shot's camera
> height, framing, or field of view for this shot.

## 2. Per-hole template

Start with the art-style spec, fill in the bracketed fields, then append the matching camera spec
from §1.

```
[ART STYLE SPEC FROM SECTION 1]

Hole [N], par [P]. Theme: [BIOME]. The fairway [DOGLEG DIRECTION — straight / doglegs left /
doglegs right / S-curve]. Hazards: [HAZARD LIST — type, count, position relative to fairway].
Distinguishing landmark: [LANDMARK]. Lighting/mood: [LIGHTING].

[APPEND TEEBOX OR AERIAL SPEC FROM SECTION 1]
```

**Differentiation checklist** — before accepting a generated image, confirm:
- [ ] It reads as low-poly/flat-shaded concept art, not a photo or photorealistic render — reject
      and re-run with the art-style spec's exact wording if it looks realistic.
- [ ] This hole's biome is visually distinct from both neighboring holes (not another forest, not
      another single winding lake).
- [ ] The hazard shape/position is different from the last 2-3 holes generated.
- [ ] The aerial shot actually shows the full hole from tee to green — if it looks like the
      teebox shot tilted up, reject it and re-run with the aerial spec's exact wording.

## 3. Eighteen holes

Themes below are invented for concept-art variety only — they are not tied to any in-game data
(holes are procedurally generated at runtime; see the spec linked above). Hole 2 was deliberately
reassigned away from its original forest/lake theme, which is what made it collide with hole 1.

| # | Par | Theme | Dogleg | Hazards | Landmark | Lighting |
|---|-----|-------|--------|---------|----------|----------|
| 1 | 4 | Pine forest creek corridor | Straight | Winding creek crossing fairway mid-hole; two bunkers flanking green | Old stone footbridge over the creek | Cool overcast, soft diffused light |
| 2 | 3 | Seaside cliff dogleg | Doglegs right around a headland | Ocean cliff edge along entire right side; single pot bunker short of green | Lighthouse on the point beyond the green | Bright midday coastal sun, high contrast |
| 3 | 5 | Desert canyon | Straight | Sand waste areas both sides (no rough); dry wash crossing at 250m | Sandstone canyon walls framing the fairway | Late afternoon, long shadows, warm orange rock |
| 4 | 4 | Alpine foothills | Doglegs left | Waterfall feeding a pond that guards the green's left side | Snow-capped peak visible beyond the green | Crisp clear mountain light |
| 5 | 3 | Tropical lagoon | Straight (island green) | Green is a peninsula/island surrounded by lagoon on 3 sides | Solitary leaning palm beside the tee | Golden-hour tropical sun, turquoise water glow |
| 6 | 5 | Autumn woodland | S-curve (left then right) | Fallen-log hazards at both dogleg elbows | Dense red/orange/gold canopy overhead | Low warm autumn light, dappled shade |
| 7 | 4 | Rolling prairie | Straight, wide open | Tall native grass rough both sides, no trees | Old windmill on a rise past the green | Big open sky, scattered clouds, midday |
| 8 | 4 | Volcanic badlands | Straight | Stylized glowing lava-strip hazard down the right side; black basalt rough | Steaming vent behind the green | Dusk, warm lava glow against dark rock |
| 9 | 3 | Snowy highlands | Straight, elevated tee | Frozen pond directly short of the green | Frost-covered pines lining the fairway | Overcast winter light, pale blue-white palette |
| 10 | 5 | Bamboo grove | Doglegs right | Koi pond crossing the fairway at 220m | Red torii-style gate framing the green | Filtered green light through bamboo canopy |
| 11 | 4 | Canyon rim | Straight, forced carry | Chasm/gorge crossing the fairway mid-hole, full carry required | Rope bridge spanning the chasm beside the fairway | Bright desert light, deep shadow in the chasm |
| 12 | 3 | Orchard valley | Straight | Low stone wall crossing in front of the green | Rows of blossoming fruit trees flanking the fairway | Soft spring morning light |
| 13 | 5 | Marshland | Straight | Wetland water hazards both sides; elevated boardwalk cart path | Reeds and low mist over the water | Hazy humid light, muted greens |
| 14 | 4 | Vineyard hills | Doglegs left, terraced | Terraced elevation changes act as natural hazards; single fairway bunker | Stone farmhouse on the hillside beyond the green | Warm late-afternoon Mediterranean light |
| 15 | 3 | Coastal dunes | Straight, exposed | Two bunkers flanking the green; wind-blown marram grass dunes both sides | Weathered wooden dune-crossing boardwalk | Overcast, visible wind streaks in the grass |
| 16 | 5 | Redwood cathedral | Straight, narrow | Narrow fairway corridor between giant redwood trunks; no water | Shafts of light breaking through the canopy | Deep shadow with bright light shafts |
| 17 | 4 | Sunset mesa | Doglegs left around a butte | Sand/scrub rough around the mesa base | Flat-topped mesa butte dominating the skyline | Warm gold-orange sunset light |
| 18 | 4 | Clubhouse finale | Straight | Ornamental fountain short of the green; formal hedge borders | Clubhouse building visible directly behind the green | Bright ceremonial daylight |

## 4. Example: hole 1 and hole 2 (ready to paste)

**Hole 1 teebox:**
> Art style: low-poly stylized 3D concept art for a casual arcade golf game — flat-shaded,
> faceted low-polygon geometry throughout. This is not a photograph and not photorealistic.
> Trees are simplified geometric cone shapes in flat two-tone green, not detailed photographic
> foliage. Fairways show visible flat polygon facets and a mown zig-zag stripe pattern, not
> photographic grass texture. Bold clean black outlines on the golf cart and on major silhouettes.
> Saturated flat cartoon color palette — bright grass green, clean flat blue water, warm tan sand
> — no naturalistic color grading. Sky is a soft flat gradient with simple rounded cartoon clouds
> outlined in the same style. The golf cart is toy-like, with simple flat-shaded panels and a
> visible outline. No photographic textures, no realistic lighting gradients or soft shadows, no
> depth-of-field blur, no lens flare, no fine individual grass blades — flat or two-tone cel
> shading only, matching a mobile/indie low-poly game aesthetic.
>
> Hole 1, par 4. Theme: pine forest creek corridor. The fairway is straight. Hazards: a winding
> creek crossing the fairway mid-hole, two bunkers flanking the green. Distinguishing landmark:
> an old stone footbridge over the creek. Lighting/mood: cool overcast, soft diffused light.
>
> Ground-level camera positioned at the tee, camera height 1.8-2.2m (golf cart eye level), 60-70
> degree field of view, looking down the fairway toward the green. The golf cart occupies the
> lower third of the frame. This is a player's-eye view standing at the tee — the green and far
> hazards may be small, partially obscured by terrain, or not fully visible. Do not show the
> entire hole layout in this shot.

**Hole 1 aerial:**
> Art style: low-poly stylized 3D concept art for a casual arcade golf game — flat-shaded,
> faceted low-polygon geometry throughout. This is not a photograph and not photorealistic.
> Trees are simplified geometric cone shapes in flat two-tone green, not detailed photographic
> foliage. Fairways show visible flat polygon facets and a mown zig-zag stripe pattern, not
> photographic grass texture. Bold clean black outlines on the golf cart and on major silhouettes.
> Saturated flat cartoon color palette — bright grass green, clean flat blue water, warm tan sand
> — no naturalistic color grading. Sky is a soft flat gradient with simple rounded cartoon clouds
> outlined in the same style. The golf cart is toy-like, with simple flat-shaded panels and a
> visible outline. No photographic textures, no realistic lighting gradients or soft shadows, no
> depth-of-field blur, no lens flare, no fine individual grass blades — flat or two-tone cel
> shading only, matching a mobile/indie low-poly game aesthetic.
>
> Hole 1, par 4. Theme: pine forest creek corridor. The fairway is straight. Hazards: a winding
> creek crossing the fairway mid-hole, two bunkers flanking the green. Distinguishing landmark:
> an old stone footbridge over the creek. Lighting/mood: cool overcast, soft diffused light.
>
> True bird's-eye / high three-quarter camera, 55-75 degree downward tilt, altitude high enough
> that the entire hole is visible in one frame: tee, complete fairway shape, every hazard, the
> green, and all bunkers. No golf cart in frame, or the cart rendered small and incidental. This
> is a layout/routing view, not a ground-level view — do not reuse the teebox shot's camera
> height, framing, or field of view for this shot.

**Hole 2 teebox:**
> Art style: low-poly stylized 3D concept art for a casual arcade golf game — flat-shaded,
> faceted low-polygon geometry throughout. This is not a photograph and not photorealistic.
> Trees are simplified geometric cone shapes in flat two-tone green, not detailed photographic
> foliage. Fairways show visible flat polygon facets and a mown zig-zag stripe pattern, not
> photographic grass texture. Bold clean black outlines on the golf cart and on major silhouettes.
> Saturated flat cartoon color palette — bright grass green, clean flat blue water, warm tan sand
> — no naturalistic color grading. Sky is a soft flat gradient with simple rounded cartoon clouds
> outlined in the same style. The golf cart is toy-like, with simple flat-shaded panels and a
> visible outline. No photographic textures, no realistic lighting gradients or soft shadows, no
> depth-of-field blur, no lens flare, no fine individual grass blades — flat or two-tone cel
> shading only, matching a mobile/indie low-poly game aesthetic.
>
> Hole 2, par 3. Theme: seaside cliff dogleg. The fairway doglegs right around a headland.
> Hazards: an ocean cliff edge running along the entire right side, a single pot bunker short of
> the green. Distinguishing landmark: a lighthouse on the point beyond the green. Lighting/mood:
> bright midday coastal sun, high contrast.
>
> Ground-level camera positioned at the tee, camera height 1.8-2.2m (golf cart eye level), 60-70
> degree field of view, looking down the fairway toward the green. The golf cart occupies the
> lower third of the frame. This is a player's-eye view standing at the tee — the green and far
> hazards may be small, partially obscured by terrain, or not fully visible. Do not show the
> entire hole layout in this shot.

**Hole 2 aerial:**
> Art style: low-poly stylized 3D concept art for a casual arcade golf game — flat-shaded,
> faceted low-polygon geometry throughout. This is not a photograph and not photorealistic.
> Trees are simplified geometric cone shapes in flat two-tone green, not detailed photographic
> foliage. Fairways show visible flat polygon facets and a mown zig-zag stripe pattern, not
> photographic grass texture. Bold clean black outlines on the golf cart and on major silhouettes.
> Saturated flat cartoon color palette — bright grass green, clean flat blue water, warm tan sand
> — no naturalistic color grading. Sky is a soft flat gradient with simple rounded cartoon clouds
> outlined in the same style. The golf cart is toy-like, with simple flat-shaded panels and a
> visible outline. No photographic textures, no realistic lighting gradients or soft shadows, no
> depth-of-field blur, no lens flare, no fine individual grass blades — flat or two-tone cel
> shading only, matching a mobile/indie low-poly game aesthetic.
>
> Hole 2, par 3. Theme: seaside cliff dogleg. The fairway doglegs right around a headland.
> Hazards: an ocean cliff edge running along the entire right side, a single pot bunker short of
> the green. Distinguishing landmark: a lighthouse on the point beyond the green. Lighting/mood:
> bright midday coastal sun, high contrast.
>
> True bird's-eye / high three-quarter camera, 55-75 degree downward tilt, altitude high enough
> that the entire hole is visible in one frame: tee, complete fairway shape, every hazard, the
> green, and all bunkers. No golf cart in frame, or the cart rendered small and incidental. This
> is a layout/routing view, not a ground-level view — do not reuse the teebox shot's camera
> height, framing, or field of view for this shot.

The remaining 16 holes follow the same pattern: take that hole's row from the table in §3, drop
its fields into the §2 template, and append the teebox or aerial spec from §1.

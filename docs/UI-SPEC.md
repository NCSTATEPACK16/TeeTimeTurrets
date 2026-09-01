# TeeTimeTurrets — UI specification

Derived from `docs/concept/` by reading the images, not from a prior written spec. Its job is
to be the one place Phase 4 checks itself against, so nobody has to re-derive the HUD from
sixteen pictures a second time.

**This document is descriptive of intent, not of pixels.** The concept art is AI-generated
reference (see `docs/concept/README.md` on provenance and why none of it ships). Where a
number here is load-bearing it comes from the sim, not from measuring a JPEG.

Three rules that follow from `AGENTS.md` and constrain everything below:

- UI is a **DOM overlay** over the WebGL canvas, never geometry in the scene. The one
  exception is world-anchored decoration that is genuinely 3D (the pickup glow cylinders in
  image 06).
- UI **reads sim state and never mutates it.** Input becomes an explicit intent call
  (`sim.launch(yaw, power)`), per `ARCHITECTURE.md` §1.
- Anything positioned from a world point uses the projection in `ARCHITECTURE.md` §2c and is
  `transform: translate3d(...)`-positioned, never `left`/`top`.

---

## 1. Two HUDs, one game

The art shows two distinct HUD configurations, and reading them as one HUD is the mistake this
section exists to prevent. They correspond to the two modes `ROADMAP.md` Phase 2 says will
coexist:

| | **Swing HUD** (stationary shot) | **Cart HUD** (driving/combat) |
|---|---|---|
| Reference | 02, 08 | 03, 07, 09, 14 |
| Stroke + par chip | ✅ | ✅ (08 only, when both are live) |
| Power meter | ✅ | ✗ — charge is replaced by fire-and-reload |
| Reload gauge | ✗ | ✅ |
| Health | ✗ | ✅ |
| Club selector | ✅ full labels | ✅ icons only (03) |
| Minimap | ✅ | ✅ |

**Image 08 is the maximal case** — it carries stroke, par, surface, power meter, health,
reload, club selector, minimap, *and* an event banner simultaneously. Build Phase 4's layout
so 08 fits without overlap; every other shot is then a subset that composes by hiding
elements, not by relayout.

Image 14's two mode buttons (`DRIVER`, an icon of a figure at a wheel; `CLUBSWAP`, a figure
with a club) read as a **mode toggle**, not a club choice — further support for the two-mode
split, and the clearest statement in the art of how a player moves between them.

---

## 2. HUD element inventory

`Phase` is the phase that owns first delivery. Where two are listed, the first owns the state
and the second owns the presentation.

| # | Element | Art | Phase | Fed by | Notes |
|---|---|---|---|---|---|
| H1 | Stroke + par chip | 02, 08 | 1.75 / 4 | `Sim.strokes`, `Hole.par` | Top-left stack. `par` does not exist yet — Phase 1.75 adds it. |
| H2 | Surface chip | 08 | 4 | `Sim.surfaceUnderBall` | Icon + label under H1. Already populated every tick; currently invisible. |
| H3 | Power meter | 02, 08, 00 | 4 | `Ballistics.chargeFraction` | Extends the existing `#power-fill`. Art is inconsistent on orientation (02/08 vertical, 00 horizontal) — **vertical**, it reads better beside a portrait phone layout. |
| H4 | Club selector | 02, 03, 08, 00 | 2 / 4 | equipped `ClubType`, `CLUB_STATS` | Three buttons, active one outlined. Labels on desktop (02/08), icons only when cramped (03). 00 adds per-club POWER/RANGE/RELOAD bars — that variant belongs to the clubhouse (S3), not the HUD. |
| H5 | Reload gauge | 03, 07, 08, 09, 14 | 2 / 4 | `Cart.reloadRemaining` ÷ `CLUB_STATS[club].reloadSeconds` | Must actually block re-fire, per Phase 2's gate. |
| H6 | Health bar | 03, 07, 08, 09, 14 | 3 / 4 | `Cart.health` | Heart icon + bar. No health model exists before Phase 3. |
| H7 | Ammo counter | 06 | 3 / 4 | `Cart.ammo[club]` | Bottom-left card. **Hidden entirely in stroke-play** — see §5. |
| H8 | Minimap | 02, 03, 08, 09, 14 | 4 | `surfaceAt`, entity positions | In *every* in-game shot; the single most under-planned element in the old roadmap. Top-right, rounded. Renders from `surfaceAt` alone — no authored map data, so nothing to keep in sync (same argument as `surfaces.ts`). Shows hole shape, own heading arrow, and in multiplayer a dot per cart (09). |
| H9 | Trajectory preview arc | 02 | 4 | new `Sim.previewTrajectory()` | Solid arc through the air + dashed line on the ground. Needs a **non-mutating** integration of `computeLaunchVelocity` — it must not touch the Rapier world or advance `Sim`. |
| H10 | Ball-flight tracer | 00, 04, 15 | 4 (optional) | ball position history | Fading trail behind a struck ball. BACKLOG #32. Reads well on a long drive; cut it if Phase 4 runs long. |
| H11 | Hit markers | 00, 05 | 4 | ball/target collision events | `+100`, `DIRECT HIT!`, `HOLE IN ONE!`, `CRITICAL HIT!`, `SAND TRAP!`. Ease-out 0.8–1.5 s rise-and-fade (`DECISIONS.md`). One-shot DOM nodes; cluster manager stacks them. |
| H12 | Event banner | 08 | 4 | rule events | Full-width centred two-line card — headline + consequence (`WATER HAZARD` / `PLUS ONE STROKE`). **Distinct component from H11**: screen-anchored not world-anchored, one at a time, longer dwell. Fires on water, out-of-bounds, hole-out. |
| H13 | Cart nameplates | 07, 09 | 4 | remote cart positions | Floating pill above each cart: team-coloured name, plus a health bar in 09. Reuses H11's projection but persists per-frame rather than being one-shot — budget for that difference. |
| H14 | Team score strip | 07, 09 | 3.5 / 5 | mode scoring | Top-centre. Two dots for CTF (07), four dots with counts for free-for-all (09). |
| H15 | Touch controls | 14 | 2 / 4 | `InputSource` | Left thumbstick ring; right cluster of BRAKE, mode toggle, CLUBSWAP, and a large FIRE. See §4. |
| H16 | Coin balance | 11 | 3.5 | player wallet | Clubhouse only, not on-course. |

## 3. Screen inventory

| # | Screen | Art | Phase | Contents |
|---|---|---|---|---|
| S1 | Title | 10 | 1.75 | Logo top-left; right-hand vertical stack `PLAY` / `CLUBHOUSE` / `MULTIPLAYER` / `SETTINGS` with the primary action in orange; version string bottom-right; a live, slowly-moving course scene behind the panel at golden hour. The live backdrop is why this needs a real screen manager and not an HTML page — it shares the renderer with the round. |
| S2 | Results | 13 | 1.75 | `RESULTS` + `FINAL SCORE`; a 9-column grid with `PAR` and `STROKES` rows and a `TOTAL` column; under-par cells ringed green, over-par boxed red; four stat tiles — `DIRECT HITS`, `LONGEST DRIVE`, `TARGETS DOWN`, `ACCURACY`; `MAIN MENU` / `NEXT HOLE`. Those four tiles are the natural input to the Phase 3.5 economy, so record them from Phase 1.75 even while three of the four read zero. |
| S3 | Clubhouse loadout | 11 | 3.5 | Cart on a lit turntable; left category list `TURRET SKIN` / `CHASSIS PAINT` / `TIRE TYPE` with swatch columns; right column of per-club `POWER` / `RANGE` / `RELOAD` stat cards; coin balance; `BACK` / `CONFIRM`. |
| S4 | Match lobby | 12 | 5 | `LOBBY`; mode tabs `STROKE` / `CTF` / `TARGETS`; two team columns with per-slot cart icon, name, and ready tick; empty slots shown as dashes; `LEAVE` / `READY`; region + ping. First place the three mode names appear together — see §5. |
| S5 | Settings | 10 (button only) | 1.75 (stub) | Not drawn. Ship as a stub in 1.75 so the title screen has no dead button. |

## 4. Input inventory

Image 14 is the complete control surface, and it is the requirement list for Phase 2's
`InputSource` interface. The touch layer arrives in Phase 4, but the interface must be written
in Phase 2 against this list rather than against a keyboard, or the touch layer becomes a
refactor of every input path instead of a new implementation.

| Intent | Desktop | Touch (14) | Notes |
|---|---|---|---|
| Throttle / steer | keys | left thumbstick ring | Analogue on touch, digital on keys — the interface takes a normalised vector, not key states. |
| Brake | key | `BRAKE` button | |
| Turret aim | mouse | drag / auto-aim | Independent of chassis heading (`GolfClub.ts` already models this). |
| Fire | click | large orange `FIRE` | Gated by H5. |
| Club select | number keys | `CLUBSWAP` | |
| Mode toggle | key | `DRIVER` button | Swing HUD ↔ Cart HUD. |

## 5. Modes

The lobby (12) names three, which is the first time the mode set is stated anywhere:

- **STROKE** — the golf loop. Non-combat, first to hole out. BACKLOG #20 called this the good
  low-risk mode to ship first, and it is the one already playable.
- **CTF** — the flag-ball. Phase 3.5.
- **TARGETS** — scoring on struck ragdolls (05, and image 13's `TARGETS DOWN` tile). Named
  here for the first time; previously implied by Phase 3 without being a mode.

**Ammo and health are mode-scoped, and this is a rule, not a preference.** Finite ammo in
stroke play can strand a player mid-hole with no way to finish, which breaks golf. So:
`STROKE` runs with damage and ammo disabled; `CTF` and `TARGETS` enforce both. The HUD hides
H6/H7 rather than showing them full — an inert full bar reads as a bug.

## 6. Visual language

From 01 (the form-language sheet) and consistent across 02–14:

- **Low-poly, flat-shaded, saturated.** Untextured coloured materials, one strong sun with a
  soft ambient fill, long soft shadows. No normal maps, no PBR, no texture budget — which is
  what makes the zero-external-asset rule survivable.
- **Silhouette first.** Every object in 01 is readable as a black shape: cart, caddie, tree,
  pin flag, ball bucket, flag-ball. Hold that line when building procedural geometry — a shape
  that needs colour to be identifiable is wrong.
- **Fairway mow stripes** appear in every course shot (02, 03, 06, 09, 14). Cheap and
  high-value: alternating light/dark bands along the fairway axis, drivable from `surfaceAt`
  per mesh vertex in the same pass as the sand tinting (Phase 4).
- **Turret barrel terminates in a club head** (01, 03). Image 09 simplifies it to a plain box
  at distance — that is an LOD, not a redesign. Follow 01/03.
- **HUD chrome**: dark translucent rounded rectangles, white bold condensed type, heavy
  outlines on floating text, orange as the single accent for the primary action.

## 7. Where the art and the spec disagree

Recorded so none of it is mistaken for a requirement. The first two also appear in
`docs/concept/README.md`; the rest are new.

- **00 is 2D vector illustration.** Tonal north star and source of the HUD design language.
  The 3D scene cannot and should not look like it.
- **01 renders the flag-ball at ~⅓ cart height** and golf dimples as carved indentations.
  The capture mechanic needs the ball too big to carry, so build it at roof height; dimples
  become a flat dot pattern or nothing.
- ~~**04's recoil direction is ambiguous.**~~ **Settled in code, Phase 2.** Recoil opposes the
  shot: a forward-firing driver shoves the cart backward, and image 04 is a nose-up rear-end
  squat rather than a forward boost. Asserted by `Cart.test.ts` ("pushes the cart opposite the
  direction the turret is aiming"), so it cannot drift back. The image is now read as
  *confirming* this — the barrel points right, the muzzle flash is right, and the cart is thrown
  up and to the left.
- **05 shows a caddie as the ragdoll target.** Fine, and it means targets are humanoid
  capsule assemblies — but note the ball-to-limb mass ratio decision (`DECISIONS.md`
  "Ball mass") before expecting the pictured launch height.
- **06's pickups float and rotate inside translucent glow cylinders**, with a food cart prop
  nearby. The cylinders are the one piece of UI that is legitimately scene geometry.
- **08's splash** is a ring of white angular shards, not a particle system. Build it that way;
  it is cheaper and matches the form language.
- **09's carts have no visible club head on the turret** — see §6, treat as LOD.
- **15 is store key art.** 2D, marketing only. If it ever ships it goes in `public/`, not
  `docs/`, per `docs/concept/README.md`.

## 8. Shot → phase traceability

| # | Shot | Primary phase | What it pins down |
|---|---|---|---|
| 00 | Original concept sheet | — | Tone, HUD language, hit-marker copy, club stat-bar idea |
| 01 | Form language sheet | 2, 3, 3.5 | Object scale relationships; silhouette rule |
| 02 | The tee shot | 1.75, 4 | Swing HUD; H1, H3, H4, H8, H9 |
| 03 | Cart turret chase cam | 2, 4 | Chase camera framing; Cart HUD; H4 icon variant, H5, H6, H8 |
| 04 | Recoil launch | 2 | Recoil as self-propulsion (direction per §7) |
| 05 | Ragdoll hit | 3, 4 | Ragdoll targets are humanoid; H11 |
| 06 | Pickups on course | 3, 4 | Pickup taxonomy and presentation; H7 |
| 07 | Flag-ball struck | 3.5 | Flag-ball scale, base zone rings, H13, H14 |
| 08 | Water hazard, full HUD | 4 | **The maximal HUD.** H1, H2, H3, H4, H5, H6, H8, H12; splash |
| 09 | Four-cart multiplayer | 4, 5 | H13 with health, H14 four-team variant, cart bogged in sand |
| 10 | Title screen | 1.75 | S1 |
| 11 | Clubhouse loadout | 3.5 | S3; cosmetics taxonomy; tire type as a stat |
| 12 | Match lobby | 5 | S4; the three mode names |
| 13 | Round scorecard | 1.75 | S2; the four stat tiles that feed the economy |
| 14 | iOS touch layout | 2, 4 | §4 input inventory; mode-toggle reading |
| 15 | Store key art | — | Marketing only |

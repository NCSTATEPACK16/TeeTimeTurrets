# Research brief — pickups and power-ups for a golf-cart combat game

You are advising on the design of a pickup/power-up system. You do not have access to the code and
do not need it — everything load-bearing is below. Answer from prior art in games, plus judgement.

## The game

**TeeTimeTurrets** is a browser game: golf carts with mounted weapons, fought across a real
eighteen-hole golf course. It is not a golf course as backdrop — the course is the arena, and golf
rules and objects are the vocabulary the game speaks in.

Two modes share one world:

- **Stroke play** — an actual round of golf. You hit a ball, you take strokes, you putt out.
- **Arena** — a deathmatch driven across the whole course. This is the mode pickups exist for.

Carts drive on and across everything: fairways, rough, greens, bunkers (sand), cart paths, ponds.
**Surface material is mechanical, not decorative** — each surface has its own rolling resistance
and bounce, so sand genuinely bogs a cart down and a green rolls fast and true. Drive into water
and the cart is fished out and repositioned at a cost.

The course is a real routing: eighteen holes, two returning nines, so holes 1, 9, 10 and 18 all
converge on a **clubhouse apron** in the middle — the densest, most contested ground on the map.
The rest is corridors: long thin fairways separated by rough, with greens at one end and tee boxes
at the other, ponds and bunkers placed as hazards along the way.

## The numbers that constrain your answers

- **Six carts**: one player, five bots.
- **180-second matches.** Three minutes, then it's over.
- **Course area roughly 36 hectares** (~360,000 m²), footprint about 976 × 1196 m. This is a
  *large* map for six players — sightlines are long, and two carts can easily not meet for 30 s.
- **Deterministic fixed-step simulation at 60 Hz.** Same inputs and same seed produce the same
  match, every time. All randomness comes from a seeded PRNG; wall-clock time and unseeded random
  are banned in simulation code. This matters for replay and for a future multiplayer server.
- Respawn exists on death.

## What already exists, so proposals fit rather than replace

- **Ammo is modelled.** Carts start with 30, cap at 100. There is exactly one pickup in the game
  today: an ammo bucket (a golf-range ball bucket), which grants 30 and then goes on a **60-second
  cooldown that is global to the pickup** — so whoever takes it denies it to everyone else until
  it comes back. It is picked up by driving within 3 m of it.
- **Health is modelled**, with a working heal path. Carts have hit points and can be damaged and
  healed.
- **Shields do not exist as a resource.** The only thing resembling one is temporary respawn
  invulnerability — and by design you *forfeit it the moment you fire*. There is no shield readout
  in the HUD at all. If you recommend a shield, you are recommending a new resource and probably a
  new HUD element; say so.
- **The map/minimap draws pickups as a single gold dot**, one colour for all of them. Multiple
  distinguishable types would mean changing that.
- **Pickups have no 3D presentation yet.** The intended look is the item floating and slowly
  rotating inside a translucent glow cylinder — standard arena-shooter language.
- A **striped food cart** exists as a prop concept that would spawn pickups around itself.
- Three pickup types are already sketched in concept art: **bucket = ammo, drink = shield,
  hot dog = health**.

## Golf vocabulary you can draw on

Objects and concepts already in the world, or natural to it: flagstick and cup, tee box and tee
markers, bunker and bunker rake, ball washer, distance post, cart-path sign, footbridge and
boardwalk over water, sprinkler heads, divots, the clubhouse, the drinks cart, the 19th hole.
Rules and terms: mulligan, gimme, handicap, par/birdie/eagle, out of bounds, casual water, ground
under repair, playing through, "fore!", the sand wedge, the driver.

Golf-native ideas are strongly preferred over generic shooter power-ups reskinned. "Speed boost"
is worse than "cart path only — pinned to the path, but twice the speed."

---

## Part 1 — five questions

1. **Respawn and cooldown.** Should a pickup be consumed for the match, or respawn in place on a
   timer — and should that timer be global to the pickup or per cart? Classic arena shooters make
   global item timers a core skill; at six players over three minutes on a very large map, a
   global timer may just read as denial and feel bad. Where does the answer flip, as a function of
   player count, match length and map size?
2. **What a shield actually is.** Survey the models — flat absorb pool, percentage damage
   reduction, regenerating overshield, decaying temporary HP. Which stay legible to a player with
   *no dedicated HUD readout*, and which strictly require one? Which survive contact with a
   three-minute match?
3. **Scatter across a large map.** How do games distribute pickups so density reads as intentional
   rather than random — uniform random, blue-noise/Poisson-disk, hand-authored anchors, region
   quotas, or spawn-on-demand near players? Given 36 ha and six players, what stops the map
   feeling empty without turning it into a carpet of items? And if placement is weighted toward
   points of interest (eighteen greens/flags), what does that do to clustering and to the ground it
   empties out?
4. **Sensors versus polling.** In a deterministic fixed-step simulation, what do physics *sensor
   colliders* buy over simply checking distance from each cart to each pickup every tick, at six
   carts and (say) 30–100 pickups? What do sensors cost in event ordering and determinism? Note
   the engine is Rapier, and the game currently uses zero sensors — adopting them would be a first.
5. **Per-match variation without losing replay.** Games with deterministic simulations that still
   want a fresh item layout every match: how do they seed that, and what has to become part of the
   match record so a replay reproduces exactly? The distinction I care about is between "seeded
   from the map seed, so every match on this course is identical" and "genuinely re-rolled per
   match, so replay needs the nonce stored."

## Part 2 — propose ten power-ups

Design **ten** distinct pickups for this game, golf-native, that would work at six players over
three minutes. Include or replace the three sketched ones (ammo bucket, drink, hot dog) as you see
fit — if you think one of them is weak, say so and replace it.

Span the categories rather than giving me ten weapons: **offensive, defensive, mobility, utility,
map-control, economy.** At least two should exploit something specific to this game that a generic
shooter could not use — surface materials affecting traction, the eighteen greens, the hazards, the
clubhouse apron as a chokepoint, or the stroke-play rules themselves.

For each, give me exactly this, tight:

- **Name** and the golf object it is
- **Effect**, stated mechanically enough to implement — numbers where you can
- **Duration or charges**, and whether it is instant, timed, or held until used
- **Why it fits** a three-minute, six-cart match on a 36 ha course
- **Counterplay** — why it is not oppressive, and what a victim can do
- **Cost flags** — whether it needs a new HUD element, a new resource, per-type map colours, or new
  simulation state

Then one line at the end: which three would you ship first, and why those three.

## How to answer

For Part 1, per question: **three to six named games, engines or papers** and what each actually
does — not a description of the design space. Then the axis the trade-off genuinely turns on, one
recommendation, and the condition under which that recommendation flips. Cite sources, and mark
plainly wherever evidence is thin or you are inferring. A confident unsourced answer is worse than
"I could not find this", because the plan gets grilled against it either way and will lose.

For Part 2, prior art is welcome as a comparison ("this is Quake's Quad, golfed") but the ten
should be designed for the constraints above, not transplanted.

Answer against the numbers in this brief — six carts, 180 seconds, 36 hectares, deterministic
60 Hz — not in the abstract. Where a recommendation depends on a number I have not given you, name
the number you would need.

# Stage D — pickups — working stub

**Status: pre-grilling.** Feature statement, what the codebase already provides, and the decisions
that are still open. No user stories, no implementation decisions, no acceptance criteria — those
are outputs of grilling, and writing them now would mean inventing the answers.

Item 1 of 4 in this session's queue.

---

## The feature, as stated

From `docs/HANDOFF.md` "Next session — Stage D, pickups":

> `src/sim/entities/Pickup.ts` is 33 lines defining one hardcoded ammo `Bucket`. It becomes a typed
> collection — bucket = ammo, drink = shield, hot dog = health, per concept sheet `06` — scattered
> course-wide from a seeded PRNG (**never `Math.random()` in `src/sim/**`**), re-rolled per match,
> weighted near flags and valid anywhere drivable. Plus the striped food cart as a prop that spawns
> pickups around itself.

`ROADMAP.md:439` adds: sensor colliders, presented as an item floating and rotating inside a
translucent glow cylinder, and *"Port `consumables.ts` (42 lines, MIT, zero-dep) for the cooldown
model rather than writing one."*

---

## What the codebase already provides

**`Pickup.ts`, all 33 lines.** `interface Bucket { position: {x,z}; cooldownRemaining: number }`;
`BUCKET_COOLDOWN_S = 60`; `createBucket(x,z)`, `stepBucket(bucket,dt)`,
`tryTakeBucket(bucket,cartX,cartZ,range): boolean` — a `Math.hypot` distance check that sets the
cooldown and **does not grant ammo**; the caller decides. No type tag, no id, no y, no despawn.

**`Sim.pickups` has exactly one consumer.** `world.ts:643-645` returns the live `buckets` array.
Created once at `world.ts:513` (`tee.x + 10, tee.z`), repositioned in `loadHole`
(`world.ts:775-777`), ticked in `stepCart` (`world.ts:989`), consumed in `stepRig`
(`world.ts:1038-1039`) at `PICKUP_RANGE = 3.0` → `cart.addAmmo(BUCKET_REFILL_AMMO)`.

**Ammo and health are modelled; heal already exists.** `Cart.ts:75-77` — `STARTING_AMMO = 30`,
`BUCKET_REFILL_AMMO = 30`, `MAX_AMMO = 100`; `Cart.addAmmo` clamps (`:361-363`). `health.ts:9-17` —
`{hp, max}` with `createHealth` / `setMaxHealth` / `applyDamage` / **`heal`**.

**The seeded-PRNG machinery is in place.** `src/sim/rng.ts:17` `mulberry32(seed)`, `:35`
`hashChannel(seed, ...coords)`. Channels are declared per module, not centrally: `BOT_CHANNEL = 3`,
`SPAWN_CHANNEL = 4`, Trees channel 3, `course.ts` uses 4/2/1. A `PICKUP_CHANNEL` would be new. A
re-roll precedent exists — `Sim.reset` re-seeds `spawnRandom` for arena (`world.ts:1339-1343`),
matching `loadCourse:806`. Note that precedent is **replay-identical, not novel per match**.

**`weightsInto`** (`courseTerrain.ts:207-233`) writes each hole's normalised share into a
caller-owned `Float32Array` and returns the index of the largest share, or **-1 for open rough**.

**`consumables.ts` is not in this repo.** It sits at `../Claude-of-Tanks-main/src/game/consumables.ts`,
42 lines. `REUSE-MAP.md:43` names `CONSUMABLE_RULES`, `startConsumableCooldown`,
`cooldownRemaining`, MIT. Attribution goes in the **root `NOTICE`** (`REUSE-MAP.md:29-34`).

**Two prop classes exist** (`propGraphs.ts:10-12`): Blender-exported parameter graphs (`:41-57`,
seven props — **no food cart**) and procedural TS for anything with a collider plus sim state
(`Flagstick.ts`). `.glb` is permitted only through `src/render/decor.ts`, enforced by
`tools/decorBoundary.test.mjs` — so **a food cart with a collider cannot be `.glb`**.

---

## Load-bearing facts that reshape the design

1. **Pickups are effectively absent in arena today.** `loadCourse` (`world.ts:805-827`) never
   touches buckets and `Sim.reset` (`world.ts:1329`) never resets their position or cooldown. In
   the course-wide mode this feature exists to serve, the single bucket sits at whatever stroke-play
   hole's tee was last loaded. This is closer to building the feature than fixing it.
2. **There is no 3D presentation for pickups at all.** Zero hits for pickup/bucket under
   `src/render/**` or `src/entities/**`; "glow" appears only in `showroom.ts:16`. The floating,
   rotating item inside a translucent cylinder is entirely new.
3. **Shield does not exist as a resource.** The only "shield" is `Cart.protectedFor`
   (`Cart.ts:230-241`): respawn invulnerability, granted *only* by `Sim.stepRespawn`
   (`world.ts:1077`), cleared by `revive()`, and **forfeited by firing**. Its own doc comments
   state protection is a property of respawning, not of being alive. The HUD has no shield element
   (`hudState.ts:58-62,116`; `hud.ts:42`). One of the three pickup types has nothing behind it.
4. **No "drivable" predicate exists.** The nearest thing is a scatter filter —
   `weights.sand === 1 || weights.water === 1` in `props.ts:114-119` and `Trees.ts:129-131`, plus
   freeboard. "Valid anywhere drivable" needs defining before it can be implemented.
5. **There is no course-wide prop path.** `derivePlacements` (`props.ts:108-217`) takes a per-hole
   `Terrain` and `Surfaces`, uses no PRNG, is purely geometric, and is capped at 20 props. Nothing
   places props against `CourseTerrain`. This is a missing layer, not an extension point.
6. **Zero sensor colliders exist in the repo** — `setSensor` / `isSensor` / `sensor` return no hits.
   Today's pickup is a per-tick distance poll. `ROADMAP.md:439` specifies sensors; adopting them
   makes this the codebase's first.
7. **`MapMarker.kind` is a closed union** `self|ally|enemy|pickup` (`courseMap.ts:57-63`) with one
   colour each (`MARKER_FILL`, `:74-79`, pickup `#ffd34d`). Three pickup types would all draw as
   one gold dot unless the union and table change.
8. **Cup ownership near the apron is known-wrong** (`courseWorld.test.ts:49`, `it.fails`) and
   `weightsInto` is the method placement would ask. `HANDOFF.md` says to settle that first. The user
   has queued that work as item 2, *after* this one.

---

## Decisions this design needs

Open. None of these are answered anywhere in the repo, and none are mine to settle.

1. **Consumed for the match, or respawn on a cooldown in place?** Today's model is the latter, at 60 s.
2. **What is a shield?** A new `Cart` resource, or a reuse of `protectedFor` — which the code
   declares respawn-only and forfeit on firing. If new: does it absorb damage, cap, decay, stack?
3. **Cooldown scoped per pickup globally** (today's model — a bot can deny the player) **or per cart?**
4. **Who owns placement** — `Sim`, re-rolled in `reset`, or baked at course build alongside
   `courseWorld`?
5. **Keep the O(carts × pickups) distance poll, or introduce the repo's first sensor collider?**
6. **Is the food cart collider-bearing** (⇒ procedural TS, the `Flagstick` route) **or decorative**
   (⇒ a `props.json` re-export from the `.blend`)?
7. **Do pickups appear in STROKE mode,** or are they suppressed alongside ammo and damage per
   `ROADMAP.md:436-439`?
8. **Does placement wait on the `weightsInto` cup-ownership fix,** or build on the known-wrong
   answer and revisit? This reverses the user's stated 1-then-2 ordering if the answer is "wait".
9. **Seeded from the course seed plus a new channel** (replay-identical pickups) **or a per-match
   nonce** (genuinely re-rolled, replay-divergent)? "Re-rolled per match" is ambiguous between these.
10. **One gold map dot for all three types, or per-type colours?** The latter changes
    `MapMarker.kind` and `MARKER_FILL`.
11. **"Weighted near flags" measured from each cup, or each green polygon?** Arena has 18 of each.

---

## Corrections to the stub above, found by re-checking (2026-09-12)

Recorded because three of the facts this document was built on were wrong or incomplete, and a
later reader will otherwise trust them.

- **`MapMarker` is in `src/ui/courseMap.ts`, not `src/render/`** (`:57-63`, fill table `:74-79`).
  Its consumer is `RoundScreen.ts:366`.
- **Arena does not build a map at all.** `RoundScreen.ts:127` builds `CourseMap` only when `arena`
  is unset. Load-bearing fact 7 and open decision 10 therefore do not apply to the mode this
  feature exists for.
- **Arena draws nothing on the course but ground and carts.** `scene.ts:192-199` sets `trees`,
  `flagstick` and `props` all to `null`. Load-bearing fact 5 understates the gap: it is not only
  that no course-wide *prop* path exists, it is that no course-wide anything does. "Weighted near
  flags" means weighted near cups that are not rendered.
- **Stroke play is not pure golf.** It has bots, combat, ammo and its own cart-combat overlay
  (`RoundScreen.ts:272`), and `stepRig` takes the bucket unconditionally. Open decision 7's premise
  — that pickups might be suppressed outside arena alongside ammo and damage — is false; they are
  live there today and removing them regresses a shipped mode.
- **`planPng.mjs` already takes `--in`/`--out`** (`:24`, `:31`). Belongs to Stage E, corrected there.

## Numbers the stub did not carry, and one of them changes everything

- **`ARENA_MAX_HEALTH = 8`** (`matchConfig.ts:77`) and **`STROKE_DAMAGE = 1`** (`combat.ts:49`).
  Eight hits kill. The research brief never gave this number, so **every health figure in
  `research-answers.md` is written against a hundred-point bar and is out by 5–40×.**
- `MATCH_DURATION_S = 180`, `ARENA_BOTS = 5`, `SPAWN_PROTECTION_S = 3`.
- `CART_TUNING.topSpeed = 14` m/s. A cart covers ~1,800 m per match; the course's long axis is
  1,196 m.
- `heal()` clamps to `max` and `setMaxHealth()` refills. **Overfill is not expressible** without
  new state.
- Channels 0–4 are all taken at the `(seed, index, n)` position. `PICKUP_CHANNEL = 5` is free.

---

## Decisions settled — round 1 (2026-09-12)

1. **The hazard-aware tie-break is fixed first, as its own change.** `lastCentredness` is written
   from the spline before either hazard loop runs, so a point inside a pond can lose a tie to a
   better-centred neighbouring corridor — 8,824 m², 22% of reported water, reads dry, and cart
   drowning is gated on that same lookup. Placement would have asked the same wrong question.
   *Rejected:* a disjunctive placement-time hazard test, which makes pickups safe and leaves carts
   driving across ponds, and puts two answers to "is this water" in one codebase; and accepting it,
   which ships pickups in ponds. Own spec: `2026-09-12-hazard-aware-ownership-tie-break-design.md`.
2. **The cooldown stays global to the site and in place; starvation is solved by density.** Three
   takes per site per 180-second match; at ~50 sites that is ~25 per cart against a need of two.
   The research's starvation case holds only at ~3 sites. *Rejected:* per-cart cooldowns, which
   make the rendered world differ per viewer and become per-client state on a server — an objection
   `research-answers.md` never addresses; and consumed-for-the-match, which shrinks the economy as
   the match reaches its most contested minute.
3. **The shield is an integer pool of absorbed hits, presented as plates that shatter one per hit.**
   Two to start, decaying one per ~10 s. At one damage per hit, "temp HP" and "hits absorbed" are
   the same number and the second is countable. *Rejected:* decaying temporary HP (the research's
   recommendation — unrepresentable on an 8-point bar); percentage reduction (at integer damage it
   means "every other hit does nothing"); reusing `protectedFor`, which is a different and
   interesting item — a golf *gimme* — and deserves its own decision rather than being smuggled in.
4. **Seeded from the course seed on `PICKUP_CHANNEL = 5`, taking a nonce parameter that defaults to
   it.** *Rejected:* a real per-match nonce now — **there is no replay system**, no match record and
   no header, so an unrecorded nonce makes matches irreproducible rather than varied.
5. **3D presentation only in slice 1. The arena map is its own feature.** *Rejected:* folding a
   minimal or full arena map in, which needs course-scale corridor and contour geometry that
   nothing produces.
6. **Two shared pieces are built deliberately: the drivability predicate, and a course-wide
   instanced prop path.** Stage E's tee signs are the second consumer of both. *Rejected:* a fully
   general course-prop layer now (makes this stage's landing depend on Stage E decisions); and
   pickup-specific everything with later extraction.

Also settled without contest: **poll, not sensors** (300 checks/tick, existing precedent, and it
keeps same-tick tie-breaking out of the physics engine's contact ordering); **reject the Active Area
Set** (visibility-dependent runtime state, and density removes its job); **do not port
`consumables.ts`** — read, it is a fixed 3-entry table indexed by slot against our unbounded
positional sites; what survives is one idea (absolute `readyAt` over per-tick decrement), which is
an idea and not 42 lines, and a port keeping two lines would still take a `NOTICE` entry.

## Decisions settled — round 2 (2026-09-12)

8. **Valid ground is "not water, plus freeboard".** **Sand is valid** — not a hazard, half top
   speed, and a bunker pickup is a real risk/reward trade. **Open rough (`-1`) is valid** — that is
   what the lookup returning no owner means, and it is where density thins rather than where
   placement refuses. The freeboard guard (water level + 0.4 m, as `Trees.ts:146` uses) is added as
   an ownership-independent second check. *Rejected:* rejecting sand, copying the prop/tree filter —
   those exist because a rake in a bunker looks wrong, an argument about props; and a slope guard,
   which has no observed failure to justify it.
9. **Radius 45 m at a cup or inside the apron, easing to 140 m in deep rough; measured from
   `spec.cup`; ~50 sites.** *Rejected:* the green ellipse — a green is 15–25 m across against a
   45 m minimum, so the two rules differ by less than the spacing they produce. Recorded so nobody
   re-opens it as a real fork.
10. **Slice 1 is bucket + hot dog at +3 HP; plates are slice 2.** Both route into existing
    resources and add no simulation state, so the scatter, the predicate and the presentation land
    first. +2 is a bad trade for a 30-second detour; +4 is half the bar. *Rejected:* all three at
    once.
11. **Positions baked into `CourseWorld`; `readyAt` state on `Sim`, cleared in `reset()`; render
    owns three `InstancedMesh`es.** A site on cooldown **keeps its cylinder and loses its item** —
    which is simultaneously the cheapest instancing (cylinder count never changes) and what makes a
    global timer learnable. *Rejected:* positions on `Sim` re-rolled in `reset()`, which makes a
    rematch's pickups differ from the match it repeats.
12. **The tie-break fix covers bunkers as well as water.** One rule, not a water special case.
    *Rejected:* water-only, which produces "hazards, except bunkers" — not a statable rule; and
    softening drowning in the same change, which makes neither the fix nor the balance reviewable.

Settled by reading rather than by asking: **stroke play keeps its hardcoded bucket** (open decision
7's premise was false); **per-type map colours do not arise** (arena has no map); **the visual
cylinder is 1.5 m against a 3.0 m grab radius** — generous grab, tight visual, recorded because it
looks like an inconsistency.

## Frontier

**Empty for Stage D as specified**, across two rounds (2026-09-12). Formalised in
`docs/superpowers/specs/2026-09-12-stage-d-pickups-design.md`, including the failure each test must
be able to detect and what else would satisfy each assertion.

One stub decision is **deferred rather than settled**: open decision 6, whether the food cart bears
a collider. It is Out of Scope in the spec — it anchors a dense region rather than changing how the
scatter works — and it returns with the food cart.

One thing verified and filed elsewhere: the installed Rapier binding is built **without** enhanced
determinism, and the deterministic flavour is a separate published npm package rather than a runtime
flag. Irrelevant to Stage D, which touches no physics — but the project's "same seed, same match"
promise for a future server is currently made on a build documented not to provide it. Backlog.

**Next step:** `superpowers:writing-plans` for the task-by-task plan, then `to-issues`.

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

# Course props, the flagstick, and a crossing you can drive — design

**Status:** specified, not implemented. Written 8 September 2026 against
`docs/concept/reference/prop-silhouettes-01.jpg`. Implement in a fresh session, following
`docs/superpowers/plans/2026-09-08-course-props-implementation.md`.

**Reference:** `docs/concept/reference/prop-silhouettes-01.jpg` — read that folder's `README.md`
deviation list first. Two of them bite here: the sheet gives proportion *within* a prop and never
scale *between* props, and the footbridge and boardwalk are three-quarter views whose deck width is
a perspective artefact.

**Touches:** `src/entities/Flagstick.ts` (new), `src/render/props.ts` (new), `src/render/scene.ts`,
`src/render/backdrop.ts`, `src/entities/primitiveGraph.ts`, `src/sim/surfaces.ts`,
`src/sim/terrain.ts`, `src/sim/world.ts`, `src/ui/`, `art/clubhouse-and-cart.blend`,
`src/entities/graphs/props.json` (new).

---

## 1. Why

**The cup renders as nothing.** Not "as a placeholder" — as nothing. `src/render/scene.ts` adds
ground, trees, the ball, the carts, `TargetRig` and `BallSwarm`, and that is the entire scene. There
is no flag, no pin, no cup geometry, and `src/render/ground.ts` shades the green as colour and mow
stripes with no hole in it. On all eighteen holes, the thing the entire game is aimed at is
invisible. It is the highest player-visible gap in the project and it has been open since the
course existed.

It was blocked behind the turret spec, which was the last art work that would move a simulation
constant. That has landed, so the queue is clear and nothing here will shift under the next thing.

**Two documented contradictions get closed on the way.** `ASSET_PIPELINE.md` §2's manifest lists
`Flag + pin | primitive | 60 | Cloth as a vertex-animated quad`, while §10 step 8 says "Eight props,
primitive graph". Both cannot be true, and the graph format (§4.1: six static primitive kinds,
static transforms) cannot express a vertex-animated quad. Separately, `docs/HANDOFF.md` has carried
"the bridge is not a prop, it is a design change" for two sessions as a reason to defer it. It *is*
a design change. This spec makes it.

## 2. The constraints, as arithmetic

Three numbers decide most of this design, and two of them are not obvious.

### 2.1 The pin can stand in the cup without ever costing a holed putt

`isInCup` (`src/sim/world.ts:949`) holes the ball when its centre is within `CUP_RADIUS` of the
cup centre and it is slower than `HOLE_OUT_SPEED`:

```
CUP_RADIUS     = 0.55   (src/sim/terrain.ts:19 -- oversized on purpose, this is an arcade game)
BALL_RADIUS    = 0.15   (src/sim/entities/ballShape.ts:11)
HOLE_OUT_SPEED = 2.5    (src/sim/world.ts:88)
```

A pin of radius `r` standing at the cup centre keeps the ball's centre at least `r + BALL_RADIUS`
away from it. The ball can therefore still hole out while the pin stands, provided

```
r + 0.15 < 0.55   i.e.   r < 0.40
```

A real flagstick is about 6 mm in radius; ours wants roughly 0.02–0.03 m so it reads at all. The
margin is thirteenfold. **This is what makes D2 safe:** the pin can be genuinely solid, a putt can
genuinely deflect off it, and `isInCup` needs no special case and no exception — because the
geometry cannot produce the failure the exception would have guarded.

Write this check down in the spec rather than in the code. If the pin is ever fattened past 0.40 m,
holing out becomes impossible with the pin in and no test will explain why.

### 2.2 The heightfield cell is 1.0 m, and that decides what a crossing can be

```
cells: fieldSize        (src/sim/course.ts:711)  ->  cell size = fieldSize / cells = 1.0 m exactly
```

and the field's own comment (`course.ts:101-103`) pins it there:

> "Heightfield rows == cols. Cell size is fieldSize / cells and must stay near 1.0 m: a coarser
> cell makes triangle seams big enough for the 0.15 m ball to trip over."

So terrain resolution is **one metre**, it cannot be raised locally, and raising it globally
quadruples heightfield memory and re-terrains every hole. Anything shaped into the heightfield is
built from 1 m blocks.

The cart's kinematic controller then decides the rest (`src/sim/world.ts:166-171`):

```
CHARACTER_OFFSET         = 0.02
CART_MAX_SLOPE_CLIMB_DEG = 45
CART_MIN_SLOPE_SLIDE_DEG = 32
CART_AUTOSTEP_HEIGHT     = 0.45   over CART_AUTOSTEP_MIN_WIDTH = 0.25
CART_SNAP_TO_GROUND      = 0.6
```

Put those together and a narrow raised deck is not available:

- A deck **less than 0.45 m proud** is climbable from any direction, because autostep simply steps
  the cart onto it. It has no edge at all.
- A deck **0.8 m proud** has 1-cell shoulders at `atan(0.8 / 1.0) = 39°` — under the 45° climb
  limit, over the 32° slide angle. The cart drives up and down it at will. Still no edge.
- A deck **1.0 m proud or more** has shoulders at 45° or steeper, which the cart cannot climb. That
  is an invisible wall, and the same seams are what the 1 m-cell comment warns the ball trips on.

**There is no width or height at which a heightfield deck behaves like a narrow bridge with a real
edge.** It is either a ramp or a wall. That kills the arched footbridge as drivable geometry, and
it is why D5 builds a causeway instead — a shape 1 m cells can actually express.

### 2.3 Draw calls, which the budget cares about more than triangles

`ASSET_PIPELINE.md` §9: *"Draw calls and material count matter far more than triangle count."* After
the turret work a cart is 78 `Object3D`s — 52 for the cart graph, 26 for the rider — and a round
draws five of them, so carts alone are ~390 draw calls.

Seven graph-authored props at roughly 5 nodes each, with about a dozen prop instances on a hole,
is another **~60**. Merged to one draw call per prop instance it is **~12**. That is the whole
argument for D7, and the saving is about 12% of the carts' budget for a helper `docs/HANDOFF.md`
already names as the eventual fix for the carts themselves.

## 3. Decisions this spec makes

**D1. All eight props are in scope, and the drivable crossing is one of them.** `HANDOFF.md`
deferred the bridge as "a design change, not a prop". It is a design change; it is in. Deferring it
again only moves the same work behind another gate re-baseline.

**D2. The standing pin is solid, and a putt can deflect off it.** A thin static collider on the
pole. `isInCup` is not touched and gains no exception — §2.1 proves it does not need one. This is
real golf's flagstick-in rule arrived at by *not writing a rule*, which is the version that cannot
drift out of step with the physics.

**D3. Knocking the pin down clears your putting line, and that is the whole mechanic.** The pin has
two states, standing and felled; felled removes the collider. It is knocked down by a struck ball or
by a cart driving into it — both already have colliders, so it falls out of the physics rather than
out of a hit rule. **It stays down for the hole and stands again on the next**, which is where every
other per-hole thing already resets and is the only version that cannot be farmed.

Spending a stroke to clear the pin is therefore a genuine choice with a price, which is the only
reason to make the pin solid at all.

*A consequence to state out loud, because someone will hit it:* a static collider at the cup means
the cart can no longer drive over the hole. It has to knock the pin down first. That is a small
emergent moment in the design's favour, not a bug.

**D4. The pin is procedural TypeScript; the other seven props are Blender graphs.** This resolves
§1's contradiction, and §2.2's own rule decides it independently of the manifest. The route table
there asks *who owns the shapes*: for the ragdoll it is "the code that builds the bodies", and for
the rider it is Blender, because he never moves. **The pin has a collider and a sim-owned felled
state, so it is a ragdoll-shaped asset, not a rider-shaped one.** The vertex-animated pennant the
manifest asks for then follows for free, since a graph cannot express it. `ASSET_PIPELINE.md` §10
step 8 gets amended to say so rather than left to contradict §2.

**D5. The drivable crossing is a causeway baked into the heightfield, not a bridge on colliders.**
A new `SurfaceId.Bridge` on raised cells, 5–7 m wide with ramped shoulders. This reuses the Rapier
heightfield, the kinematic controller, `weightsAt` and the water penalty, and introduces no static
scenery collider anywhere — which matters because there is currently no such mechanism in the repo
at all and the pin (D2) is already spending that budget.

§2.2 is why it is a causeway and not the sheet's footbridge. The honest description of what ships is
a low plank causeway with railings: the **boardwalk** silhouette from the sheet, at the scale 1 m
cells can hold. Leaving the deck is a choice you make down a shoulder, not a fall you suffer, and
the spec says so rather than promising an edge the physics will not deliver.

**D6. The arched footbridge is built, as decoration, over water nothing drives across.** Streams at
a hole's edge, a ditch behind a green. All eight props ship, the sheet's silhouette gets built as
drawn, and it costs only geometry because nothing crosses it. Keeping it as a drivable object would
mean re-opening D5.

**D7. `primitiveGraph.ts` gains a merge path.** `mergeGraph()` flattens a `BuiltGraph` into one
geometry with baked vertex colours — §2.3's arithmetic. It costs per-slot recolouring, which props
do not need and the cart opts out of by continuing to use `buildGraph`. This is deliberately the
same helper `HANDOFF.md` names as the fix for the cart's own draw calls, so it is written once and
proved on the cheap case first.

**D8. Decorative prop placement is derived from the hole, not seeded and not authored.** Pure
functions of `HoleSpec`: tee markers flanking `spec.tee`, a rake at each `spec.bunkers` rim,
distance posts along `spec.control`, ball washer and cart-path sign at the tee. It lives entirely in
`src/render/**`, so it adds nothing to the seed, needs no RNG channel — trees already own channel 3
(`COURSE_PIPELINE.md:285`) — and **cannot alter a trajectory**. A seeded scatter would put bunker
rakes 40 m from any bunker, which is worse than no rake.

**D9. Bridges are additive. `validateHole` is not touched.** Crossings are derived *after* a hole
validates, wherever the centreline crosses water. Routing therefore stays bit-for-bit identical:
par, corridor, field size and the acceptance rate do not move, and the eighteen holes keep the shape
they have. Holes 2, 13 and 15 gain an alternative to their forced carries rather than being
re-judged. Relaxing the wet-run check would regenerate the whole course, and that is a separate
decision that should be taken on its own merits and its own play session.

**D10. A new HUD element, H17: the pin marker, labelled with metres from the ball to the cup.**
Always on, following H13's nameplate pattern, edge-clamped when the pin is off-camera. The
flagstick is modelled at true scale (~2.1 m pin) and is therefore genuinely small from the tee, as a
real one is; H17 is what makes it findable. There is **no distance readout anywhere in the game
today**, which is its own gap in a golf game, and this is the natural place to close it. Distance is
measured from the ball because that is the number that makes a club choice mean something.

## 4. Scope

**Phase A — the flagstick.** D2, D3, D4, D10. The only phase that adds a Rapier body. Ships the
highest-value object on its own.

**Phase B — the five decorative props.** D7, D8, plus tee marker, bunker rake, ball washer, distance
post, cart-path sign. Touches no `src/sim/**` at all.

**Phase C — the crossing.** D5, D6, D9. `SurfaceId.Bridge`, the causeway in terrain's shaping pass,
the footbridge and boardwalk graphs, the plan colour.

The phases are independent in that order and each leaves the game shippable.

### Explicitly out of scope

- **Relaxing `validateHole`** so bridged carries count as playable. It regenerates the course; it
  wants its own spec and its own reading of `npm run plan`.
- **Bridges as brief vocabulary in `placement.ts`.** Derived is enough for a first pass.
- **The pin as a scoring target.** No `stats.targetsDown` entry, no hit marker, no coins. It is a
  tactical object, not a piñata.
- **Invisible walls anywhere.** Ruled out in D5's own reasoning.
- **Per-slot recolouring of props.** D7 trades it away deliberately.
- **A hole in the green mesh.** The cup is a sim radius, not geometry; `ground.ts` is not touched.
- **Wind.** The pennant animates on a fixed cycle. There is no wind system and this does not add
  one.

## 5. Acceptance criteria

1. **The drawn pin and the sim's cup agree to 1 cm**, in world space, on a hole whose cup is not at
   the origin. Compare the flagstick's world base position against `terrain.cupPosition` directly —
   not the flagstick against a constant and the cup against the same constant. That pairing is what
   let a 0.26 m turret defect ship behind two green tests, and it is the single most repeatable
   mistake in this codebase.
2. **The pin's collider and the pin's drawn pole agree to 1 cm**, and the comparison is made between
   *those two*, for the same reason.
3. **A putt can be deflected by a standing pin, and can still hole out with it standing.** Both
   directions asserted: a ball fired at the pole off-centre does not hole; a ball rolled into the
   cup at putting speed does. The second is what §2.1's arithmetic promises and it must be checked,
   not assumed.
4. **A felled pin deflects nothing.** Same off-centre shot holes out once the pin is down.
5. **The pin stands again on the next hole.** Fell it, `loadHole`, assert standing — and assert the
   collider was removed and rebuilt, per `AGENTS.md`'s removal-path rule.
6. **Every prop appears on the title-screen backdrop as well as in a round.** `src/render/backdrop.ts`
   builds a live hole with no `Sim` and is a second consumer of every static factory. A prop wired
   only into `scene.ts` is invisible on the title screen and nothing else will catch it.
7. **`npm run plan`'s routing output is byte-identical** — every `par`, `corridor`, `field` and the
   acceptance-rate line, on all eighteen holes. This is D9's whole claim and it is falsifiable.
8. **The plan SVGs are expected to change, and only where a crossing is.** `holePlan` samples
   `surfaceAt` into the images and draws contours from terrain heights, so a raised causeway moves
   pixels by construction. A hole with no water must produce a byte-identical SVG; a hole with a
   crossing must differ only around it. **Do not read the second as a regression and do not read the
   first as licence to skip looking.**
9. **`npm run probe` unchanged.** Nothing here touches ballistics. Expect the same single known-red
   driver-distance line, byte-identical. (`tools/feelProbe.ts` fires the free ball directly and
   never calls `computeMuzzle`, so it is blind to most render-side work — see the turret spec's
   header for how that misled a previous session.)
10. **`npm run gate` re-baselined after looking at the diffs**, with a subject per prop.
11. **Draw calls per hole from props stay under 20**, asserted by counting the objects the prop
    factory adds rather than by eye. That is D7's whole purpose and §2.3 predicts ~12.
12. **The cart cannot drive over a standing pin, and can over a felled one.** D3's stated
    consequence, pinned so it is a decision rather than a surprise.

## 6. Test plan

Red before green on every item, per the house rule — and this codebase's specific failure is not
"too few assertions", it is **two assertions that are each true about different things**. Criteria
1 and 2 exist in that shape on purpose.

- **Pin/cup agreement (new).** Confirm it fails before the flagstick is positioned from
  `terrain.cupPosition` — e.g. by leaving it at the origin on a hole whose cup is at (45, 8).
- **Deflection (new, sim).** Drive the ball at the pole through `Sim`, headless, as
  `world.cart.test.ts` already does for targets. Confirm the "still holes out with the pin in"
  assertion fails when the pin radius is temporarily raised past 0.40 m — that is §2.1's arithmetic
  under test rather than restated.
- **Felled state (new, sim).** Assert the collider count drops, not just that a boolean flipped.
- **Backdrop coverage (new).** Build a `Backdrop` and assert the props are in its scene. Confirm it
  fails by wiring a prop only into `scene.ts`.
- **Placement derivation (new, render).** One assertion per prop kind tying it to the feature it
  derives from — a rake within a metre of a bunker rim, a distance post on the centreline. Confirm
  each fails when the corresponding `HoleSpec` field is moved.
- **`mergeGraph` (new).** Same triangle count as `buildGraph`, one `Object3D` instead of many, and
  colours preserved per source node. The colour check is the one that will actually catch a bug.
- **Surface (new, sim).** `surfaceAt` returns `Bridge` on the deck and `Water` a metre off its
  shoulder; `isHazard` false on the deck. Confirm it fails with the bridge test placed *after* the
  water test in the priority chain — that ordering is the whole trick and it is one line.
- **Causeway drivability (new, sim).** Drive a cart across a crossing headless and assert it does
  not take a water stroke. This is the one that proves D5 rather than describing it.
- **Blender.** `get_viewport_screenshot` per prop against its cell on the sheet, and the causeway in
  section against a cart for scale.

## 7. Risks

- **The shoulder seam is where this will misbehave.** A causeway meets the excavated pond
  (`WATER_DEPTH = 1.5` below `waterLevel`, `WATER_SHORE = 6` of blend) and the bank. At 1 m cells
  that junction is the most likely place for the cart to catch or the ball to trip. Drive it before
  believing it, and prefer a longer, gentler shoulder over a shorter, tidier one.
- **`backdrop.ts` will be forgotten.** It is the second consumer of every static factory, its
  `dispose()` warns that anything missed "accumulates once per visit to the title screen", and it
  is not obvious from `scene.ts`. Criterion 6 exists solely because this is the predictable miss.
- **`mergeGraph` bakes colours**, so any prop later wanting a paint slot has silently lost it. The
  cart must keep using `buildGraph`; that is a rule, not a preference.
- **The pin collider changes cart behaviour near the cup** for every cart including bots. Bots spawn
  from `terrain.cupPosition` (`world.ts:1179-1180`) — check a bot does not spawn inside the pin.
- **Two gate subject lists.** `tools/gate/gateScene.ts` and `tools/sceneGate.mjs` both carry one, and
  a subject added to one only fails confusingly. Also: a gate subject must build with no Rapier, no
  terrain and no seed, so prop geometry must be separable from prop placement.
- **The sheet is not a measurement.** Scale is per-cell: the flagstick and the 0.3 m tee marker are
  drawn at comparable heights. Size every prop against cart height (~2.05 m to the canopy, now
  ~2.6 m to the turret pivot), never against another panel.

## 8. What this leaves for afterwards

- **Whether a bridged carry should count as playable in `validateHole`**, which would regenerate the
  course and is the natural sequel to D9.
- **`CHASE_HEIGHT`**, still 3.6 m, still hiding the rider. Untouched by this and still wanting a
  play test.
- **The driver roll/carry ratio**, 0.63 against real golf's ~0.15, open since Phase 0 and the one
  red line in `probe`. Note it interacts with the turret work: loft decides how far below horizontal
  a swing angle puts the club head, and the putter's 3° is what currently caps the follow-through.

# Stage D — pickups

Written 2026-09-12. Formalises the decisions settled by grilling in
`.scratch/stage-d-pickups/prd.md`, which is this document's decision log, against the research in
`.scratch/stage-d-pickups/research-answers.md`, which is argued with rather than accepted. Every
decision below was settled by the user across two rounds; several questions that looked like
decisions turned out to be already answered by the code and are marked as such.

**Blocked on** `docs/superpowers/specs/2026-09-12-hazard-aware-ownership-tie-break-design.md`.
Placement validity asks the surface lookup whether a point is water, and that lookup is wrong across
8,824 m² until the tie-break lands.

---

## Problem Statement

`src/sim/entities/Pickup.ts` is thirty-three lines defining one hardcoded ammo bucket: a position, a
cooldown, and a distance check that does not grant ammo. It is created once at hole one's tee plus
ten metres.

**In arena — the mode this feature exists for — it is effectively absent.** `loadCourse` never
touches it and `Sim.reset` never resets its position or cooldown, so across a course footprint of
976 × 1196 m the single bucket sits at whatever stroke-play hole's tee was last loaded. This is
closer to building the feature than to fixing it.

**And a pickup placed today would be invisible.** Arena draws nothing on the course but ground and
carts: the trees, the flagstick and the props are all null in that mode, and the `M` map is not
built at all because it is derived from one hole's corridor and contours. There is no 3D
presentation for pickups anywhere in the renderer. So the floating item inside a translucent glow
cylinder is not the polish on this feature — with no map and nothing else on the course to navigate
by, it is the only thing that would make a pickup findable.

**One of the three sketched types has no resource behind it.** Concept sheet 06 names bucket =
ammo, drink = shield, hot dog = health. Ammo is modelled and health has a working heal path. Shield
does not exist: the only thing resembling one is respawn invulnerability, which the code states is a
property of respawning rather than of being alive, is granted by one call site, and is forfeited by
firing.

**And there is no course-wide placement layer to hang any of it on.** The existing prop derivation
takes one hole's terrain and surfaces, uses no seeded randomness, is purely geometric, and is capped
at twenty props. Nothing places anything against the assembled course. That gap is wider than
pickups — it is also why no tee sign, footbridge or flagstick appears in arena — so this work builds
part of it deliberately rather than by accident.

## Solution

Pickup **sites** are computed once when the course is assembled: a seeded, variable-radius
blue-noise scatter over drivable ground, dense near the eighteen cups and the clubhouse apron,
sparse in the deep rough between corridors. Positions are immutable for the life of the course.
Pickup **state** — when each site next becomes available — lives on the simulation and is cleared on
reset.

Collection stays a per-tick distance poll, as it is today. Cooldown stays global to the site, as it
is today; the starvation that a global timer causes on a large map is solved by having enough sites
rather than by giving each cart its own view of the world.

A pickup on cooldown keeps its glow cylinder and loses its item, so the cylinder is a landmark that
teaches its own timer instead of a thing that vanishes.

Health is an eight-point bar and one ball hit takes one point, which decides the shape of everything
that touches it: the hot dog heals three, and the shield is a small integer pool of absorbed hits
shown as plates that shatter one per hit, not a decaying temporary-HP pool that an eight-point bar
has no room to express.

Slice one ships the bucket and the hot dog, the scatter layer, the validity predicate and the 3D
presentation. Slice two adds the drink and the plates it needs.

## User Stories

1. As a player driving across the course in arena, I want to see a pickup from a distance, so that
   it is something I choose to go to rather than something I drive over by luck.
2. As a player, I want a pickup I have just taken to still be visible and visibly empty, so that I
   learn where it is and roughly when it returns.
3. As a player low on ammo, I want the nearest pickup to be close enough to be worth the detour, so
   that running dry is a decision point rather than the end of my match.
4. As a player who loses a race to a pickup, I want another one within reach, so that being beaten
   to one costs me a detour rather than the rest of the match.
5. As a player, I want a hot dog to be worth crossing open ground for, so that the reward matches
   what the traversal costs me on a map this size.
6. As a player with a shield, I want to be able to count what is left of it by looking at my cart,
   so that I can decide whether to push or break off without a HUD readout.
7. As a player shooting at a shielded cart, I want to see its protection coming apart as I hit it,
   so that I know whether to commit.
8. As a player, I want a pickup in a bunker to be a real choice, so that the course's own materials
   are part of the decision rather than decoration around it.
9. As a player, I want never to find a pickup floating in a pond, so that the world does not
   contradict itself.
10. As a player replaying the same course, I want the pickups in the same places, so that learning
    the map is worth something.
11. As a developer, I want placement seeded and never drawn from unseeded randomness, so that the
    simulation stays reproducible and a future server and client cannot disagree.
12. As a developer, I want positions immutable once the course is built, so that "where are the
    pickups" has one answer for the whole match.
13. As a developer, I want cooldown state cleared on reset, so that a rematch starts from the same
    world as the first match rather than resuming the previous one's timers.
14. As a developer, I want the world identical for every viewer, so that nothing here becomes
    per-client state the day there is a server.
15. As a developer, I want to resolve two carts reaching the same pickup on the same tick by a rule
    I wrote, so that the answer does not depend on a physics engine's internal ordering.
16. As a developer, I want the validity predicate to be one function used by placement and by
    anything that later asks the same question, so that "can you drive here" has a single answer.
17. As a developer, I want the per-tick cost of pickups to be bounded and small at fifty sites, so
    that adding them does not have to be weighed against the six carts already on screen.
18. As a developer, I want every mesh created for pickups to have a stated owner and a disposal
    path, so that the first thing in this project that spawns course-wide does not leak.
19. As a developer, I want stroke play's existing bucket to keep working, so that a shipped mode is
    not regressed by a feature aimed at a different one.
20. As a reviewer, I want each pickup number to be marked as a playtest placeholder where it is one,
    so that nobody defends a value that was never derived.
21. As a maintainer, I want the reason behind the global cooldown recorded, so that the next person
    who reads "a bot can deny the player" does not re-derive per-cart timers and reintroduce
    per-viewer state.

## Implementation Decisions

**Positions are baked at course build; state lives on the simulation.** The course world is already
built once and cached so that a rematch does not reassemble eighteen holes, which makes it the
natural owner of something that must not move. It gains the site list. The simulation owns a
parallel array of "ready at" times, cleared on reset. Owning positions on the simulation and
re-rolling them in reset was rejected: it would make the pickups of a rematch differ from those of
the match it is a rematch of, which is the opposite of the replay-identical behaviour the reset
precedent already establishes for spawn tees.

**Seeded from the course seed on a new channel, with a socket for a nonce that does not exist yet.**
The placement stream is drawn on `PICKUP_CHANNEL = 5`. *Verified rather than assumed:* channels 0,
1, 2, 3 and 4 are all taken at the `(seed, index, n)` position by terrain, surfaces, course
generation, trees and course generation again; the bot and spawn channels avoid collision by arity
rather than by value, which is fragile enough not to imitate. The seed is taken as a parameter
defaulting to the course seed.

A genuine per-match nonce — the research's recommendation, and the reading of "re-rolled per match"
that produces novel layouts — was rejected **for now, on a fact the research could not have
known: there is no replay system.** There is no match record, no header, and no file format. A
nonce generated at match start and written down nowhere does not make matches reproducible-but-
varied; it makes them simply irreproducible, which is strictly worse than seeding. The parameter is
the whole of the accommodation: the day a match record exists, the nonce has a socket and nothing
restructures.

**Distribution is variable-radius blue noise, not uniform random and not spawn-on-demand.** Uniform
random produces clusters and voids at this scale. A uniform Poisson radius forces a choice between a
carpet and a desert: *computed,* at the standard planar packing of roughly `0.69/r²` points per
square metre over 36 ha, a 45 m radius yields about 123 sites and a 140 m radius about 13. A radius
that varies with distance to the nearest cup, easing from 45 m at a cup or inside the 140 m
clubhouse apron out to 140 m in deep rough, resolves that — dense where the map is contested, sparse
where it is not — and lands near **50 sites**.

**The dynamic injection half of the research's recommendation is rejected outright.** It proposed
seeding a deterministic baseline *and* injecting pickups ahead of players just out of sight. That is
visibility-dependent runtime state, in direct contradiction with the deterministic replay the same
document endorses elsewhere, and it never reconciles them. It does not need reconciling: injection
was proposed to solve starvation, and density solves starvation, so the second half has no job.

**Measured from the cup, not the green ellipse.** Both are available and a green is a real ellipse
rather than a radius. It does not matter: a green is 15–25 m across against a 45 m minimum radius,
so the two rules differ by less than the spacing they produce. The cheaper and more precisely
defined one wins, and the reason it does not matter is recorded so that nobody re-opens it as though
it were a real fork.

**Valid ground is "not water, and with freeboard".** The mechanical predicate is that the assembled
surface does not report water. **Sand is valid** — it is not a hazard, it costs half top speed, and
a pickup in a bunker is a genuine risk-and-reward trade in the game's own vocabulary rather than a
placement bug. Rejecting sand, which is what the existing prop and tree scatter does, was considered
and rejected: those filters exist because a rake standing in a bunker looks wrong, which is an
argument about props and not about pickups. **Open rough is valid**, which settles what a placement
rule does with the lookup returning "no hole reaches here" — that is the interstitial ground between
corridors, and it is where density should thin out rather than where placement should refuse.

A second, ownership-independent guard is added alongside: reject any point below the hole's water
level plus the same 0.4 m of freeboard the tree scatter already uses. It costs one subtraction, and
it catches a pond by comparing height to a water plane rather than by asking who owns the point —
so it holds even if the ownership tie-break ever regresses.

A slope guard was rejected for slice one: corridors are already graded by hole validation, and a
guard with no observed failure to justify it is a constant nobody can tune.

**The cooldown stays global to the site, and stays in place.** *The starvation argument does not
survive arithmetic.* A 180-second match against a 60-second cooldown is three takes per site per
match; at 50 sites that is 150 takes shared by six carts, or about 25 each against a need of
perhaps two. Even at 15 sites it is 7.5 each. The research's case for per-cart timers holds only at
roughly three sites, which is where it silently assumed we would be because that is how many armour
spawns a Quake map has.

Per-cart cooldowns were therefore rejected, and on a second ground the research never addresses: a
pickup present for one cart and absent for another means the rendered world differs per viewer, and
in a future multiplayer server that becomes per-client state. Consumed-for-the-match was rejected
as well — it shrinks the economy exactly as the match reaches its most contested minute.

What a global timer buys at this density is *local* denial without global starvation: two carts
contesting one site near a green is a real fight, and the loser drives a hundred metres to the next
one. That is the arena-shooter dynamic actually scaled to 36 hectares.

**Cooldown is an absolute "ready at" time, not a per-tick decrement.** Today's model steps every
bucket every tick. At fifty sites that is bookkeeping for its own sake; a timestamp compared once in
the poll removes the loop entirely.

**Collection stays a distance poll. Sensors are rejected.** Six carts against fifty sites is three
hundred squared-distance comparisons per tick, which is nothing, and the pooled-ball lookup is the
existing precedent for exactly this shape. Rapier sensors would make this the project's first, put
fifty non-solid colliders into the broad phase, and — the decisive part — resolve two carts crossing
a threshold on the same tick by the physics engine's internal contact ordering rather than by a rule
we wrote. **Two carts reaching a site on the same tick is resolved by lower cart index**, chosen
because it is stateless and reproducible; nearest-distance was rejected as a tie-break that itself
ties.

**The shield is a small pool of absorbed hits, not decaying temporary health.** *This is the decision
the research got wrong for a reason it could not have known:* the arena health bar is eight points
and one ball hit removes one. Its recommendation — fifty temporary hit points decaying at one per
second — is written against a hundred-point bar; on this one, two points decaying at one per second
is gone in two seconds.

But the same quantisation offers a better model for free. At one damage per hit, "temporary health"
and "hits absorbed" are the same number, and hits absorbed is something a player can count. So: a
small integer pool on the cart, decremented in the damage path at the point where respawn protection
is already checked, presented as plates around the cart that shatter one per hit. **Two plates** —
twenty-five percent more life — decaying one plate per ten seconds so it is used rather than
carried. Percentage damage reduction was rejected outright: at integer damage of one it means "every
other hit does nothing", which is stateful and illegible. Reusing respawn protection was considered
seriously and rejected for slice one, because a shield forfeited by firing is a different item — an
interesting one, a golf *gimme*, and worth its own decision rather than being smuggled in as an
implementation shortcut for this one.

**Types and numbers.** The bucket is unchanged: thirty ammo against a start of thirty and a cap of a
hundred. The hot dog heals **three** of eight — meaningful against a thirty-second detour, where two
is not, and short of the half-bar reset that four would be. Every number here goes in the arena
tunables module under its existing, explicit "playtest placeholders, not derived constants" heading,
because that is what they are.

**Slice one is the bucket and the hot dog.** Both route into resources that already exist and
neither adds simulation state, so the scatter layer, the validity predicate and the presentation all
land before any new combat state does. Shipping all three at once was rejected on that ground alone.
Two types still read as designed at fifty sites.

**Presentation: one instanced mesh per type, and the cylinder outlives the item.** The tree scatter
is the precedent — one merged geometry, one instanced mesh, one draw call, and a disposal that frees
geometry, material and mesh together. Two item meshes plus one cylinder mesh is three draw calls
against the roughly 470 six carts already cost. Because a site on cooldown keeps its cylinder, the
cylinder's instance count never changes and only the item's does, which is simultaneously the
cheapest thing to implement and the thing that makes a global timer learnable.

**The visual cylinder is deliberately narrower than the grab.** Collection radius is 3.0 m; the
cylinder reads at 1.5 m. Generous grab, tight visual. Recorded because it looks like an
inconsistency and is not one.

**Two pieces are built as shared infrastructure and named as such:** the drivability predicate, and
a course-wide instanced prop path in the renderer. Stage E needs both for its tee signs, and the
wider gap — no trees, props or flagsticks anywhere in arena — will need them again. Building a fully
general course-prop layer now was rejected as scope that makes this work's landing depend on
decisions Stage E has not taken; building everything pickup-specific and extracting later was
rejected because the two pieces are identifiable now and extraction under a later deadline is how
they end up not shared.

**Stroke play keeps its single hardcoded bucket.** *Established by reading rather than decided:* the
non-arena mode has bots, combat, ammo and a cart-combat overlay — it is not pure golf, and the
bucket is live in it. Suppressing pickups outside arena would regress a shipped mode. The scatter
layer is arena-only because stroke play is one hole; the pickup module serves both.

**The map is untouched, and the question it was thought to raise does not arise.** The marker kind
union is a closed set with one colour each, and three pickup types would indeed all draw as one gold
dot — but *arena does not build a map at all*, and stroke play has exactly one bucket. Per-type
marker colours are therefore not a Stage D decision. A course-wide arena map is a real feature with
real work behind it — it needs course-scale corridor and contour geometry where the existing
sampler produces one hole's — and it is explicitly not in this stage.

**The consumables port is rejected.** The roadmap says to port a 42-line module for the cooldown
model rather than writing one. *Read rather than assumed:* it is a fixed three-entry frozen rule
table indexed by slot, and our cooldowns are per-site, unbounded in count and positional. What
survives contact is one idea — absolute ready-at timestamps rather than per-tick decrement — which
is adopted above and is an idea rather than forty-two lines. A port that keeps two lines is not a
port, and it would take an attribution entry in the root notice for code that was not used.

## Testing Decisions

The house rule is that a plan specifies **the failure each test must be able to detect**, and for
every assertion, **what else would satisfy it**. Six tests on this project have been green while the
bug they were named for was fully present; the list below is written against that.

**Placement never lands in water.** *Detects:* a site whose position reports water. *What else would
satisfy it:* a scatter that happens to produce no wet site for the default seed. So the assertion
runs across several seeds, and the count of sites tested is asserted non-zero — a loop over an empty
list passes every assertion inside it, which is the most common way this shape of test lies.

**Placement is dense near cups and sparse in rough.** *Detects:* a radius function that is ignored,
or applied with its sense inverted. *What else would satisfy it:* "there exist sites near cups",
which is true of uniform random. The assertion that carries weight is comparative — mean
nearest-neighbour spacing among sites within 60 m of any cup is materially smaller than among sites
beyond 250 m of every cup — because only a radius that actually varies produces that.

**Placement is reproducible and seed-sensitive.** *Detects:* an unseeded draw, or a channel that
collides with an existing consumer. *What else would satisfy it:* asserting that two builds with the
same seed agree, which is also true of a hardcoded list. It is paired with the inverse — two
different seeds disagree — and with an assertion that changing the terrain seed does not shift the
pickup layout, which is what a channel collision would break and nothing else would.

**No allocation in the per-tick path.** *Detects:* a scratch array allocated per call. The project
bans allocation in query paths and the existing pattern is caller-owned scratch. Asserted the way
the existing weight queries are, not by timing.

**A cooldown site is unavailable and then available.** *Detects:* a ready-at comparison with the
wrong sign or a missing reset. *What else would satisfy it:* the existing bucket tests already
assert this shape and would pass against a site array that is never populated — so this assertion is
made against a site taken from the real scatter, not a constructed one.

**Reset clears cooldowns and does not move sites.** *Detects:* state surviving a rematch, and
positions being re-rolled. Both halves are needed: asserting only that cooldowns clear would be
satisfied by rebuilding the whole site list, which is the behaviour being rejected.

**Two carts on the same tick yield exactly one take.** *Detects:* a poll that lets both carts
collect. *What else would satisfy it:* a test where the two carts are at different distances, which
the nearest-distance rule would also pass. The carts are placed equidistant, which is the only
arrangement that tests the index rule rather than a distance rule.

**The hot dog cannot heal above the bar, and consumes either way.** *Detects:* an unclamped heal.
The clamp already exists in the health module; what is being tested is that the pickup routes
through it rather than writing the field.

**What the gate and smoke checks may and may not be used for.** A render check is never evidence
about simulation. The gate may show that pickups are drawn, instanced and disposed; it may not be
cited as evidence that placement is correct, that a cooldown works, or that a site is on valid
ground. The smoke check may show that a match with pickups boots and completes. Neither appears in
the acceptance criteria for any placement or cooldown behaviour.

**Disposal is asserted, not inspected.** The project requires every mesh to dispose its geometry and
material. Pickups are the first thing here that spawns course-wide, so the disposal assertion is
explicit rather than assumed from the tree precedent it copies.

**Red before green, and where the code comes first, mutate it.** The scatter and the predicate are
new code, so their tests are confirmed red against a stub before the implementation exists. The
cooldown path exists, so its new assertions are confirmed by mutating the implementation and
watching them fail.

## Out of Scope

- **The arena map.** Needed, absent, and its own feature — it requires course-scale corridor and
  contour geometry that nothing currently produces.
- **Per-type map marker colours.** Does not arise: arena has no map and stroke play has one bucket.
- **The drink and its plates.** Slice two. Recorded here because the decision is settled, not
  because it ships with slice one.
- **The food cart.** Its collider question is genuinely open and it anchors a dense region rather
  than changing how the scatter works.
- **Respawn protection as a pickup — the golf "gimme".** A good idea, a different item, its own
  decision.
- **Trees, flagsticks and props on the course.** The same missing layer, and the reason two pieces
  of it are built here deliberately. Delivering the rest is not this stage.
- **A general course-prop placement layer.** See above; the two shared pieces are the bound.
- **Whether the arena health bar of eight is the right number.** It reshaped every figure in this
  document and is left exactly where it is.
- **Rapier's build flavour.** *Verified:* the installed binding is built without enhanced
  determinism, and the deterministic flavour is a separate published package rather than a runtime
  flag. It is irrelevant here, because nothing in this feature touches the physics engine — but the
  project's stated "same seed, same match" promise for a future server is currently made on a build
  documented not to provide it, and that belongs in the backlog.

## Further Notes

The research brief was answered well on its own terms and three of its five answers survive intact:
poll rather than sensors, blue noise rather than uniform random, and the bifurcated seed. Two did
not survive contact with the code, and both failures were failures of information rather than of
reasoning.

**The health numbers.** The brief told the research model that health was modelled and never said
the bar was eight points. Every health figure that came back — a fifty-point overfill, a forty-point
heal — is written against a hundred-point bar and is out by roughly an order of magnitude. The
single best idea in the document, a decaying overshield read off a dimming particle effect rather
than a HUD bar, is the one most thoroughly destroyed by the number it was denied. Its *intent*
survives in the plates: state that is legible from the cart rather than from a readout.

**The replay nonce.** Architecturally correct for a game that has a replay format. This one does not
have one, which inverts the recommendation: an unrecorded nonce makes matches less reproducible, not
more.

Two further claims in the document should not be carried forward. Its item-timer citations — Quake
3's 35 and 25 seconds, Unreal Tournament's 27.5 and 60 — point at forum threads and a document
upload rather than at anything primary. The numbers are very likely right and it does not matter:
the argument turns on the ratio of traversal time to respawn time, and this course's ratio is
derivable here without citing anyone. A cart's top speed is 14 m/s, so it covers roughly 1,800 m in
a 180-second match and the long axis of the course alone is 1,196 m. That is the number the
cooldown decision was actually made against. And its assertion that Rapier's enhanced-determinism
flag "must be active" is not actionable as written, for the reason recorded under Out of Scope.

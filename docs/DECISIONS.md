# Architecture decisions

Records the small set of choices that constrain future work. Add an entry only when a
later phase must preserve a non-obvious decision or deliberately reverse it. Current
behavior lives in `ARCHITECTURE.md`, `ROADMAP.md`, and the source.

## Settled by the research pass

Revised 31 Aug 2026 against `docs/RESEARCH-FINDINGS.md`. Four rows changed: **ragdolls**
(the previous decision specified API that does not work), **ball mass** (new), and both
**hosting** rows. Superseded text is kept below the table where the reasoning is worth
preserving; where it was simply wrong it is gone.

| Question | Decision |
|---|---|
| Cart movement | Rapier `KinematicCharacterController`. Hover/slide arcade feel over dynamic-vehicle realism. |
| Netcode | Colyseus, server-authoritative, room-based. `@colyseus/schema` binary delta-sync. |
| Determinism | **Not pursued.** Snapshot interpolation + client-side prediction for the local cart, instead of replicate-from-seed. |
| Ragdolls | Pose is held by **body type, not joints**: parts sit `Fixed`/`KinematicPositionBased` at rest and flip to `Dynamic` on impact. Joints only shape the collapse. See "Ragdolls" below — the previous decision was built on inert API. |
| Ball ↔ ragdoll impact | Ball mass is raised to keep the mass ratio ≤ 1:20, with a scripted-impulse fallback. Realistic 46 g is the thing that breaks this. See "Ball mass" below. |
| Client hosting | Served by the game server as one process (Colyseus's Vite plugin builds both halves). Static-only hosting stays possible but is now a deliberate split, not the default. |
| Server hosting | **Bare VPS + `docker compose up` is the documented path.** `fly.toml` / `railway.json` ship alongside as optional conveniences, never as the primary path. |
| Licensing | Split by directory: Apache-2.0 for `src/**` and `tools/**`, AGPL-3.0-or-later for `server/**`. **Materialized** — see `LICENSES.md`. DCO sign-off required from the first commit. |
| Hit markers | Ease-out, 0.8–1.5 s. Cluster manager stacks vertically with randomised X drift. ⚠️ Under-specified — see "Still open" at the bottom of this file. |

The determinism decision is the load-bearing one: it is what makes the cart choice work,
and it retires `RESEARCH-NEEDED.md` question 5 rather than answering it. The second research
pass strengthened it rather than changing it: even granting perfect cross-platform determinism
(which is itself unresolved — Rapier's JS user guide and the `rapier3d-compat` npm README
contradict each other outright), replicate-from-seed additionally requires bodies to be
created and destroyed in identical order on every client. A player joining mid-flight breaks
that silently. Snapshot interpolation has no such failure mode.

## Ragdolls

**The previous decision here was wrong and would have failed silently.** It specified
`SphericalImpulseJoint`/`RevoluteImpulseJoint` with "high stiffness and moderate damping to
hold a pose," then `setMotorMaxForce(axis, 0)` on a contact threshold. Three of those pieces
do not work in the JS bindings:

- **`JointData.stiffness` and `JointData.damping` are inert.** The fields exist and accept
  values; setting them has no effect (dimforge/rapier.js#287). Every hour spent tuning them
  would have been spent tuning nothing.
- **Spherical joints have no angular limits** in the JS bindings (dimforge/rapier.js#290), so
  shoulders and hips rotate infinitely in the twist direction.
- **Spherical joint motors were removed at 0.12-alpha** and the changelog never clearly
  restores them. Treat as absent until verified at runtime against the installed build.

Also worth knowing before writing any of this: revolute limits must be set on the **created
joint object**, not on the `JointData` (dimforge/rapier.js#260) — a silent no-op otherwise.

### What to build instead

**Hold the pose without physics.** Ragdoll parts are `Fixed` or `KinematicPositionBased` while
undisturbed and flip to `Dynamic` with `RigidBody.setBodyType` on the frame of impact. This is
the standard animation-driven → ragdoll switch, and it gives a perfectly rigid pose for free:
no solver work, no drift, no jitter, nothing to tune. Any attempt to hold an upright pose with
joint motors costs frame time and still sags.

The joints therefore have exactly one job — shaping the collapse — which is a job they can
actually do.

- 7–11 **capsules** (pelvis, torso, head, upper/lower arm ×2, upper/lower leg ×2). Capsules
  over boxes: fewer contact points, no corner snagging, no tunneling at joint seams.
- Knees and elbows: **revolute**, limits set on the joint object after creation. These are
  1-DOF anyway, so the missing spherical limits cost nothing here.
- Shoulders, hips, neck: **spherical**, accepting free twist and suppressing it with high
  angular damping on the body. `JointData.generic` with one angular axis locked
  (`JointAxesMask`, 3D only) approximates a universal joint if the free twist reads badly.
- Angular damping higher on distal limbs (forearms, shins) than proximal ones.
- **Disable self-collision between adjacent capsules via collision groups.** Neighbouring
  bodies always interpenetrate slightly at the joint anchor; letting them collide produces
  permanent jitter. This is the most common cause of a ragdoll that doesn't explode but
  still buzzes.
- **No CCD on ragdoll parts.** It only engages for fast relative motion, which limbs at rest
  don't have, and it isn't free. CCD stays on the ball only.
- Raise `world.numSolverIterations` only if validation fails, not preemptively.

**Validate against fixed criteria, not by eye.** Define pass conditions up front — a ragdoll
dropped from 2 m settles with no joint separation inside 5 s; a fixed-impulse side shove
produces no head interpenetration — and record and diff poses across runs so it becomes a
regression check rather than a re-eyeballing exercise. `npm run probe` is already the right
harness for this; see `ROADMAP.md` Phase 1.

Closest working reference: `mattvb91/rapierjs-ragdoll` (Three.js + `rapier3d-compat`, dynamic
bodies per limb, spherical joints, toggleable debug renderer). Take the physics setup; the
GLTF bone-sync half is irrelevant to an asset-free project.

## Ball mass

> **Corrected 2 Sep 2026, when the ragdoll was actually built.** The arithmetic below assumed a
> regulation golf ball. This project's ball is not one: `BALL_RADIUS = 0.15` m (arcade scale,
> seven times a real ball), so `BALL_DENSITY = 1130` gives a **~16 kg** ball, not 46 g. Against
> the shipped ragdoll's heaviest part — a torso capsule at `TARGET_DENSITY = 400`, ~21 kg — the
> ratio is about **1:1.3**, already far inside the ≤ 1:20 bound this entry demands. So the
> density was **not** raised: doing so would only push the ball past the ragdoll's own mass.
> The ratio is asserted against the real bodies in `src/sim/entities/Target.test.ts` rather than
> recomputed by hand, and the velocity clamp below **is** implemented
> (`MAX_PART_LINVEL`/`MAX_PART_ANGVEL`). The reasoning that follows is otherwise intact and is
> what made the ragdoll design safe; only the numbers were wrong.

`BALL_DENSITY = 1130` in `src/sim/world.ts` is real golf-ball density, giving a ~46 g ball.
Its comment claims this "matters from Phase 3 on, when the ball has to move a ragdoll." That
is true and backwards: realism is what breaks the ragdoll.

A 46 g ball against a torso capsule of a few kg is a **1:100+ mass ratio struck at driver
velocity** — the single worst case for any impulse-based solver, and no joint configuration
rescues it. The previous plan had this failure mode sitting directly behind a ragdoll design
that was itself non-functional.

**Decision: raise the ball's collider density until the ratio against the heaviest ragdoll
part is roughly ≤ 1:20, and clamp post-impact linear and angular velocity on ragdoll parts.**

This is nearly free here, which is why it wins over the alternative. `ARCHITECTURE.md` §2b
establishes that against a fixed collider, gravity, damping, and restitution/friction impulse
resolution are all mass-independent — the same property the existing comment relies on. So
**every validated Phase 0 and Phase 1.5 carry, roll, and settle number survives a density
change unchanged.** Re-run `npm run probe` to confirm rather than assume, but expect no drift.

**Fallback if it still misbehaves:** don't resolve the hit physically at all. Detect the
impact (collision event or shapecast), then apply a scripted impulse to the struck limb and a
scripted bounce to the ball. *(As built, the knockdown takes exactly this path, and not as a
fallback: the contact that raises the event was resolved against a `Fixed` body on that tick,
because the flip to `Dynamic` can only happen after it. `combat.ts` scripts the impulse from the
ball's impact speed — `KNOCKDOWN_IMPULSE_PER_MPS` — and `Target` clamps the result.)* Arcade games do this because it is controllable and cannot
explode, and for a comedy physics game "feels right" beats "is correct." Prefer the density
fix first because it keeps one code path; switch if tuning fights back.

Note the interaction with the CTF flag-ball, which is deliberately high-mass and must be
struck rather than carried — it is on the *other* side of this problem and wants its own
density, not the play ball's.

## Hosting

Both hosting rows changed. The self-host-first criterion — a contributor can run a fork
without an account on any one company's platform — is what ranks them, not developer
experience in the abstract.

**Bare VPS + Docker Compose is the canonical path and the docs are written against it.**
Hetzner or DigitalOcean, `docker compose up`, Caddy in front for TLS and WebSocket proxying.
Zero lock-in by construction. Everything else is a convenience wrapper over this, never a
replacement: one `Dockerfile` and one `docker-compose.yml` at the repo root, `docker compose
up` as the README's documented path, and `fly.toml` / `railway.json` committed alongside as
optional.

**Railway is demoted from the previous "VPS or Railway".** It has the smoothest indie DX and
a genuinely persistent always-on process with no cold starts, but its reliability record is
the weak spot: five published postmortems since Nov 2025 including an ~8-hour full blackout
in May 2026, and the free tier is gone. It can also be IPv6-only on private networking —
Colyseus shipped `@colyseus/traefik` specifically for this. Fine as an optional target,
wrong as a documented default.

Fly.io is the best *technical* fit of the managed options (Firecracker micro-VMs, explicitly
strong for long-lived WebSocket connections, connection-aware routing, per-second billing)
with the highest company risk. Render is the wrong shape outright: it is described as less
suited to persistent-connection backends, and its free tier spins down after 15 minutes with
a 30–50 s wake, which is useless for a game server.

**The client hosting row changed as a consequence, not on its own merits.** Colyseus now
ships a first-class Vite plugin (`colyseus/vite`, in `colyseus@0.17.9`): client and game
server on one port, one config, HMR that preserves running room state, `/matchmake/*` injected
as middleware so there is no proxy or CORS. Production is `npx vite build --app` →
`dist/client/` + `dist/server/server.mjs`, deployed as a single process. That removes most of
the integration work that was the historical argument against Colyseus, and it makes "static
client on Netlify, server elsewhere" a deliberate split to opt into rather than the default
shape. Also note the SDK moved: the standalone `colyseus.js` client repo was archived
15 Mar 2026 and the client is now `@colyseus/sdk`.

## Still open

Recorded here so they aren't mistaken for settled:

- **Hit markers are under-specified.** The row above describes one channel; the research
  describes three that shouldn't be conflated — a ~100–150 ms screen-space confirm at the
  crosshair, a world-anchored floating number at 800–1000 ms (pinned to the impact point for
  ~200 ms, then released to screen space so it doesn't slide off when the camera swings), and
  a queued centre-screen banner for "HOLE IN ONE!". The 0.8–1.5 s figure is the middle
  channel only.
- **There is no audio anywhere in this project**, and no hit stop. An NLP study of ~5,000
  Steam comments on action games isolated hit stop, sound coherence, and camera control as the
  three features that dominate perceived impact, with a weakness in any one ruining the
  impression — and none of the three is floating text. Phase 4 is currently all text and HUD.
  This is a missing pillar, not a polish item.
- **Ball prediction in Phase 5.** The roadmap says the ball is server-authoritative with no
  client prediction. For a ~3 s, 129 m flight that adds a full round-trip of visual lag to the
  thing the player is watching most closely. The research recommends clients simulating
  locally for smoothness with server snapshots as truth and a snap to the authoritative
  resting position on settle. Worth revisiting before Phase 5 starts; cheap to keep open,
  since `src/sim/**` already runs in both places.
- **Cart movement model.** Still a build-and-feel spike, as previously agreed. One addition:
  Rapier ships a `DynamicRayCastVehicleController` if the dynamic route is ever revisited,
  which shortens that spike considerably. Whether Colyseus's built-in client prediction fits
  the cart or needs custom reconciliation depends entirely on how the chosen model behaves
  under rollback, so it cannot be settled before the spike.
- **Reserved-Content diff** against the reference repo. Human-only, and unchanged.
- **Trademark clearance**, now materially smaller. The project was **renamed from "CallofGolf"
  to "TeeTimeTurrets" on 31 Aug 2026**, which retires the acute version of this concern: the
  old name was a close phonetic play on a heavily-enforced entertainment mark, and the new one
  is not a play on any mark this project is aware of. What remains is the ordinary check any
  name deserves — a jurisdiction-specific search before there are users — not the urgent one.
  Note the parent working directory is still `GolfofDuty/`, which is not published and not part
  of the repo, but is worth not reintroducing as a name anywhere.

## Physics ownership after the research

Three bodies, three different treatments. Getting this wrong is the expensive mistake.

| Thing | Rapier representation | Why |
|---|---|---|
| Ball | Dynamic rigid body, CCD on | Needs real contact solving at 40 m/s |
| Cart | Kinematic character controller | Feel is designed, not simulated |
| Flag-ball (CTF) | Dynamic rigid body, high mass | Must be struck, not carried — so it has to be a real physics object |
| Ragdolls | Dynamic bodies + impulse joints | Joints do the animation |

**A kinematic character controller does not receive impulses.** The driver-fired-backward
recoil boost therefore cannot come from `applyImpulse` — it has to be a velocity term the
cart controller owns and decays itself. Same for being shunted by another cart. This is the
detail most likely to be lost between the design and the implementation; it is recorded here
and in `BACKLOG.md` #10 for that reason.

For the cart to shove the flag-ball, the controller needs
`setApplyImpulsesToDynamicBodies(true)` and a real `setCharacterMass`.

## What is reusable from Claude of Tanks, and what is not

> Superseded in detail by `REUSE-MAP.md`, which is the maintained version. Summary kept here.

Claude of Tanks is MIT **with a Reserved Content carve-out** (`LICENSE-POLICY.md` in that
repo). The boundary lands almost exactly on the line that matters here:

| Path | License | Relevance |
|---|---|---|
| `src/sim/**` | MIT | movement, ballistics, terrain mobility, damage, spotting |
| `src/engine/**` | MIT | frame scheduling, renderer, lighting, quality tiers |
| `src/net/**`, `server/**` | MIT | protocol, snapshots, authority, transport |
| `src/vehicles/**` | **Reserved** | procedural vehicle geometry — not licensed to us |
| `src/world/**` | **Reserved** | terrain, maps, props, vegetation — not licensed to us |
| `docs/research/**`, `docs/references/**` | **Reserved** | including `movement-physics.md` |

Consequences we are bound by:

- **Terrain generation and vehicle geometry must be ours.** They already are
  (`src/sim/terrain.ts`, `src/entities/GolfClub.ts`). Do not port anything from that
  project's `src/world/**` or `src/vehicles/**`, and do not use its research docs as a
  source for tuning constants — `docs/research/movement-physics.md` is Reserved even
  though the `movement.ts` that implements it is MIT.
- **MIT still requires attribution.** Any file we copy or derive closely from must retain
  the copyright and permission notice (© 2026 Kevin B. Liu) and be recorded in an
  attribution file. Same-shape reimplementation from the public interface is not a
  derivative work; a close port is.

Ranked reuse targets, highest value first:

1. `src/sim/terrainMobility.ts` — 159 lines, MIT, **zero imports**. Pure functions mapping
   (spec, ground type, slope) → drive acceleration, grip coefficient, slope margin, travel
   cost. Maps directly onto a golf cart on fairway/rough/sand, and its
   `groundResistanceFor(spec, groundType)` shape is the lookup our Phase 3
   `SURFACE_TUNING` work already needs.
2. The **interface decomposition** in `src/sim/movement.ts` — `MovementSpec` (static tuning)
   / `TankState` (mutable pose) / `MovementInput` (intent) / `MovementHeightField`
   (injected terrain sampler) / `MovementCollisionResolver` (injected push-out). That
   four-way split is the shape `Cart.ts` should take regardless of what integrates it.
3. `src/engine/frameLoopScheduler.ts` — idle cadence, input wakeups, backgrounded-tab
   rescue. A strict upgrade over our `GameLoop.ts`, but not needed until there is
   something to idle.
4. Its `AGENTS.md` invariant set. Already adopted here; this was always the highest-value
   thing to copy and it is not code.

## Physics: hybrid, not one engine

**Claude of Tanks uses no physics engine.** Its dependencies are `three` and `ws`. All of
`src/sim/movement.ts` (2320 lines) is a hand-rolled deterministic integrator that samples
a heightfield, owns the vehicle pose, and resolves slope/grip/rollover itself. Its shells
(`stepShell`) are a plain ballistic integrator with no ground interaction — nothing in that
game rolls.

We use Rapier, and we keep it for everything. See the ownership table above.

**Withdrawn:** an earlier revision of this file argued the cart should be hand-rolled over
the heightfield rather than being a Rapier body, on the grounds that Phase 5 determinism
demanded it. That argument was entirely downstream of assuming replicate-from-seed netcode.
The research chose snapshot interpolation instead, which removes the determinism requirement
that was the whole basis for the recommendation. With it gone, the character controller is
less code for the same feel, and the recommendation is withdrawn rather than defended.

`RESEARCH-NEEDED.md` question 5 (Rapier cross-platform determinism) is retired for the same
reason — the netcode no longer depends on the answer.

## Deceleration is not the physics engine's job

`Sim.step()` applies rolling resistance directly rather than leaving all deceleration to
Rapier. This is deliberate and load-bearing — Rapier models no rolling friction, and
velocity-proportional damping cannot bring a ball to rest on a slope. Full reasoning and
the measurements behind it are in `ARCHITECTURE.md` §2b. Do not "clean this up" by moving
it back into collider properties.

## Self-tests over a test framework

`tools/feelProbe.ts` is built with a Vite SSR pass and run under plain Node. Claude of
Tanks uses the same pattern at scale — `*.selftest.mjs` files run by
`node tools/run-selftests.mjs`, with no test framework in its dependency tree.

`ROADMAP.md` Phase 1 lists Vitest. Either works, but the selftest pattern is already
proven here, adds no dependency, and matches the project we are deliberately mirroring.
Prefer it unless something specifically needs a framework's fixtures or mocking.

## Arena mode, and a course that is one place

Decided 9 Sep 2026, in the session that built the course map. This is the largest scope
change since Phase 0 and it deliberately reverses a statement in the source.

**There is a second mode, and it is not golf.** `Arena` is a timed, team-based cart
deathmatch played across all eighteen holes joined into one drivable course. Kills score
**points**, which decide the individual MVP; deaths score **strokes**, which are
team-aggregated, and the team with the **fewest** strokes wins. There is no played ball,
no scorecard, no par and no holing out — the cart's golf balls are ammunition and that is
the only ball in the mode. Carts start spread across the eighteen holes and respawn at a
random tee.

The scoring holds a deliberate tension: the team wins by *not dying* while the MVP badge
goes to whoever kills most. That is the design, not an oversight — do not "fix" it by
making both awards agree.

**This reverses `ROADMAP.md`'s mode-scoping rule.** That rule reads "STROKE runs with
damage and ammo disabled," justified because finite ammo in stroke play can strand a
player mid-hole with no legal way to finish. Arena keeps damage and ammo on, and the match
timer is what retires the stranding problem: a match ends on the clock whatever state a
cart is in. The rule still stands for stroke play if stroke play keeps running.

**Stroke play is not decided.** It is untouched — its per-hole isolated fields, 1 m cells
and ball physics all still ship. Whether the two modes ever share a world is explicitly
deferred rather than answered. Do not delete the golf code on the strength of this entry,
and do not assume it is being maintained either.

**`course.ts`'s header is qualified, not overturned.** It says "a course is nine holes,
not one nine-hole map. Each HoleSpec owns its own field, terrain and surfaces, and playing
a round loads one at a time." That remains true of **stroke play**, which is what it was
written about. Arena adds a course frame — `src/sim/courseLayout.ts` — that places all
eighteen fields relative to each other and to a clubhouse. `HoleSpec` is unchanged and
still origin-centred; the frame is a separate layer over it, not a rewrite of it.

**Fields are expected to overlap; corridors are not.** Nine fields are 47 ha of ground and
the loop they sit on is 36 ha, so they cannot all fit — but the playable corridors are
ribbons about 40 m wide using 7.5 ha of that 36. Every clearance rule belongs on the
corridor, never the field, and the contiguous heightfield is base noise with every hole's
corridor carved into it. A future check that reports overlapping *fields* as a defect is
the check being wrong.

**Holes may converge on the clubhouse apron, and nowhere else.** Returning nines means 1,
9, 10 and 18 all start or finish on the same ground. `inspectLayout` exempts corridors
whose closest approach falls within `CLUBHOUSE_APRON_M` for exactly this reason.

**2 m heightfield cells are legal where no ball is simulated.** `course.ts` requires cells
"near 1.0 m" because "a coarser cell makes triangle seams big enough for the 0.15 m ball to
trip over." That constraint is about the *ball*, and Arena has none — a cart capsule is an
order of magnitude larger. Arena's contiguous course runs 2 m cells, which takes a 1,300 m
course from ~3.4M ground triangles to ~845k and its collider from ~1.69M cells to ~422k,
resident in one Rapier heightfield with no streaming. **Stroke play keeps 1 m.** If golf
ever moves onto this world, the cell size moves back or the ball trips.

**Measured 9 Sep 2026, and the reasoned numbers above were never checked before that.**
`tools/terrainProbe.ts` (`npm run probe:terrain`) builds the real thing — the eighteen
generated holes placed by `courseLayout.ts` and assembled by `createCourseTerrain` — as one
Rapier heightfield, and drives 24 KCC carts across it for 600 ticks. The course is
**1056 × 1613 m** including its rough margin, not the square 1,300 m the paragraph above
assumed, so 2 m cells are **426k** cells and ~852k triangles rather than 422k and 845k. Cost
at 2 m: heights sampled in **951 ms**, collider built in **4 ms**, **1.19 ms mean** per tick
(p95 1.52, max 2.67) for `world.step()` plus 24 character-controller moves, **1.6 MB** of
heights and no measurable resident growth. The budgets it is judged against are a quarter of a
16.67 ms frame as a mean and half as a p95, since the frame holds a render too.

**So the 4 m fallback is not needed, and neither is tiled streaming.** The probe sweeps cell
sizes to prove it is measuring cell size at all — 1/2/4 m give 2.36 / 1.19 / 0.83 ms mean and
3909 / 951 / 250 ms to sample. **1 m is the one that fails**, and on the build rather than the
step: four seconds of sampling is a loading screen, and it buys ground detail no cart can feel.
That is the fallback the reasoning above expected to need at 2 m, landing one step finer.
Two guards decide whether a run is evidence at all: carts must be grounded ≥ 90% of ticks and
must travel ≥ 40% of free speed. They are not decoration — the first run of the probe reported
a cheerful 0.81 ms on a control whose carts had been fanned off the edge of the field and were
in free fall, touching nothing. An idle world is cheap for reasons that have nothing to do
with cell size.

**The roadmap was jumped deliberately.** The map is `UI-SPEC.md` H8, listed under Phase 4;
the clubhouse is Phase 3.5; the contiguous course was in no phase at all. Phase 3's two
open items — mode-scoping and the pickup trio — are untouched by the map and nameplate
work, so there was no technical reason to wait. Recorded here so a reader of `ROADMAP.md`
does not find shipped Phase 4 work with no explanation.

## Arena's scoreboard: two strokes that must never touch, and a flat health number

Decided 9 Sep 2026 in the session that built `src/sim/match.ts` (against
`docs/superpowers/specs/2026-09-09-arena-match-and-scoring-design.md`, cited below as D1–D13);
`MatchResultsScreen` (D12) landed 12 Sep 2026, closing out Stage C5.

**"Stroke" means two different things in this codebase, and they must never touch (D1).**
`Cart.strokesTaken` counts ball hits absorbed, one per hit — the score of the timed cart-combat
sub-mode stroke play itself already runs (shipped 3 September). Arena's stroke is a **death**,
counted on `Match` and incremented once per kill regardless of how many hits it took to cause
it — at `ARENA_MAX_HEALTH` (8), that is a factor-of-eight difference for the same cart. Nothing
derives one from the other. The failure this guards against is a scoreboard that folds them
together and looks plausible at every value it displays, which is why `src/sim/match.ts`'s
header states it first, and why `MatchResultsScreen` reads only `Sim.match` — never
`Cart.strokesTaken` or `Sim.matchOutcome()`. Those stay stroke play's own combat-timer ending
(`src/ui/matchResults.ts`, untouched); reusing them for arena would have shown hits-absorbed as
though it were the team score, and `RoundScreen` now skips drawing that overlay outright
whenever `arena` is set so the two endings can never both be on screen.

**A kill is attributed, an environmental death is not, and a team kill scores no point (D5).**
Ball kill by an enemy: killer +1 point, victim's team +1 stroke. Team-mate kill: no point, but
the team still loses the life — that is the punishment. Ram kills (`cartsShunt`) score
identically, attributed to the other cart; both carts dying in one contact scores both, each
blaming the other. Any death with no other cart involved (drowning) is `NO_KILLER`: +1 stroke,
no point, and the sentinel is negative so it can never be mistaken for a real roster index.

**Arena health is a flat number, chosen here rather than left open (D9).** `docs/HANDOFF.md`
carried "cart health is `2 × par` and `loadHole` re-sizes it" unanswered for several sessions —
arena has no par, so it cannot inherit the rule. `ARENA_MAX_HEALTH = 8`: inside the 6–10 band
`2 × par` produces across the par mix, so the combat feel already tuned for stroke play carries
over, and flat because the thing that varied it does not exist in this mode. Set once, by
`loadCourse`, and never resized afterwards — the actual defect the open question pointed at was
never the number, it was `setMaxHealth` refilling the bar as a side effect of a mode event.

**`MatchResultsScreen` is a real `Screen`, not the existing overlay (D12).** The easy path when
the match clock runs out in arena would have been the overlay already sitting in `RoundScreen`
for stroke play's ending — same `sim.matchOver` flag, same "time's up" moment, no new screen to
write. It was left exactly where it is, unchanged, and arena got its own screen
(`src/ui/screens/MatchResultsScreen.ts`, registered as `"arenaResults"`) for the reason directly
above: the two endings do not share a scoreboard. `MatchResultsScreen` is built fresh in
`enter()` like `ResultsScreen`/`ClubhouseScreen`/`TitleScreen` — not static markup toggled by a
flag like `#match-results` — so there was no placeholder text to ship empty and no `index.html`
markup change at all, only new CSS for the layout.

The DOM-free half of this, `src/ui/matchScoreboard.ts`'s `deriveScoreboard(match): ScoreboardState`
— headline, both teams' strokes, the MVP, and one row per player — is **not** new. It shipped
with C1–C4, committed at `8170e52`, before `MatchResultsScreen` existed to call it. Worth stating
because it was nearly lost: an early pass of this session's own work wrote a second, narrower
scoreboard module under the same filename without reading the one already there first, and briefly
overwrote it. Restored from `git show HEAD:src/ui/matchScoreboard.ts` before anything shipped. The
lesson is procedural, not architectural — read a file before writing one with the same name and
purpose, even when a search for it under a different name turned up nothing — and is recorded here
rather than dropped because the failure mode (destroying an already-correct module while believing
it did not exist) is exactly what `search_symbols`-first navigation is supposed to prevent, and did
not, because the search terms were the ones missing, not the module.

## Assembling the course: influence, not a mosaic

Decided 9 Sep 2026, building Stage B of arena mode. The entry above says the contiguous
heightfield is "base noise with every hole's corridor carved into it"; this is what that turned
into when it was built, and the parts a later change has to preserve.

**A point does not belong to a field.** Nine fields cover 47 ha of a 36 ha loop, so "which field
is this in" has no single answer, and any rule that picks one leaves a cliff along the line where
the pick changes. What has an answer is how much a hole's *corridor* claims a point.
`courseTerrain.ts` gives each hole an influence that is 1 out to the edge of its own blend band —
where `Terrain.heightAt` has stopped carving and is returning plain noise — and falls to 0 over
`COURSE_BLEND_M` (40 m). Inside a corridor the ground is therefore *exactly* what stroke play
builds, to the last decimal. Nothing is re-derived.

**Weights are cubed before blending.** Corridors clear each other by 35 m and influence reaches
about 65 m, so most fairways sit inside a neighbour's band; at raw weights the neighbour's rough
drags a third of a metre of camber onto ground `validateHole` proved was flat. Cubing leaves a
neighbour at half influence contributing an eighth. It is one function, `blendWeight`, and
`courseSurfaces.ts` blends materials over the same weights so ground that drives like fairway
looks like fairway.

**Hazards hold their ground where the corridor has let go of it.** A pond faded into rough is
ground standing above the water plane — a pond a cart drives across.

**The invariant to test against is the grade, not the height.** The blend does move a corridor:
a green 30 m from the next tee is inside that hole's ground too, and the two average, by up to
2 m. What it must not do is steepen one, and it does not — the steepest ground on the assembled
course is the same causeway shoulder on hole 2 that stroke play has, to 3e-6 of grade.

**`Sim` stands on a `Playfield`, not on a hole.** Height, material, boundary and heightfield are
the four questions `Sim` asked `Terrain` that are not about holes; they moved behind an interface
with two implementations. That is what makes `isPastFieldEdge` mean something in a mode with no
field edges, and it deliberately carries nothing about tees, cups or par — a mode with no par
should not be handed one through the ground it drives on.

**The renderer's limit is build time, not draw calls.** `weightsAt` costs 3.0 us (the spline
nearest-point scan, eighteen of them), so stroke play's 0.5 m surface mask over the course would
be ten minutes of baking. `courseGround.ts` tiles instead: every tile gets an 8 m build at
construction and a 2 m one on approach, a few rows per frame. 2 m is the physics cell, so what
you see resolves what you can drive on. Re-measure with `npm run probe:terrain` before assuming
any of this is still true.

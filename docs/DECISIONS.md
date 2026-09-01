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
scripted bounce to the ball. Arcade games do this because it is controllable and cannot
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

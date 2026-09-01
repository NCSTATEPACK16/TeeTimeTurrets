# TeeTimeTurrets — Research Findings

Response to `RESEARCH-NEEDED.md`. Researched 31 Aug 2026. All claims sourced; where sources
conflict, the conflict is reported rather than resolved.

---

## TL;DR — two premise corrections that matter more than the answers

**1. Q1's core question has a partly negative answer.** The rapier.js API does not expose the
knobs the brief assumes exist. Spherical joints have **no angular limits** in the JS bindings
(dimforge/rapier.js#290), and the `stiffness` / `damping` fields on `JointData` are **inert** —
setting them has no effect (dimforge/rapier.js#287). There is no official Rapier ragdoll
parameter recipe to cite, because the official docs don't have one. The working answer is
structural, not numeric: don't use joints to hold the pose at all.

**2. Q5's premise is contradicted by Rapier's own docs.** The brief says the default WASM build
isn't cross-platform deterministic. The JS user guide says the opposite, in the first sentence:
"The WASM/Typescript/JavaScript version of Rapier is fully cross-platform deterministic."
The npm README for `@dimforge/rapier3d-compat` says the main build "does not guarantee
cross-platform determinism" and points at `-deterministic` builds. Both are official. Treat this
as unresolved and verify empirically (snapshot hash across machines) before betting netcode on it.

---

## Q1 — Rapier ragdoll joint tuning

### What the API actually gives you

| Feature | Available in `rapier3d-compat`? | Source |
|---|---|---|
| Spherical joint | Yes | JS joints guide |
| Spherical joint *angular limits* | **No** | dimforge/rapier.js#290 |
| `JointData.stiffness` / `.damping` | Present but **no effect** | dimforge/rapier.js#287 |
| Revolute joint limits | Yes, but must be set **on the created joint**, not on `JointData` | dimforge/rapier.js#260 |
| Prismatic joint limits | Yes, via `JointData` (`limitsEnabled`, `limits`) | JS joints guide |
| Joint motors (PD controller, `stiffness`+`damping`) | Documented for spherical/revolute/prismatic — but spherical motors were removed at 0.12-alpha and the changelog never clearly restores them. **Verify at runtime.** | JS joints guide; rapier.js CHANGELOG |
| `JointData.generic` — 6-DOF, lock axes via `JointAxesMask` (3D only) | Yes | rapier.js CHANGELOG |
| `JointData.spring`, `JointData.rope` | Yes | rapier.js CHANGELOG |

Note `JointAxesMask` uses `LIN_X/LIN_Y/LIN_Z` for translation and `ANG_X/ANG_Y/ANG_Z` for
rotation — these were renamed specifically because people were mixing them up.

### Recommended structure

**(a) "Rigidly upright while undisturbed" — solve this without physics.**
Keep the ragdoll bodies as `Fixed` or `KinematicPositionBased` while at rest and flip them to
`Dynamic` on the frame of impact (`RigidBody.setBodyType`). This is the standard
animation-driven → ragdoll switch. It gives you a perfectly rigid pose for free: no solver work,
no drift, no jitter, no joint tuning. Any attempt to hold an upright pose with joint motors will
cost you frame time and still sag.

**(b) "Collapses without exploding" — the real risk is the mass ratio, not the joints.**
A golf ball is ~46 g. A torso capsule at plausible game density is several kg. A ~1:100+ mass
ratio struck at driver velocity is the single worst case for any impulse-based solver, and no
joint configuration rescues it. Two fixes, in order of preference:

1. **Don't resolve the hit physically.** Detect the impact (collision event or shapecast), then
   apply a scripted impulse to the struck limb and a scripted bounce to the ball. Arcade games
   do this because it's controllable and it can't explode. Strongly recommended for a comedy
   physics game where "feels right" beats "is correct."
2. If you keep the physical hit, raise the ball's simulated mass (via collider density) so the
   ratio is roughly ≤ 1:20, and clamp post-impact linear/angular velocity on ragdoll parts.

**(c) Joint layout, given the missing limits.**

- 7–11 **capsules** (pelvis, torso, head, upper/lower arm ×2, upper/lower leg ×2). Capsules over
  boxes — fewer contact points, no corner snagging, no tunneling at joint seams.
- Knees and elbows: **revolute** joints with limits set on the joint object after creation.
  These are 1-DOF anyway, so you lose nothing.
- Shoulders, hips, neck: **spherical** gives you free rotation with no limit — which is exactly
  the "rotates infinitely in the twist direction" complaint in issue #290. Two workarounds:
  use `JointData.generic` with one angular axis locked to approximate a universal joint, or
  accept the free twist and suppress it with high **angular damping** on that body.
- Angular damping higher on distal limbs (forearms, shins) than proximal ones — standard
  practice for calming spin and oscillation.
- **Collision groups: disable self-collision between adjacent capsules.** Neighbouring bodies
  always interpenetrate slightly at the joint anchor; if they collide, you get permanent jitter.
  This is the most common cause of "non-exploding but still buzzing" ragdolls.
- **Do not enable CCD on ragdoll parts.** CCD only engages when a body is moving fast relative
  to another; ragdoll limbs at rest don't need it and it costs you. Keep it on the ball only.
- Raise `world.numSolverIterations` modestly and only if validation fails — the guidance in the
  general literature is to start conservative and increase, not the reverse.

**(d) Validate with a fixed test, not by eye.** Define pass criteria up front: e.g. ragdoll
dropped from 2 m settles with no joint separation within 5 s; a fixed-impulse side shove causes
no head interpenetration. Record and diff poses across runs. This gives you a regression check
you can run in CI instead of re-eyeballing after every tuning change.

**Prior art worth reading:** `mattvb91/rapierjs-ragdoll` — Three.js + `rapier3d-compat`, dynamic
bodies per limb, spherical joints, GLTF bone mapping, toggleable debug renderer via Tweakpane.
Closest working reference to what you want. (Your project is asset-free, so you'd take the
physics setup and skip the bone-sync half.)

---

## Q2 — Colyseus, reconfirmed (and it got better for you specifically)

**Verdict: yes, still the pick — and by a wider margin than when the brief was written.**

- **License:** MIT. Core framework, SDK, schema. No cloud-only lock-in. Colyseus Cloud is a
  funding model, not a gate; the README asks non-Cloud users to sponsor, which is the extent of it.
- **Maintenance:** very active. Consolidated into a monorepo — the standalone `colyseus.js`
  client repo was archived 15 Mar 2026 and the SDK now ships as `@colyseus/sdk`. Stable line is
  0.17.x (`@colyseus/core` 0.17.43, May 2026); a 0.18 line is in flight (0.18.x release notes
  reference `readBodyMaxTime`, Node 22 requirement, and a `TIMED` wire-format doc fix). Outside
  PRs are being merged and credited.
- **`@colyseus/schema`:** still there, v4.x, still doing binary delta-encoded state sync. The
  docs front page now also advertises **built-in client prediction**, which didn't exist at the
  time of the older comparisons you're re-confirming against.
- **The thing you should actually care about:** there is now a **first-class Vite plugin**
  (`colyseus/vite`, shipped in `colyseus@0.17.9`). Client and game server on one port, one
  config, HMR that preserves running room state and auto-reconnects clients, `/matchmake/*`
  injected as middleware so no proxy or CORS. Production build is
  `npx vite build --app` → `dist/client/` + `dist/server/server.mjs`, deployed as a single
  process with `node dist/server/server.mjs`. For a Vite + TypeScript project this removes most
  of the integration work that used to be the argument against Colyseus.
- **Transports:** WebSocket (default, `ws`-based), Bun (`@colyseus/bun-websockets`), and
  H3/WebTransport. You're not locked to one.
- **Self-hosting:** plain Node process. Redis + load balancer for horizontal scale;
  `@colyseus/traefik` exists for routing. Nothing in the core path requires their infrastructure.

### The alternatives, honestly

**Raw `ws`.** Works. You then hand-build matchmaking, rooms, reconnection tokens, delta
compression, and a schema/serialization layer. That's most of Colyseus. Only worth it if you want
the netcode itself to be the project.

**geckos.io.** Alive but small: v3.1.0, last published ~4 months ago (Mar 2026), BSD-3-Clause,
one maintainer, ~726 weekly downloads. The real problem for *your stated goal* is that WebRTC
data channels make self-hosting harder, not easier — STUN/TURN, UDP port ranges, NAT traversal.
That directly cuts against "a contributor should be able to `docker compose up` a fork."

**Recommendation:** Colyseus over WebSocket. Revisit UDP only if you measure a latency problem
you can attribute to TCP head-of-line blocking, which for a turn-ish golf game you probably won't.

---

## Q3 — Hit markers and floating combat text

### Concrete conventions from prior art

- **Stacking / overlap.** Two established techniques: *spatial spreading* — random spawn offset
  of roughly 20–40 px per axis (larger in screen space, smaller in world space) so each number
  gets its own reading zone; and *number combining* — merge multiple hits landing on the same
  target within a **100–200 ms** window into one larger number rather than spawning several.
  Path of Exile uses combining for damage-over-time.
- **Criticals / special hits.** Yellow or orange, **150–200% size**, with a brief pop-scale
  animation on spawn *before* the float begins. Keep ordinary numbers clean; elaborate ordinary
  numbers flood the screen in high-frequency combat.
- **Motion.** Simple upward float is the baseline and is what makes multiple simultaneous numbers
  readable. A bounce or lateral arc adds "pop" but costs legibility. When numbers shrink they
  should never shrink to illegibility.
- **Numbers are not the feedback system.** If floating text is disabled, hit reactions, health
  bars, audio and screen effects should still fully communicate the outcome. Text augments.
- **What actually drives "impact feel."** An NLP study of ~5,000 Steam comments on action games
  isolated three features that dominate: **hit stop, sound coherence, and camera control**. A
  weakness in any one of the three ruins the impression — and none of them is floating text.
  Budget your polish time accordingly.

### Suggested spec for TeeTimeTurrets

Two separate channels, don't conflate them:

**Channel 1 — hitmarker (screen space, at the crosshair).** Confirms *you* connected. ~100–150 ms,
no motion, scale-in then hard cut. This is the one that has to be instant. Consider encoding
extra info in it (some shooters put target health in the hitmarker rather than adding a health bar).

**Channel 2 — floating number (world-anchored, at the impact point).**
- Project the world position to screen each frame for the first ~200 ms so it tracks the target,
  then unpin to pure screen space so it doesn't slide off frame when the camera swings.
- Total lifetime ~800–1000 ms. Ease-out rise of ~40–60 px. Alpha holds for the first 60–70% of
  lifetime, then linear fade — fading from t=0 makes the number unreadable at the exact moment
  the player looks at it.
- Scale overshoot 1.0 → 1.25 → 1.0 over the first ~120 ms.
- Maintain a ring buffer of active markers. On spawn: if within ~40 px of a live marker and
  within 150 ms from the same source, merge; otherwise offset into a free lane.

**Channel 3 — banner text ("HOLE IN ONE!").** Different thing entirely. Screen-centre, 1.5–2.5 s,
never stacked, **queued rather than concurrent**. Two banners at once reads as a bug.

---

## Q4 — Hosting a stateful Node WebSocket server, self-host-first

Ranked against your stated criterion (a contributor can self-host a fork without one company's
platform), not against general DX.

**1. Bare VPS + Docker Compose — this is the canonical path, write the docs against it.**
Hetzner or DigitalOcean, `docker compose up`, Caddy in front for TLS and WebSocket proxying.
Zero lock-in by construction. If you want Heroku-style DX on your own box, Coolify or Dokku.
Everything below should be a *convenience wrapper over this*, not a replacement for it.

**2. Fly.io.** Deploys your Docker image as Firecracker micro-VMs; explicitly strong for
WebSockets and long-lived connections thanks to connection-aware routing; 18 regions, sub-100 ms
anycast, ~61 ms warm response globally in third-party benchmarks; per-second billing with
near-zero idle cost via auto-suspend. Lock-in is one `fly.toml`. Caveats: first deploy is slow
(~22 min in a May 2026 benchmark vs Railway's ~2 min), and there are business-continuity signals
worth noting — GPU deprecation effective 1 Aug 2026 and reported frozen headcount against two
better-funded competitors. Technical fit is the best of the three; company risk is the highest.

**3. Railway.** Persistent always-on process (not serverless), no cold starts, one-click Redis,
$5/mo Hobby, smoothest indie DX. Against it: reliability record is the weak spot — five published
postmortems since Nov 2025 including an ~8-hour full blackout in May 2026 — and the free tier is
gone (one-time $5/30-day trial credit, prepaid credits removed early 2026). Also note Railway can
be IPv6-only on private networking; Colyseus shipped a `@colyseus/traefik` fix specifically for
this.

**4. Render.** Most Heroku-like, best managed Postgres story (PITR on all paid tiers, read
replicas, automated backups), moved off per-seat pricing in April 2026. Two problems for you:
free web services **spin down after 15 min and take 30–50 s to wake**, which makes them useless
for a game server, so $7/mo Starter is the floor; and Render is specifically described as *less
ideal* for backends built on persistent connections and stateful processes.

**Excluded as requested:** Cloudflare Durable Objects, Vercel (stateless by design; needs Redis
for sessions), and anything else where the runtime model can't be reproduced on a generic host.

**Concrete recommendation:** one `Dockerfile` + one `docker-compose.yml` in the repo root,
`docker compose up` as the documented path in the README, and a `fly.toml` / `railway.json`
committed alongside as optional conveniences. That satisfies the fork-portability goal while
still giving you a one-command deploy.

---

## Q5 — Cross-platform determinism and `Math.sin`/`Math.cos`

### The contradiction, stated plainly

- **JS user guide, Determinism page:** the WASM/TS/JS version "is fully cross-platform
  deterministic" — same version, different browsers/OS/CPUs, identical results; an MD5 of
  `world.createSnapshot()` after the same number of steps matches across machines.
- **npm README for `@dimforge/rapier3d-compat`:** the main build "does not guarantee cross-platform
  determinism of the physics simulation (but it is still locally deterministic, on the same
  machine)," and directs you to `@dimforge/rapier3d-deterministic` (or
  `rapier3d-deterministic-compat`) for a guarantee, at the cost of a less optimized build.

Both are dimforge. The brief followed the npm README; the docs page says otherwise. **Do not
architect around either claim without testing it yourself** — the test is cheap: run N fixed steps
on your Windows PC and your MacBook Neo, hash the snapshot bytes, compare. Do this before you
write a line of netcode. (Latest `rapier3d-compat` on npm is 0.19.3.)

### Does `Math.cos`/`Math.sin` on the input side break replicate-from-seed?

**Not on its own, and the fix is trivial.** The docs' warning is about *initial conditions*: every
value used to initialize the simulation must itself come from cross-platform-deterministic
operations, or the simulations start from different states and the engine's determinism is
irrelevant. `Math.sin`/`Math.cos` are called out by name.

But you control where that value crosses into the sim. Two mitigations, both cheap:

1. **Quantize the launch velocity before handing it to Rapier.** Compute `cos`/`sin` however you
   like, then round the resulting velocity components to a fixed grid (e.g. nearest 1/1024) before
   `setLinvel`. Any platform-to-platform discrepancy in the last ULP of `Math.cos` disappears
   under quantization, and the bytes entering the sim are bit-identical everywhere.
2. **Never send floats over the wire at all.** Send the aim as an integer index into a fixed
   angular grid (say 4096 steps) plus an integer charge level. Both clients look up or compute
   the velocity from the same integer, quantized identically. This also shrinks your shot packet
   to a few bytes.

A precomputed trig lookup table is the same idea, just materialized. The `-deterministic` build is
a *separate* concern — it addresses the engine's internals, not your input math — and you only
need it if your own snapshot-hash test fails.

### The bigger objection to replicate-from-seed

Even with perfect determinism, this architecture is fragile here for reasons the brief doesn't
raise:

- **Rapier's determinism requires identical construction order.** Same simulation parameters,
  same bodies/colliders/joints, **added and removed in the exact same order**. A player joining
  or leaving mid-flight, or a ragdoll being spawned on one client a frame earlier, silently
  breaks the guarantee.
- **A golf ball on a noise heightfield with CCD is chaotic.** A one-ULP difference at launch is
  amplified by every bounce. Even if your first bounce matches, the fifth may not.
- **Ragdoll impacts multiply this.** The moment a ball hits a jointed multi-body assembly, you
  have the least numerically forgiving part of the whole engine sitting in your determinism path.

**Recommendation:** server-authoritative simulation with snapshot interpolation as the baseline,
and replicate-from-seed as a *bandwidth optimization* layered on top for the ball-flight phase —
clients simulate locally for smoothness, the server's periodic snapshots are truth, and the ball
snaps to the authoritative resting position on settle. Colyseus's built-in client prediction plus
`@colyseus/schema` delta sync gives you this shape out of the box. It degrades gracefully; pure
replicate-from-seed fails hard and silently.

---

## Q6 — License choice

### What comparable projects actually use

| Project | License | Relevance |
|---|---|---|
| **lichess (lila)** | AGPL-3.0-or-later (Highcharts exception) | The canonical open networked game server on AGPL. Large outside-contributor base, works fine. |
| **Space Station 14** | **Relicensed MIT → AGPL-3.0, Aug 2024** | The single most relevant precedent. Multiplayer game, server component, active fork ecosystem. |
| Colyseus | MIT | Your likely netcode dependency |
| geckos.io | BSD-3-Clause | Alternative netcode |

**The SS14 migration is worth copying wholesale as a mechanism.** Content contributed after commit
`7210960b` (15 Aug 2024) is AGPL-3.0; everything before it stays MIT; both LICENSE files ship in
the repo; assets are CC-BY-SA 3.0 separately, with some CC-BY-NC assets flagged as needing removal
for commercial use. Their downstream forks (Frontier, Delta-V, Goob, imp) each did the same
commit-boundary relicense. It's a proven pattern for changing your mind later — with the caveat
that it only works if you get consent, which is why the forks track it as an open issue.

### Trade-offs that actually bite

**AGPL-3.0**
- The "run as a service" trigger genuinely applies to you — this is a networked multiplayer
  server, unlike a purely client-side game where AGPL and GPL are equivalent in practice. Anyone
  hosting a modified TeeTimeTurrets server must publish their modifications.
- **Contributor cost is real:** several large companies have blanket internal bans on AGPL, so
  employees at those companies can't contribute to your repo even on their own time in some
  policies. For a hobby project this is a rounding error; know that you're paying it.
- Blocks later dual-licensing **unless you take a CLA or DCO from day one** — relicensing requires
  consent from every copyright holder, and a CLA is itself a contributor-friction cost.

**MIT / Apache-2.0**
- Maximum reuse, zero friction, no barrier to any contributor.
- Apache-2.0 adds an explicit **patent grant** that MIT lacks — for a game this is mostly
  theoretical, but it costs you nothing.
- Nothing prevents a closed hosted fork.
- **Irreversible in one direction:** anything you publish under MIT stays MIT forever. Someone can
  fork the last MIT commit and continue under those terms regardless of what you do later.

### Recommendation

**Split by directory, which is what the game projects above actually do:**

- `client/`, procedural geometry, rendering → **Apache-2.0** (or MIT). This is the part people
  will want to learn from and lift; make that maximally easy. Apache for the patent grant.
- `server/`, netcode, room logic → **AGPL-3.0** if "no closed hosted fork" is a real goal.
- Any assets you eventually add → **CC-BY-SA 4.0**, tracked in per-file metadata (SS14's approach).

**Decide before the first outside PR.** Add a DCO sign-off requirement to `CONTRIBUTING.md` now
even if you go permissive — it costs contributors one `-s` flag and preserves your options.

**One caveat that isn't a licensing question:** the Reserved Content carve-out in the Claude of
Tanks repo means that reference project is *not* fully permissive. Your license choice does not
cure a Reserved-Content overlap if one exists. See the flag-backs below.

---

## Flag-backs — agreed, these are not research questions

Confirming all five items in the brief's own list, and adding two:

1. ✅ **Golf-cart movement model (kinematic controller vs. dynamic + drive forces).** Agreed —
   build-and-feel spike. Worth noting Rapier ships a `DynamicRayCastVehicleController` if you go
   dynamic, which shortens the spike considerably.
2. ✅ **Terrain amplitude / noise frequency / ball damping-friction-restitution.** Agreed —
   playtesting. Adjacent research-answerable note: Rapier changed contact regularization from
   `erp`/`damping_ratio` to `contact_natural_frequency`/`contact_damping_ratio`, and replaced
   `normalized_max_penetration_correction` with `normalized_max_corrective_velocity` to kill
   popping. If your "slow to settle" report predates that, some of it may be parameter naming
   rather than tuning.
3. ✅ **Club balance numbers.** Agreed — play sessions only.
4. ✅ **Reserved-Content drift vs. the reference repo.** Agreed — needs a human diff of your
   actual files. Nobody outside your codebase can answer it, and the answer is legally
   consequential enough that it shouldn't be guessed at.
5. ✅ **Trademark clearance for "CallofGolf."** Agreed — jurisdiction-specific search, not general
   research, and not legal advice from anyone here. Flagging only that the name is a close
   phonetic play on a heavily-enforced entertainment mark, which is a reason to get a real answer
   early rather than after you have users.

   > **Superseded 31 Aug 2026 — the project was renamed to TeeTimeTurrets.** This finding is
   > left in the old name deliberately: it was a finding *about* "CallofGolf", and rewriting it
   > would make the record claim something it never said. The phonetic-play concern was
   > specific to that name and does not carry over. See `RESEARCH-NEEDED.md` for what is still
   > open under the new name.

**Added:**

6. **Whether Colyseus's built-in client prediction fits the cart, or you need your own
   reconciliation.** Prediction quality depends entirely on how your cart movement model behaves
   under rollback — which depends on item 1, which is a spike.
7. **The determinism snapshot-hash test (Q5).** Research can't settle the docs/npm contradiction.
   Run the hash comparison across your Windows PC and MacBook Neo yourself; it's an afternoon and
   it decides your entire netcode architecture.

---

## Sources

- Rapier JS joints guide — https://rapier.rs/docs/user_guides/javascript/joints
- Rapier JS determinism guide — https://rapier.rs/docs/user_guides/javascript/determinism
- Rapier JS rigid-bodies guide (CCD) — https://rapier.rs/docs/user_guides/javascript/rigid_bodies
- `@dimforge/rapier3d-compat` on npm (build variants) — https://www.npmjs.com/package/@dimforge/rapier3d-compat
- rapier.js#287 (joint stiffness/damping inert) — https://github.com/dimforge/rapier.js/issues/287
- rapier.js#290 (no spherical angular limits) — https://github.com/dimforge/rapier.js/issues/290
- rapier.js#260 (revolute limits must be set on the joint) — https://github.com/dimforge/rapier.js/issues/260
- rapier.js CHANGELOG — https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md
- rapier CHANGELOG (JointAxesMask, contact params) — https://github.com/dimforge/rapier/blob/master/CHANGELOG.md
- `mattvb91/rapierjs-ragdoll` — https://github.com/mattvb91/rapierjs-ragdoll
- Colyseus releases (Vite plugin, 0.17/0.18) — https://github.com/colyseus/colyseus/releases
- Colyseus docs — https://docs.colyseus.io/
- `colyseus` on npm — https://www.npmjs.com/package/colyseus
- `@geckos.io/server` on npm + Socket health — https://socket.dev/npm/package/@geckos.io/server
- geckos.io repo — https://github.com/geckosio/geckos.io
- Damage numbers design — https://www.gamejuice.co.uk/articles/damage-numbers-satisfying-feedback
- Damage numbers in RPGs (Shweep) — https://shweep.medium.com/damage-numbers-in-rpgs-1f0e3b1bc23a
- Impact-feel feature study (Lin et al.) — https://faculty.washington.edu/zkwen/articles/lin22features.pdf
- Ragdoll stability practices — https://pulsegeek.com/articles/ragdoll-setup-and-stability-tips-for-reliable-collisions/
- Railway vs Render vs Fly.io 2026 — https://www.clientcues.com/competitors/compare/railway-vs-render-vs-fly-2026-07/
- Solo-dev hosting comparison — https://devtoolpicks.com/blog/railway-vs-render-vs-fly-io-solo-developers-2026
- Node.js SaaS hosting framework — https://nodejs.tech/posts/render-vs-railway-vs-flyio-nodejs-saas-hosting/
- Space Station 14 licensing (AGPL/MIT commit boundary) — https://github.com/AirFryerBuyOneGetOneFree/imp-station-14
- lichess/lila licensing — https://github.com/lichess-org/lila
- Open-source licenses for game developers — https://www.gamedevhub.dev/guides/open-source-licenses/

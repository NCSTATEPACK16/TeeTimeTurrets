# TeeTimeTurrets — Research Brief

Hand this file to a research-capable LLM (web search / deep research mode) as-is. It's
self-contained — no access to prior conversation or the codebase is assumed.

## Project context

TeeTimeTurrets is an open-source, browser-based arcade golf-combat game: Three.js for
rendering, Rapier (`@dimforge/rapier3d-compat`, WASM physics) for simulation, Vite +
TypeScript, zero external 3D assets (all geometry is procedural primitives — no .glb/.obj).
Core loop today: a stationary player aims, charges a swing, and releases to launch a golf
ball as a Rapier dynamic rigid body with CCD enabled, rolling/bouncing across a noise-based
heightfield terrain. Planned next: the player also pilots a golf-cart vehicle with a
tank-style rotating turret that swaps between club types (putter: fast/short-range/quick-
reload; iron: mid; driver: slow/long-range/huge-power/slow-reload), eventually multiplayer
over WebSockets with a server-authoritative model. Architectural reference/inspiration (not
a dependency): "Claude of Tanks," an open-source (mostly MIT, with a Reserved Content
carve-out for its procedural vehicle/world/geometry-QA code) Three.js tank-combat game whose
`AGENTS.md` documents a fixed 60Hz deterministic sim decoupled from a variable-rate renderer.

## Status after the first research pass

A research pass has landed and answered most of this brief. Decisions are recorded in
`docs/DECISIONS.md`; what each answer changed is noted below.

| # | Question | Status |
|---|---|---|
| 1 | Rapier ragdoll joint tuning | **Answered in shape, not in numbers** — still open, see below |
| 2 | Netcode library | **Answered** — Colyseus, `@colyseus/schema` delta-sync |
| 3 | Hit-marker UX | **Answered** — ease-out, 0.8–1.5 s, vertical stacking + X drift |
| 4 | Self-hostable WS hosting | **Answered** — Docker → VPS or Railway |
| 5 | Rapier cross-platform determinism | **Retired** — snapshot interpolation makes it moot |
| 6 | Licence choice | **Answered** — dual MIT client / AGPL-3.0 server |

**Question 1 is only half-answered and is the one to push on next.** The pass returned the
right *structure* — `SphericalImpulseJoint`/`RevoluteImpulseJoint`, high stiffness and
moderate damping to hold a pose, zero the motor force on an impact-impulse threshold to
collapse — but no actual stiffness, damping, limit, or threshold values, and those are the
part that does not transfer from general physics intuition. Phase 3 is blocked on numbers,
not on approach. Worth re-asking narrowly, with the structure above given as settled.

**Question 5 is retired rather than answered.** It asked whether `Math.sin`/`Math.cos` in our
own launch math breaks replicate-from-seed netcode. Since the server now owns the only
simulation and clients interpolate snapshots, no client ever re-simulates a shot, so the
question no longer gates anything.

## Original questions

1. **Rapier joint tuning for ragdolls.** For `@dimforge/rapier3d-compat` (JS/WASM bindings),
   what impulse-joint configuration (stiffness, damping, joint limits) produces a humanoid
   or simplified capsule-based ragdoll that (a) stays rigidly upright/static while
   undisturbed and (b) collapses into a stable, non-exploding, non-jittering tumble when
   struck by a fast-moving small rigid body (a golf ball)? Cite official Rapier docs/
   examples over general physics-engine intuition — joint parameters are engine-specific and
   don't transfer cleanly from e.g. Bullet/PhysX intuition.

2. **Current state of browser game-netcode libraries (as of now).** Re-confirm: is Colyseus
   (`colyseus` on npm) still the best-maintained, most solo-dev-friendly option for a
   server-authoritative room-based multiplayer game over WebSockets, versus raw `ws`,
   geckos.io (WebRTC/UDP), or any newer entrant? Cover: current version/maintenance activity,
   whether it still ships `@colyseus/schema` binary delta-sync, self-hosting story (Docker/
   any VPS vs. requiring their cloud), and license (must remain fully open-source-compatible,
   no cloud-service-only lock-in for the core framework).

3. **Hit-marker / floating combat-text UX conventions.** For arcade shooters and sports/
   party games showing a floating "+100" or "HOLE IN ONE!"-style text at a 3D-world hit
   location projected to 2D screen space: what timing/easing (rise distance, duration,
   fade curve) and stacking behavior (offsetting overlapping markers when multiple hits land
   near-simultaneously) is common practice? Prior art from shooters (e.g. Overwatch-style hit
   markers, MOBA damage numbers) and physics-comedy games ("What the Golf?", "Golf It!") is
   relevant.

4. **WebSocket-based multiplayer hosting options that stay self-hostable.** For a stateful
   Node.js WebSocket game server (not request/response), which hosts support a
   long-lived process with minimal vendor lock-in and a straightforward self-host fallback
   (plain Docker container deployable to any VPS)? Compare Fly.io, Railway, Render, and a
   bare VPS + Docker, specifically from an "an open-source project's contributors should be
   able to self-host a fork without depending on one company's proprietary platform" angle —
   explicitly deprioritize serverless/proprietary-platform-specific options (e.g. Cloudflare
   Durable Objects) that aren't portable to a generic host.

5. **Cross-platform determinism of Rapier under transcendental math.** Rapier's docs state
   its default WASM build is deterministic per-run but not guaranteed bit-identical across
   platforms unless using the separate `rapier3d-deterministic` build, and specifically flag
   `Math.sin`/`Math.cos` as not cross-platform-deterministic. If a game's own input math
   (e.g. computing a launch velocity from an aim angle via `Math.cos`/`Math.sin`) feeds into
   the simulation, does that alone break replicate-from-seed netcode (where every client
   simulates the same shot from an initial seed rather than receiving continuous position
   updates), or only affect it under specific conditions? What's the current recommended
   mitigation (fixed-point trig lookup tables, the deterministic build, or abandoning
   replicate-from-seed in favor of snapshot interpolation)?

6. **Open-source game license choice.** For a permissively-open community game project where
   the goal is maximum ease of reuse/forking (MIT/Apache-2.0 style) versus one where the
   goal is preventing a closed-source or SaaS-only fork from competing without contributing
   back (AGPL-3.0 style, relevant specifically because this is a networked multiplayer
   server, where AGPL's "modify and run as a service" trigger actually applies unlike a
   purely client-side MIT project): what are other comparable open-source browser/multiplayer
   game projects actually using, and what are the practical contributor-experience trade-offs
   of each for a project expecting to accept outside pull requests?

## Not research questions — flag these back, don't try to answer from literature

These need hands-on iteration against this specific codebase, not outside research. A
research LLM should say so rather than guess:

- Golf-cart movement model choice (kinematic character controller vs. dynamic rigid body
  with drive forces) — needs a short build-and-feel spike against this project's actual
  terrain, not a desk comparison.
- ~~Terrain height amplitude/noise frequency and ball damping/friction/restitution tuning.~~
  **Resolved** — see `docs/ROADMAP.md` Phase 0. Turned out to be measurable rather than
  purely felt: `npm run probe` reports terrain slope statistics and per-club carry/roll/settle
  numbers, which can be compared against published real-golf figures (fairway grades, roll/
  carry ratios) without a play session.
- Club balance numbers (exact min/max speed, charge time, reload time per club) — needs
  actual play sessions. One concrete lead for that session: the driver's roll/carry ratio is
  0.86 against a real-golf ~0.15, because 13° loft gives a near-symmetric trajectory and a
  13° descent angle. Try `loftDeg` 18–20 first.
- Whether this project's own code has drifted close enough to a Reserved-Content pattern
  from its reference repo to be a concern — needs a human diff/review of this project's
  actual files, not general research.
- Trademark clearance for the name "TeeTimeTurrets" — needs a jurisdiction-specific trademark
  search, not general web research, and isn't legal advice either way. **Downgraded from urgent
  by the 31 Aug 2026 rename** away from "CallofGolf", which was the phonetic play that made
  this pressing; see `DECISIONS.md`.

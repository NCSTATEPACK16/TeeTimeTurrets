# TeeTimeTurrets — Agent Rulebook

Structure and several conventions below are adapted from the reference repo
`Claude-of-Tanks-main/AGENTS.md` — that file, and its stated engineering conventions, are
general engineering documentation and MIT-licensed under that repo's own
`LICENSE-POLICY.md`. **Its procedural vehicle/world code and its `docs/geometry-gate/**`
system are NOT MIT** (see License note at the bottom) — nothing here copies from those
paths; only the documented conventions and this file's own structure are adapted.

## Overview

Browser-native Three.js + Rapier golf-combat game. Runtime combines a fixed-step 60Hz
deterministic simulation, procedural first-party geometry (clubs, cart, terrain, targets —
zero GLB/OBJ), and DOM-overlay UI. Phases 0 and 1.5 are built and verified; the rest is
scaffolding.

## Git

Superseded 31 Aug 2026. This file previously said never to run any git command; the project
now has a repository and agents may commit. Two rules replace the prohibition:

- **Every commit needs a DCO sign-off** (`git commit -s`) — see `CONTRIBUTING.md`.
- **Never put AI-session metadata in git.** No assistant co-author trailers, no session or
  chat URLs, no prompt text, no "generated with" footers — in commit messages, PR titles and
  bodies, or code comments. Commit messages describe the change and the reasoning a reader of
  the code needs; where a decision came from a conversation, write the decision, not the
  conversation. Existing history is the standard: match it.

## Architecture pointers

- `docs/ARCHITECTURE.md` — module boundaries, fixed-step math, ballistics formulas, hit-marker projection.
- `docs/ROADMAP.md` — phases and their pass/fail gates.
- `docs/UI-SPEC.md` — HUD and screen inventory derived from `docs/concept/`: which element
  comes from which shot, which phase owns it, which sim field feeds it. Read this before
  building any UI; do not re-derive intent from the images.
- `src/sim/`, `src/physics/` — authoritative, DOM-free, deterministic.
- `src/render/`, `src/entities/`, `src/ui/` — pure consumers of sim state.

## Conventions & invariants

- Units are meters, seconds, radians throughout. Aim yaw `0` points down world `+X`.
- Simulation advances at `FIXED_DT = 1/60` (`src/sim/world.ts`). Rendering is variable-rate.
- Any randomness reachable from `src/sim/**` or `src/physics/**` must be an injected,
  seeded PRNG — never `Math.random()`, never wall-clock time. (`Ballistics.applyAimSpread`
  already follows this: it takes `random: () => number` as a parameter.)
- `src/sim/**` and `src/physics/**` must stay Node-runnable: no `three`, no `window`, no
  `document`. This is what keeps "add a multiplayer server" a matter of running the same
  module in Node rather than a rewrite (see `docs/ARCHITECTURE.md` §1).
- No per-frame allocation in the fixed-tick hot loop (`Sim.step`, `GameLoop`'s `frame`).
  Reuse scratch objects (see `main.ts`'s `scratchA/B/Out` quaternions for the pattern).
- All playable geometry (clubs, cart, terrain, future targets) is first-party procedural
  primitives assembled at runtime. No `.glb`/`.obj`/`.fbx` in the playable path, ever.
- **CCD is enabled on the ball and nothing else.** It only engages for fast relative motion,
  which ragdoll limbs at rest don't have, and it isn't free.
- **Rapier JS binding caveats — verified against issues, not assumed from the Rust docs.**
  `JointData.stiffness` and `JointData.damping` are present but **inert** (rapier.js#287);
  spherical joints have **no angular limits** (#290); revolute limits must be set on the
  **created joint object**, not on `JointData` (#260), or they silently do nothing. Spherical
  joint motors were removed at 0.12-alpha with no clear restoration — verify at runtime before
  relying on them. Anything that looks like it should hold a pose via joint parameters does
  not work; hold poses with body type instead (`docs/DECISIONS.md` "Ragdolls").
- **Licensing is split by directory** and the split is load-bearing: `src/**` and `tools/**`
  are Apache-2.0, `server/**` is AGPL-3.0-or-later. AGPL code may import Apache-2.0 code;
  **the reverse must never happen.** Shared logic lives in `src/sim/**` or `src/physics/**`.
  See `LICENSES.md`. Every commit needs a DCO sign-off (`git commit -s`) — see the Git section
  above.
- New sim/physics logic gets a colocated test. This project doesn't have a test runner wired
  up yet (Phase 1 should add one — Vitest is the natural fit given the Vite toolchain); until
  then, any new pure function in `Ballistics.ts` should at minimum be exercised by the
  headless-browser trajectory check pattern used to validate Phase 0 (see git-free session
  history / ask the user for the verify.mjs pattern) before being declared done.
- `tsc --noEmit` (aliased as part of `npm run build`) must be clean before any change is
  considered finished. `strict: true`, `noUnusedLocals`, `noUnusedParameters` are all on —
  don't relax them to make an error go away.

## Testing invariants & failure conditions

- A change to `src/sim/**` or `src/physics/**` that makes `tsc --noEmit` fail, or that
  introduces a `three`/DOM import into either directory, is a failed change — revert or fix,
  don't ship it.
- A change to ball/terrain physics tuning must be re-verified for tunneling: launch a
  full-power shot and confirm the ball's Y position stays bounded (doesn't diverge toward
  free-fall) through flight and settling. This caught nothing wrong in Phase 0, but it's the
  cheapest real signal available before a human plays it — don't skip it after a physics
  parameter change.
- **Resource cleanup.** Every `THREE.Mesh`'s `geometry` and `material` must be `.dispose()`d
  when the mesh is discarded (see `GolfClub.dispose()` for the pattern — `traverse` + dispose
  geometry and material(s), materials can be an array). Every Rapier `RigidBody`/`Collider`
  created outside `Sim.create()`'s one-time setup must have a corresponding removal path.
  `InstancedMesh` buffers (Phase 3+ grass/particles/targets) follow the same rule: dispose on
  teardown, not just on process exit.

## Visual Critic / Scene Gate protocol

The reference repo has a real, confirmed procedural-geometry gate: its `AGENTS.md` states
*"Any playable tank addition or geometry/profile change must run the complete combat-anatomy
procedure: `npm run tank:anatomy:update`, `npm run tank:anatomy:check`, then the targeted
`npm run tank:release:check -- --ids=<ids> --gate`."* The `--gate` flag and the two-step
update/check pattern confirm this blocks on failure rather than just reporting. **Its actual
comparator internals are Reserved Content under that repo's license policy** (`docs/
geometry-gate/**` is explicitly excluded from the MIT grant) — this project does not have
access to how it works and must not try to reverse-engineer or approximate its specific
mechanism from the reference repo's files. What follows is an independent design, inspired
only by the general idea "gate procedural geometry changes on an automated check," built
fresh for this project's own needs:

1. **`tools/sceneGate.mjs`** (Phase 1+, not yet built): headless Chrome (Puppeteer — already
   proven to work in this dev environment for the Phase 0 verification pass) loads the dev
   build with a fixed camera, fixed lighting, and a seeded RNG for whatever entity is under
   test (a club head, the cart, a terrain patch, a target ragdoll).
2. Captures: a screenshot, and structural metrics read directly off the `THREE.BufferGeometry`
   — vertex count, triangle count, bounding-box dimensions.
3. Compares metrics against a checked-in baseline (JSON) with a tolerance band, and the
   screenshot against a checked-in baseline PNG via perceptual diff (pixel-delta threshold,
   not exact match — antialiasing/driver differences are expected noise).
4. Fails (non-zero exit) if either check drifts past threshold without an explicit baseline
   update (`--update-baseline` flag, requires a human to review the diff first).
5. Wire into `npm run build` once it exists, so a geometry regression is caught before it's
   called done — not after a human happens to notice a club looks wrong.

## Gotchas / never-do-X

- Never let `src/render/**` or `src/entities/**` mutate `Sim` state directly — go through an
  explicit method (`sim.launch(...)`, `sim.reset(...)`), never reach into `sim.ball` etc.
- Never call `Math.random()` inside `src/sim/**` or `src/physics/**`.
- Never add a second source of truth for a club's stats — `Ballistics.CLUB_STATS` is
  canonical; `GolfClub.ts`'s visual geometry switches on `ClubType` for looks only, it must
  not duplicate numbers.
- Never treat a screenshot-only "it renders" check as proof physics is correct — verify a
  live trajectory (numeric position over time), the way Phase 0 was validated, before
  claiming a physics change works.
- Never tune `JointData.stiffness`/`.damping` or expect spherical angular limits — both are
  no-ops in this binding (see invariants above). Code that appears to work because it compiles
  is the failure mode here; there is no runtime error to catch it.
- Never enable CCD on anything but the ball, and never let adjacent ragdoll capsules collide
  with each other — the second one is the usual cause of a ragdoll that buzzes forever.
- Never place code in `server/` that the client also needs; it crosses the Apache→AGPL
  boundary the wrong way. Put it in `src/sim/**` and import it.
- Never commit without a DCO sign-off, and never put session URLs, prompt text, or assistant
  co-author trailers in a commit message or PR body. See the Git section near the top.

## License note (important, verified against actual repo files, not just the README)

### This project

Split by directory — `src/**` and `tools/**` Apache-2.0, `server/**` AGPL-3.0-or-later. Full
map, reasoning, and trade-offs in `LICENSES.md`; attributions in `NOTICE`; contributor
sign-off in `CONTRIBUTING.md`. The import direction (AGPL may depend on Apache, never the
reverse) is what keeps the boundary clean.

**Any code ported from another project needs a `NOTICE` entry in the same change.** MIT and
Apache-2.0 both permit reuse and both require the notice to travel with the code. A
reimplementation from a public interface is not a derivative work; a close port is.

### The reference repository

Claude-of-Tanks is **not** blanket-MIT. Its `LICENSE-POLICY.md` states MIT applies to
first-party code/tests/build-tools/general docs, **except** an explicit Reserved Content
list under a separate proprietary license:

```
src/vehicles/**   src/world/**   docs/geometry-gate/**   docs/references/**
docs/research/**  docs/images/** docs/BUILD-STANDARD.md  docs/TANK-ASSET-PIPELINE.md
docs/VEHICLE-ROSTER.md  docs/SCREENSHOT_CONTRACT.md  docs/SHOWCASE-LIBRARY.md
docs/MARKETING-BATTLE-CAMPAIGN.md  public/audio/** public/brand/** public/fx/**
public/icons/** public/maps/** public/media/** tools/marketing-shots/**
```

That list covers exactly the pieces most tempting to port for this project: procedural
vehicle geometry/profile code, world/terrain generation code, and the geometry-gate QA
system. **Do not copy or closely adapt code, JSON structure, or documentation from those
paths into this project.** Conceptual inspiration (the existence of a fixed-step sim, the
existence of a geometry gate, the module-split idea) is fine and is what this project
already draws on; literal reuse of Reserved Content is not licensed. `src/sim/`, `src/net/`,
`src/engine/`, `AGENTS.md`'s own structure, and general engineering conventions are MIT and
fair to adapt with attribution.

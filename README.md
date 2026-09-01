# TeeTimeTurrets

An open-source, browser-based arcade golf-combat game. Three.js for rendering, Rapier
(`@dimforge/rapier3d-compat`) for physics, Vite + TypeScript, zero external 3D assets —
every club, cart, and terrain patch is procedural geometry, no `.glb`/`.obj` in the playable
path.

**Status: early. Phases 0 and 1.5 are done; Phase 1 is partly done.** There is a playable
golf loop — a stationary swing (aim, charge, release) launches a physics-simulated ball across
a noise-generated heightfield, across green/fairway/rough/sand/water surfaces that each roll
and bounce differently, into a cup, with stroke counting and a water penalty. There is no
cart, no turret, no targets, no UI beyond a power bar, and no multiplayer. `docs/ROADMAP.md`
is the honest account of what exists versus what is planned, phase by phase, with the pass/fail
gate each phase had to clear.

Formerly called *CallofGolf*; renamed August 2026.

## Running it

```
npm install
npm run dev
```

Open the printed local URL. Controls: arrow keys to aim, hold Space to charge a swing,
release to launch, R to reset the ball.

`npm run build` type-checks (`tsc --noEmit`) and builds a production bundle.

## Project layout

- `src/sim/`, `src/physics/` — authoritative, deterministic, DOM-free simulation. No
  `three`, no `window`/`document`, no unseeded randomness.
- `src/render/`, `src/entities/`, `src/ui/` — pure consumers of simulation state.
- `src/engine/GameLoop.ts` — the fixed 60Hz tick / variable-rate render split everything
  else is built on.
- `docs/ARCHITECTURE.md` — module boundaries and the math behind the tick loop, ballistics,
  and screen-space hit-marker projection.
- `docs/ROADMAP.md` — phases 0–5, each with a concrete pass/fail gate.
- `docs/UI-SPEC.md` — the HUD and screen inventory: every element mapped to the concept shot
  it comes from, the phase that owns it, and the sim field that feeds it.
- `docs/DECISIONS.md` — the small set of choices later phases must preserve or deliberately
  reverse, including several where the obvious approach does not work.
- `docs/BACKLOG.md` — everything not on the committed critical path.
- `docs/RESEARCH-NEEDED.md` — open questions still being investigated.
- `docs/concept/` — concept art. **Reference only; never loaded by the game.** AI-generated
  and tracked by provenance rather than licensed — read that folder's `README.md` before
  assuming you may ship any of it.
- `AGENTS.md` — conventions for anyone (human or AI agent) working in this repo, including a
  license-boundary note about this project's architectural reference material.

## Contributing

See `CONTRIBUTING.md` and `AGENTS.md`. Short version: `tsc --noEmit` must stay clean, sim/
physics code stays deterministic and engine-agnostic, and geometry stays procedural.

## License

**Split by directory.** `src/**` and `tools/**` — the client, engine, and simulation — are
**Apache-2.0** (`LICENSE`), so the parts worth learning from are maximally reusable. The
future `server/**` is **AGPL-3.0-or-later** (`server/LICENSE`), so a modified public server
has to publish its modifications. `LICENSES.md` has the full map and the trade-offs; `NOTICE`
has attributions.

Contributions require a DCO sign-off (`git commit -s`) — see `CONTRIBUTING.md`.

(The Claude of Tanks repository used for architectural research is **not part of this repo** —
it sat alongside it as a sibling directory during development, and `docs/REUSE-MAP.md` refers
to paths inside *it*, not inside this project. It is *not* MIT for all paths; see the license
note in `AGENTS.md` before porting anything from it.)

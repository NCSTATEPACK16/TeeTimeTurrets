# `server/` — authoritative game server

**Nothing is built here yet.** This directory exists ahead of its code for one reason: it is
the license boundary, and the boundary has to exist before the code does.

`server/**` is licensed **AGPL-3.0-or-later** (`server/LICENSE`). Everything outside this
directory is Apache-2.0. See `../LICENSES.md` for the full map and the reasoning.

> Do not create files here that belong on the other side of the line. Anything the client
> also needs — simulation, physics, protocol types — lives in `src/sim/**` or `src/physics/**`
> under Apache-2.0 and is *imported* by this server. That import direction is what keeps the
> boundary clean: AGPL code may depend on Apache-2.0 code, and the reverse must never happen.

## What lands here (Phase 5 — see `../docs/ROADMAP.md`)

A Node process that imports `src/sim/**` unmodified and runs the one authoritative Rapier
simulation, plus the Colyseus room and `@colyseus/schema` state definitions. That the sim can
already run headless is not an assumption — `npm run probe` does it today, which is the
whole payoff of the DOM-free rule in `AGENTS.md`.

Do not start this before Phase 4's gate is green. `docs/ROADMAP.md` Phase 5 explains why
building it early is a rewrite rather than a head start.

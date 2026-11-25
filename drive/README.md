# GolfCartSimulator (free drive)

Drive a golf cart around a believable Piedmont golf course, slow and scenic or sideways through a bunker. See `PRD.md` for the product plan and `CLAUDE.md` for working rules.

This is TeeTimeTurrets' free-drive mode. It lives in `drive/` with its own pnpm workspace and Python pipeline, and the site build serves it at `/drive/`: pick Chill or Joyride on TeeTimeTurrets' Choose Your Ride. Licensed Apache-2.0 like TeeTimeTurrets' client code (see the repo-root `LICENSES.md`); third-party data and assets are listed in `ATTRIBUTION.md`.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | The game: three.js (`three/webgpu`, TSL) + Rapier, Vite, TypeScript |
| `packages/level-schema` | Level packet v0.2: JSON Schemas (source of truth), TS types, validators |
| `pipeline` | Python 3.12 (uv) course pipeline; M0 ships the `gce-dummy` synthetic packet |

## Commands

Requires Node 22.12+, pnpm 10, and uv.

```sh
pnpm install
(cd pipeline && uv sync)

pnpm --filter web dev          # http://localhost:5173  (?debug=1, ?tune=1, ?mode=joyride, ?level=<id>)
pnpm -r build
pnpm -r test
pnpm -r typecheck
pnpm -r lint

(cd pipeline && uv run gce-dummy --out ../apps/web/public/levels/dummy-01)
(cd pipeline && uv run pytest -q)
(cd pipeline && uv run ruff check .)

pnpm --filter web smoke        # build + headless Chromium smoke + screenshots to docs/screens/m1
                               # (Chromium from $CHROMIUM_PATH, /opt/pw-browsers, or installed Chrome)
```

## Controls

| Action | Keyboard | Gamepad (standard mapping) |
| --- | --- | --- |
| Throttle | W / Up | Right trigger |
| Brake, then reverse | S / Down | Left trigger |
| Steer | A D / Left Right | Left stick |
| Handbrake (drift) | Space | A / Cross |
| Boost (Joyride) | Shift | Right bumper |
| Switch Chill / Joyride | M | Back / Select |
| Reset to spawn | R | Y / Triangle |

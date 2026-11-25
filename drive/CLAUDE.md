# CLAUDE.md — GolfCartSimulator (free drive)

This is TeeTimeTurrets' free-drive mode, in `drive/` of the TeeTimeTurrets repo since 2026-11-25
(moved from the GolfCartSimulator repo, which is frozen). Run every command below from `drive/`.
Git and PRs follow the repo-root `AGENTS.md`: DCO sign-off on every commit (`git commit -s`), no
AI-session metadata in commits, PRs or comments, and that file's branch rules; they replace this
file's branch naming. The site build (`npm run build` at the repo root) builds this app into
`dist/drive/`; TeeTimeTurrets' title opens it with `?level=tee-time-links&mode=<ride>&menu=0&home=/`.

Read PRD.md sections "Vision and modes" and the CURRENT milestone only. Don't read ahead.

Current milestone: M2 (handoff notes: docs/handoff/M2.md)

## Commands
- Install: pnpm install · (cd pipeline && uv sync)
- Web: pnpm --filter web dev · pnpm -r build · pnpm -r test · pnpm -r typecheck · pnpm -r lint
- Pipeline: (cd pipeline && uv run gce-dummy --out ../apps/web/public/levels/dummy-01) · uv run pytest -q · uv run ruff check .
- Real course: (cd pipeline && uv run gce-fetch-dem --course tee-time-links && uv run gce-route --course tee-time-links && uv run gce-author --course tee-time-links && uv run gce-course --course tee-time-links --stage full --out ../apps/web/public/levels/tee-time-links) · GCS_LEVEL=tee-time-links pnpm --filter web test
- Blender tools (local only): (cd tools/blender && uv run python export_asset.py <file.blend>)

## Conventions
- three.js from three/webgpu; shaders in TSL only (no ShaderMaterial, no onBeforeCompile); post via RenderPipeline.
- All water uses the afl_ext Shadertoy ocean port (env/oceanWaves.ts, Shadertoy MdXyzX); tune it in envConfig.water.
- Vanilla TS, no React in the game loop. Physics must run in Node (Vitest).
- Rapier: @dimforge/rapier3d-compat, pinned. Fixed 60 Hz step. Heightfield is column-major (see heightfieldCollider.ts).
- Meters, +Y up, north = -Z. Heights only from the level packet.
- Every tunable number lives in a config file (cartTuning.ts, surfaces.ts, tiers.ts), never inline.
- No runtime fetches to third-party hosts. No symlinks. LF endings.

## Verification
- Paste the exact command and summary line for every test run. "Should work" is not evidence.
- Visual work: screenshots to docs/screens/m<N>/ when a browser is available; otherwise say so.

## Gates
- Branch m<N>-<slug>. At milestone end: checklist with evidence → PR → STOP.
- Do not start M<N+1> until John writes "APPROVED M<N>".
- Blocked by network? Stop and name the domain. Don't work around it.

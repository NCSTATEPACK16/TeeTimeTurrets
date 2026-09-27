# Claude of Tanks: reference only

These files are copied verbatim from Claude of Tanks `src/engine/` and are MIT-licensed. `LICENSE` in this folder is the notice. They are stored as `.ts.txt` so they are never compiled, linted or bundled.

| File | Upstream | Read it for |
|---|---|---|
| `sky.ts.txt` | `src/engine/sky.ts` | Procedural sky dome, PMREM env bake, fog colour read from the horizon, and the NaN guard for iOS env maps |
| `lighting.ts.txt` | `src/engine/lighting.ts` | CSM setup order, hemisphere bounce, per-preset shadow sizes |
| `quality.ts.txt` | `src/engine/quality.ts` | Quality presets as data, device-tier pick |
| `cameraRig.ts.txt` | `src/engine/cameraRig.ts` | Spring-followed pivot, terrain-aware pull-in, trauma shake |
| `post.ts.txt` | `src/engine/post.ts` | HDR target → AO → bloom → ACES → SMAA chain order (includes AMD FSR1, MIT) |

## Rules
- **Adapt in small pieces.** Each of these files pulls in a web of CoT modules that is not here. Lift a technique or a function, not a file.
- **Anything that lands in `src/` needs a `NOTICE` entry** in the same commit. Use the form given in `NOTICE`.
- **Never add files from Claude of Tanks' Reserved Content paths** (`src/world/**`, `src/vehicles/**`, `docs/research/**` and the others listed in `AGENTS.md`). Techniques from those areas are described by name in `docs/REVAMP-PLAN.md`. Write them from scratch.

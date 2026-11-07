# Next session: Stage 3.5, after 3.5a

Written 2026-11-07, at the end of Stage 3.5a. Paste this file, or point the session at it. It
supersedes `docs/NEXT-SESSION-PROMPT.md` until Stage 3.5 is done; that file is still the Stage 4
prompt, for afterwards.

---

## Start here

1. **Read:**
   - `AGENTS.md`, for the rules, the DCO sign-off and the 15 s / 60 s testing policy;
   - `docs/HANDOFF.md`;
   - `docs/REVAMP-PLAN.md` § Stage 3.5;
   - `docs/DECISIONS.md` § "Stage 3.5";
   - `docs/TEST-AND-SPEC-PITFALLS.md`, before writing any test.
2. **Check PR #87** (`NCSTATEPACK16/TeeTimeTurrets`, branch `claude/sharp-feynman-bzzp7s`).
   - **Unmerged, and no play-test notes from the user:** ask for the 3.5a play-test, then stop.
     Don't start 3.5b on top of an untested slice.
   - **Unmerged, with notes:** fix them on #87's branch first, push, and ask for a re-test.
   - **Merged:** branch 3.5b fresh from `main`. The user chose merge-first, so don't stack on the old
     branch.
3. **Check the asset hosts.**
   - Run `curl -sI https://kenney.nl | head -1`. The user said they will allow kenney.nl,
     opengameart.org and ambientcg.com in the environment's Network access.
   - If they still return 403 from the proxy, tell the user and stay procedural. Don't fake the
     assets.

## Where things stand

Stage 3.5a, "match pacing, juice, battlefield presentation", is built and in draft PR #87. It has not
been play-tested yet (user, 7 Nov). **The golden did not move**: the countdown defaults to 0 in
`Sim.create`, and everything else is render, UI or audio.

| Commit | What |
|---|---|
| `5902b56` | Pre-match countdown (`Match.phase`), final-30 ramp, golf-named streak callouts, hitstop with impact veil, H horn |
| `c26f3db` | Sprite particles: fireball, wreck smoke, confetti, scorch decals, muzzle and impact smoke, tracers, tyre roost, landing puffs |
| `402cf13` | Procedural marching-band music bed with intensity layers, plus wind, birds and crowd ambience |
| `193d091` | Distant barrages (boom delayed at the speed of sound) and flares over the clubhouse |
| `4f2d4f4` | 72 knockable tee props (render-only, no collider) |
| `2de3da9` | Docs (plan, decisions, UI-SPEC, backlog, handoff); H added to the controls card |

New modules, all following the existing patterns: a pure, node-tested half and a thin three.js or DOM
half, with no allocation per frame.

| Area | Files |
|---|---|
| Sprites | `src/render/spritePool.ts` (pure), `spriteParticles.ts` (one instanced billboard draw, fogged), `spriteAtlas.ts` (painted 4 × 2 atlas), `fxRandom.ts` (seeded, never fed to the sim) |
| Motion effects | `src/render/trails.ts` (roost, tracers, landing puffs from frame deltas) |
| Ambience | `src/render/battleAmbience.ts` |
| Props | `src/render/knockState.ts` (pure), `knockables.ts` |
| Audio | `src/audio/music.ts` (`MusicBed`, `musicIntensity`); new cues in `audioEngine.ts` |
| UI | `src/ui/countdown.ts`, `src/ui/streaks.ts`; `BannerFeed.push` |
| Hooks | `MatchScreen.updatePacing` / `onKillPacing` / `hitstop`; `RenderScene.battle`, `onPropKnock` |

Smoke checks: `world.countdown.test.ts`, `streaks.test.ts`, `spritePool.test.ts`, `music.test.ts`,
`battleAmbience.test.ts`, `knockState.test.ts`. On the last run the full `npm test` was 110 files and
1113 tests in 55 s on Linux cloud.

## The user's decisions (grilled 7 Nov 2026; don't relitigate)

| Question | Answer |
|---|---|
| 3.5a play-test | **Not played yet.** Wait for the notes before building 3.5b. |
| Art direction for the course | **Toy style, but richer.** Keep the approved soft-bevelled toy look (`docs/art/STYLE-RESEARCH.md` P1–P6); add real textures, animated water, dense swaying woods and moving grass. Not photoreal. |
| 3.5b priority | All four matter. If only two fit before the next play-test: **water and trees first**, then sand, then ground and grass. |
| CC0 asset hosts | **The user will allow** kenney.nl, opengameart.org and ambientcg.com. Download the Kenney Particle Pack and Smoke Particles, plus an ambientCG sand set if `Ground093C` doesn't read as sand. Record each in `LICENSES.md` and `NOTICE` in the same commit. |
| Mortar (3.5c) | **A killstreak reward**, not a course pickup. Granted at a 3-kill streak (ON THE GREEN). Sim state, so it moves the golden. |
| Capture flags (3.5c) | **As planned:** 3 flags on arena greens, 12 m radius, 6 s capture, contested pauses. Holding 2 or more bleeds the other side 1 stroke every 20 s. Fewest strokes still wins. |
| PR flow | **Merge 3.5a first.** Each sub-stage gets its own branch from `main` and its own draft PR. |

## 3.5a play-test list (from #87, `?match=60`, each item 60 s or less)

1. The countdown holds the cart and lets you aim; FORE! releases it.
2. A kill hitches briefly, with a flash, fireball, confetti, lingering smoke and a scorch mark.
3. Ball tracers and tyre roost (turf, sand, spray) show.
4. The music starts at FORE!, builds with kills and speeds up in the final 30, with a FINAL 30 banner.
5. Distant booms come after their flashes.
6. Driving through tee markers or a ball washer knocks them over.
7. H honks.

If the user says it's too much, the knobs are:
- the `TRAUMA_*`, `HITSTOP_*` and `FLASH_*` constants in `MatchScreen.ts`;
- the specs at the top of `effects.ts`;
- `musicIntensity` in `music.ts`.

## 3.5b: the living course (render only; the golden must not move)

Work in this order. Each item gets **one** smoke check of 15 s or less. Write the code from scratch:
Claude of Tanks Reserved Content is off-limits (`AGENTS.md` licence note). Techniques are in
`REVAMP-PLAN.md` § Stage 5.

1. **Water**, new file `src/render/water.ts`.
   - Geometry: one plane per pond polygon, from the water data the sim already uses (`sim/hazards.ts`
     and `surfaces`).
   - Shader:
     - two scrolling procedural normal layers;
     - fresnel against `scene.environment`;
     - shallow-to-deep teal, matching shot 03 and **not** the grey `restyle-chase-01` water;
     - a shore-foam band from a baked per-vertex distance-to-edge attribute, so no depth texture is
       needed on any preset;
     - ripple rings from a uniform array of the last 8 splashes, fed by `splash` events and by
       `MotionTrails` water landings.
   - Today water is only a colour tint in `groundShader.ts` (mask channel A). Keep the tint under
     the plane.
2. **Trees**, in `src/render/Trees.ts` and `courseDressing.ts`.
   - Replace the jittered 6 m grid with per-hole blue-noise placement. That also fixes the row-major
     `MAX_TREES` cap, which starves the north holes.
   - Clumps of 3–7 conifers on the rough, and denser stands between holes as cover.
   - Drop `flatShading`, per the P1 amendment.
   - Per-instance tint and scale.
   - Height-weighted vertex wind sway.
   - Cap from `quality.treeCap`, which nothing reads yet.
   - Reject trees on fairway, green, water and path.
   - **Stop after water and trees if the session is running long.** Push, open a draft PR with a
     play-test list, and stop.
3. **Sand.**
   - Bunker texture (`Ground093C`, or an ambientCG set) in `groundShader.ts`, with a darkened
     raised-lip rim.
   - Wind-blown drift sprites skimming each bunker, through `EffectsLayer.smoke`, capped per preset.
   - `sandPlume` already exists.
4. **Ground and grass.**
   - Wire the CC0 terrain sets in `public/textures/terrain/` into the splat. Nothing references them
     today.
   - Anti-tiling: a rotated second sample under a noise mask.
   - Slope-driven rock, and a distance detail fade. Keep the mow stripes.
   - New file `src/render/grassCarpet.ts`: a camera-following ring of 16 m cells out to ±48 m, wind
     blades, rough and fairway edges only, density from `quality.grassDensity`.
5. **Assets.** Once the hosts work:
   - Download into a fresh empty directory in the scratchpad.
   - Repack about 8 Kenney sprites into the existing 4 × 2 layout with a new `tools/packFxAtlas.mjs`,
     writing `public/textures/fx/fx-atlas.png` at under about 300 KB.
   - Load it in `spriteAtlas.ts` behind a fallback to the painted cells.
6. **Ambient life**, if there's time: bird flocks that scatter at blasts, fairway sprinklers, waving
   flag cloth, pollen motes.

For the PR, record draw calls and frame time on Med from the `?perf` dev hook
(`window.__teetimeturrets.perf`).

## 3.5c: new warfare rules (sim; moves the golden once)

1. **Mulligan Mortar, as a killstreak reward.**
   - The sim tracks each cart's kill streak, reset on death. A 3-kill streak grants one charge.
   - Firing: a key (proposed **G**, so confirm it) fires at the turret-aim landing point. Reuse
     `previewTrajectory`, clamped to 70 m.
   - A 2 s telegraph emits a `mortarMarked` event. The render shows a red flare (`EffectsLayer.flare`
     exists) and a ground ring everyone sees.
   - Then 6 balls inside 8 m over 1.5 s:
     - positions from a seeded `hashChannel` channel;
     - balls from `BallPool`;
     - owner-attributed, with friendly fire off.
   - Bots fire it when 2 or more enemies are within 10 m of each other.
   - Smoke: `mortar.test.ts`. Deterministic per seed, 6 balls in radius after the delay, no friendly
     damage.
2. **Capture flags**, new file `src/sim/captureFlags.ts`.
   - Placement: A/B/C on the greens of arena holes 1, 10 and 18.
   - Add `Match.addStroke(team)`, and `flagCaptured`/`flagLost` events.
   - HUD badges with progress rings in the score strip, and a banner and horn on capture.
   - Flag cloth recoloured to the owner.
   - Bots head for unowned flags when no enemy is in range, split by `botIndex`.
   - Smoke: `captureFlags.test.ts`. Capture time, the pause while contested, and the bleed rate.
3. **Golden.** Push, read `expected N to be M` from the failing CI run, and record N in a follow-up
   commit. Say why in both messages. Run the AGENTS physics tunnelling re-check: a full-power shot,
   with Y staying bounded.
4. Record both rule changes in `DECISIONS.md` and `UI-SPEC.md`.

## Open questions for the user (ask; don't guess)

- **Mortar key:** G, or something else? And should firing it need the turret aimed, or click a spot
  on the M map?
- **Streak and mortar together:** should the ON THE GREEN callout also say "MORTAR READY", or should
  each have its own banner?
- **Flags on the M map:** show them, with owner colours?
- **Effects per preset:** should sprite capacities and ambience scale with Low/Med/High? Today they're
  fixed: 1,200 smoke and 500 glow sprites.
- **After 3.5c:** straight to Stage 4 (handling feel and arena zone), or another round of feel
  tweaks first?

## Environment notes (cloud)

- Install: `PUPPETEER_SKIP_DOWNLOAD=1 npm ci --ignore-scripts`. The postinstall Chrome download
  isn't needed.
- Headless check: Playwright Chromium is preinstalled. Launch it with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
  - The first match build takes about 60–120 s under swiftshader.
  - Start a match by clicking the title's PLAY button.
  - Then click **GOT IT** on the controls card. A partial localStorage seed is ignored; the full
    object is `{"version":2,"quality":"high","seenControls":true}`.
  - The dev hook is `window.__teetimeturrets` (`sim`, `render`, `perf`, `screen`).
- Known harmless console warnings: the PCFSoftShadowMap deprecation, and swiftshader's "GPU stall
  due to ReadPixels".
- Git:
  - always `git commit -s`;
  - stage files by name;
  - no AI-session metadata in commits or PR bodies (`AGENTS.md` § Git).

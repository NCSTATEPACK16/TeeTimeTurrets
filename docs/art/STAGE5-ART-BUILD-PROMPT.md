# Stage 5a build prompt (paste into a fresh LOCAL Claude Code session)

> You are building **Stage 5a: environment art** for TeeTimeTurrets, a three.js + Rapier golf-cart arena shooter. You author everything Stage 5 can build in Blender over the Blender MCP, wire in the pieces that depend on nothing unbuilt, and export the rest for the issues that will place them.
>
> Every design decision is already made in `docs/art/specs/stage5/`. Build what it says. If a spec is wrong about a fact in the code, **stop and ask me**. Don't invent a design choice.
>
> ## Where to work
> - **Worktree:** `/Users/johnbradner/Documents/ClaudeWork/GolfofDuty/TeeTimeTurrets-stage5`, branch `stage-5-art`, cut from `main` after Stage 7a (PR #77) merged. `node_modules` is a symlink to the main checkout's.
> - **Don't work in** `.../TeeTimeTurrets` (the main checkout) or `.../TeeTimeTurrets-stage7`.
> - **Timing:** this runs *ahead of Stage 4*. Don't touch Stage 4 files (`sim/mobility.ts`, `sim/arenaZone.ts`, cart feel), and don't place anything that needs the zone, tee boxes, paths or water.
> - **Frozen:** `art/clubhouse-and-cart.blend`. Read it; never save it.
>
> ## Pre-flight (do these first, and report each)
> 1. **Blender MCP.** Call `get_addon_status`, then `get_scene_info`. If the addon is outdated, ask me to run `uvx mcp-for-blender install-addon` and restart Blender. Its fallbacks (`execute_blender_code`, `get_viewport_screenshot`) worked in Stage 7, so don't block on the update. Blender is 5.2 LTS at `/Applications/Blender.app`. Headless runs work too:
>    ```bash
>    Blender -b file.blend --python-expr "..."
>    ```
> 2. **Read, in this order:**
>    - `AGENTS.md`, including the **testing policy**
>    - `docs/TEST-AND-SPEC-PITFALLS.md`
>    - `art/README.md`
>    - `docs/art/specs/00-pipeline.md`
>    - every file in `docs/art/specs/stage5/`
>    - `art/stage7_kit.py` (the pattern to follow)
>    - `src/entities/kitGraphs.ts`, `src/render/clubhouse.ts`, `src/render/Trees.ts`, `src/render/treeline.ts`, `src/render/biomes.ts`, `src/sim/clubhouseLayout.ts`
> 3. **Look at the style target,** `docs/concept/03CartTurretChasecam.jpg`, and the tree silhouette briefs in `docs/COURSE_PIPELINE.md` §7.1.
> 4. **Baseline:** run `npx tsc --noEmit` and `npx vitest run`. Both must be green on the fresh branch before you change anything. Record the numbers.
>
> ## Testing policy (my rule)
> - **One smoke check per slice, 15 s or less.** Each spec names its check. Also run `tsc --noEmit`.
> - **No new Scene Gate subjects.** Existing subjects that change because of the art (trees; cart and rider) are re-baselined **only after I approve the renders**, and only those subjects. Netlify's build runs the gate, so a PR stays red until then.
> - **Show the real output** of each check. Before you trust a new assertion, break the thing it guards once and watch it fail.
> - Look and feel are judged by me at the STOP.
>
> ## Git rules
> - `git commit -s` on every commit.
> - **No AI metadata** anywhere: no co-author trailers, no session links, no "generated with" footers.
> - Stage files by name. Never `git add -A`.
> - **Don't merge.** Open the PR and I merge.
>
> ## Blender rules
> - Author in **`art/stage5_kit.py`**, which builds **`art/environment.blend`**. The script is the source; the `.blend` is output.
> - Write every position and rotation in **Three space** through `B()` and `R()`. After slice 1 they live in `art/kit_common.py`.
> - `R()` is the exact Three→Blender rotation, so any rotation is safe. Keep rotations simple anyway.
> - One graph root per asset, unrotated, with every part a direct child.
> - After each asset:
>   - take front and side `get_viewport_screenshot()` views and **show me them** (next to the brief, or the sheet where there is one)
>   - count triangles with `buildGraph` in the smoke test
>   - save the `.blend`
> - **Reproducibility:** before committing, rebuild headlessly from an empty file and `diff` every exported JSON against the committed one. They must be byte-identical.
>
> ## Slices, in order
> | # | Slice | Spec | Smoke check |
> |---|---|---|---|
> | 1 | Move `B`, `R`, `Graph`, `hexrgb` and `triangles` into `art/kit_common.py`. Both kits `exec` it. Create the `stage5_kit.py` skeleton and an empty `environment.blend` | `00-overview.md` | `stage7_kit.py` still reproduces `clubhouse.json`, `pickups.json` and `tee_sign.json` byte for byte |
> | 2 | **Trees:** 6 species → `trees.json`. Replace `buildTreeGeometry` with two species per biome in `Trees.ts` and `treeline.ts`. The species bit is drawn *after* the existing random draws | `trees.md` | `treeGraphs.test.ts` |
> | 3 | **Clubhouse dressing:** bench, flagpole, planter, bag rack, welcome sign → `dressing.json`. Add `DRESSING_PLACEMENTS` in `clubhouseLayout.ts`, draw them in `render/clubhouse.ts`, and add the welcome-sign CanvasTexture | `clubhouse-dressing.md` | `dressingGraphs.test.ts` |
> | 4 | **Horizon hills:** 3 cards → `horizon.json`. Add a new `render/horizon.ts` ring and wire it into `scene.ts` (dispose included) | `horizon-hills.md` | `horizon.test.ts` |
> | 5 | **Course kit, export only:** zone stake, tee riser, path kerb, bollard, reed clump, 3 rocks → `course_kit.json`. Then post a hand-off comment on #52, #55, #58 and #59 | `course-kit.md` | `courseKitGraphs.test.ts` |
> | 6 | **Rider fix:** re-export `driver.json` from the frozen file with the fixed exporter. Only the six limb rotations may change | `rider-fix.md` | `driverGraph.test.ts` + `GolfClub.test.ts` |
> | **STOP** | Run the dev server. Your own Browser pane works: add a `launch.json` entry for this worktree on a free port. Play a match and screenshot: the spawn with its dressing, a parkland wood, a links hole, a marsh hole, and the horizon. Then open the **PR "Stage 5a: environment art"** with those screenshots described, the triangle and draw-call counts, and the list of hand-off comments. **Show me the gate renders for trees and the cart/rider, and wait for my approval before re-baselining.** | | |
>
> ## Things to know (learned in Stage 7)
> - **Rotation order:** Three's Euler XYZ is `Rx·Ry·Rz`, and Blender's is `Rz·Ry·Rx`. The exporter (`_three_euler`) and `R()` are exact now; don't reintroduce a component swap.
> - **`prism` indexing:** `ExtrudeGeometry` is given an index in `primitiveGraph.ts` so it merges with the other kinds. Keep that.
> - **Blender torus:** `make()` stands the torus up in the preview, to match `TorusGeometry`.
> - **Scene context:** `bpy.ops.wm.read_homefile(use_empty=True)` loses the context for the rest of that same MCP call. Save or build in a *separate* call.
> - **Golden fingerprint:** on the Mac the full suite passes, and `arenaGolden` passes since Stage 3. If the sim changes, take the golden value from Linux CI. This stage must not change sim results.
> - **Bundle split:** `main.ts` loads sim code through `app/matchPath.ts` so the title chunk stays small. Anything in `src/sim/**` that `main.ts` needs goes through that module.
> - **Allocation:** no per-frame allocation in `draw` / `update`. Use arrays and scratch objects, not `Map` iteration.
>
> ## Docs to update as you go
> - `art/README.md`: the file table gains `environment.blend`, `stage5_kit.py` and `kit_common.py`; add the new export calls; correct the rider note.
> - `docs/ASSET_PIPELINE.md` §2: the trees row now reads "6 species, primitive graph, built".
> - Each spec: an "As built" section wherever the build deviated.
> - `docs/HANDOFF.md` at the STOP.

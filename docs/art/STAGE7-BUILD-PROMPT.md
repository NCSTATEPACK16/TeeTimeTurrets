# Stage 7 build prompt (paste into a fresh LOCAL Claude Code session)

> You are building **Stage 7** of TeeTimeTurrets: the clubhouse complex, pickups, tee signs and a cart refresh, authored in Blender over the Blender MCP. It is a browser game built on three.js and Rapier. Every design decision is already made. Don't re-open them; build what the specs say. If a spec is wrong about a fact in the code, stop and ask me.
>
> ## Where to work
> - **Worktree:** `/Users/johnbradner/Documents/ClaudeWork/GolfofDuty/TeeTimeTurrets-stage7`, branch `stage-7-blender`, cut from `main`.
> - **Never work in the main checkout** `.../TeeTimeTurrets`. It holds another session's uncommitted Stage 3 work.
> - **Never open `art/clubhouse-and-cart.blend` for writing.** It is frozen. Append from it only.
>
> ## Pre-flight (do these first, and report each)
> 1. **Ask me to run** `uvx mcp-for-blender install-addon`, restart Blender, enable "Interface: Blender MCP", and click Start MCP Server. Then call `get_addon_status`, which should report up to date, and `get_scene_info`. Blender is 5.2 LTS at `/Applications/Blender.app`.
> 2. **Read, in this order:**
>    - `AGENTS.md`
>    - `docs/TEST-AND-SPEC-PITFALLS.md`
>    - `art/README.md`
>    - `docs/art/specs/00-pipeline.md`, then every other file in `docs/art/specs/`
>    - `docs/superpowers/specs/2026-09-12-stage-d-pickups-design.md`, the Implementation Decisions section
> 3. **Look at each source sheet** named in the specs, in `docs/concept/reference/`, with the Read tool. Also look at `docs/concept/03CartTurretChasecam.jpg`, the style target.
> 4. **Check the GitHub issues:** `gh issue list --milestone "Stage 7"`. The sub-issues of #65 map one-to-one to the slices below; close each one from its commit or PR.
>
> ## Testing policy (my rule; it overrides older AGENTS.md wording)
> - **One smoke check per slice, 15 s or less.** Each spec names its check.
> - **No new Scene Gate subjects, no feel probes, no broad suites.**
> - Always run `npx tsc --noEmit`.
> - Existing CI must stay green.
> - **Look and feel are judged by human play-testers.** That is me, at the STOP points.
> - Show me that each smoke check ran and passed, with its output. Don't just claim it.
>
> ## Git rules
> - `git commit -s` (DCO) on every commit.
> - **No AI metadata** anywhere: no co-author trailers, no session links, no "generated with".
> - Stage files by name. Never `git add -A` or `git add .`.
> - **Don't merge.** Open PRs and I merge.
>
> ## Blender rules (`00-pipeline.md` has the detail)
> - Load the exporter with `exec(open(REPO + '/art/ttt_authoring.py').read(), globals())` once slice 1 has extracted it.
> - Author with `make()` only. Every object carries `ttt_kind`, `ttt_params` and `ttt_slot`.
> - Scale stays (1,1,1). Rotations are X plus at most one of Y or Z. Call `view_layer.update()` before reading matrices.
> - After each asset, take front and side `get_viewport_screenshot()` views and **show them to me beside the source sheet.**
> - Save the `.blend` after every asset.
> - **Stay within the triangle budget** in each spec. Count the triangles and report the number.
>
> ## Slices, in order (these are the sub-issues of #65)
> | Issue | Slice | Spec | Smoke check |
> |---|---|---|---|
> | #72 | Extract `ttt_authoring.py` to `art/`. Add the `prism` kind to the exporter and to `primitiveGraph.ts`. Prove Blender 5.2 re-exports the old cart byte-identical to `cart.json` | `00-pipeline.md` | the prism Vitest case, plus a `diff` of the re-exported cart |
> | #73 | Cart v2: create `art/cart-v2.blend`, add the `canopy` slot, reshape the turret to shot 03, add `render/teamColors.ts`, apply colours in scene and showroom | `cart-v2.md` | `cartGraph.test.ts` + `GolfClub.test.ts` |
> | #74 | Clubhouse complex, tee signs and pickup visuals, render only:<br>• author `clubhouse.json` (clubhouse, team_barn, lot_stripes, lamp_post, food_cart), `tee_sign.json` and `pickups.json`<br>• `render/clubhouse.ts`, replacing the decor stand-in in the arena<br>• the tee-sign pass and its CanvasTexture atlas<br>• the pure `placePickupSites()` function, and rendering of pillars and items<br>Author and screenshot each asset in turn | `clubhouse.md`, `team-barn.md`, `lot.md`, `food-cart.md`, `tee-sign.md`, `pickups.md` | `clubhouseGraph.test.ts`, `pickupGraph.test.ts`, `teeSigns.test.ts`, one `placePickupSites` case |
> | **STOP A** | Open **PR "Stage 7a: art"** against `main`, closing #72–#74. Give me: screenshots of every asset beside its sheet, triangle counts, draw calls from the dev readout, and the commands to play. **Wait for my play-test.** | | |
> | — | **Wait until Stage 3 (#48) has merged to `main`.** Check with `gh pr list --state merged`. Then run `git rebase origin/main` on the branch and resolve conflicts | | |
> | #75 | Static colliders in `sim/clubhouse.ts` with the 0.1 m bounds guard; footprint obstacles in `lineOfSight.ts` | `sim-slices.md` §1–2 | `clubhouse.test.ts` + `lineOfSight.test.ts` |
> | #76 | Pickup collection, the shield, and the plate VFX; retire `sim/entities/Pickup.ts` | `sim-slices.md` §3–4, `pickups.md` | `pickups.test.ts` + the shield case in `combat.test.ts` |
> | **STOP B** | Open **PR "Stage 7b: sim"**, closing #75–#76. If the arena golden fingerprint moved, take the value from the failing **Linux** CI run and commit it with an explanation. **Wait for my play-test.** | | |
>
> ## Docs to update as you go
> - `docs/ASSET_PIPELINE.md`: the cart slot list gains `canopy`; the clubhouse row changes from decorative GLB to primitive graph; add `prism` to §4.2.
> - `art/README.md`: the file table (three `.blend` files, one frozen), the extracted exporter path, and the new export calls.
> - `docs/BACKLOG.md`: a Stage 8 note to avoid selling chassis paints in the team hues.
> - `docs/HANDOFF.md` at each STOP.
>
> ## When you're unsure
> - If a fact in a spec is wrong about the code, stop and ask me.
> - Don't invent a design choice.
> - Don't add tests beyond the one smoke check per slice.

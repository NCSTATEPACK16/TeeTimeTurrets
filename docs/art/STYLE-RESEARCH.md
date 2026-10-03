# Style research: why the build looks bulky next to the concept art

Written 2 October 2026. **Sheets reviewed 3 October 2026:** see `SHEET-REVIEW-2026-10-03.md` for the recommended verdicts on P1–P6. This is research plus **proposals**. Nothing here changes a rule until the user approves it; the proposals are marked **P1–P6** so they can be accepted one at a time. The image prompts that follow from it are in `GEMINI-PROMPTS-v2.md`.

## Summary

The bulk is mostly self-inflicted, and it comes from **one misreading that hardened into rules**.

`docs/ASSET_PIPELINE.md` §2.1 describes shot 03 as "flat-shaded, hard facets", and every later rule copies that description. Shots 01 and 03 show something else: a **soft-bevelled "vinyl toy" style**. Forms are chunky and few, every edge is visibly rounded and catches a thin highlight, shading is smooth inside each part, and soft ambient occlusion and contact shadows sit in every crease. Only the distant hills show facets.

Our cart is built correctly from its spec. The spec and the pipeline asked for the wrong surface treatment, so a correct build of them looks like a stack of hard boxes.

## Evidence

| What the concept shows | What we built | Where the rule lives |
|---|---|---|
| Rounded edges on every box (cart body, canopy, turret, seats). The radius is about 10–15% of the part's smallest dimension | 26 hard `box` nodes on the cart. No primitive kind can round an edge | `PrimitiveKind` in `src/entities/primitiveGraph.ts` |
| Smooth shading inside a part | `flatShading: true` on every graph material, on trees and on the treeline | `primitiveGraph.ts:369`, `Trees.ts:164`, `treeline.ts:115` |
| Ambient occlusion: dark seat well, dark under the canopy and in the wheel arches | No AO pass. `quality.ts` says so: "ambient occlusion has no pass" | `src/render/quality.ts`, `src/render/post.ts` |
| One rounded tub for the body | 8 separate boxes (`chassis_pan`, `body_tub`, `hood`, `nose`, `dash`, `rear_deck`, 4 `arch_*`). Each seam reads as a step | `src/entities/graphs/cart.json` |
| Canopy covers the seats only; the rear deck and bag stay visible (01, 03) | `canopy` is 1.48 × 2.28 m, covering 92% of the 2.48 m cart. From the chase camera it is the biggest shape on screen, and it is painted solid team blue | `docs/art/specs/cart-v2.md` |
| Camera low and slightly to the side; the seat well, rider and side panel all visible | `CHASE_HEIGHT` 3.6 m at `CHASE_DISTANCE` 6.5 m. The camera looks down onto the canopy | `src/render/chaseCamera.ts` |
| "No bevels, deliberately large facets" | Followed exactly | `docs/art/specs/00-pipeline.md`, Conventions |
| `cart-turnaround-02`'s smooth shading was the closest any sheet came to the target | The cart-v2 critique listed that smooth shading as a defect | `docs/art/specs/cart-v2.md`, Sheet critique |

The prompt-side cause is the same. The style block that every sheet prompt pastes in verbatim (`docs/concept/hole-shot-prompts.md` §1) asks for "flat-shaded, faceted… bold clean black outlines… no realistic lighting gradients or soft shadows". Shots 01 and 03 have no outlines and do have soft shadows. Every reference sheet since has been steered away from the look we want.

**The environment is a separate gap, and it is already scheduled.** The parkland screenshot from 1 October, with round trees, mowing stripes and soft sky, is close to shot 03's mood. The missing pieces are a fairway/rough value contrast, sculpted bunker lips, clumps of trees and AO. Those are Stage 3b (PR #79) and Stage 5 (PR #80, plus #54, #56, #57 and #60). The prompts help Stage 5 by giving it a frame to aim at, not by changing its scope.

## What makes this style read as rich

These come from the research sources at the end, checked against shots 01 and 03.

1. **Bevels are the detail.** A rounded edge puts a thin highlight along every silhouette. At game distance that light line is most of what reads as "finished". It is the cheapest richness there is: a few dozen triangles per part.
2. **Smooth inside a part, crisp between parts.** Smooth normals with a crease angle give soft volumes without a mushy outline. three.js does this with `BufferGeometryUtils.toCreasedNormals(geometry, creaseAngle)`, which keeps normals smooth except where faces meet above the angle.
3. **AO sells contact and depth.** Without it, parts float on each other. That floating is the "stacked blocks" read. In three.js, N8AO is the common choice: it has a half-resolution mode and is reported to avoid the halos GTAO leaves at depth edges. Low and Medium can't afford a pass, so they need a cheap stand-in (P4).
4. **Few mid-sized details instead of many small ones.** The concept cart has headlights, a bumper, seat cushions, a steering wheel and a bag. It has no bolts, vents or panel lines. Our parts list is about the right size; the problem is the surface, not the count.
5. **Proportion is chunky.** Big soft wheels, a low tub and a thin canopy. Our wheels (0.68 m diameter) are already big. The tub and canopy are what read as tall and heavy.
6. **Value separation.** Shot 03 holds clear light and dark steps: a white body, a dark seat well, a red turret and a pale canopy against mid-green grass. A saturated blue canopy at the same value as the grass muddies that.

## Proposals (each needs approval)

**P1. Change the style rule.** Replace "flat shading, deliberately large facets, no bevels" in `00-pipeline.md` and `ASSET_PIPELINE.md` §2.1 with: *"Soft-bevelled toy: chunky forms, every exposed edge rounded, smooth shading inside a part and creased between parts. The premium look comes from bevels plus lighting."* Terrain and trees may stay faceted, because the concept's hills are.

**P2. Add an `rbox` primitive kind** (a rounded box), with `params` `[w, h, d, radius]`.
- **Three side:** `RoundedBoxGeometry(w, h, d, 1, radius)` from `three/addons/geometries/RoundedBoxGeometry.js`. **Measured: 108 triangles at segments 1** (300 at segments 2; a plain box is 12). Validate `radius < min(w, h, d) / 2` when the graph loads.
- **Blender side:** a cube plus an unapplied Bevel modifier, segments 1, width = radius. It is a preview only; the exporter writes the kind and params, not the mesh.
- **Collision:** none, because colliders are never graph nodes (`00-pipeline.md`).
- **Smoke check (≤15 s):** one Vitest case. The bounding box must equal w × h × d, the triangle count must be 108, and a radius at or above half the smallest side must throw.

**P3. Per-slot shading flag.** Add an optional `flat: boolean` per slot, default false for `rbox`, cylinders and spheres. Run `toCreasedNormals` at about 40° on non-flat parts. Keep flat shading for terrain, trees and treeline (P1).

**P4. AO.** On the High preset, an AO pass on the post chain. N8AO in half-resolution mode is the candidate; **check its licence before adopting it** and add a `NOTICE` entry if it is used. On Low and Medium, use a soft blob contact shadow under each cart and building, plus a darker vertex colour on the inward faces of the seat well and wheel arches, baked into the merged mesh.

**P5. Cart re-proportion.** This one reopens part of the cart-v2 spec, so it is listed separately.
- Shorten the canopy to cover the seats only, about 1.5 m long instead of 2.28 m, so the rear deck and bag show as they do in shots 01 and 03.
- Merge the 8 body boxes into **3 rounded volumes**: tub, hood/nose and rear deck.
- Turn 13 boxes into `rbox`: the body volumes, both bumpers, the 3 seat parts, the canopy and the turret housing. At +96 triangles each, the cart goes from 1,944 to about 3,200. **Raise the cart budget from 2,000–3,000 to 3,000–4,500.** Draw calls are unchanged, because they are per slot.
- **Team colour (an open question for the user):** the sheets in `GEMINI-PROMPTS-v2.md` include a panel comparing a full team-colour canopy with a white canopy carrying a team stripe on its edge, plus the shirt. Choose from the image, not in the abstract. The Stage 7 rule ("team colour on `canopy`") stands until then.

**P6. Chase camera framing input for Stage 4 (#51).** Aim at shot 03's framing: the camera lower and with a slight side offset, so the side panel and seat well show. These are numbers for #51 to tune by feel; nothing is changed here. Shot 03 suggests a height of about 2.6–3.0 m at 6–6.5 m back, with the horizon about a fifth of the way down the frame.

**Not proposed: switching to decorative GLBs.** By AGENTS.md's mechanical test, the clubhouse visual *is* decorative, since its colliders live in `src/sim/clubhouse.ts`. So a GLB would be legal. But P1–P3 close most of the gap while keeping one pipeline, one exporter and slot recolouring. Revisit only if the P2 build still looks bulky.

## Where this goes in the plan

1. **The user runs the prompt pack** (`GEMINI-PROMPTS-v2.md`) in the Gemini app. Sheets are filed under `docs/concept/reference/`.
2. **Spec session, high effort:** read the new sheets, accept or amend P1–P6, and rewrite `cart-v2.md` → `cart-v3.md` and the clubhouse spec with numbers.
3. **Code slice, any session:** P2 + P3 + P4, one smoke check each. This can ride with Stage 5 or run as its own small PR.
4. **Blender session, high effort for the first asset:** re-block the cart, then the clubhouse, with `rbox`. Once the look is approved, medium effort is enough for the rest.

The earlier stage order (4 → 5 → 6 → 8–10) does not change. This work slots in after the play-test of #79/#80 and before Stage 5's remaining issues, because Stage 5 dresses the world around these assets.

## Sources

- [N8AO repository](https://github.com/N8python/n8ao) and [three.js forum: HBAO vs N8AO](https://discourse.threejs.org/t/new-ambient-occlusion-example-hbao-vs-n8ao/58847): AO options, half-resolution mode, and the GTAO halo comparison.
- [three.js GTAOShader docs](https://threejs.org/docs/pages/module-GTAOShader.html)
- three.js `RoundedBoxGeometry` and `BufferGeometryUtils.toCreasedNormals`: the official docs, read via Context7; the triangle counts were measured locally against the installed `three`.
- [polycount: low-poly bevel edges](https://polycount.com/discussion/190137/low-poly-bevel-edges) and [polycount: face-weighted normals](https://polycount.com/discussion/188399/solved-blender-face-weighted-normals-controlling-bevel-weights): chamfer plus custom normals as the standard low-poly "soft" workflow.
- [Retro Style Games: low-poly game art guide](https://retrostylegames.com/blog/low-poly-game-art-an-ultimate-guide/): chamfers and simple deformation as the toy-look toolkit.

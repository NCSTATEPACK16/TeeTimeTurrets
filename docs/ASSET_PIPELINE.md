# 3D Asset Pipeline

**Status:** specification. The primitive-graph format (§4) and the exporter are not yet built.
**Supersedes:** the previous `ASSET_PIPELINE.md` (the "CallofGolf" draft) — see §0.2.
**Related:** `COURSE_PIPELINE.md` (course design), `AGENTS.md` (the geometry rule), `LICENSES.md`.

---

## 0. Read this first

### 0.1 The scope conclusion, unchanged

The previous draft's central finding survives the rewrite intact and is worth restating, because it
is the highest-leverage decision in the project's art plan:

**The art direction needs far less AI 3D generation than assumed — possibly none.** Concept images
`05RagdollHit.jpg` and `03CartTurretChasecam.jpg` are flat-shaded low-poly. Specifically:

- **The player is a segmented wooden-mannequin figure** — capsule limbs, sphere head, box torso,
  visible joint gaps. That is ~15 primitives. It needs no AI generation, no retopology, no UV
  unwrapping, no skinning, no Mixamo. It also maps **1:1 onto a Rapier ragdoll**: every visible body
  segment is already a rigid body. This deletes the single largest bottleneck from any asset plan.
- **The clubs are a shaft and a head** — a cylinder and a beveled wedge. Ten minutes each.
- **The cart is the only asset with real geometric complexity**, and it is still a boxy low-poly
  vehicle.

### 0.2 What was wrong with the previous draft

Recorded so the next reader does not re-derive it:

- **It contradicted `AGENTS.md`.** Its §5 steps 8–9 specified glTF export and `GLTFLoader` as the
  shipping path, against a rule stated absolutely in four places. §1 below resolves this.
- **It duplicated shipped code.** Its §6.1 proposed a `Hole` schema and its §6.5 a surface-effects
  table; `src/sim/course.ts` and `src/sim/surfaces.ts` have since shipped both. Course design now
  lives in `COURSE_PIPELINE.md` and is out of scope here.
- **It carried the old project name** (CallofGolf → TeeTimeTurrets, renamed August 2026).
- **Its §7 gameplay-rules section was out of scope** for an asset document. The health/stroke rule it
  proposed belongs in `ROADMAP.md` / `UI-SPEC.md`.

Its art-style conflict analysis (§1), its Blender origin/hierarchy rules (§5.6), and its
license-first reasoning about AI generators (§2) all survive, and appear below as §2.1, §5.4 and §7.

---

## 1. The geometry rule, resolved

`AGENTS.md` states: *"All playable geometry (clubs, cart, terrain, future targets) is first-party
procedural primitives assembled at runtime. No `.glb`/`.obj`/`.fbx` in the playable path, ever."*

That rule earns its keep. It is what makes `src/sim/**` Node-runnable, what lets an authoritative
server reconstruct the world from a seed instead of shipping a level format, and what keeps the
project's license surface auditable — a concern this repo demonstrably takes seriously
(`LICENSES.md`, `NOTICE`, and the Reserved-Content analysis in `AGENTS.md`).

But it is stated more broadly than its own justification. The determinism argument is about geometry
the simulation *touches*. A clubhouse on the horizon touches nothing.

**Decision: the rule splits by path.**

| Path | Rule | Covers |
|---|---|---|
| **Playable** | Procedural primitives only. No mesh files, ever. | Cart, clubs, ball, targets/ragdolls, terrain, anything with a collider, anything the server reconstructs, anything whose dimensions the sim reads |
| **Decorative** | Authored `.glb` permitted | Clubhouse backdrop, distant scenery, menu podium, title-screen set dressing — geometry that is never collided with, never replicated, and never read by `src/sim/**` |

The boundary test is mechanical: **if removing the asset entirely would change a single simulation
result, it is playable.** If it would only change what the screen looks like, it is decorative.

### 1.1 The `AGENTS.md` edit

```diff
-- All playable geometry (clubs, cart, terrain, future targets) is first-party procedural
-  primitives assembled at runtime. No `.glb`/`.obj`/`.fbx` in the playable path, ever.
+- All playable geometry (clubs, cart, terrain, targets) is first-party procedural primitives
+  assembled at runtime. No `.glb`/`.obj`/`.fbx` in the playable path, ever. "Playable" is
+  mechanical: if removing the asset would change a simulation result, it is playable. Purely
+  decorative geometry that is never collided with, never replicated, and never read by
+  `src/sim/**` may ship as authored `.glb` — see `docs/ASSET_PIPELINE.md` §1.
```

### 1.2 What stays banned regardless of path

- **Third-party geometry without a recorded licence and a `NOTICE` entry.** Same rule as ported code.
- **AI-generated geometry as shipped mesh.** See §7 — it is reference to model over, never output.
- **Any mesh file under `src/sim/**` or `src/physics/**`.** Those directories stay Node-runnable and
  DOM-free; that invariant is enforced by the node-environment Vitest config and is not negotiable.

---

## 2. Asset manifest

Three routes. **Primitive** = hand-written TypeScript, as `GolfClub.ts` is today.
**Primitive-graph** = authored in Blender, exported as parameters (§4), assembled at runtime.
**Decorative GLB** = authored mesh, loaded outside the sim.

| Asset | Route | Budget | Notes |
|---|---|---|---|
| Golf cart | primitive-graph | 2,000–3,000 tri | 8 material slots (§2.1). Wheels separate for rotation. |
| Turret housing + barrel | primitive-graph | 300 | Child of cart; Y-rotation for aim. |
| Club heads (driver, iron, putter) | primitive | 150 each | The barrel *is* the club, per image 03. |
| Player mannequin | **primitive** | ~600 | ~15 parts, one per rigid body. §2.2. |
| Golf ball | primitive | 80 | Built (`entities/ballShape.ts`). |
| Trees, 2–3 per biome | primitive-graph | 200 each | **Must be GPU-instanced.** Silhouettes from `COURSE_PIPELINE.md` §7.1. |
| Flag + pin | primitive | 60 | Cloth as a vertex-animated quad. |
| Course props (rake, tee marker, bridge, boardwalk) | primitive-graph | 100–400 | Sheet in hand: `docs/concept/reference/prop-silhouettes-01.jpg` (`COURSE_PIPELINE.md` §7.2). Eight props. Scale is per-cell, not uniform — size them against cart height. |
| Terrain | procedural heightfield | — | Built (`sim/terrain.ts`). |
| **Clubhouse exterior** | **decorative GLB** | 3,000 | Menu backdrop and hole 18's landmark. Never collided with. |
| **Distant scenery** | **decorative GLB** | 2,000 | Skyline dressing beyond the field edge. |
| Menu podium | decorative GLB | 500 | Clubhouse screen only. |

### 2.1 The art-style conflict, and the cart's material slots

The concept art contains **two different art styles**, and one must be chosen before anyone models:

| | `11ClubhouseLoadout.jpg` (menu) | `03CartTurretChasecam.jpg` (gameplay) |
|---|---|---|
| Shading | Glossy, soft shadows, heavy bevels | Flat-shaded, hard facets |
| Cart detail | Knobby tires, chrome rims, seat stitching, 8-iron bag | Simple wheels, plain body |
| Est. tris | 15–30k | 1.5–3k |

**Build one mesh at gameplay fidelity (`03`)** and get the premium menu look from *lighting and
presentation*: three-point lighting, a shadow catcher, the rotating podium, slight bloom, and a
higher-res environment map the gameplay scene cannot afford. Do not author two unrelated meshes —
paint and skin variants must apply to both.

The customisation menu implies **separable material slots**, authored as distinct slots on one
model so a paint swap is a material-index change rather than a mesh swap:

`chassis` · `roof` · `turret_housing` · `turret_barrel` · `tires` · `rims` · `seats` · `club_bag`

### 2.2 The mannequin is a ragdoll, not a model

`05RagdollHit.jpg` shows a segmented mannequin with visibly separated joints. Build it as ~15
independent primitives, one per Rapier rigid body:

`head, torso_upper, torso_lower, upper_arm_L/R, lower_arm_L/R, upper_leg_L/R, lower_leg_L/R, foot_L/R, cap`

- **No skinning, no armature, no weight painting, no Mixamo.** Each part's transform is copied from
  its rigid body every frame.
- **The ragdoll is free.** The physics rig *is* the character rig.
- **Animation is joint targets, not keyframes.** Idle, walk and swing are motor targets; getting hit
  disables the motors and it goes limp — exactly the effect in `05`.
- **Variants are data.** Colours, cap on/off, segment scale.
- The cap is a separate loose body so it flies off on impact, as in the concept art.

Generate these procedurally in TypeScript rather than through the Blender pipeline. It keeps the
zero-asset property for characters and matches how the rest of the codebase works.

> **Rapier caveat that bites here.** Per `AGENTS.md`: `JointData.stiffness`/`.damping` are inert,
> spherical joints have no angular limits, revolute limits must be set on the *created joint*, and
> spherical motors were removed at 0.12-alpha. Hold poses with body type, not joint parameters.
> Code that appears to work because it compiles is the failure mode; there is no runtime error.

---

## 3. Toolchain

All open-source or free-tier, all scriptable.

| Tool | Licence | Role |
|---|---|---|
| **Blender 4.x** | GPL | Authoring. Output is parameters (§4) or decorative GLB (§6). |
| **Blender MCP** | MIT | Drives Blender from a Claude Code session — `execute_blender_code`, `get_scene_info`, `get_object_info`, `get_viewport_screenshot`. |
| **Poly.pizza** | **CC0** | Low-poly model library. *The closest aesthetic match to this project's concept art.* Wired into the MCP (`search_polypizza_models`). |
| **Poly Haven** | **CC0** | HDRIs and textures. Mainly menu lighting. Wired in (`search_polyhaven_assets`). |
| **Kenney.nl** | **CC0** | Low-poly kits including golf and nature. Not MCP-wired; download manually. |
| Sketchfab | mixed | Wired in, but licences vary per model. **Filter every model individually**; default to not using it. |
| **gltf-transform** | MIT | GLB optimisation, `npm`-installable, scriptable in CI. |
| **gltfpack** / meshoptimizer | MIT | Mesh compression for decorative GLB. |

**CC0 sources are strongly preferred** and the ordering above is by licence safety, not by quality.
CC0 requires no attribution, no `NOTICE` entry, and raises no question when the repo is forked.

### 3.1 Why the MCP matters

`execute_blender_code` is what turns this from a checklist a human follows into a pipeline a session
executes. A future session can build geometry programmatically, screenshot the viewport, evaluate
it, and iterate — with a human approving at checkpoints. That is the mechanism behind §5.

**The addon must be running.** The MCP server being configured is not enough: Blender must be open
with the addon started and listening, or every call returns
`Could not connect to Blender. Make sure the Blender addon is running.` Verify with
`get_scene_info` before starting any modelling session.

---

## 4. The primitive graph

The item named at `ROADMAP.md:304` ("the Blender primitive-graph prop exporter") and never designed.
It is what lets Blender be a *design* tool for playable assets without any mesh data crossing the
line into the game — **only parameters cross.**

### 4.1 Format

```ts
export type PrimitiveKind = 'box' | 'cylinder' | 'cone' | 'sphere' | 'capsule' | 'torus';

export interface PrimitiveNode {
  readonly name: string;
  readonly kind: PrimitiveKind;
  /** Kind-specific, in the same order as the matching THREE geometry constructor. §4.2. */
  readonly params: readonly number[];
  readonly position: readonly [number, number, number];
  /** Euler XYZ, radians. */
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  /** Material slot name. Must exist in the graph's `slots`. */
  readonly slot: string;
  readonly children?: readonly PrimitiveNode[];
}

export interface PrimitiveGraph {
  readonly name: string;
  readonly version: 1;
  readonly units: 'm';
  readonly slots: Readonly<Record<string, {
    readonly color: number;      // 0xRRGGBB
    readonly roughness: number;
    readonly metalness: number;
  }>>;
  readonly root: PrimitiveNode;
}
```

### 4.2 Parameter order

Matching the Three.js constructors exactly, so the runtime assembler is a `switch` with no
translation layer:

| Kind | `params` |
|---|---|
| `box` | `[width, height, depth]` |
| `cylinder` | `[radiusTop, radiusBottom, height, radialSegments]` |
| `cone` | `[radius, height, radialSegments]` |
| `sphere` | `[radius, widthSegments, heightSegments]` |
| `capsule` | `[radius, length, capSegments, radialSegments]` |
| `torus` | `[radius, tube, radialSegments, tubularSegments]` |

### 4.3 The Blender-side exporter

Objects are tagged with custom properties and the exporter walks the selection. Run via
`execute_blender_code`, or saved as an addon operator.

```python
import bpy, json, math

KINDS = {'box', 'cylinder', 'cone', 'sphere', 'capsule', 'torus'}

def node(obj):
    kind = obj.get('ttt_kind')
    if kind not in KINDS:
        raise ValueError(f"{obj.name}: ttt_kind missing or invalid (got {kind!r})")
    params = obj.get('ttt_params')
    if params is None:
        raise ValueError(f"{obj.name}: ttt_params missing")
    loc, rot, scale = obj.matrix_local.decompose()
    euler = rot.to_euler('XYZ')
    return {
        'name': obj.name,
        'kind': kind,
        'params': [round(float(p), 4) for p in params],
        # Blender is Z-up, Three is Y-up: (x, y, z)_blender -> (x, z, -y)_three.
        'position': [round(loc.x, 4), round(loc.z, 4), round(-loc.y, 4)],
        'rotation': [round(euler.x, 4), round(euler.z, 4), round(-euler.y, 4)],
        'scale': [round(scale.x, 4), round(scale.z, 4), round(scale.y, 4)],
        'slot': obj.get('ttt_slot', 'default'),
        'children': [node(c) for c in obj.children] or None,
    }

def export(root_name, out_path):
    root = bpy.data.objects[root_name]
    slots = {}
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        if bsdf is None:
            continue
        c = bsdf.inputs['Base Color'].default_value
        slots[mat.name] = {
            'color': (int(c[0] * 255) << 16) | (int(c[1] * 255) << 8) | int(c[2] * 255),
            'roughness': round(bsdf.inputs['Roughness'].default_value, 3),
            'metalness': round(bsdf.inputs['Metallic'].default_value, 3),
        }
    graph = {'name': root_name, 'version': 1, 'units': 'm', 'slots': slots, 'root': node(root)}
    with open(out_path, 'w') as f:
        json.dump(graph, f, indent=2)
    return graph
```

**The Z-up to Y-up conversion is the trap.** Blender is Z-up, Three.js is Y-up. Getting it wrong
produces a model lying on its side, which is obvious, or subtly mirrored, which is not. The mapping
above is `(x, y, z) → (x, z, −y)`; verify it on an asymmetric test object before trusting it on the
cart.

### 4.4 Origins and hierarchy

Carried forward from the previous draft, because it is the part that costs hours of transform maths
if gotten wrong:

- **Cart body:** origin at ground-contact centre.
- **Wheels:** origin at axle centre.
- **Turret:** origin at its yaw pivot.
- **Barrel:** origin at the turret mount point.
- **1 Blender unit = 1 metre.** Cart ~2.4 m long. Apply all transforms (`Ctrl+A → All Transforms`)
  before export.

---

## 5. Authoring a playable asset — the cart

Checkpoints marked **[REVIEW]** are where a human looks at a viewport screenshot and says yes or no.

1. **Verify the connection.** `get_scene_info`. If it errors, Blender is not running with the addon
   started (§3.1). Do not proceed.
2. **Gather reference.** Start with `docs/concept/reference/cart-turnaround-01.jpg` (§8.1) — four
   orthographic-ish views, and the deviations in that folder's README are load-bearing: mirror the
   SIDE view, take no dimension across panels, and author `club_bag` from `03CartTurretChasecam.jpg`
   because the sheet omits it. For a 3D proportion check,
   `search_polypizza_models("golf cart")` — CC0, and the style already matches. Import one as a
   **proportion reference only**, set to wireframe and non-selectable. Do not model on top of it and
   do not ship it. **[REVIEW]** — confirm the reference reads like `03`, not like `11`.
3. **Block out** with primitives at gameplay fidelity, using the §2.1 comparison as the target.
   Every object gets `ttt_kind`, `ttt_params` and `ttt_slot` custom properties as it is created —
   retrofitting them across 40 objects is miserable.
4. **Set origins and hierarchy** per §4.4. Parent wheels and turret to the chassis.
   **[REVIEW]** — `get_viewport_screenshot` from front, side and 3/4.
5. **Assign the eight material slots** from §2.1 with flat base colours. No textures: this is a
   flat-material art style, and a texture atlas adds load cost for nothing.
6. **Export the graph** (§4.3) to `src/entities/graphs/cart.json`. **[REVIEW]** — diff against the
   previous export; an unexpected change means an origin moved.
7. **Assemble at runtime** and compare against the Blender screenshot.
8. **Baseline the scene gate.** `npm run gate -- --update-baseline` after a human reviews the diff.
   New geometry without a baseline is unguarded (`AGENTS.md`, Visual Critic protocol).

---

## 6. Authoring a decorative asset — the clubhouse

The GLB path, permitted only under §1's decorative branch.

1. Model in Blender at ~3,000 triangles. Flat-shaded, sharp edges marked, or Shade Auto Smooth at
   ~30°. The look in `03` comes from *deliberately large flat facets* — keep polygon density low and
   even. **Do not decimate**; decimation produces the wrong facet distribution for flat shading.
2. Export **glTF 2.0 (.glb)**: Selected Objects, +Y Up, Apply Modifiers. Exclude cameras and lights.
3. Optimise: `npx @gltf-transform/cli optimize in.glb out.glb --texture-compress webp`.
4. Place under `public/models/`. **Never under `src/sim/**` or `src/physics/**`.**
5. Load with `GLTFLoader` from `src/render/**` only, behind a null check — a decorative asset that
   fails to load must degrade to nothing, never throw. It is decoration; the game must run without
   it.
6. Record provenance in `LICENSES.md` and, if third-party, `NOTICE`.
7. Budget check: the decorative set must stay under 500 KB compressed and must not block first
   render. Load it after the sim is live.

---

## 7. AI 3D generation — reference only, and mostly unnecessary

The MCP exposes Hyper3D/Rodin (`generate_hyper3d_model_via_text`, `via_images`) and Hunyuan3D
(`generate_hunyuan3d_model`). The previous draft compared these against TRELLIS and Tripo on licence
grounds and concluded that generated geometry should be **reference to retopologise over, never
shipped mesh**. That conclusion stands, and under §1 it is stronger than before:

**Under the split, AI-generated geometry may never ship at all.** Playable assets are primitives —
there is nothing for a generated mesh to be. Decorative assets are few and hand-authored. So the
whole Hunyuan-vs-TRELLIS-vs-Tripo licence comparison, which the previous draft spent a full section
on, mostly evaporates. That retires a set of open questions rather than carrying them forward.

Where generation still helps: producing a proportion reference for a hero prop when a blockout
stalls. In that use it never leaves Blender and never enters the repo, so its licence governs a
temporary file.

Two rules if used at all:

- **Never put an HF Space in a build script.** Shared queues, cold starts, and runtime errors. Fine
  as an occasional manual step, unusable as a dependency.
- **Never feed the concept art in directly.** `11ClubhouseLoadout.jpg` is a stylistically
  inconsistent 3/4 view; conditioning on it produces the wrong style. Prompt for a plain low-poly
  form and use `03` as the visual target.

---

## 8. Prompt blocks

### 8.1 Orthographic turnaround sheet → *consumer: the §5 blockout, or §7 image-to-3D*

**Run once, for the cart: `docs/concept/reference/cart-turnaround-01.jpg`.** This was the image job
the concept folder was missing entirely — sixteen scene paintings existed and not one was usable as
modelling reference, because a modeller needs orthographic elevations with no perspective, no shadow
and no environment, and every one of them is a dramatic perspective shot.

The sheet that came back is good silhouette and material-slot reference and **is not a measured
blueprint** — its panels share neither a baseline nor a scale. The full deviation list is in
`docs/concept/reference/README.md`; read it before modelling from the image.

```
Produce an orthographic turnaround reference sheet for 3D modelling. This is a technical
modelling reference, NOT an illustration and NOT a scene.

Subject: [SUBJECT — e.g. a simple low-poly golf cart with a small turret mounted on the roof]

Layout: a single image, plain neutral mid-grey background, divided into a 2x2 grid of four
views of the SAME object at the SAME scale, each labelled in small clean sans-serif type:
  TOP-LEFT: FRONT view     TOP-RIGHT: SIDE view (facing right)
  BOTTOM-LEFT: REAR view   BOTTOM-RIGHT: TOP-DOWN view

Every view must be TRUE ORTHOGRAPHIC PROJECTION — parallel projection, absolutely no
perspective, no foreshortening, no vanishing points, no camera tilt. The four views must align
on a shared horizontal baseline so heights match exactly across FRONT, SIDE and REAR.

Rendering: flat-shaded low-polygon forms, two or three flat tones per surface, clean black
outlines. Uniform ambient lighting with no directional light, no cast shadows, no ground
shadow, no reflections, no ambient occlusion, no depth of field.

Do NOT include: a ground plane, an environment, a sky, a horizon, characters, motion effects,
a decorative border, or any 3/4 or perspective "hero" view.
```

#### If you re-run this sheet

Three amendments, each earned by a specific failure in the first real run. Fold them into the block
above rather than appending them, so the prompt stays one piece of text.

1. **Ask for the view names as the labels, explicitly.** The block describes the layout
   positionally — *"TOP-LEFT: FRONT view"* — and the model lettered the position word: the front
   panel came back labelled `TOP-LEFT` and the word `FRONT` appears nowhere on the sheet. Say
   instead: *"label the four panels with exactly these words and no others: FRONT, SIDE, REAR,
   TOP-DOWN. Do not label a panel by its position on the page."*
2. **Restate the shared baseline as the sheet's one hard requirement.** It is the only measurable
   thing the block asks for and it is the one that was dropped — the SIDE panel came back larger
   than FRONT and REAR with no common ground line, which is what demotes the result from blueprint
   to silhouette reference. Give it its own line and say what it is for: *"all four views are of the
   same object at one scale. Draw a single shared horizontal ground line across FRONT, SIDE and REAR
   so heights can be measured across panels."*
3. **Name every material slot in the subject line.** `club_bag` is one of §2.1's eight slots and it
   is absent from all four views. A model that is not told a part exists will not invent it. For the
   cart: *"…with a roof-mounted turret and a golf bag on the rear deck."*

**A fourth thing worth accepting rather than fixing:** the model mirrors freely — the SIDE view came
back facing left against a prompt asking for right. It was self-consistent with the TOP-DOWN, so it
cost nothing but a note. Handedness is cheap to correct in Blender and expensive to argue with an
image model about; check it once, mirror once, move on.

### 8.2 Image-to-3D → *consumer: a Blender reference object, never the repo*

```
[Attach: the SIDE and FRONT views from the §8.1 sheet]

Generate a low-polygon 3D model of a simple stylised golf cart with a roof-mounted turret.

Geometry requirements: chunky, blocky, flat-faceted forms with large flat planes. Low polygon
count — under 3,000 triangles. No fine surface detail, no greebling, no panel-line geometry,
no rounded organic surfaces, no subdivision smoothing.

The model is a proportion reference. Silhouette accuracy and correct relative dimensions
matter; surface detail and texture do not.
```

**Whatever this returns is a reference object.** It is set to wireframe and non-selectable in
Blender, modelled over, and deleted. It does not enter the repository.

### 8.3 Blender MCP session template → *consumer: a future Claude Code session*

```
Model the [ASSET] for TeeTimeTurrets using the Blender MCP.

Read docs/ASSET_PIPELINE.md §4 and §5 first, then follow §5 step by step.

Constraints:
  - Gameplay fidelity per §2.1 — match 03CartTurretChasecam.jpg, NOT 11ClubhouseLoadout.jpg.
  - Every object gets ttt_kind, ttt_params and ttt_slot custom properties AS IT IS CREATED.
  - Origins and hierarchy per §4.4. 1 Blender unit = 1 metre.
  - Material slots exactly as listed in §2.1 — no more, no fewer, same names.
  - Only primitive kinds from §4.2. If a form cannot be built from those, stop and ask rather
    than adding a mesh that the exporter cannot represent.

Verify the connection with get_scene_info before doing anything. At every [REVIEW] checkpoint
in §5, call get_viewport_screenshot and stop for approval before continuing.
```

---

## 9. Budgets and the gate

- **~30,000 triangles for everything shipped.** Nothing for a browser game.
- **Draw calls and material count matter far more than triangle count.** With flat-shaded low-poly
  the failure mode is hundreds of small objects each with its own material. Keep the cart under ~10
  draw calls; **instance every tree**; share materials aggressively; merge static geometry per chunk.
- **Every new asset gets a `sceneGate` baseline** before it is called done (`AGENTS.md`, Visual
  Critic protocol). `npm run gate` runs as part of `npm run build`.
- **Dispose everything.** Every `THREE.Mesh`'s geometry and material, and every `InstancedMesh`
  buffer, on teardown — see `GolfClub.dispose()` for the pattern.

---

## 10. Build order

1. **Land the §1.1 `AGENTS.md` edit.** Until it lands, the rulebook and this document disagree, and
   the rulebook wins.
2. **Build the primitive-graph runtime assembler and the §4.3 exporter.** Verify the Z-up→Y-up
   conversion on an asymmetric test object before anything real depends on it.
3. **Port `GolfClub.ts` to a graph** as the proof. It already exists as hand-written primitives, so
   a correct port produces an identical scene-gate screenshot — which is a real test rather than a
   claim.
4. **Model the cart** (§5). The first genuinely new asset. **Reference is in hand** —
   `docs/concept/reference/cart-turnaround-01.jpg`, with its deviations recorded next to it.
5. **Trees, per biome**, from the `COURSE_PIPELINE.md` §7.1 silhouette sheets. Instanced from day
   one, never retrofitted.
6. **The mannequin and ragdoll** (§2.2) as a standalone test scene. It is the game's signature
   moment and the tuning takes real iteration; budget for it.
7. **The clubhouse** (§6) — the first decorative GLB, and the test of whether §1's split holds up in
   practice.

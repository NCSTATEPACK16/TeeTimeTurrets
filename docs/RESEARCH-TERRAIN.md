# TeeTimeTurrets — Research: Procedural Course Generation

Second research pass, received 1 Sep 2026. Separate from `RESEARCH-FINDINGS.md`, which holds
the answers to `RESEARCH-NEEDED.md`'s six numbered questions — this one answers a different
brief (terrain topology, point generation, biome delineation, height formulation, and route
carving) and burying it there would hide both.

**What it settles:** whether the playable course stays procedural or becomes authored
geometry, and how a dog-leg hole is produced without abandoning `surfaceAt(x, z)` as a pure
function. **Its answer is procedural**, with hole *shape* coming from a spline whose control
points are seeded or authored — not from noise alone. Nothing in it requires or mentions
imported mesh assets, so `AGENTS.md`'s no-`.glb` rule is unaffected.

**Status: not yet adopted.** Read the reconciliation section below before implementing any
number from §4.2.

---

## Reconciliation with this codebase — read first

Checked against `src/sim/terrain.ts` and `src/sim/surfaces.ts` at the time the research
landed. Three things line up exactly; two do not, and one of those is load-bearing.

### Confirmed — the research was written against the real numbers

- **`crr` values match `SURFACES` exactly.** Green `0.06`, fairway `0.11`, rough `0.22` are
  the values already in `surfaces.ts`. The slope ceilings the research derives from them
  (3.43° / 6.27° / 12.4°) therefore apply to this project directly, with no translation.
- **`crr ≥ tan(θ)` is already the codebase's own model.** `surfaces.ts` documents `rolling`
  as setting "the steepest grade a ball will hold on that surface, at atan(crr)." The
  research's contribution is turning that from a *description* into a *generation
  constraint*, which is new and is the useful part.
- **Ball radius `0.15 m` matches**, so §1.2's 0.05 m physics/render divergence budget
  (one-third of the radius) transfers unchanged.
- **C¹ smoothstep blending is already the established idiom.** `heightAt` blends its flat
  pads with `smoothstep01` for exactly the reason §5.2 gives. §5.2 is that pattern
  generalised from a circular pad to a spline corridor, not a new concept.

### Discrepancy 1 — the gradient constant `k`, measured, and it is material

§4.1 states the maximum gradient of a single Simplex octave is `A · f · k` with **`k ≈ 2.5`**.
`terrain.ts` states the same relation with **`k = 2π ≈ 6.28`**. The whole of §4.2's amplitude
table is derived from whichever is right, so it was measured directly against the installed
`simplex-noise` build rather than argued — the same discipline Phase 0 applied to the Rapier
heightfield row/column convention.

**Method:** central differences (`h = 1e-4`) on unit-amplitude, unit-frequency `createNoise2D`,
1,002,001 samples over a 20 × 20 domain at 0.02 spacing.

| statistic of ‖∇S‖ | measured |
|---|---|
| **max** | **7.333** |
| rms | 2.955 |
| mean | **2.672** |

**Neither source is right, and the research's 2.5 is the mean gradient, not the maximum.**
The true peak is 7.333 — 2.9× the research's figure and 1.2× `terrain.ts`'s.

Cross-checked against the shipped two-octave terrain (`HEIGHT_AMPLITUDE 0.85`,
`NOISE_FREQUENCY 0.028`, detail `0.15` / `2.6`), sum-of-max at `k = 7.333` predicts **13.6°**
max against the probe's measured **12.5°**, and **5.1°** mean against **4.3°**. Slightly
conservative — octave peaks rarely coincide — but the right scale, and a usable budget.

Re-deriving §4.2's table at the measured constant:

| Layer | published grad | **actual grad at k = 7.333** | vs green 0.06 | vs fairway 0.11 |
|---|---|---|---|---|
| Micro | 0.03 (1.7°) | **0.088 (5.0°)** | **exceeds alone** | ok |
| Meso | 0.07 (4.0°) | **0.205 (11.6°)** | **exceeds alone** | **exceeds alone** |
| Macro | 0.18 (10.2°) | **0.528 (27.8°)** | must be fully masked | must be fully masked |

Micro + Meso is **0.293 — about 16.3°**, past even the rough's 12.4° ceiling. Implemented as
published, §4.2 produces terrain *steeper than the terrain Phase 0 already had to fix*. It is
a regression, not an improvement.

**Corrected amplitudes**, holding the research's target gradients and solving `A = target / (f · k)`:

| Layer | f | target grad | published A | **corrected A** |
|---|---|---|---|---|
| Micro | 0.1 | 0.03 | 0.12 m | **0.041 m** |
| Meso | 0.02 | 0.07 | 1.40 m | **0.477 m** |
| Macro | 0.005 | 0.18 | 14.40 m | **4.91 m** |

Two consequences beyond the numbers:

- **§5.3's "80–85% of seeds pass" does not carry over.** That pass rate was computed from the
  published amplitudes. At corrected amplitudes the terrain is far gentler, so the rate should
  be *higher* — but it is unmeasured, and the rejection loop needs its own measurement before
  anyone relies on "1–3 iterations."
- **The reproduction script belongs in the repo.** `k` is a property of the installed
  `simplex-noise` build, so it can change under a dependency bump and silently invalidate every
  amplitude above. It wants to be an assertion in `npm run probe`, not a number in a document.

### Discrepancy 2 — the green's slope budget is over-committed as published

§4.2 says the octave gradients acting on a coordinate must sum under the surface's `tan(θ)`,
then notes only that the **Macro** layer needs masking. But Micro + Meso as published is
`0.03 + 0.07 = 0.10`, already above the green's `0.06` before Macro contributes anything.

So the corridor mask in §5 must attenuate **Meso as well as Macro** over the green, not Macro
alone. §5's `lerp` toward `H_spline` does this in practice — the note in §4.2 is what is
incomplete, not the design.

### What is genuinely new work, beyond the research's own scope

**`terrain.ts` is a module-level singleton, and that blocks 9 holes before anything here
does.** `FIELD_SIZE`, `TEE_XZ`, `CUP_XZ`, `PADS`, `TEE_POSITION`, `CUP_POSITION` are all
module constants evaluated at import, and both noise generators are seeded with hardcoded
literals (`0.42`, `0.77`). A second hole cannot exist while that is true, let alone a second
course. The research assumes a seed can be injected; in this codebase it cannot yet. That
refactor is a prerequisite for adopting any of §5, and it is not named anywhere in
`ROADMAP.md` or `BACKLOG.md`.

Related: `BACKLOG.md #5` already wants `mulberry32` ported for aim spread. §2.4's
coordinate-hashed variant is a superset of that need — one port, two consumers.

**Physical properties are discontinuous today.** §3.4 requires `crr` to blend continuously
across biome boundaries or the solver registers an acceleration step and the ball visibly
jerks. `tuningAt` currently returns a discrete `SurfaceTuning` from a priority list, so every
boundary — green edge, bunker edge, fairway edge — is a step today. Phase 1.5's gate passed
with this, so it is latent rather than fatal, but §3.4 is describing a real defect in shipped
code, not only a constraint on new code.

**`distanceToFairwayLine` is a straight segment.** §5.1's centripetal Catmull-Rom spline
replaces it directly and cleanly — same signature, same call sites, dog-legs fall out.

**New dependency.** §3.1 requires `delaunator` (mapbox, ISC). Only needed if the Delaunay
render mesh of §1–§3 is adopted; §4–§5 need nothing new.

---

## Procedural Generation of Deterministic Low-Poly Terrain for Physics-Based Golf Simulation

*Verbatim below except for notation cleanup: the source's LaTeX markup and conversion
artifacts were rendered into plain math and inline code. No substantive edits.*

### 1. Physics Topology and Collider Architecture

The foundation of an authoritative, physics-based multiplayer simulation is the strict
determinism and spatial stability of its collision geometry. Given the strict architectural
requirement to execute a 60 Hz fixed-timestep physics simulation in a headless Node.js
environment utilizing Rapier 0.20 (WASM), the choice of collider topology governs all
subsequent architectural decisions regarding point generation and terrain rendering. The
evaluation must consider the behavior of a small, fast-moving spherical projectile (a golf
ball with r = 0.15 meters) traversing the surface.

#### 1.1 Heightfield vs. Trimesh Colliders in Rapier

Rapier supports both regular Heightfields and irregular Trimeshes. Evaluating these against
the specific constraints of a golf simulation reveals critical behavioral, performance, and
deterministic differences.

The performance characteristics of these two collider types differ fundamentally at the
narrow-phase collision detection stage. Rapier's Heightfield operates as a 2.5D structure.
When the physics solver evaluates the spatial coordinates of the spherical collider, it maps
these coordinates directly to the underlying regular grid via an O(1) index calculation. The
solver then tests the sphere against a maximum of two triangles corresponding to the
bilinearly split quad at that coordinate. Conversely, a Trimesh collider requires a Bounding
Volume Hierarchy (BVH) lookup. While the underlying collision library optimizes this
traversal, a Trimesh still imposes an O(log N) traversal cost per active collision pair. In a
dense multiplayer scenario executed on a headless server, the Heightfield presents a
mathematically superior optimization for the CPU budget.

Beyond raw performance, rigid-body physics engines historically suffer from behavioral
anomalies known as "ghost collisions" or "ball-catching." This phenomenon occurs when an
object sliding across a tessellated plane collides with the internal edges of coplanar or
nearly coplanar triangles. The constraint solver temporarily treats the edge of a triangle as
a solid boundary rather than a continuous planar surface, resulting in abrupt, spurious
vertical impulses that launch the rolling ball into the air. In Rapier 0.20, recent updates
modified how internal edges are processed, requiring explicit flags such as
`TriMeshFlags.FIX_INTERNAL_EDGES` and `HeightFieldFlags.FIX_INTERNAL_EDGES` to aggressively
filter interior edge contacts.

Despite these flags, the topological uniformity of a Heightfield renders its internal edge
normals highly predictable, allowing the physics solver to reject invalid contact manifolds
with far higher reliability than it can for an irregular Trimesh. A golf ball traversing an
irregular Trimesh composed of highly acute triangles is significantly more prone to normal
discontinuities and chatter.

Continuous Collision Detection (CCD) is another critical factor. At 60 Hz, a golf ball driven
at 60 meters per second travels 1.0 meter per tick. Without CCD, the ball will tunnel through
any geometric peak or boundary narrower than 1.0 meter. Rapier's CCD implementation utilizes
a non-linear time-of-impact (TOI) sweep. Sweeping a sphere against a regular Heightfield's
analytic bounds is far more stable than sweeping against the potentially degenerate or
overlapping spatial bounds of a dense Trimesh BVH, where near-tangent directions can return
unreliable normals.

#### 1.2 Decoupling Physics and Render Topologies

To satisfy the low-poly, flat-shaded aesthetic (Constraint 5) while maintaining the absolute
physics stability required for a golf simulation, the optimal architecture strictly decouples
the render mesh from the physics collider.

The standard practical approach dictates establishing a Rapier Heightfield defined on a
regular 1.0-meter grid for physics, while simultaneously constructing an irregular Delaunay
mesh (a trimesh) assembled into a Three.js `BufferGeometry` at runtime for rendering.

The primary failure mode of this decoupled architecture is the spatial disagreement between
the two representations. Because both structures sample the exact same pure mathematical
height function `y = H(x, z)`, the divergence arises entirely from interpolation. A
Heightfield interpolates heights bilinearly (or via two fixed triangles) across a 1.0 × 1.0
meter quad. An irregular Delaunay mesh interpolates heights linearly across triangles that
may span several meters. If a Delaunay triangle spans a concave valley present in the height
function, the physics Heightfield will accurately model the valley, but the visual mesh will
form a flat polygon bridging the depression. A ball rolling into this valley will physically
sink below the visual floor, breaking immersion.

Given the golf ball radius of r = 0.15 meters, the maximum acceptable vertical divergence
between the physics grid and the render mesh is roughly 0.05 meters (one-third of the radius)
before the visual intersection becomes problematic. This threshold dictates a strict density
constraint on the point generation step: the render mesh cannot feature excessively large
triangles in areas of high topographic curvature.

#### 1.3 Point-Location and the Pure Functional Mapping

Constraint 4 establishes that `surfaceAt(x, z)` must remain a pure function returning surface
biome data without authored zone states. An irregular physics mesh usually forces the
implementation of spatial lookups (e.g., BVH, quadtrees, or grid-hashing) to determine which
triangle a physical point occupies. However, by driving both the terrain height and the
surface classification through continuous 2D mathematical fields evaluated at (x, z), the
dependency is inverted.

The architecture does not query the generated mesh to deduce the biome; it queries the
mathematical field. Therefore, deploying an irregular visual mesh does not force the
abandonment of `surfaceAt(x, z)` as a pure function. The authoritative multiplayer server
evaluates `H(x, z)` and `surfaceAt(x, z)` directly using the injected deterministic seed. No
complex spatial hierarchy is required for gameplay logic, eliminating the synchronization of
a BVH between client and server.

If an edge-case arises requiring exact point-location within the render mesh (e.g., rendering
a decal exactly on the visual facet), the cheapest deterministic structure is the Delaunator
half-edge array itself. A directed walk algorithm can locate the enclosing triangle for any
arbitrary point in O(√N) expected time by traversing the half-edges iteratively toward the
target coordinate. This avoids building a separate spatial index, leveraging the topology the
client already computed.

| Feature Matrix | Rapier Heightfield | Rapier Trimesh |
|---|---|---|
| Lookup Complexity | O(1) Spatial Index | O(log N) BVH Traversal |
| Topology | Strict 2D Regular Grid | Irregular 3D Mesh |
| Internal Edge Stability | Highly stable with flags | Subject to acute angle failures |
| CCD TOI Sweeping | Analytically stable bounds | Vulnerable to near-tangent errors |
| Aesthetic Output | Uniform grid (Artifacts visible) | Organic, varied low-poly facets |
| **Recommendation** | **Deployed for Physics** | **Deployed for Rendering** |

### 2. Point Generation: Grid Jittering vs. Poisson-Disc Sampling

Generating the vertices for the low-poly render mesh requires evaluating standard
distribution algorithms against the strict determinism and functional purity constraints of
the system.

#### 2.1 The Mathematical Constraints of Determinism

Bridson's algorithm for Poisson-disc sampling is an O(N) active-list generation technique
favored for blue-noise spatial distributions. While highly optimized implementations are fast
enough to execute in milliseconds for tens of thousands of points in a V8 JavaScript
environment, the algorithm possesses a fatal architectural flaw for this stack: it is
inherently stateful and sequential.

To generate the n-th point, Bridson's algorithm relies entirely on the spatial existence of
the (n−1)-th point in the active list. If an authoritative server needs to evaluate the
terrain topology of a single chunk without generating the entire 160×160 meter map,
Poisson-disc fails because it cannot be mapped as a pure function.

Grid Jittering, conversely, maps trivially to a pure function:

```
P(i, j) = ( i · size + Δx ,  j · size + Δz )
```

Where Δx and Δz are deterministic pseudo-random offsets generated by a seed unique to the
cell coordinate (i, j). Because any point can be computed independently of its neighbors in
O(1) time, the generator remains entirely stateless, functionally pure, and capable of
infinite parallelization or localized sampling.

#### 2.2 Achieving Variable Density Without Circular Dependencies

The visual requirements dictate varying point density based on the surface type: dense on the
green to support sub-meter fidelity for putting, medium on the fairway, and sparse in the
rough or on boundary mountains. A circular dependency arises if point density relies on the
surface type, but the surface type is only known after the mesh is constructed.

Because `surfaceAt(x, z)` is a pure mathematical field relying solely on procedural noise and
spline distance fields (established in Section 5), it can be evaluated before any points are
generated. To resolve the dependency, the system must utilize a Hierarchical Grid Jittering
(Quadtree) approach.

The algorithm proceeds as follows:

- **Define a Macroscopic Grid:** Initialize a base grid utilizing large cells (e.g., 4.0
  meters) covering the 160×160 meter field.
- **Evaluate Sub-division:** For each macroscopic cell, evaluate `surfaceAt(center_x, center_z)`.
- **Recursive Splitting:**
  - If the function returns `GREEN`, split the cell into 16 smaller cells (1.0 meter each).
  - If it returns `FAIRWAY`, split the cell into 4 cells (2.0 meters each).
  - If it returns `ROUGH`, `SAND`, or `MOUNTAIN`, apply no split (4.0 meters).
- **Deterministic Jitter:** Apply a deterministic offset to the center of each finalized cell.
  To prevent mesh inversion (overlapping triangles), the jitter magnitude is mathematically
  constrained to a maximum of ±0.4 × cell_size.

This strict operational order guarantees that the mathematical domain dictates the discrete
mesh density, preserving the linear flow of generation without cycles.

#### 2.3 Visual Outcomes Under Flat Shading

Flat shading heavily exposes the underlying geometric topology. A standard orthogonal
jittered grid, even when heavily offset, betrays a pervasive diagonal anisotropy. The human
visual system rapidly detects the structural alignment, reading the terrain as a warped
chessboard rather than a natural landscape.

To break this orthogonal artifact while preserving the stateless purity of grid jittering,
the base structure must be initialized as a Hexagonal (Triangular) Grid before jittering is
applied. By offsetting every alternating row by 0.5 × cell_size along the X-axis, the base
grid naturally forms equilateral triangles. When deterministic jitter is introduced, a
hexagonal base closely mimics the isotropic, organic blue-noise distribution of Poisson-disc
sampling, successfully eliminating orthogonal artifacts under flat shading.

#### 2.4 Deterministic Seeding via Mulberry32

To strictly fulfill Constraint 3, JavaScript's native `Math.random()` must be entirely
excised, as it relies on internal engine state and provides zero guarantees of cross-platform
determinism. The optimal replacement is Mulberry32, a 32-bit state pseudo-random number
generator (PRNG) that utilizes fast bitwise operations to yield evenly distributed
floating-point numbers in the range [0, 1).

To maintain absolute statelessness across the grid, the system cannot advance a single PRNG
instance sequentially. Instead, it must hash the integer spatial coordinates (i, j) combined
with the global level seed to construct a unique, deterministic state for every single
vertex:

```ts
function hashCoordinates(seed: number, i: number, j: number): number {
  // Force inputs to 32-bit integers and mix using prime constants
  let state = (seed + Math.imul(i, 0x85ebca6b) + Math.imul(j, 0xc2b2ae35)) >>> 0;
  // Avalanche bit-mixing matching Mulberry32 internal cascades
  state = Math.imul(state ^ (state >>> 15), state | 1);
  state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
  return (state ^ (state >>> 14)) >>> 0;
}

function randomFloat(state: number): number {
  // Convert the 32-bit unsigned integer to a [0, 1) float
  return state / 4294967296.0;
}
```

By utilizing coordinate-hashed Mulberry32 operations, the client and authoritative server are
mathematically guaranteed to produce byte-identical floating-point offsets for any vertex,
evaluated in any arbitrary execution order, completely fulfilling the requirements of the
DOM-free Node environment.

### 3. Triangulation and Biome Delineation

Following the generation of the variable-density, jittered point cloud, the points must be
triangulated to construct the irregular render mesh.

#### 3.1 Delaunay Triangulation Execution

For rapid, load-time triangulation of a 2D point set in JavaScript, the Delaunator library is
the prevailing standard. Utilizing a highly optimized sweep-circle algorithm (a robust
variant of Fortune's and Bowyer-Watson algorithms), Delaunator is capable of triangulating
millions of points in under 500 milliseconds.

The library operates strictly on a 1D flat `Float64Array` formatted as
`[x0, z0, x1, z1, ...]`. It outputs a `triangles` array (a `Uint32Array` of indices mapping
back to the input coordinates) and a `halfedges` array (an `Int32Array` defining adjacency).
Because the stack relies on Three.js `BufferGeometry`, the application iterates through the
Delaunator output at runtime, evaluates `y = H(x, z)` for each indexed coordinate, and packs
a `Float32Array` representing the finalized 3D vertices and their associated normals.

#### 3.2 Delaunay Isotropy vs. Fairway Anisotropy

Delaunay triangulation mathematically maximizes the minimum interior angle of all triangles
in the mesh, actively avoiding long, "skinny" triangles (slivers). This inherent property
drives the overall mesh topology toward equilateral configurations.

For a golf surface, near-equilateral triangles are highly desirable for the visual aesthetic
of the rough, sand traps, and boundary mountains. However, along the fairway axis,
anisotropic triangles (elongated parallel to the direction of play) theoretically offer a
smoother visual representation of the functional corridor and slightly reduce the polygon
count.

Applying anisotropic triangles via Delaunay triangulation requires distorting the input
space. An algorithm would apply a non-uniform scale (e.g., compressing the Z-axis), execute
the triangulation, and then revert the transformation on the resulting vertices. Given the
requirement for dog-leg holes, the axis of anisotropy constantly rotates along the curving
spline of the fairway. Transforming the 2D domain to align continuously with a curving
Catmull-Rom spline is computationally hostile and violates the simplicity of a global
triangulation step.

The recommendation is to accept the near-equilateral properties of the Delaunay algorithm for
the entire mesh. The low-poly aesthetic fundamentally thrives on uniform geometric density.
Attempting to enforce spline-aligned anisotropy strictly on the fairway will generate highly
visible, jagged "seams" where the anisotropic fairway polygons connect abruptly to the
isotropic rough polygons.

#### 3.3 Voronoi Cells vs. Pure Functional Boundaries

The geometric dual of a Delaunay triangulation is the Voronoi diagram. In a Voronoi-based
biome classification system, every generated point acts as a discrete "site," and the
resulting polygonal face strictly inherits the biome classification of its site.

If biomes are defined strictly by Voronoi cells, every visible polygonal facet possesses
exactly one pure biome. Under flat shading, a triangle is either entirely fairway or entirely
rough. This creates a crisp, highly faceted boundary between zones that perfectly complements
the low-poly aesthetic.

Conversely, if the system relies exclusively on the mathematical `surfaceAt(x, z)` function
using distance-to-corridor and noise thresholds to color the mesh, the boundaries manifest as
continuous mathematical curves. When a Delaunay triangle bridges a biome boundary, one vertex
might evaluate as fairway, while the other two evaluate as rough. This scenario forces the
rendering engine to either interpolate vertex colors (which destroys the crisp, unlit
flat-shaded aesthetic by introducing gradients) or procedurally subdivide the triangle at the
exact mathematical boundary (which is computationally intensive and introduces microscopic
slivers into the mesh).

#### 3.4 Blending Physical Properties Across Cell Boundaries

While visual boundaries must remain crisp utilizing Voronoi inheritance, the underlying
physical properties must remain perfectly continuous. If a golf ball rolling across a facet
suddenly experiences a discrete, instantaneous jump in rolling resistance (`crr`) from 0.11
(fairway) to 0.22 (rough), the constraint solver will register a massive acceleration
discontinuity, causing the ball to visibly jerk or halt unnaturally.

To resolve this dichotomy, the physics simulation must completely ignore the visual Voronoi
facets. When evaluating rolling resistance or restitution at the ball's current physics
position (x, z) during a Rapier tick, the solver queries the continuous mathematical function
rather than the mesh:

```
crr_actual = lerp( crr_fairway, crr_rough, smoothstep(R_inner, R_outer, d_spline(x, z)) )
```

The rendering engine paints discrete triangles based on the biome at the triangle's centroid
to preserve the low-poly aesthetic, while the Rapier simulation experiences a perfectly
smooth, differentiable gradient of physical resistance as the ball approaches the edge of the
fairway.

### 4. Height Formulation and Noise Layering

The topographic elevation of the golf course, expressed as the function `H(x, z)`, must be
orchestrated using multi-octave Simplex noise. As emphasized by the constraints, slope is the
absolute playability constraint, not raw height.

#### 4.1 The Analytics of Simplex Slope

Simplex noise `S(x, z)` natively outputs pseudo-random values in the range [−1, 1]. An
individual octave of noise is defined by an amplitude A and a frequency f:

```
h(x, z) = A · S(f · x, f · z)
```

Because Simplex noise is constructed from analytical gradients, it is possible to compute its
maximum spatial derivative. The maximum gradient magnitude of a standard 2D Simplex function
is empirically bounded by a constant factor k ≈ 2.5 (derived from the normalization factors
of the simplex grid). Therefore, the absolute maximum slope (gradient magnitude) contributed
by a single octave is bounded by:

```
max ‖∇h‖ ≈ A · f · k
```

The geometric slope angle θ is defined as `arctan(‖∇h‖)`.

> **This constant is wrong — see "Discrepancy 1" above.** Measured against the installed
> build, max ‖∇S‖ = **7.333**. The value 2.5 is the *mean* gradient (measured 2.672), not the
> maximum. Every amplitude derived from it is ~2.9× too large.

#### 4.2 Slope Budgets and Rolling Resistance (crr)

A spherical object resting on an inclined plane experiences a gravitational force component
`F_g = m · g · sin(θ)` acting downwards along the slope, and a rolling resistance force
`F_r = m · g · crr · cos(θ)` opposing the direction of motion. The ball comes to rest only if
the resistance equals or exceeds the gravitational pull: `F_r ≥ F_g`. This simplifies to the
hard physical threshold:

```
crr ≥ tan(θ)
```

Given the baseline `crr` values, the maximum tolerable angles for playability are strictly
mathematically bounded:

- **Green:** crr = 0.06 ⟹ θ_max = arctan(0.06) = 3.43°
- **Fairway:** crr = 0.11 ⟹ θ_max = arctan(0.11) = 6.27°
- **Rough:** crr = 0.22 ⟹ θ_max = arctan(0.22) = 12.4°

To guarantee that a green never exceeds 3.43°, the sum of all maximum gradients from the
active noise octaves acting upon that coordinate must not exceed tan(3.43°) = 0.06.

The recommended strategy establishes three primary procedural noise layers, each allocated a
specific slope budget to ensure playability:

| Noise Layer | Spatial Freq (f) | Target Max Grad | Allowable Amplitude (A) | Topographic Role |
|---|---|---|---|---|
| Micro (Detail) | 0.1 | 0.03 (1.7°) | 0.12 m | Minor surface ripples |
| Meso (Contours) | 0.02 | 0.07 (4.0°) | 1.40 m | Gentle undulating hills |
| Macro (Layout) | 0.005 | 0.18 (10.2°) | 14.40 m | Large regional elevations |

*Note: The Macro layer produces gradients that exceed the strict limits for Greens and
Fairways. The amplitude of this layer must be dynamically masked based on the distance to the
fairway spline.*

> **Do not implement this table as published.** At the measured k = 7.333 it yields Micro
> 0.088, Meso 0.205, Macro 0.528 — Micro alone busts the green and Micro + Meso (0.293, 16.3°)
> busts even the rough. Corrected amplitudes are in "Discrepancy 1" above; the masking gap is
> "Discrepancy 2."

#### 4.3 Boundary Mountains and Domain Warping

To generate steep, dramatic boundary mountains framing the 160×160 meter field without
leaking unplayable gradients into the fairway, the amplitude of the Macro noise must be
spatially scaled utilizing an envelope function `E(x, z)`.

```
H_boundary = E(x, z) · A_mountain · S_mountain(x, z)
```

The envelope `E(x, z)` must evaluate to precisely 0.0 over the interior playable area (e.g.,
20 m to 140 m) and ramp sharply to 1.0 near the map edges.

Domain warping involves offsetting the input coordinates of a noise function by the output of
another noise function, effectively distorting the spatial grid:
`H(x, z) = S(x + D(x, z), z + D(x, z))`. While domain warping generates aesthetically
superior, wind-swept ridges and organic overhangs, it actively destroys mathematical slope
predictability. The chain rule of derivatives causes the local gradient to multiply
unpredictably, creating isolated microscopic spikes in slope that easily exceed the rolling
resistance threshold.

The strict recommendation is to **ban domain warping entirely on playable surfaces** (Green,
Fairway, Sand). It should be deployed exclusively within the boundary mountain envelope where
`E(x, z) ≈ 1.0` and playability is intentionally impossible.

### 5. Deformation for Gameplay: Carving the Playable Route

To support non-linear dog-leg holes, the straight tee-to-cup fairway segment must be replaced
by a parameterized spline, and a playable corridor must be carved into the multi-octave
noise.

#### 5.1 Centripetal Catmull-Rom Splines

For the corridor centerline, the system should implement a Centripetal Catmull-Rom Spline.
Standard (uniform) Catmull-Rom splines compute tangents that often produce violent loops,
cusps, and self-intersections when the underlying control points are placed at varying
spatial distances. The centripetal parameterization (α = 0.5) mathematically prevents the
formation of cusps and guarantees that the curve remains strictly bounded by its control
polygon, producing smooth, highly predictable dog-legs.

The fairway path is defined by a minimum of three 2D control points: P₀ (Tee box), P₁
(Dog-leg apex), and P₂ (Green center).

#### 5.2 Terrain Carving and C¹ Continuity

To carve the fairway corridor into the noise landscape, the algorithm must blend the raw
procedural height `H_noise(x, z)` with a targeted, flattened corridor height
`H_spline(x, z)`.

Terracing is a common procedural technique that quantizes height to create flat steps
separated by steep cliffs. This is fundamentally incompatible with physics-based golf, as
rolling balls become irreversibly trapped against the vertical cliff faces. Spline Masking
(continuous blending) is the mathematically correct approach, offering absolute control over
the slope guarantees established in Section 4.

The blended terrain height evaluates as:

```
H_final(x, z) = lerp( H_spline(x, z), H_noise(x, z), M(d) )
```

Where d is the shortest 2D Euclidean distance from the coordinate (x, z) to the spline curve,
and M(d) is the masking weight ranging from [0, 1].

A C¹ continuous surface mandates that there are no sudden changes in normal vectors (i.e., no
visible geometric creases). If the mask M(d) employs a linear interpolation (e.g., d / R),
the spatial derivative steps instantaneously from zero to a constant value at the boundary
distances d = 0 and d = R. This instantaneous step results in a visible seam in the low-poly
rendering and, critically, a physical edge that can act as a ramp, launching a fast-rolling
ball into the air.

To guarantee C¹ continuity, M(d) must possess a derivative of exactly 0.0 at its blending
boundaries. The standard mathematical polynomial for this requirement is the smoothstep
function:

```
S₁(t) = 3t² − 2t³
```

Or the C² continuous smootherstep function:

```
S₂(t) = 6t⁵ − 15t⁴ + 10t³
```

Assuming a fairway half-width of 15 meters and a 10-meter blending region transitioning into
the rough:

```
t    = clamp( (d − 15) / 10 , 0.0, 1.0 )
M(d) = S₁(t)
```

By applying the smoothstep polynomial, the rigidly flattened tee and green corridors
transition into the jagged procedural rough with absolute geometric perfection, eliminating
all normal-vector snapping and preserving the integrity of the Rapier physics simulation.

#### 5.3 Guaranteed Completable Generation and Rejection Sampling

A fundamental design question is whether a playable route can be mathematically guaranteed by
inverse construction, or if it requires a generate-and-validate loop.

Because the underlying terrain is an aggregate of multi-octave noise, guaranteeing that the
baseline `H_noise` running parallel to the spline never exceeds the slope budget is
analytically complex due to the phase interference of the octaves. While `H_spline` scales
the geometry to flatten the fairway laterally (camber), the longitudinal slope (elevation
change from tee to green) is dictated primarily by the underlying macro noise interacting
with the spline path.

Attempting inverse procedural construction to force the noise to obey the path is
computationally heavier than brute-force validation. A generate-and-validate loop (rejection
sampling) is vastly more practical. Because the simulation is headless, operates purely on
mathematical fields, and avoids all DOM or Three.js overhead during generation, evaluating a
generated route requires less than a millisecond.

**The Validation Algorithm:**

- **Generate Spline Control Points:** The Mulberry32 PRNG selects a dog-leg apex relative to
  the Tee and Cup positions.
- **Discretize the Spline:** Sample the Catmull-Rom spline at 1.0-meter intervals from t = 0
  to t = 1.
- **Evaluate Gradients:** At each sample point, evaluate the longitudinal gradient ΔH/Δd and
  lateral gradient utilizing finite differences.
- **Check Playability Metrics:**
  - **Longitudinal Check:** Does the fairway climb continuously exceed tan(6.27°)? If so, the
    ball cannot be physically driven up the hill. The seed is rejected.
  - **Lateral Check (Camber):** Does the side-slope exceed tan(4.0°)? If so, balls will
    irreversibly roll off the fairway into the rough due to gravity overcoming crr. The seed
    is rejected.
  - **Green Check:** Sample a 10-meter radius around the cup. Does any local gradient exceed
    tan(3.43°)? If so, putts will never come to rest. The seed is rejected.
- **Iteration:** Given the noise parameters meticulously tuned in Section 4, empirical testing
  shows approximately 80–85% of generated seeds will pass all constraints. The validation loop
  will typically find a valid course in 1–3 iterations, executing so rapidly that no visible
  hitch occurs during server initialization or client load time.

---

## Works cited

1. Advanced collision-detection — Rapier.rs, https://rapier.rs/docs/user_guides/bevy_plugin/advanced_collision_detection/
2. Three.js Visual & Interactive Encyclopedia — A Complete Guide, https://neuralpixelgames.github.io/threejs-visual-guide/
3. Colliders — Rapier.rs, https://rapier.rs/docs/user_guides/rust/colliders
4. JavaScript Physics Engines Comparison — Cannon-es vs Rapier, https://www.mysimulator.uk/content/references/physics-engines-comparison.html
5. rapier/CHANGELOG.md at master — GitHub, https://github.com/dimforge/rapier/blob/master/CHANGELOG.md
6. parry/CHANGELOG.md at master · dimforge/parry — GitHub, https://github.com/dimforge/parry/blob/master/CHANGELOG.md
7. CHANGELOG.md — rapier.js — GitHub, https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md
8. mapbox/delaunator — GitHub, https://github.com/mapbox/delaunator
9. delaunator/README.md at main — GitHub, https://github.com/mapbox/delaunator/blob/master/README.md
10. Comparison to alternatives — startinpy 0.12.3 documentation, https://startinpy.readthedocs.io/latest/comparison.html
11. findTriangle() for D3.Delaunay and Delaunator / Fabian Iwand, https://observablehq.com/@mootari/delaunay-findtriangle
12. Bowyer-Watson Delaunay Triangulation neighbour walk in O(n^{1/d}), https://cs.stackexchange.com/questions/148452/bowyer-watson-delaunay-triangulation-neighbour-walk-in-on1-d
13. Support Generation for SLA, DLP, LCD 3D Printing — RapidMade, https://rapidmade.com/support-generation-for-sla-dlp-lcd-3d-printing/
14. Turbulent Noise VOP node — SideFX, https://www.sidefx.com/docs/houdini/nodes/vop/turbnoise.html
15. Creating Randomness Without Math.random — Andrew Healey, https://healeycodes.com/creating-randomness
16. [AskJS] Cryptographic random floats — r/javascript, https://www.reddit.com/r/javascript/comments/19c7mf5/askjs_cryptographic_random_floats/
17. Mulberry32: A Tiny, Fast, Deterministic RNG — Nikos Papadopoulos, https://www.4rknova.com/blog/2026/03/01/mulberry32-rng
18. Creating a Seeded Random String Generator in JavaScript — Medium, https://medium.com/@modos.m98/creating-a-seeded-random-string-generator-in-javascript-3165aae1c2d5
19. Understanding how to use Mulberry32 to achieve deterministic randomness in JavaScript, https://emanueleferonato.com/2026/01/08/understanding-how-to-use-mulberry32-to-achieve-deterministic-randomness-in-javascript/
20. Seeding the random number generator in JavaScript — Stack Overflow, https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript
21. JuliaGeometry/Delaunator.jl — GitHub, https://github.com/JuliaGeometry/Delaunator.jl
22. delaunator — UNPKG, https://app.unpkg.com/delaunator@5.0.1/files/README.md
23. Bowyer-Watson Algorithm for Delaunay Triangulation — Gorilla Sun, https://www.gorillasun.de/blog/bowyer-watson-algorithm-for-delaunay-triangulation/
24. Converting a Triangulation to a Navmesh in Unreal 4 — Maladius, https://maladius.com/posts/manual_detour_navmeshes_3/
25. Delaunay triangulation — Wikipedia, https://en.wikipedia.org/wiki/Delaunay_triangulation
26. Delaunator download — SourceForge.net, https://sourceforge.net/projects/delaunator.mirror/
27. Delaunay triangulations | D3 by Observable — D3.js, https://d3js.org/d3-delaunay/delaunay
28. (PDF) Simplex noise demystified — ResearchGate, https://www.researchgate.net/publication/216813608_Simplex_noise_demystified
29. Polynomial methods for fast Procedural Terrain Generation — arXiv, https://arxiv.org/html/1610.03525v4
30. Simplex Noise | briansharpe — WordPress.com, https://briansharpe.wordpress.com/2012/01/13/simplex-noise/
31. Making maps with noise functions — Red Blob Games, https://www.redblobgames.com/maps/terrain-from-noise/
32. Properties of Catmull–Rom Splines, https://splines.readthedocs.io/en/latest/euclidean/catmull-rom-properties.html
33. Catmull-Rom interpolation on SVG Paths — Stack Overflow, https://stackoverflow.com/questions/30748316/catmull-rom-interpolation-on-svg-paths
34. A Primer on Bézier Curves — Pomax, https://pomax.github.io/bezierinfo/
35. Curves in 3D — 3D Math Primer for Graphics and Game Development, https://gamemath.com/book/curves.html
36. Procedural Editing of Virtual Terrains Using 3D Bézier Curves, https://www.sbgames.org/sbgames2019/files/papers/ComputacaoFull/198326.pdf
37. SNOPT: An SQP Algorithm for Large-Scale Constrained Optimization, https://epubs.siam.org/doi/abs/10.1137/S0036144504446096
38. Evolutionary Black-box Topology Optimization: Challenges and Promises, https://cdfg.csail.mit.edu/assets/images/evolutionary-black-box-topology-optimization_-challenges-and-promises.pdf

---

## Provenance

Delivered as `Procedural Golf Course Generation.docx`, 1 Sep 2026. Converted to Markdown and
committed here; the original is not tracked (regenerable, and git stores binaries badly — same
reasoning as `docs/concept/README.md`'s full-resolution originals note).

The research was briefed with this project's real constraints — it cites "Constraint 3"
(no `Math.random()`), "Constraint 4" (`surfaceAt` stays pure), and "Constraint 5" (low-poly
flat-shaded), and its `crr` values and 160 m field size match the shipped code. Treat the
architecture as informed; treat the specific constants as needing the measurement described in
"Discrepancy 1."

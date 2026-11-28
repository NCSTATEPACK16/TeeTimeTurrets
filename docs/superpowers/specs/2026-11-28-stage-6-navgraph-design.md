# Stage 6: the bots' navigation graph

Written 2026-11-28. The spec for `docs/REVAMP-PLAN.md`, "Stage 6: navGraph". It settles what
`docs/SPEC-QUEUE.md` item 2 lists as missing. The user asked for the build straight after the
spec, as with Stage 5, so every question in §7 is built to its default. The play-test is where a
default gets overturned.

What the plan asked for, and where each item lands:

| Plan item | Here |
|---|---|
| `sim/navGraph.ts`, adapting the vendored `botRoutePlanner.ts`: a grid A* with a min-heap | §2, slice 1 |
| The grid covers the zone only; cell size and extent are parameters | §2.1 |
| Passable: the mobility table can drive the grade, and the cell is not water or woods; paths cheaper | §2.2 |
| Replan at most once a second; skip the plan with direct sight inside 80 m | §3.2, slice 2 |
| The graph builds in 150 ms or less | §2.4 |
| Tests: connected across the zone, around the hole-18 pond, never out of the zone, the build budget | §5 |

---

## 1. What exists today

Read from `main` at `28f3c06`.

- **Bots drive straight lines.** `computeBotIntent` (`src/sim/bot.ts`) steers at one point. That
  point is its target, or the zone's edge nearest the target (`botTargetScratch`), or a capture
  flag (`flagDrive`), or the nearest ammo or hot dog (`BotMind`).
- **Steering around buildings.** `detourAround` steers round one clubhouse building that stands in
  the line, by way of the building's nearer reachable corner. It is the only routing there is.
- **When stuck.** A bot with no headway for 2 s reverses on full lock for 1 s (`trackProgress`).
  Water and steep pond banks are what stop bots today. A bot whose target is across a pond drives
  into the pond and drowns, or wedges on the bank.
- **Trees are decoration.** Trees are render-only (`render/woodsPlacement.ts`) and have no
  collider, so carts drive through woods. "Not woods" in the plan therefore has nothing in the sim
  to read (§2.2).
- **The ground the sim stands on.** The baked 2 m grids (`courseGrids.ts`) give the sim its height,
  its class (water, sand and the rest) and its tuning.
  - The grids reach the sim as `Playfield`: `heightAt`, `surfaces`, `bounds`.
  - Climb limits come from `maxClimbRad(tyre, surfaceScale, accel)` (`mobility.ts`). On street tyres
    that is about 38.7° on fairway, and lower on rough and sand.
- **Every bot runs street tyres** (`new Cart({ ... })` in `Sim.create`, the default tyre).
- **The zone** (`arenaZone.ts`) is a simplified polygon of about 600 × 350 m, with `contains`,
  `clampInside` and `bounds`. Bots already aim only at points inside it.
- **The vendored planner** (`src/vendor/cot/botRoutePlanner.ts`, MIT, `NOTICE`) runs A* over a
  fixed ±500 m world in 25 m cells. Its per-plan arrays and heap nodes are allocated afresh on every
  call. It reads ground types `hard`, `medium` and `soft`, and draws seeded noise for role detours.

## 2. The graph (slice 1)

New `src/sim/navGraph.ts`: DOM-free, deterministic, no RNG. It adapts the vendored planner's
shape: a grid, 8-connected steps with √2 diagonals, a binary min-heap, and an octile heuristic.
It is not a copy. The world size, the cell size and the passability rules become parameters and
tables of our own. Every per-plan buffer is preallocated, so a plan allocates nothing in the tick.
`NOTICE` already credits the file it adapts; the new file names it in its header.

### 2.1 Extent and cells

- **Cell: 4 m** (Q1). The cart hull is 1.8 m across, and the cart paths are planned on the same
  4 m pitch (`cartPaths.ts`).
- **Extent: the zone's bounds**, padded by one cell. On the shipped course that is
  202 × 156 cells, about 31 thousand in all.
- **In the zone:** a cell counts only if its corners and edge midpoints, pushed 1 m further out,
  are all inside the zone polygon. Lines are walked at 1 m steps (§2.3), so every point on a clear
  line is within 0.5 m of a sample, and that sample is at least 1 m inside the zone. No route can
  leave the zone. A first build tested only each cell's centre, and pulled legs clipped the zone's
  concave corners.

### 2.2 Passability and cost

Each cell is **refused** when any of these holds:

- **Water** at its centre, or at any of eight points 3 m out (the corners and edge midpoints of a
  6 m square), so a passable cell keeps about a metre of dry ground past its own edge. A first
  build sampled only 1.2 m out. A routed cart then cut a corner 2.6 m wide of its line, into the
  pond.
- **Too steep to drive.** The grade from the centre to any of four points 1.2 m out is above `maxClimbRad` for street tyres on
  that cell's surface, times a 0.8 margin (Q2). On sand and rough the limit is lower than on
  fairway, so a steep bunker face is refused while a fairway bank of the same grade is not.
- **A clubhouse building,** grown by the hull radius plus 1 m (`clubhouseObstacles`).
- **Outside the zone** (§2.1).

**Woods are not refused** (Q3). The sim has no trees: a cart drives through a wood today, and a
graph that steered round decoration would send bots the long way round for nothing. If trees ever
get colliders, they join the refused list then.

**Cost** of a step is metres times the cell's resistance on street tyres (`tireResistance`).
Fairway is 1, rough 1.4, sand 2.0 and path 0.85, so paths are cheaper without a rule of their own.
Two more terms:

- **Grade.** Plus `4 × grade²`, so a bot prefers the flat way round a hill but will still take a
  gentle one.
- **Hazard margin.** Plus 1.5 on any cell beside a refused cell, so routes do not shave pond edges.

**Corners.** A diagonal step is allowed only when both of the orthogonal cells it passes are
passable, so a route never cuts the corner of a refused cell.

### 2.3 Planning

```ts
plan(fromX, fromZ, toX, toZ, out: NavRoute): boolean
```

- **Start and goal snap to the nearest passable cell.** The search is within 3 cells, rings in
  index order. A goal with no passable cell that near makes `plan` return false.
- **A\*** runs with an octile heuristic times the cheapest resistance (0.85), which keeps the
  heuristic admissible. Ties break on the lower cell index, so the plan is the same on every
  machine.
- **The search is capped at 20,000 expansions** (Q4). Past that `plan` returns false and the bot
  drives straight, as it does today.
- **The cells are pulled tight** into waypoints. From each kept point, skip ahead to the farthest
  later cell that a straight line reaches over passable cells only, walking the line at 1 m
  steps. Waypoints are cell centres. The last waypoint is the exact goal when the goal's own cell
  is passable, and the snapped centre when it is not.
- **`NavRoute` is preallocated:** a `Float32Array` of 64 waypoints (x, z) and a count. A longer
  pulled route keeps its first 63 waypoints and then the goal; replanning picks up the rest.
- **`lineClear(ax, az, bx, bz)`** is the same line walk, exported for §3.2's direct-sight skip.

### 2.4 Build budget

The graph is built once per `Sim`, in the constructor, from the playfield, the zone and the
obstacles. It is cached on the playfield and zone pair (a `WeakMap`), so a rematch on the same
ground does not rebuild it.

- **Budget: 150 ms** on the CI machine. Measured: 16–41 ms in a cloud container, for 202 × 156
  cells (the zone's bounds are wider than its 600 × 350 m core).
- Building means five ground samples per cell plus the obstacle test. The grids answer those in
  well under a microsecond each.

## 3. Following a route (slice 2)

### 3.1 What a bot routes to

Whatever it is driving at, after `world.ts` has chosen it: the target's drive point
(`botTargetScratch` and `flagDrive`), the ammo it needs, or the hot dog it is going for.

- **`detourAround` goes** (built): the graph refuses the buildings, so routes already go round them.
- **Unchanged:** distances, holding, standoff and firing are still measured to the real target and
  goal. Only the direction the bot **steers** changes.

### 3.2 When it replans

- **Direct sight skips the plan.** If the goal is within 80 m and `lineClear` from the bot to it
  holds, the bot steers straight at the goal, as today.
- **Otherwise plans are rationed.** Bot `i`'s slot is the tick where `tick % 60 === (i × 7) % 60`,
  so no two of seven bots plan on the same tick.
  - **At once:** after it respawns, after it finishes backing off from being stuck, and when it has
    no route and its goal has moved 12 m from the last goal it planned to.
  - **On its slot, at most once a second:** when it has no route (the last plan failed), or when its
    goal has moved more than 12 m from the goal its route was planned to.
- **Following the route.**
  - The bot steers at its current waypoint, and moves on to the next one within 6 m (Q5).
  - Each tick it also moves on when the waypoint after next is in direct sight, which smooths
    corners the pull left.
- **A failed plan** (no passable goal, or over the expansion cap) leaves the bot steering
  straight, as today, until the next planning tick.

### 3.3 Where it lives

- **`BotMind` gains:** `route` (a `NavRoute`), `routeAt` (the next waypoint index), `routeGoalX/Z`
  and `routeOn`. It also gains `steerX/steerZ` and `hasSteer`, which `computeBotIntent` uses for
  heading error in place of the goal whenever `hasSteer` is set.
- **Everything else in `computeBotIntent` is unchanged.** The pure function stays pure: `world.ts`
  writes the steer point each tick, as it already writes `ammoX/Z`.
- **No allocation per tick.** The route buffer is allocated once per bot, with its mind.

## 4. The golden

Bots that route drive differently, so the match changes. **The golden is re-recorded once, in
slice 2's commit**, from Linux x64, and that commit says why. Slice 1 adds the graph and wires
nothing to it, so it leaves the golden alone.

## 5. Smoke checks

One file per slice, each under 15 s, each seen to fail when the code it checks is broken
(`docs/TEST-AND-SPEC-PITFALLS.md`).

- **Slice 1, `src/sim/navGraph.test.ts`.** One shipped course and one graph, built once.
  - **Connected.** At least 97% of the passable cells are reachable from the clubhouse cell. The
    premise is that more than 5,000 cells are passable.
  - **Around the pond.** For the hole-18 pond, find two passable points on opposite sides whose
    straight line crosses water. The plan between them succeeds, every leg of the pulled route is
    clear of water at 0.5 m steps, and the route is longer than the straight line.
  - **Never leaves the zone.** 200 seeded start and goal pairs inside the zone. Every waypoint and
    every 1 m step along every leg is inside the zone.
  - **Build budget.** Building takes 150 ms or less, measured on a second build from fresh after
    one warm-up.
- **Slice 2, in the same file** (one course bake for both; the suite is near its cap). A real `Sim`
  on the shipped course, with no capture flags, because a lone bot is its side's flag runner and
  drives to the flags. One bot stands on one bank of the zone's widest pond and the idle player
  stands on the other.
  - **The pond:** hole 10's, 143 m bank to bank. The hole-18 pond the plan named is only about 11 m
    across inside the zone, and a straight-line bot crossed it dry.
  - **Routed:** the bot comes within `BOT_STANDOFF` + 6 m of the player within 30 s and never
    touches water.
  - **Control:** the same match with the graph removed. The straight-line bot is in the water
    first.

## 6. Slices

1. **The graph:** `navGraph.ts` and its test. Nothing wired. Golden unchanged.
2. **Bots follow it:** `BotMind`, `computeBotIntent`'s steer point and `world.ts`'s replanning;
   `detourAround` removed. The routing case in `navGraph.test.ts`. The golden is re-recorded. Play-test stop.

## 7. Questions (built to the default)

| # | Question | Default built |
|---|---|---|
| Q1 | Cell size | 4 m, the cart paths' pitch |
| Q2 | Margin under the climb limit | 0.8 × `maxClimbRad` for the cell's surface, on street tyres |
| Q3 | Do woods block? | No: trees have no collider. Revisit if they get one. |
| Q4 | Expansion cap | 20,000; over it the bot drives straight |
| Q5 | Waypoint reach | 6 m, a little under the cart's braking distance at top speed |
| Q6 | Per-bot route variety (the vendored planner's seeded detours) | None. Every bot takes the cheapest route. Add seeded cost noise if bots trail each other in single file. |
| Q7 | A player on off-road tyres: does it matter? | No. Only bots route, and bots run street tyres. |

# Targets, Ragdolls, and Health/Damage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give cart-mode combat real consequences — a ball knocks a capsule ragdoll down, a ball
or a cart shunt damages a cart, a dead cart takes a stroke penalty and respawns — resolved from
real Rapier collision events by a new `src/sim/combat.ts`.

**Architecture:** Four new leaf modules (`health.ts` pure, `stats.ts` pure, `entities/Target.ts`
Rapier-only, `combat.ts` orchestrator) plus wiring in `world.ts`. `combat.ts` is the only module
that touches `RAPIER.EventQueue`; `Cart.ts` stays Rapier-free and gains health/death/shunt state
the same way it gained `ammo`. Same leaf-module split the ammo system established: nothing new
imports `world.ts`.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`),
`@dimforge/rapier3d-compat` 0.20.0, Vitest in the **node** environment.

**Spec:** `docs/superpowers/specs/2026-09-02-targets-health-combat-design.md`

## Global Constraints

- `src/sim/**` and `src/physics/**` stay DOM-free and `three`-free (the node-env test suite is
  the enforcement).
- No `Math.random()` and no wall-clock time anywhere under `src/sim/**`.
- No per-tick allocation in `Sim.step`/`stepCart`/`processContacts` — reuse scratch objects.
- **A `KinematicCharacterController` receives no impulses.** Shunting is a velocity term `Cart`
  owns and decays, exactly like `recoil`. Never `applyImpulse` on the cart body.
- **CCD stays on the ball only** — never on a ragdoll part.
- Self-collision between ragdoll capsules is disabled via collision groups.
- Revolute joint limits are set on the **created joint object**, never on `JointData`;
  `JointData.stiffness`/`.damping` are inert and must not be used.
- `tsc --noEmit` clean and `npm test` green before any task is called done.
- Commits are `git commit -s` (DCO), with no AI-session metadata of any kind.

---

## Decisions this plan makes that the spec deferred (§9), and two departures from its sketches

**Tuning constants**, derived from `CLUB_STATS`'s achievable ball speeds (putter min 2 m/s →
driver max 40 m/s) against `STARTING_HP = 100`:

| Constant | Value | Reasoning |
|---|---|---|
| `DAMAGE_PER_MPS` | `1.5` | A full-charge driver (40 m/s) lands on the `MAX_HIT_DAMAGE` clamp; a mid-charge iron (~16 m/s) does 24. |
| `MIN_HIT_DAMAGE` | `5` | A putter tap (2 m/s → 3) still registers as a hit rather than as nothing. |
| `MAX_HIT_DAMAGE` | `60` | Two clean driver hits kill. A one-shot kill would make the respawn loop the whole game. |
| `SHUNT_DAMAGE_PER_MPS` | `0.8` | Two carts at `topSpeed` head-on close at ~28 m/s → 22 damage: ramming hurts, but shooting is the primary. |
| `SHUNT_MIN_SPEED` | `3` | Below this, contact is parking, not ramming — no damage, no shove. |
| `SHUNT_VELOCITY_TRANSFER` | `0.5` | Half the closing speed becomes each cart's `shuntVelocity`, decayed at `CART_TUNING.recoilDecay`. |

`STARTING_HP = 100` and `RESPAWN_DELAY_S = 3` are the spec's own placeholder-but-real values,
kept. The ragdoll uses **11 capsules** (the top of the spec's 7–11 range): pelvis, torso, head,
upper/lower arm ×2, upper/lower leg ×2.

**`BALL_DENSITY` is not raised, and that is a finding rather than a skipped step.** The spec (§2,
§7) and `ROADMAP.md` inherit the claim that `BALL_DENSITY = 1130` gives a "46 g ball" at a
~1:100 ratio against a torso. That mass is wrong for this project's ball: `BALL_RADIUS` is
`0.15` m (an arcade-scale ball, not a regulation 0.021 m one), so its volume is 0.0141 m³ and its
mass is **~16 kg**, not 46 g. Against this plan's torso capsule (`TARGET_DENSITY = 400`, ~23 kg)
the ratio is ~1:1.4 — already far inside the "≤ 1:20" criterion the decision demands. Raising the
density would only push the ball *past* the ragdoll's mass. Task 3 asserts the ratio as a test
against the real bodies, which is the criterion made executable; `docs/DECISIONS.md` gets a
correction note in Task 7. The post-impact velocity clamp the same decision asks for **is**
implemented (Task 3).

**Departure 1 — `processContacts` takes a registry, not bare arrays.** The spec's
`ctx: { targets; carts; stats }` has no way to answer "which entity owns collider handle 47?",
which is the only question a drained collision event can ask. `combat.ts` therefore owns a
`CombatRegistry` mapping `ColliderHandle → Actor`, and `world.ts` registers the ball, the pooled
balls, the cart and each target part as it creates them. Same dispatch, same three cases; the
lookup is explicit instead of implied.

**Departure 2 — `health.ts` lives at `src/sim/health.ts`, not `src/sim/entities/health.ts`.**
The spec says both (§1 and `ROADMAP.md` say `src/sim/health.ts`; §3's code comment says
`entities/`). `src/sim/health.ts` wins: it is what the roadmap item this fulfils names, and
`entities/` is for things that own Rapier bodies, which `health.ts` deliberately does not.

**One behavioural note the spec leaves implicit:** `knockDown` flips **every** part of the rig to
`Dynamic`, not just the struck one. A joint attached to a still-`Fixed` neighbour pins the
ragdoll in mid-air instead of shaping a collapse, so "and, via its joints, the rest of the rig"
is only achievable by flipping the whole rig.

---

## Task 1: Pure health model

**Files:**
- Create: `src/sim/health.ts`
- Test: `src/sim/health.test.ts`

**Interfaces:**
- Produces: `Health { hp: number; readonly max: number }`, `createHealth(max: number): Health`,
  `applyDamage(h: Health, amount: number): boolean`, `heal(h: Health, amount: number): void`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { applyDamage, createHealth, heal } from "./health";

describe("health", () => {
  it("starts full", () => {
    const h = createHealth(100);
    expect(h.hp).toBe(100);
    expect(h.max).toBe(100);
  });

  it("clamps hp at zero rather than going negative", () => {
    const h = createHealth(100);
    applyDamage(h, 250);
    expect(h.hp).toBe(0);
  });

  it("returns true only on the tick that crosses to zero", () => {
    const h = createHealth(100);
    expect(applyDamage(h, 40)).toBe(false);
    expect(applyDamage(h, 60)).toBe(true);
    expect(applyDamage(h, 10)).toBe(false);
  });

  it("ignores non-positive damage", () => {
    const h = createHealth(100);
    expect(applyDamage(h, 0)).toBe(false);
    expect(applyDamage(h, -10)).toBe(false);
    expect(h.hp).toBe(100);
  });

  it("heals up to max and no further", () => {
    const h = createHealth(100);
    applyDamage(h, 70);
    heal(h, 20);
    expect(h.hp).toBe(50);
    heal(h, 999);
    expect(h.hp).toBe(100);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/sim/health.test.ts`
Expected: FAIL — cannot resolve `./health`.

- [ ] **Step 3: Implement `src/sim/health.ts`**

```ts
/**
 * Pure HP model -- no Rapier, no timers, no entity knowledge. Damage is applied by combat.ts
 * and owned by whatever holds a Health (a Cart today; a target or a flag-carrier later).
 */

export interface Health {
  hp: number;
  readonly max: number;
}

export function createHealth(max: number): Health {
  return { hp: max, max };
}

/**
 * Returns true iff this call took hp from above zero to zero -- i.e. this is the killing blow.
 * Damage on an already-dead health is a no-op returning false, so two lethal contacts landing
 * in the same tick cannot double-trigger a death.
 */
export function applyDamage(h: Health, amount: number): boolean {
  if (amount <= 0 || h.hp <= 0) return false;
  h.hp = Math.max(0, h.hp - amount);
  return h.hp === 0;
}

export function heal(h: Health, amount: number): void {
  if (amount <= 0) return;
  h.hp = Math.min(h.max, h.hp + amount);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/sim/health.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/health.ts src/sim/health.test.ts
git commit -s -m "feat(sim): add pure health/damage model"
```

---

## Task 2: Round stats tracker

**Files:**
- Create: `src/sim/stats.ts`
- Test: `src/sim/stats.test.ts`

**Interfaces:**
- Produces: `Stats { shotsFired: number; directHits: number; targetsDown: number }`,
  `createStats(): Stats`, `accuracy(s: Stats): number`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { accuracy, createStats } from "./stats";

describe("stats", () => {
  it("starts at zero", () => {
    expect(createStats()).toEqual({ shotsFired: 0, directHits: 0, targetsDown: 0 });
  });

  it("reports zero accuracy before a shot is fired rather than dividing by zero", () => {
    expect(accuracy(createStats())).toBe(0);
  });

  it("reports hits over shots", () => {
    const s = createStats();
    s.shotsFired = 4;
    s.directHits = 1;
    expect(accuracy(s)).toBeCloseTo(0.25, 9);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/sim/stats.test.ts` → FAIL, cannot resolve `./stats`.

- [ ] **Step 3: Implement `src/sim/stats.ts`**

```ts
/**
 * Minimal round-scoped counters, deliberately not a round model. Phase 1.75's round.ts absorbs
 * this once it resumes (spec §6); until then it exists so the numbers the ResultsScreen will
 * want are real from the start rather than hardcoded zeros.
 */

export interface Stats {
  /** Cart-mode shots that actually spawned a ball -- a 0-ammo blank is not a shot fired. */
  shotsFired: number;
  /** Ball-vs-target and ball-vs-cart contacts resolved by combat.ts. */
  directHits: number;
  /** Distinct targets whose `isDown` flipped true. */
  targetsDown: number;
}

export function createStats(): Stats {
  return { shotsFired: 0, directHits: 0, targetsDown: 0 };
}

/** 0 rather than NaN before the first shot -- the HUD would render NaN%. */
export function accuracy(s: Stats): number {
  return s.shotsFired === 0 ? 0 : s.directHits / s.shotsFired;
}
```

- [ ] **Step 4: Run the test and watch it pass**

- [ ] **Step 5: Commit**

```bash
git add src/sim/stats.ts src/sim/stats.test.ts
git commit -s -m "feat(sim): add round stats counters"
```

---

## Task 3: Capsule ragdoll target

**Files:**
- Create: `src/sim/entities/Target.ts`
- Test: `src/sim/entities/Target.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TargetPart { body; collider; restTranslation }`, `Target` class with
  `readonly parts: TargetPart[]`, `isDown: boolean`, `knockDown(part: TargetPart, impulse:
  RAPIER.Vector): void`, `reset(): void`, `dispose(): void`; constants `TARGET_DENSITY`,
  `TARGET_GROUP`, `MAX_PART_LINVEL`, `MAX_PART_ANGVEL`.

Key rules, all from `DECISIONS.md` "Ragdolls": parts are `Fixed` until struck; revolute limits go
on the created joint; spherical elsewhere with distal-heavier angular damping; self-collision off
via collision groups; no CCD.

- [ ] **Step 1: Write the failing test**

```ts
import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_PART_LINVEL, Target } from "./Target";

const DT = 1 / 60;

function stepWorld(world: RAPIER.World, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.step();
}

describe("Target ragdoll", () => {
  let world: RAPIER.World;
  let target: Target;

  beforeAll(async () => {
    await RAPIER.init();
  });

  beforeEach(() => {
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = DT;
    world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
    target = new Target(world, { x: 0, y: 0, z: 0 });
  });

  it("holds its pose while undisturbed -- body type, not joints", () => {
    const head = target.parts[target.parts.length - 1];
    const before = { ...head.body.translation() };
    stepWorld(world, 300); // 5 s
    const after = head.body.translation();
    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeLessThan(1e-6);
    expect(target.isDown).toBe(false);
  });

  it("flips the whole rig to dynamic and collapses when struck", () => {
    const struck = target.parts[1];
    const headY = target.parts[target.parts.length - 1].body.translation().y;
    target.knockDown(struck, { x: 40, y: 0, z: 0 });
    expect(target.isDown).toBe(true);
    for (const p of target.parts) expect(p.body.isDynamic()).toBe(true);

    stepWorld(world, 180);
    expect(target.parts[target.parts.length - 1].body.translation().y).toBeLessThan(headY - 0.3);
  });

  it("clamps post-impact velocity so a hit cannot launch the rig", () => {
    target.knockDown(target.parts[1], { x: 100000, y: 0, z: 0 });
    stepWorld(world, 1);
    for (const p of target.parts) {
      const v = p.body.linvel();
      expect(Math.hypot(v.x, v.y, v.z)).toBeLessThanOrEqual(MAX_PART_LINVEL + 1e-3);
    }
  });

  it("does not buzz: adjacent capsules never collide with each other", () => {
    // Self-collision is off via collision groups, so a knocked-down rig settles instead of
    // vibrating forever. Measured as total speed after a long settle.
    target.knockDown(target.parts[1], { x: 30, y: 0, z: 0 });
    stepWorld(world, 600); // 10 s
    let total = 0;
    for (const p of target.parts) {
      const v = p.body.linvel();
      total += Math.hypot(v.x, v.y, v.z);
    }
    expect(total).toBeLessThan(0.5);
  });

  it("resets back to the held pose", () => {
    const head = target.parts[target.parts.length - 1];
    const posed = { ...head.body.translation() };
    target.knockDown(target.parts[1], { x: 40, y: 0, z: 0 });
    stepWorld(world, 120);
    target.reset();

    expect(target.isDown).toBe(false);
    for (const p of target.parts) expect(p.body.isFixed()).toBe(true);
    const back = head.body.translation();
    expect(back.x).toBeCloseTo(posed.x, 6);
    expect(back.y).toBeCloseTo(posed.y, 6);
    expect(back.z).toBeCloseTo(posed.z, 6);
  });

  it("keeps the ball-to-heaviest-part mass ratio inside the 1:20 criterion", () => {
    // DECISIONS.md "Ball mass" states the criterion; this asserts it against the real bodies
    // rather than against the 46 g figure that entry assumes (BALL_RADIUS is 0.15 m here, so
    // the ball is ~16 kg -- see the plan's note).
    const ballVolume = (4 / 3) * Math.PI * 0.15 ** 3;
    const ballMass = ballVolume * 1130;
    target.knockDown(target.parts[1], { x: 0, y: 0, z: 0 });
    let heaviest = 0;
    for (const p of target.parts) heaviest = Math.max(heaviest, p.body.mass());
    expect(heaviest).toBeGreaterThan(0);
    expect(ballMass).toBeGreaterThanOrEqual(heaviest / 20);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/sim/entities/Target.test.ts` → FAIL, cannot resolve `./Target`.

- [ ] **Step 3: Implement `src/sim/entities/Target.ts`**

Build the rig from a table of 11 capsules with parent/joint metadata, so the anatomy is data and
the construction loop is one code path. Use `RAPIER.RigidBodyDesc.fixed()` for every part;
`knockDown` flips them all with `setBodyType(RAPIER.RigidBodyType.Dynamic, true)`, applies the
impulse to the struck part, then clamps. Collision groups: membership bit 1 (`0x0002`), filter
every bit except that one (`0xFFFD`), so parts collide with the ground and the ball but never
with each other.

- [ ] **Step 4: Run the tests and watch them pass**

- [ ] **Step 5: Commit**

```bash
git add src/sim/entities/Target.ts src/sim/entities/Target.test.ts
git commit -s -m "feat(sim): add capsule ragdoll target held by body type"
```

---

## Task 4: Cart health, death and shunt state

**Files:**
- Modify: `src/sim/entities/Cart.ts`
- Test: `src/sim/entities/Cart.test.ts`

**Interfaces:**
- Consumes: `createHealth` from Task 1.
- Produces: `STARTING_HP`, `RESPAWN_DELAY_S`; `Cart.health: Health`, `Cart.dead: boolean`,
  `Cart.respawnTimer: number`, `Cart.shuntVelocity: Vec2XZ`, `Cart.revive(): void`.

- [ ] **Step 1: Write the failing tests** (append to `Cart.test.ts`)

```ts
describe("cart health and shunting", () => {
  it("starts alive at full HP", () => {
    const cart = new Cart();
    expect(cart.health.hp).toBe(STARTING_HP);
    expect(cart.dead).toBe(false);
  });

  it("adds shunt velocity into the desired translation like recoil does", () => {
    const cart = new Cart();
    cart.shuntVelocity.x = 4;
    cart.step(neutral(), 1 / 60, SURFACE);
    expect(cart.desiredTranslation.x).toBeGreaterThan(0);
  });

  it("decays shunt velocity at the recoil rate", () => {
    const cart = new Cart();
    cart.shuntVelocity.x = 10;
    cart.step(neutral(), 1 / 60, SURFACE);
    expect(cart.shuntVelocity.x).toBeCloseTo(10 * Math.exp(-CART_TUNING.recoilDecay / 60), 6);
  });

  it("revive() restores full HP and clears death and momentum", () => {
    const cart = new Cart();
    cart.health.hp = 0;
    cart.dead = true;
    cart.respawnTimer = 1.2;
    cart.speed = 8;
    cart.recoil.x = 3;
    cart.shuntVelocity.z = 2;

    cart.revive();

    expect(cart.health.hp).toBe(STARTING_HP);
    expect(cart.dead).toBe(false);
    expect(cart.respawnTimer).toBe(0);
    expect(cart.speed).toBe(0);
    expect(cart.recoil.x).toBe(0);
    expect(cart.shuntVelocity.z).toBe(0);
  });
});
```

(`neutral()` and `SURFACE` mirror whatever the existing `Cart.test.ts` helpers are called; reuse
them rather than adding new ones.)

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement** — add the fields, fold `shuntVelocity` into the same exponential decay
and the same `desiredTranslation` sum `recoil` already uses, and add `revive()`.

- [ ] **Step 4: Run `npx vitest run src/sim/entities/Cart.test.ts` → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/sim/entities/Cart.ts src/sim/entities/Cart.test.ts
git commit -s -m "feat(sim): add cart health, death state and shunt velocity"
```

---

## Task 5: combat.ts — the contact orchestrator

**Files:**
- Create: `src/sim/combat.ts`
- Test: `src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `Target`/`TargetPart` (Task 3), `Cart` (Task 4), `Health`/`applyDamage` (Task 1),
  `Stats` (Task 2).
- Produces: `DAMAGE_PER_MPS`, `MIN_HIT_DAMAGE`, `MAX_HIT_DAMAGE`, `SHUNT_DAMAGE_PER_MPS`,
  `SHUNT_MIN_SPEED`, `SHUNT_VELOCITY_TRANSFER`; `CombatRegistry` with
  `registerBall(handle, body)`, `registerTarget(target)`, `registerCart(handle, cart)`,
  `get(handle)`; `hitDamage(speed: number): number`; `processContacts(queue, ctx)` where
  `ctx = { registry: CombatRegistry; stats: Stats; onCartKilled(cart: Cart): void }`.

Tests drive `processContacts` through a fake queue object exposing only
`drainCollisionEvents(f)` — the surface `processContacts` actually uses — so no Rapier world is
needed for the dispatch cases. `Target`/`Cart` instances are real.

- [ ] **Step 1: Write the failing tests** covering: ball→target-part knocks down, increments
  `directHits` and `targetsDown` once per target (a second part hit on the same target does not
  re-increment `targetsDown`); ball→cart damage scales with contact speed and clamps at both
  ends; cart↔cart contact damages both and adds to both `shuntVelocity` values, and a contact
  below `SHUNT_MIN_SPEED` does neither; a killing hit calls `onCartKilled` exactly once even when
  two lethal contacts drain in the same tick; `started: false` (separation) events are ignored.

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement** — a `Map<ColliderHandle, Actor>` registry, one `switch` on the sorted
  actor-kind pair, `hitDamage` clamped to `[MIN_HIT_DAMAGE, MAX_HIT_DAMAGE]`, and cart velocity
  derived from `heading`/`speed`/`recoil`/`shuntVelocity` (never read from the kinematic body).

- [ ] **Step 4: `npx vitest run src/sim/combat.test.ts` → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/sim/combat.ts src/sim/combat.test.ts
git commit -s -m "feat(sim): add combat contact orchestrator"
```

---

## Task 6: Wire it into the world

**Files:**
- Modify: `src/sim/world.ts`
- Test: `src/sim/world.cart.test.ts`

**Interfaces:**
- Produces: `Sim.stats`, `Sim.targets`, and the death/respawn behaviour.

- [ ] **Step 1: Write the failing integration tests** — a cart driven to 0 HP takes a stroke
  penalty and goes `dead`; intent is ignored for `RESPAWN_DELAY_S`; on expiry position snaps to
  `cartSpawnPosition` with HP back at `STARTING_HP`; `Sim.reset()` clears `dead` and heals a
  mid-respawn cart; `stats` survives `Sim.reset()`; a cart-mode shot with ammo increments
  `stats.shotsFired` and a 0-ammo blank does not; a ball fired into a target knocks it down and
  increments `directHits`.

- [ ] **Step 2: Run and watch fail**

- [ ] **Step 3: Implement** — one `RAPIER.EventQueue` built in `create()`; `COLLISION_EVENTS` on
  the ball, every pooled ball, the cart (plus `ActiveCollisionTypes.KINEMATIC_KINEMATIC` so a
  future second cart's contacts are generated at all) and every target part; three hardcoded
  targets placed down the fairway the same way the bucket is; `world.step(this.eventQueue)`
  followed by `combat.processContacts`; the death branch at the top of `stepCart`; targets and
  health reset in `reset()`/`loadHole()`, stats deliberately not.

- [ ] **Step 4: `npm test` and `npx tsc --noEmit` → both clean**

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts src/sim/world.cart.test.ts
git commit -s -m "feat(sim): wire targets, damage and respawn into the world"
```

---

## Task 7: Docs

**Files:**
- Modify: `docs/ROADMAP.md`, `docs/BACKLOG.md`, `docs/DECISIONS.md`,
  `docs/superpowers/specs/2026-09-02-targets-health-combat-design.md`

- [ ] **Step 1:** Tick Phase 3's `Target.ts`, hit-detection and health/damage items with pointers
  to this plan; annotate the `BALL_DENSITY` item with the mass finding rather than ticking it.
- [ ] **Step 2:** Correct `DECISIONS.md` "Ball mass" — the 46 g / 1:100 figure is wrong for
  `BALL_RADIUS = 0.15`; state the measured ~16 kg ball and the ratio the ragdoll actually sees,
  keep the clamp (implemented) and the scripted-impulse fallback.
- [ ] **Step 3:** Flip the spec's status line to implemented and cross-reference this plan.
- [ ] **Step 4:** Commit `docs: record targets/health/combat implementation`.

---

## Self-review against the spec

- §3 data model → Tasks 1–5 (all four modules, all named fields).
- §4 integration → Task 6 (EventQueue, `ActiveEvents`, dispatch, `stats.shotsFired`).
- §5 death/stroke/respawn → Tasks 4 and 6.
- §6 stats persistence across `reset()` → Tasks 2 and 6.
- §7 edge cases → per-contact independence (Task 5), idempotent kill (Tasks 1 and 5), respawn
  during reset (Task 6), ball density (Task 3's ratio test + Task 7's correction).
- §8 testing → one test file per module plus the `world.cart.test.ts` additions.
- §9 open parameters → resolved in the table above.

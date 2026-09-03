# Cart-Only Combat Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cart and its turret the only way to play — strokes become damage taken, a seeded AI bot cart fights back, a match clock decides the winner, and a results overlay shows the outcome.

**Architecture:** `Sim` grows from "one cart" to "an array of cart rigs" — a `CartRig` bundles a `Cart` with its Rapier body, collider, fall speed and (for a bot) its seeded RNG channel. `Sim.cart` stays the player's, index 0; `Sim.bots` is the rest. Damage becomes a flat `STROKE_DAMAGE = 1` per ball-hit and per water-entry against a health bar sized `2 × hole.par`, with a per-cart `strokesTaken` counter as the score. Bot behaviour is one pure function in `src/sim/bot.ts` fed the bot's own state plus the player's position. The match clock and win condition live on `Sim`; the results overlay and the cart nameplates follow the existing `hudState.ts`/`hud.ts` derive-then-write split.

**Tech Stack:** TypeScript 7 (strict, `noUnusedLocals`, `noUnusedParameters`), Three.js 0.185, Rapier 0.20 (`@dimforge/rapier3d-compat`), Vite 8, Vitest 4 (node environment), Puppeteer 25.

**Spec:** `docs/superpowers/specs/2026-09-03-cart-combat-mode-design.md`

## Global Constraints

Copied from `AGENTS.md` and the spec. Every task's requirements implicitly include this section.

- **Never put AI-session metadata in git.** No assistant co-author trailers, no `Co-Authored-By: Claude`, no session or chat URLs, no prompt text, no "generated with" footers — not in commit messages, not in PR titles or bodies, not in code comments. History was rewritten once already to remove exactly this. Commit messages describe the change and its reasoning; where a decision came from a conversation, write the decision, not the conversation.
- **Every commit needs a DCO sign-off** (`git commit -s`).
- **`src/sim/**` and `src/physics/**` stay DOM-free and three-free.** No `three`, no `window`, no `document`. Vitest's node environment enforces this; a stray import fails the suite.
- **No `Math.random()` anywhere reachable from `src/sim/**` or `src/physics/**`.** Seeded PRNG only, via `src/sim/rng.ts`.
- **`src/render/**`, `src/entities/**`, `src/ui/**` never mutate `Sim` state.** They read snapshots and public fields; they never touch a Rapier body.
- **No per-frame allocation in the fixed tick or the render loop.** Reuse scratch objects — see `main.ts`'s `scratchA`/`scratchB`/`scratchOut` and `hudState.ts`'s `createHudStateScratch` for the two established patterns.
- **Every `THREE.Mesh`'s geometry and material must be `.dispose()`d** when discarded — `traverse` + dispose geometry and material(s); materials can be arrays.
- **No `.glb`/`.obj`/`.fbx` in the playable path, ever.** All geometry is first-party procedural primitives.
- **Never add a second source of truth.** `Ballistics.CLUB_STATS` is canonical for club numbers; `Cart.ts` is canonical for turret geometry and cart tuning.
- **Never launch Puppeteer bare.** `tools/sceneGate.mjs` and `tools/smoke.mjs` already pass the no-sandbox launch flags and `package.json` has the `postinstall` Chrome install. Do not "simplify" either into a bare `puppeteer.launch({})` — that reintroduces a fixed CI failure.
- **`npx tsc --noEmit` must be clean.** Do not relax `strict`, `noUnusedLocals` or `noUnusedParameters` to make an error go away.
- **Licensing:** everything here lands in `src/**` or `tools/**`, both Apache-2.0. Nothing may import from `server/**`.

## Baseline at the start of this work

Verified by running them on `cart-only-mode` at `5e28459`, not assumed:

- `npm test` — 269 tests pass across 19 files.
- `npx tsc --noEmit` — clean.
- `npm run probe` — one failure and only one: `driver distance FAIL - 106.4 m total (65.3 carry + 41.0 roll) vs REFERENCE_CARRY_M 129, drift 17.6% (limit 15%)`. **That failure is not this plan's to fix.** Every other probe check passes; keep it that way.
- `npm run smoke` — passes today and must keep passing; this plan rewrites the assertions the mode removal invalidates.

## Decisions taken before writing this plan

Three open questions from the spec, resolved with the user. These are settled — do not relitigate them mid-task.

1. **Cart-vs-cart shunting does not cost a stroke** (spec §5/§13). `cartsShunt` keeps its existing `SHUNT_DAMAGE_PER_MPS` velocity-scaled `applyDamage` call, unchanged, and never touches `strokesTaken`. Ramming is a physical shove, not a stroke.
2. **A dead/respawning cart is not a valid bot target** (spec §11/§13). `computeBotIntent` treats a dead target exactly as an out-of-range one: idle, no throttle, no fire. This is what stops a bot camping a respawn point.
3. **Respawn restores HP; `strokesTaken` is a real counter.** The spec contradicted itself here — §5 says strokes-taken is *never* stored (`health.max - health.hp`), §8 says a dead cart "respawns and keeps accumulating". Those cannot both hold, because `Cart.revive()` restores full HP. Resolved in favour of §8: `revive()` keeps restoring HP, and each cart carries `strokesTaken`, incremented at the same two places `STROKE_DAMAGE` is applied. Health is lives-within-the-match; `strokesTaken` is the score. The timer stays the only match-end trigger.

## Stated departures from the spec

- **`computeBotIntent`'s signature.** Spec §7 writes `(bot, target, random) => PlayerIntent`. It is implemented as `(bot, target, dt, random, out) => void`: it writes into a caller-owned `out` because it runs inside the fixed tick and the no-allocation rule applies, it needs `dt` to bound the turret slew rate to radians *per second*, and its `target` carries a `dead` flag because of decision 3 above. It is still a pure structural function of exactly the state it needs, which is what the spec was actually asking for.
- **`Sim.strokes` is not the score.** Spec §5's derived-value reasoning is superseded by decision 3. `Sim.strokes` stays as a dormant field driven only by the dormant `launch()` path; nothing live reads or writes it after Task 1.

## Confirmed test seams

Tests go at these boundaries and nowhere else.

| Seam | Where | Why here |
|---|---|---|
| `Cart`'s state machine | `src/sim/entities/Cart.test.ts` | Rapier-free and DOM-free by construction. |
| `combat.ts` contact dispatch | `src/sim/combat.test.ts` | Scripted fake `CollisionEventSource`, real `Cart`/`Target`/ball bodies. |
| `computeBotIntent` | `src/sim/bot.test.ts` | Pure function; needs no world. |
| `Sim`'s public fields, driven through real `step()`/`reset()`/`loadHole()` | `src/sim/world.cart.test.ts` | Never by reaching into Rapier bodies. |
| `src/ui/hudState.ts`, `src/ui/matchResultsState.ts` | colocated `.test.ts` | DOM-free derivation, reachable from the node environment. |
| **Not** unit-tested: `THREE` object graphs | — | `npm run gate`. A geometry assertion in Vitest would restate the constructor. |
| **Not** unit-tested: DOM writes | — | `npm run smoke`, which drives the real browser. |

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/sim/bot.ts` | One pure function turning a bot cart + a target position into a `PlayerIntent`. |
| `src/sim/bot.test.ts` | Tests for the above. |
| `src/ui/matchResultsState.ts` | DOM-free derivation of the results overlay's strings from `Sim`. |
| `src/ui/matchResultsState.test.ts` | Tests for the above. |
| `src/ui/matchResults.ts` | Reads the overlay's elements once, writes derived state into them. |
| `src/ui/nameplates.ts` | Persistent per-frame name+health pills over each cart. DOM only. |

**Modified:**

| Path | Change |
|---|---|
| `src/sim/health.ts` | `max` becomes mutable; add `setMaxHealth`. |
| `src/sim/entities/Cart.ts` | `maxHealth` option, `strokesTaken`, `wasInWater`, `lastSafePosition`, `setMaxHealth`, `clearStrokes`. |
| `src/sim/combat.ts` | `STROKE_DAMAGE`; flat ball-hit damage; dead-cart guard. |
| `src/sim/world.ts` | `CartRig` array, `bots`, `SimOptions`, per-cart water hazard, match clock, win condition, mode removal. |
| `src/input/InputSource.ts` | Delete `toggleMode`. |
| `src/input/mapping.ts` | Delete the `KeyC` binding. |
| `src/input/ScriptedInputSource.ts` | Delete `toggleMode` handling. |
| `src/ui/hudState.ts` | `combatVisible` always true; drop `modeText`; add `timerText`. |
| `src/ui/hud.ts` | Drop `#hud-mode`; add `#hud-timer`. |
| `src/render/scene.ts` | Bot cart meshes; `projectToScreen`; delete the stationary-only aim arrow and ball framing. |
| `src/main.ts` | Interpolate bot carts; wire the results overlay and nameplates. |
| `index.html` | `#hud-timer`, `#match-results`, `#nameplates` markup and styles; updated help line. |
| `tools/smoke.mjs` | Rewrite the mode assertions; add timer/results/bot assertions. |
| `src/sim/world.cart.test.ts`, `src/sim/world.render.test.ts`, `src/ui/hudState.test.ts`, `src/input/mapping.test.ts`, `src/input/ScriptedInputSource.test.ts` | Fallout from the changes above. |
| `docs/UI-SPEC.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md` | Record what landed. |

---

## Task 1: Health sized by par, and a stroke counter per cart

The scoring model, before anything else reads it. `Health.max` stops being a fixed 100 and becomes `2 × hole.par`; every cart gains the `strokesTaken` counter that is the actual match score.

**Files:**
- Modify: `src/sim/health.ts`
- Modify: `src/sim/entities/Cart.ts`
- Modify: `src/sim/world.ts`
- Test: `src/sim/health.test.ts`, `src/sim/entities/Cart.test.ts`, `src/sim/world.cart.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `setMaxHealth(h: Health, max: number): void` in `src/sim/health.ts` — sets `h.max` and refills `h.hp` to it.
  - `CartOptions.maxHealth?: number` — defaults to `STARTING_HP`.
  - `Cart.strokesTaken: number` — starts at 0, survives `revive()`, cleared by `clearStrokes()`.
  - `Cart.setMaxHealth(max: number): void`, `Cart.clearStrokes(): void`.
  - `Sim.cart` becomes a constructor-assigned `readonly cart: Cart` (same name, same type — no call site changes).

- [ ] **Step 1: Write the failing tests**

Append to `src/sim/health.test.ts`:

```ts
describe("setMaxHealth", () => {
  it("resizes the bar and refills it", () => {
    const h = createHealth(100);
    applyDamage(h, 40);
    setMaxHealth(h, 8);
    expect(h.max).toBe(8);
    expect(h.hp).toBe(8);
  });
});
```

Add `setMaxHealth` to that file's existing import from `./health`.

Append to `src/sim/entities/Cart.test.ts`:

```ts
describe("stroke bookkeeping", () => {
  it("sizes health from the maxHealth option and defaults to STARTING_HP", () => {
    expect(new Cart().health.max).toBe(STARTING_HP);
    const sized = new Cart({ maxHealth: 8 });
    expect(sized.health.max).toBe(8);
    expect(sized.health.hp).toBe(8);
  });

  it("keeps strokesTaken across a respawn but clears it on clearStrokes", () => {
    const cart = new Cart({ maxHealth: 8 });
    cart.strokesTaken = 3;
    cart.health.hp = 0;

    cart.revive();
    expect(cart.health.hp).toBe(8);
    expect(cart.strokesTaken).toBe(3);

    cart.clearStrokes();
    expect(cart.strokesTaken).toBe(0);
  });

  it("setMaxHealth resizes and refills", () => {
    const cart = new Cart({ maxHealth: 6 });
    cart.health.hp = 2;
    cart.setMaxHealth(10);
    expect(cart.health.max).toBe(10);
    expect(cart.health.hp).toBe(10);
  });
});
```

Make sure `STARTING_HP` is in that file's import list from `./Cart`.

Append to `src/sim/world.cart.test.ts`, inside the existing `describe("targets, damage and respawn", ...)` block:

```ts
  it("sizes the player's health bar at twice the hole's par", () => {
    expect(sim.terrain.spec.par).toBe(3);
    expect(sim.cart.health.max).toBe(6);
    expect(sim.cart.health.hp).toBe(6);
  });

  it("resizes the health bar when loadHole brings a different par", () => {
    sim.loadHole({ ...fixedHoleSpec(), par: 5, seed: 4141 });
    expect(sim.cart.health.max).toBe(10);
    expect(sim.cart.health.hp).toBe(10);
  });

  it("reset clears strokesTaken", () => {
    sim.cart.strokesTaken = 4;
    sim.reset();
    expect(sim.cart.strokesTaken).toBe(0);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/health.test.ts src/sim/entities/Cart.test.ts src/sim/world.cart.test.ts`
Expected: FAIL — `setMaxHealth is not exported`, `clearStrokes is not a function`, and `expected 100 to be 6`.

- [ ] **Step 3: Make `Health.max` mutable and add `setMaxHealth`**

In `src/sim/health.ts`, change the interface and add the function. Replace:

```ts
export interface Health {
  hp: number;
  readonly max: number;
}
```

with:

```ts
export interface Health {
  hp: number;
  /**
   * Mutable because the bar's size is a property of the hole being played, not of the cart:
   * cart-only mode sizes it at 2 x par, and `Sim.loadHole` can bring a different par. Resizing
   * goes through `setMaxHealth` so hp is never left above max.
   */
  max: number;
}
```

Then append, after `createHealth`:

```ts
/** Resize the bar and refill it. A new hole starts at full HP, exactly as `Cart.revive()` does. */
export function setMaxHealth(h: Health, max: number): void {
  h.max = max;
  h.hp = max;
}
```

- [ ] **Step 4: Add the cart-side fields**

In `src/sim/entities/Cart.ts`, add to `CartOptions`:

```ts
  /**
   * Size of the health bar. Cart-only mode passes `2 * hole.par` -- the hole's par is the
   * number of strokes it is worth, and health is that budget doubled. Defaults to STARTING_HP
   * for a cart built without a hole (tests, and the dormant stationary path).
   */
  maxHealth?: number;
```

Add to the class body, next to `dead`/`respawnTimer`:

```ts
  /**
   * Strokes taken this match: one per ball hit, one per water entry. The match score.
   *
   * A real counter rather than `health.max - health.hp`, because a respawn refills the bar and
   * a derived value would silently reset the score with it. Cart-vs-cart shunting deliberately
   * does not touch this -- ramming is a shove, not a stroke (spec section 5).
   */
  strokesTaken: number;
```

In the constructor, replace `this.health = createHealth(STARTING_HP);` with:

```ts
    this.health = createHealth(options.maxHealth ?? STARTING_HP);
```

and add, beside `this.respawnTimer = 0;`:

```ts
    this.strokesTaken = 0;
```

Add these two methods after `revive()`:

```ts
  /**
   * Resize the health bar for a new hole's par. Refills, so a hole always opens at full HP --
   * `strokesTaken` is deliberately untouched, since it spans the match rather than the hole.
   */
  setMaxHealth(max: number): void {
    setMaxHealth(this.health, max);
  }

  /** Zeroes the match score. Called by `Sim.reset()`, never by a respawn. */
  clearStrokes(): void {
    this.strokesTaken = 0;
  }
```

Extend the health import at the top of the file:

```ts
import { createHealth, setMaxHealth } from "../health";
```

- [ ] **Step 5: Size the player's bar from the hole, and stop charging a stroke for a death**

In `src/sim/world.ts`, replace the field declaration:

```ts
  /** The cart's authoritative state machine. Read for the HUD; drive it through `step`. */
  readonly cart = new Cart();
```

with:

```ts
  /** The player's cart state machine. Read for the HUD; drive it through `step`. */
  readonly cart: Cart;
```

and in the private constructor, after `this.surfaces = surfaces;`, add:

```ts
    // 2 x par: the hole's par is the strokes it is worth, and the health bar is that budget
    // doubled (spec section 5). Sized here rather than at the field initializer because the
    // initializer runs before `terrain` exists.
    this.cart = new Cart({ maxHealth: 2 * terrain.spec.par });
```

Replace `killCart` in full:

```ts
  /**
   * Death: the cart is out of the world for `RESPAWN_DELAY_S` and comes back at the spawn point.
   * Guarded on `dead` so two lethal contacts in one tick do not restart the timer.
   *
   * No stroke is charged here. The hit that took the last point of HP already counted its own
   * stroke against `cart.strokesTaken`; charging again for the death would double it.
   */
  private killCart(cart: Cart): void {
    if (cart.dead) return;
    cart.dead = true;
    cart.respawnTimer = RESPAWN_DELAY_S;
  }
```

In `loadHole`, immediately before the closing `this.reset();`, add:

```ts
    // A new hole can bring a different par, and the health bar is sized from it.
    this.cart.setMaxHealth(2 * this.terrain.spec.par);
```

In `reset()`, immediately after `this.cart.revive();`, add:

```ts
    this.cart.clearStrokes();
```

- [ ] **Step 6: Run the tests to verify they pass, and fix the fallout**

Run: `npm test`
Expected: the three new blocks pass. Two existing tests in `src/sim/world.cart.test.ts` now fail because they assert the old fixed HP and the old death penalty. Fix them exactly as follows.

Replace `expect(sim.cart.health.hp).toBe(STARTING_HP);` in **both** `"respawns at the tee-adjacent spawn point at full health once the delay elapses"` and `"reset() heals a mid-respawn cart and stands every target back up"` with:

```ts
    expect(sim.cart.health.hp).toBe(sim.cart.health.max);
```

Replace the test `"a death costs a stroke and freezes the cart for the respawn delay"` in full:

```ts
  it("a death freezes the cart for the respawn delay without charging its own stroke", () => {
    play(sim, [ENTER_CART_MODE, { ticks: seconds(1), intent: { throttle: 1 } }]);
    const strokesBefore = sim.cart.strokesTaken;
    const ammoBefore = sim.cart.ammo;

    kill(sim);
    expect(sim.cart.dead).toBe(true);
    // The hit that emptied the bar counted its own stroke; the death itself is not a second one.
    expect(sim.cart.strokesTaken).toBe(strokesBefore);

    const frozen = { ...sim.cart.position };
    play(sim, [{ ticks: seconds(RESPAWN_DELAY_S - 0.5), intent: { throttle: 1, fire: true } }]);

    expect(sim.cart.dead).toBe(true);
    expect(sim.cart.position.x).toBeCloseTo(frozen.x, 9);
    expect(sim.cart.position.z).toBeCloseTo(frozen.z, 9);
    expect(sim.cart.ammo).toBe(ammoBefore);
  });
```

Replace the test `"only one death per life: a second kill while dead does not double the penalty"` in full:

```ts
  it("only one death per life: a second kill while dead does not restart the respawn timer", () => {
    play(sim, [ENTER_CART_MODE, { ticks: 1, intent: {} }]);
    kill(sim);
    play(sim, [{ ticks: seconds(1), intent: {} }]);
    const timer = sim.cart.respawnTimer;
    expect(timer).toBeLessThan(RESPAWN_DELAY_S);

    kill(sim);
    expect(sim.cart.respawnTimer).toBeCloseTo(timer, 9);
  });
```

If `STARTING_HP` is now unused in `src/sim/world.cart.test.ts`, drop it from that file's import list — `noUnusedLocals` is on.

- [ ] **Step 7: Verify the whole suite and the typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (269 + 8 new), tsc silent.

- [ ] **Step 8: Commit**

```bash
git add src/sim/health.ts src/sim/health.test.ts src/sim/entities/Cart.ts src/sim/entities/Cart.test.ts src/sim/world.ts src/sim/world.cart.test.ts
git commit -s -m "sim: size cart health at twice par and count strokes taken per cart

The health bar is now the hole's stroke budget doubled rather than a fixed
100, and each cart carries the strokesTaken counter that scores the match.
A death no longer charges its own stroke: the hit that emptied the bar
already counted one."
```

---

## Task 2: Flat stroke damage on a ball hit

One hit is one stroke and one point of health, regardless of how hard the ball was travelling. The velocity curve stays in the file, dormant, for a future mode that wants graduated damage back.

**Files:**
- Modify: `src/sim/combat.ts`
- Test: `src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `Cart.strokesTaken` (Task 1).
- Produces: `STROKE_DAMAGE = 1` exported from `src/sim/combat.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/sim/combat.test.ts`, add `STROKE_DAMAGE` to the import from `./combat`, then append this block:

```ts
describe("a ball hit is exactly one stroke", () => {
  it("costs one point of health and one stroke, whatever the ball's speed", () => {
    const slow = makeBall(3);
    registry.registerBall(slow.handle, slow.body);
    processContacts(queueOf([slow.handle, cartHandle, true]), ctx());
    expect(cart.health.hp).toBe(STARTING_HP - STROKE_DAMAGE);
    expect(cart.strokesTaken).toBe(1);

    const fast = makeBall(40);
    registry.registerBall(fast.handle, fast.body);
    processContacts(queueOf([fast.handle, cartHandle, true]), ctx());
    expect(cart.health.hp).toBe(STARTING_HP - STROKE_DAMAGE * 2);
    expect(cart.strokesTaken).toBe(2);
  });

  it("still counts the hit as a direct hit for accuracy stats", () => {
    const ball = makeBall(20);
    registry.registerBall(ball.handle, ball.body);
    processContacts(queueOf([ball.handle, cartHandle, true]), ctx());
    expect(stats.directHits).toBe(1);
  });

  it("kills on the hit that empties a bar sized to par", () => {
    const small = new Cart({ maxHealth: 2 });
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(0.35, 0.6),
      world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()),
    );
    registry.registerCart(collider.handle, small);
    const ball = makeBall(20);
    registry.registerBall(ball.handle, ball.body);

    processContacts(queueOf([ball.handle, collider.handle, true]), ctx());
    expect(killed).toHaveLength(0);
    processContacts(queueOf([ball.handle, collider.handle, true]), ctx());
    expect(small.health.hp).toBe(0);
    expect(small.strokesTaken).toBe(2);
    expect(killed).toEqual([small]);
  });

  it("ignores a hit on a cart that is already dead and awaiting respawn", () => {
    cart.dead = true;
    const ball = makeBall(20);
    registry.registerBall(ball.handle, ball.body);
    processContacts(queueOf([ball.handle, cartHandle, true]), ctx());
    expect(cart.health.hp).toBe(STARTING_HP);
    expect(cart.strokesTaken).toBe(0);
    expect(stats.directHits).toBe(0);
  });

  it("leaves shunt damage velocity-scaled and free of strokes", () => {
    const other = new Cart();
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(0.35, 0.6),
      world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()),
    );
    registry.registerCart(collider.handle, other);
    cart.heading = 0;
    cart.speed = 10;
    other.heading = Math.PI;
    other.speed = 10;

    processContacts(queueOf([cartHandle, collider.handle, true]), ctx());

    expect(cart.health.hp).toBeLessThan(STARTING_HP - STROKE_DAMAGE);
    expect(cart.strokesTaken).toBe(0);
    expect(other.strokesTaken).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/combat.test.ts`
Expected: FAIL — `STROKE_DAMAGE` is not exported, and the existing velocity-scaled hits do not match.

- [ ] **Step 3: Add the constant and rewrite the ball-hit path**

In `src/sim/combat.ts`, add after the `MAX_HIT_DAMAGE` declaration:

```ts
/**
 * Cart-only mode's whole damage rule: one ball hit is one stroke and one point of health, and a
 * health bar is 2 x par points tall. Speed no longer scales damage -- a stroke is a stroke, and
 * making a driver hit worth more strokes than a putter hit would be scoring the club rather than
 * the shot.
 *
 * DAMAGE_PER_MPS / MIN_HIT_DAMAGE / MAX_HIT_DAMAGE and `hitDamage` above are kept, unreferenced
 * by the live path, as the reference curve for a future mode that wants graduated damage back --
 * the same dormant-code exception the design spec makes for the stationary swing.
 */
export const STROKE_DAMAGE = 1;
```

Replace `ballHitsCart` in full:

```ts
function ballHitsCart(_ball: RAPIER.RigidBody, cart: Cart, ctx: CombatContext): void {
  // A cart awaiting respawn is out of the world: it takes no damage, no stroke, and generates
  // no accuracy credit for whoever shot at it. `world.ts` freezes it for the same reason.
  if (cart.dead) return;

  ctx.stats.directHits += 1;
  cart.strokesTaken += 1;
  if (applyDamage(cart.health, STROKE_DAMAGE)) ctx.onCartKilled(cart);
}
```

The `ball` parameter is now unused, hence the leading underscore — `noUnusedParameters` allows that prefix. Its old body used `cartVelocity(cart, velA)` and `ball.linvel()` to compute a closing speed; nothing needs either now. `cartVelocity` and `velA` are still used by `cartsShunt`, so leave them alone.

- [ ] **Step 4: Run the tests to verify they pass, and fix the fallout**

Run: `npx vitest run src/sim/combat.test.ts`
Expected: the new block passes. The existing tests asserting a velocity-scaled cart hit now fail. Rewrite each of those to assert `STROKE_DAMAGE` instead — the `hitDamage`/`MIN_HIT_DAMAGE`/`MAX_HIT_DAMAGE` *pure function* tests stay exactly as they are, since that function is unchanged and still exported. Delete any assertion of the form `expect(cart.health.hp).toBe(STARTING_HP - hitDamage(...))` in favour of `expect(cart.health.hp).toBe(STARTING_HP - STROKE_DAMAGE)`.

- [ ] **Step 5: Verify the whole suite and the typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, tsc silent.

- [ ] **Step 6: Commit**

```bash
git add src/sim/combat.ts src/sim/combat.test.ts
git commit -s -m "sim: a ball hit costs exactly one stroke and one point of health

Speed no longer scales cart damage. The velocity curve stays in the file
unreferenced as the reference for a future mode that wants graduated damage.
Shunting is untouched and still costs no stroke; a dead cart takes neither."
```

---

## Task 3: Multi-cart scaffolding

`Sim` stops owning "the cart" and starts owning an array of cart rigs. No AI yet — the bot exists, spawns, is stepped with a neutral intent, and does nothing. That is what makes this task independently reviewable.

**Files:**
- Modify: `src/sim/world.ts`
- Test: `src/sim/world.cart.test.ts`, `src/sim/world.render.test.ts`

**Interfaces:**
- Consumes: Task 1's `Cart` options.
- Produces:
  - `export interface SimOptions { readonly matchDurationS?: number; readonly botCount?: number }` — `matchDurationS` is unused until Task 7 and is not declared yet; this task declares `botCount` only.
  - `Sim.create(hole: HoleSpec, options: SimOptions = {})`.
  - `Sim.bots: readonly Cart[]` — AI carts, `botCount` long, empty when `botCount` is 0.
  - `Sim.previousBotCarts: CartTransform[]` / `Sim.currentBotCarts: CartTransform[]` — one entry per bot, laid out exactly like `previousCart`/`currentCart`.
  - `BOT_SPAWN_OFFSET = 2.5` (metres past the cup, per bot).

- [ ] **Step 1: Write the failing tests**

Append a new top-level block to `src/sim/world.cart.test.ts`:

```ts
describe("bot carts", () => {
  it("creates one bot by default, on the terrain and out past the cup", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    expect(sim.bots).toHaveLength(1);

    const bot = sim.bots[0]!;
    const cup = sim.terrain.cupPosition;
    expect(bot.position.x).toBeCloseTo(cup.x + 2.5, 5);
    expect(bot.position.z).toBeCloseTo(cup.z, 5);
    expect(bot.position.y).toBeGreaterThan(sim.terrain.heightAt(bot.position.x, bot.position.z));
  });

  it("creates none when the caller asks for none", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    expect(sim.bots).toHaveLength(0);
    expect(sim.currentBotCarts).toHaveLength(0);
  });

  it("gives every bot its own health bar sized to par", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    expect(sim.bots[0]!.health.max).toBe(2 * sim.terrain.spec.par);
    expect(sim.bots[0]!.health.hp).toBe(sim.bots[0]!.health.max);
  });

  it("publishes a render transform per bot and keeps it in step with the sim", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    expect(sim.currentBotCarts).toHaveLength(1);
    expect(sim.previousBotCarts).toHaveLength(1);
    for (let i = 0; i < 30; i++) sim.step();
    expect(sim.currentBotCarts[0]!.position.x).toBeCloseTo(sim.bots[0]!.position.x, 9);
    expect(sim.currentBotCarts[0]!.position.z).toBeCloseTo(sim.bots[0]!.position.z, 9);
  });

  it("settles the bot onto the ground rather than leaving it hanging or sunk", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    for (let i = 0; i < 120; i++) sim.step();
    const bot = sim.bots[0]!;
    const ground = sim.terrain.heightAt(bot.position.x, bot.position.z);
    expect(bot.position.y - ground).toBeGreaterThan(0);
    expect(bot.position.y - ground).toBeLessThan(2);
  });

  it("returns every bot to its spawn on reset", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    const bot = sim.bots[0]!;
    bot.position.x = 0;
    bot.position.z = 0;
    bot.strokesTaken = 3;
    bot.health.hp = 1;

    sim.reset();

    expect(bot.position.x).toBeCloseTo(sim.terrain.cupPosition.x + 2.5, 5);
    expect(bot.strokesTaken).toBe(0);
    expect(bot.health.hp).toBe(bot.health.max);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/world.cart.test.ts`
Expected: FAIL — `sim.bots` is undefined.

- [ ] **Step 3: Introduce the rig and the options**

In `src/sim/world.ts`, add after the `CartTransform` interface:

```ts
/**
 * Everything the world owns for one cart: the state machine, the kinematic body it drives, the
 * collider that generates its contacts, and the fall speed the KCC does not integrate for us.
 *
 * Bundled rather than kept as parallel arrays because every one of these is looked up together,
 * every time. Rig 0 is always the player's; the rest are bots, in `bots` order.
 */
interface CartRig {
  readonly cart: Cart;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  fallSpeed: number;
}

export interface SimOptions {
  /**
   * AI carts to create. 1 in play. Tests that want the player's cart in isolation pass 0 --
   * a second cart on the course is a second source of contacts, ammo pickups and shunts.
   */
  readonly botCount?: number;
}

/** Metres past the cup, per bot. Far enough from the tee that a match opens with the bot idle. */
export const BOT_SPAWN_OFFSET = 2.5;
```

Replace the four private cart fields:

```ts
  private cartBody!: RAPIER.RigidBody;
  private cartCollider!: RAPIER.Collider;
```

with:

```ts
  /** Rig 0 is the player's; rigs 1.. are `bots`, in the same order. */
  private readonly rigs: CartRig[] = [];
```

and delete the `cartFallSpeed` field entirely (it moves onto the rig):

```ts
  /** Vertical velocity of the cart, integrated here because a KCC has no gravity of its own. */
  private cartFallSpeed = 0;
```

Add beside the `cart` field:

```ts
  /**
   * AI-controlled carts. An array rather than a single field because nothing in the design
   * assumes exactly one; this build creates one.
   */
  readonly bots: Cart[] = [];
  /** Bot cart transforms from the previous fixed step, for render interpolation. One per bot. */
  previousBotCarts: CartTransform[] = [];
  /** Bot cart transforms from the most recent fixed step. One per bot. */
  currentBotCarts: CartTransform[] = [];
```

- [ ] **Step 4: Build the rigs in `create`**

In `src/sim/world.ts`, change the signature:

```ts
  static async create(hole: HoleSpec, options: SimOptions = {}): Promise<Sim> {
```

Replace the block from `const spawn = cartSpawnPosition(terrain);` through `sim.cart.position.z = spawn.z;` with a call to a new helper:

```ts
    sim.addCartRig(sim.cart, cartSpawnPosition(terrain));
```

Move the controller setup (the `sim.controller = ...` through `sim.controller.setApplyImpulsesToDynamicBodies(true);` lines) so it runs **before** that `addCartRig` call — `addCartRig` does not use the controller, but keeping construction in dependency order stops the next person wondering.

Then, after the `sim.registry.registerCart(...)` line is deleted (see below) and before `sim.buildTargets();`, add:

```ts
    const botCount = options.botCount ?? 1;
    for (let i = 0; i < botCount; i++) {
      const bot = new Cart({ maxHealth: 2 * hole.par });
      sim.bots.push(bot);
      sim.addCartRig(bot, botSpawnPosition(terrain, i));
    }
```

Delete the now-superseded lines:

```ts
    sim.cartBody = sim.world.createRigidBody(...);
    sim.cartCollider = sim.world.createCollider(...);
    sim.registry.registerCart(sim.cartCollider.handle, sim.cart);
```

Add the helper as a private method on `Sim`, next to `buildTargets`:

```ts
  /**
   * Creates one cart's body and collider at `spawn`, registers it for contact dispatch, and
   * files the rig. Every cart -- the player's and every bot's -- goes through here, so a bot is
   * physically identical to the player rather than a cheaper approximation of one.
   */
  private addCartRig(cart: Cart, spawn: Vec3): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(CART_COLLIDER.halfHeight, CART_COLLIDER.radius)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        // Rapier computes no contacts between two kinematic bodies by default, and every cart
        // here is kinematic -- without this, cart-vs-cart shunting generates no events at all.
        .setActiveCollisionTypes(
          RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
        ),
      body,
    );
    cart.position.x = spawn.x;
    cart.position.y = spawn.y;
    cart.position.z = spawn.z;
    this.registry.registerCart(collider.handle, cart);
    this.rigs.push({ cart, body, collider, fallSpeed: 0 });
  }
```

Add the spawn function beside `cartSpawnPosition` at the bottom of the file:

```ts
/**
 * Beyond the cup along +X, mirroring `cartSpawnPosition`'s "behind the tee" placement. Chosen so
 * a match opens with the bot further from the player than BOT_ENGAGE_RANGE: on the fixed hole
 * that is ~93 m against a 40 m engagement range, so the bot idles until the player drives at it
 * rather than opening fire from the tee.
 */
function botSpawnPosition(terrain: Terrain, index: number): Vec3 {
  const x = terrain.cupPosition.x + BOT_SPAWN_OFFSET * (index + 1);
  const z = terrain.cupPosition.z;
  return { x, y: terrain.heightAt(x, z) + CART_COLLIDER.groundOffset, z };
}
```

- [ ] **Step 5: Step, move, respawn and reset every rig**

In `src/sim/world.ts`, replace the body of `stepCart` from `if (this.cart.dead)` to the end of the method with a per-rig loop. The method becomes:

```ts
  private stepCart(intent: PlayerIntent): void {
    // The world keeps running while a cart is out of it: balls already in flight land, and
    // bucket cooldowns keep ticking. Only the cart is frozen.
    this.simTime += FIXED_DT;
    this.ballPool.step(FIXED_DT, this.simTime);
    for (const bucket of this.buckets) stepBucket(bucket, FIXED_DT);

    for (const rig of this.rigs) {
      // Bots are driven by a neutral intent until sim/bot.ts exists; the player's cart is
      // driven by the player's. Everything below is otherwise identical for both.
      this.stepRig(rig, rig.cart === this.cart ? intent : IDLE_INTENT);
    }
  }

  /** Intent -> cart state -> body movement -> shot resolution, for exactly one cart. */
  private stepRig(rig: CartRig, intent: PlayerIntent): void {
    const cart = rig.cart;
    if (cart.dead) {
      this.stepRespawn(rig);
      return;
    }

    if (intent.selectClub !== null) cart.selectClub(intent.selectClub);

    const c = cart.position;
    this.surfaces.tuningAt(c.x, c.z, this.cartTuningScratch);
    cart.step(intent, FIXED_DT, this.cartTuningScratch);
    this.moveCartBody(rig);

    for (const bucket of this.buckets) {
      if (tryTakeBucket(bucket, c.x, c.z, PICKUP_RANGE)) cart.addAmmo(BUCKET_REFILL_AMMO);
    }
    for (const landed of this.ballPool.ballsNear(c.x, c.z, PICKUP_RANGE)) {
      cart.addAmmo(1);
      this.ballPool.release(landed);
    }

    if (cart.shot.fired) {
      cart.shot.fired = false;
      this.resolveShot(cart);
    }
  }
```

Note what this deletes: the `intent.toggleMode` branch, the `driving` flag and the `parkedIntent(intent)` call. `SwingMode` and `Sim.mode` stay in the file untouched — Task 5 handles the rest of the mode removal.

**Delete `parkedIntent` and the `parkedScratch` field in this task, not in Task 5.** This task was their only caller, and `noUnusedLocals` reports `TS6133: 'parkedIntent' is declared but its value is never read` for an unused *private method* just as it does for a local — verified, not assumed. Leaving them for a later task fails this task's own typecheck. Deleting `parkedIntent` also orphans `parkedScratch`, so both go together.

Retarget `stepRespawn`, `moveCartBody` and `resolveShot` at a rig or a cart. Replace `stepRespawn` in full:

```ts
  /**
   * Counts one cart's respawn delay down and puts it back at its own spawn point when it
   * expires. Intent is not read at all while dead -- drive, steer, aim, fire and club selection
   * are all ignored -- so ammo, reload and position are frozen for the duration.
   */
  private stepRespawn(rig: CartRig): void {
    rig.cart.respawnTimer -= FIXED_DT;
    if (rig.cart.respawnTimer > 0) return;

    const spawn = this.spawnFor(rig);
    rig.cart.position.x = spawn.x;
    rig.cart.position.y = spawn.y;
    rig.cart.position.z = spawn.z;
    rig.cart.revive();
    rig.fallSpeed = 0;
    rig.body.setTranslation(spawn, true);
  }

  /** Rig 0 spawns behind the tee; a bot spawns past the cup, one offset per bot index. */
  private spawnFor(rig: CartRig): Vec3 {
    const index = this.rigs.indexOf(rig);
    return index <= 0 ? cartSpawnPosition(this.terrain) : botSpawnPosition(this.terrain, index - 1);
  }
```

Replace `moveCartBody`'s signature and body references:

```ts
  private moveCartBody(rig: CartRig): void {
    rig.fallSpeed -= GRAVITY * FIXED_DT;
    this.moveScratch.x = rig.cart.desiredTranslation.x;
    this.moveScratch.y = rig.fallSpeed * FIXED_DT;
    this.moveScratch.z = rig.cart.desiredTranslation.z;

    this.controller.computeColliderMovement(rig.collider, this.moveScratch);
    const corrected = this.controller.computedMovement();

    const p = rig.cart.position;
    const half = this.terrain.spec.fieldSize / 2 - CART_COLLIDER.radius;
    p.x = Math.min(half, Math.max(-half, p.x + corrected.x));
    p.y += corrected.y;
    p.z = Math.min(half, Math.max(-half, p.z + corrected.z));

    if (this.controller.computedGrounded()) rig.fallSpeed = 0;
    rig.body.setNextKinematicTranslation(p);
  }
```

Change `resolveShot()` to take the firing cart, so a bot's shot spawns from its own muzzle. Replace its signature with `private resolveShot(cart: Cart): void` and, inside, replace every `this.cart.` with `cart.` and `computeMuzzle(this.cart, ...)` with `computeMuzzle(cart, ...)`. Leave the `this.mode === SwingMode.Cart` branch structure and the stationary half exactly as they are — Task 5 owns the mode.

Replace `reset()`'s body in full — the old cart lines were not contiguous (the `cartBody.setTranslation` call sat after the target block), so replace the whole method rather than patching around it:

```ts
  /** Full reset back to the tee: new hole, stroke counts and every cart's position included. */
  reset(): void {
    this.lastSafePosition = { ...this.terrain.teePosition };
    this.dropAtLastSafePosition();
    this.strokes = 0;
    this.holedOut = false;
    this.lastShotOutOfBounds = false;
    this.lastShotInWater = false;
    this.lastShotWasStrike = false;

    for (const rig of this.rigs) {
      const spawn = this.spawnFor(rig);
      rig.cart.position.x = spawn.x;
      rig.cart.position.y = spawn.y;
      rig.cart.position.z = spawn.z;
      rig.cart.heading = 0;
      rig.cart.turretOffset = 0;
      // Health, death, momentum and the match score all clear here: a new hole starts alive, at
      // full HP, standing still, on nothing. Ammo deliberately survives -- it is a round-spanning
      // resource, HP is not. `stats` survives too, being round-level (sim/stats.ts).
      rig.cart.revive();
      rig.cart.clearStrokes();
      rig.cart.wasInWater = false;
      rig.fallSpeed = 0;
      rig.body.setTranslation(spawn, true);
    }

    for (const target of this.targets) target.reset();
    this.syncCurrentTargets();
    this.previousTargetTransforms.set(this.currentTargetTransforms);
    this.syncCurrentCart();
    this.previousCart = this.currentCart;
    this.previousBotCarts = this.currentBotCarts.slice();
  }
```

`rig.cart.wasInWater` does not exist until Task 4; drop that one line for now and add it back with the rest of Task 4.

In `loadHole`, replace the single `this.cart.setMaxHealth(...)` line added in Task 1 with:

```ts
    for (const rig of this.rigs) rig.cart.setMaxHealth(2 * this.terrain.spec.par);
```

- [ ] **Step 6: Publish a render transform per bot**

In `src/sim/world.ts`, replace `syncCurrentCart` in full:

```ts
  /**
   * Snapshots each cart's own position rather than its rigid body's: a kinematic body only moves
   * when `world.step()` consumes the queued translation, so reading the body here would render
   * every cart one tick behind everything else.
   */
  private syncCurrentCart(): void {
    this.currentCart = cartTransformOf(this.cart);
    for (let i = 0; i < this.bots.length; i++) {
      this.currentBotCarts[i] = cartTransformOf(this.bots[i]!);
    }
  }
```

and add, at the bottom of the file beside `restCartTransform`:

```ts
function cartTransformOf(cart: Cart): CartTransform {
  const p = cart.position;
  return {
    position: { x: p.x, y: p.y, z: p.z },
    heading: cart.heading,
    turretYaw: cart.turretYaw,
  };
}
```

In `step()`, replace `this.previousCart = this.currentCart;` with:

```ts
    this.previousCart = this.currentCart;
    for (let i = 0; i < this.currentBotCarts.length; i++) {
      this.previousBotCarts[i] = this.currentBotCarts[i]!;
    }
```

In `create`, after the existing `sim.syncCurrentCart(); sim.previousCart = sim.currentCart;` pair, add:

```ts
    sim.previousBotCarts = sim.currentBotCarts.slice();
```

`syncCurrentCart` allocates one transform per cart per tick. That is the pre-existing pattern on this field — the old single-cart code allocated exactly the same way — and it is what keeps `previous` a genuine snapshot instead of aliasing `current`. Do not "fix" it here; it is not a regression and changing it would need the double-buffer treatment the `Float32Array` snapshots got.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/sim/world.cart.test.ts && npx tsc --noEmit`
Expected: the new `bot carts` block passes; tsc silent.

- [ ] **Step 8: Isolate the existing sim suites from the bot**

The existing suites in `src/sim/world.cart.test.ts` and `src/sim/world.render.test.ts` test the player's cart on its own. A bot on the course is a second source of contacts, pickups and shunts and would make them non-deterministic in ways that have nothing to do with what they assert. Opt them out.

In `src/sim/world.cart.test.ts`, change **every** `await Sim.create(fixedHoleSpec())` inside a `beforeEach` or a test body to `await Sim.create(fixedHoleSpec(), { botCount: 0 })`, **except** the ones in the new `describe("bot carts", ...)` block, which need the default.

In `src/sim/world.render.test.ts`, change every `await Sim.create(...)` call to pass `{ botCount: 0 }` as a second argument.

- [ ] **Step 9: Verify the whole suite**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, tsc silent. If a test in `world.cart.test.ts` still fails, check it was given `{ botCount: 0 }`.

- [ ] **Step 10: Commit**

```bash
git add src/sim/world.ts src/sim/world.cart.test.ts src/sim/world.render.test.ts
git commit -s -m "sim: hold carts as an array of rigs so a bot cart can exist

Sim.cart stays the player's, index 0 of a new rigs array bundling each
cart with its body, collider and fall speed. Sim.bots holds the AI carts
and publishes a render transform each. The bot is stepped with a neutral
intent for now; sim/bot.ts gives it one next."
```

---

## Task 4: Driving into water costs a stroke

The second of the two stroke sources. Edge-triggered per cart, so sitting in a puddle drains one point rather than one per tick.

**Files:**
- Modify: `src/sim/entities/Cart.ts`
- Modify: `src/sim/world.ts`
- Test: `src/sim/world.cart.test.ts`

**Interfaces:**
- Consumes: `STROKE_DAMAGE` (Task 2), `CartRig` (Task 3).
- Produces:
  - `Cart.wasInWater: boolean` — true while the cart is standing on a water surface.
  - `Cart.lastSafePosition: Vec3` — the last non-hazard spot this cart occupied.

- [ ] **Step 1: Write the failing tests**

Add a new top-level block to `src/sim/world.cart.test.ts`:

```ts
describe("driving into water", () => {
  let sim: Sim;
  beforeEach(async () => {
    sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
  });

  /** Find a water cell on this hole, or skip -- the fixed hole has one but do not assume where. */
  function findWater(s: Sim): { x: number; z: number } | null {
    const half = s.terrain.spec.fieldSize / 2 - 4;
    for (let x = -half; x <= half; x += 2) {
      for (let z = -half; z <= half; z += 2) {
        if (s.surfaces.surfaceAt(x, z) === SurfaceId.Water) return { x, z };
      }
    }
    return null;
  }

  it("costs exactly one stroke and one point of health on the tick it enters", () => {
    const water = findWater(sim);
    expect(water).not.toBeNull();

    // Settle first, so the cart has a last-safe position recorded on dry land.
    play(sim, [{ ticks: 30, intent: {} }]);
    const hpBefore = sim.cart.health.hp;

    sim.cart.position.x = water!.x;
    sim.cart.position.z = water!.z;
    sim.step();

    expect(sim.cart.strokesTaken).toBe(1);
    expect(sim.cart.health.hp).toBe(hpBefore - 1);
  });

  it("does not drain a stroke every tick while it sits there", () => {
    const water = findWater(sim)!;
    play(sim, [{ ticks: 30, intent: {} }]);

    sim.cart.position.x = water.x;
    sim.cart.position.z = water.z;
    sim.step();
    const afterFirst = sim.cart.strokesTaken;

    // Put it straight back in; the edge only re-arms once the cart is out of the water.
    for (let i = 0; i < 10; i++) {
      sim.cart.position.x = water.x;
      sim.cart.position.z = water.z;
      sim.step();
    }
    expect(sim.cart.strokesTaken).toBe(afterFirst);
  });

  it("drops the cart back on the last dry ground it stood on", () => {
    const water = findWater(sim)!;
    play(sim, [{ ticks: 30, intent: {} }]);
    const dry = { x: sim.cart.position.x, z: sim.cart.position.z };

    sim.cart.position.x = water.x;
    sim.cart.position.z = water.z;
    sim.step();

    expect(sim.cart.position.x).toBeCloseTo(dry.x, 3);
    expect(sim.cart.position.z).toBeCloseTo(dry.z, 3);
    expect(sim.surfaces.surfaceAt(sim.cart.position.x, sim.cart.position.z)).not.toBe(
      SurfaceId.Water,
    );
  });

  it("does not fire while the cart is dead and awaiting respawn", () => {
    const water = findWater(sim)!;
    play(sim, [{ ticks: 30, intent: {} }]);
    (sim as unknown as { killCart: (cart: Cart) => void }).killCart(sim.cart);

    sim.cart.position.x = water.x;
    sim.cart.position.z = water.z;
    sim.step();

    expect(sim.cart.strokesTaken).toBe(0);
  });
});
```

`SurfaceId` and `Cart` are already imported in that file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/world.cart.test.ts -t "driving into water"`
Expected: FAIL — `expected 0 to be 1`; nothing checks a cart against the water surface yet.

- [ ] **Step 3: Give the cart its water state**

In `src/sim/entities/Cart.ts`, add to the class body next to `dead`:

```ts
  /**
   * True while this cart is standing on a hazard surface. The edge into water is what costs a
   * stroke, not the state -- a cart parked in the shallows must not be drained every tick.
   * Owned here rather than in a parallel array in `world.ts` so it cannot fall out of step with
   * the cart it describes when carts are added or removed.
   */
  wasInWater: boolean;
  /** The last non-hazard spot this cart occupied: where it is dropped after driving into water. */
  readonly lastSafePosition: Vec3;
```

and in the constructor, beside `this.strokesTaken = 0;`:

```ts
    this.wasInWater = false;
    this.lastSafePosition = { x: start.x, y: start.y, z: start.z };
```

- [ ] **Step 4: Check each cart against the surface it is standing on**

In `src/sim/world.ts`, add the check to `stepRig`, immediately after `this.moveCartBody(rig);`:

```ts
    this.checkCartWater(rig);
```

and add the method after `moveCartBody`:

```ts
  /**
   * A cart in the water costs a stroke and is dropped back where it was last on dry land --
   * the same stroke-and-distance shape the ball's own water rule uses, applied to the driver.
   *
   * Edge-triggered on `wasInWater`, so a cart nosing into a pond pays once rather than once per
   * tick. Each cart's flag is its own state, so two carts entering water on the same tick are
   * independent by construction and need no ordering rule.
   *
   * Runs inside `stepRig`'s alive branch, which `stepRespawn` returns before -- a dead cart is
   * out of the world and pays nothing.
   */
  private checkCartWater(rig: CartRig): void {
    const cart = rig.cart;
    const p = cart.position;
    const inWater = this.surfaces.surfaceAt(p.x, p.z) === SurfaceId.Water;

    if (!inWater) {
      cart.wasInWater = false;
      // Recorded every dry tick. A cart does not bounce the way a ball does, so this needs none
      // of the ball's REST_HOLD_TICKS debounce -- wherever it is now is somewhere it can be put
      // back down.
      cart.lastSafePosition.x = p.x;
      cart.lastSafePosition.y = p.y;
      cart.lastSafePosition.z = p.z;
      return;
    }

    if (cart.wasInWater) return;
    cart.wasInWater = true;

    cart.strokesTaken += 1;
    if (applyDamage(cart.health, STROKE_DAMAGE)) this.killCart(cart);

    const safe = cart.lastSafePosition;
    p.x = safe.x;
    p.y = safe.y;
    p.z = safe.z;
    cart.speed = 0;
    rig.fallSpeed = 0;
    rig.body.setTranslation(p, true);
  }
```

Extend the imports at the top of `src/sim/world.ts`:

```ts
import { CombatRegistry, STROKE_DAMAGE, processContacts } from "./combat";
import { applyDamage } from "./health";
```

Finally, re-arm the flag on a reset — a cart put back at its spawn is out of the water by definition. Add to `reset()`'s per-rig loop, beside `rig.cart.clearStrokes();`:

```ts
      rig.cart.wasInWater = false;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/sim/world.cart.test.ts && npx tsc --noEmit`
Expected: PASS, tsc silent.

- [ ] **Step 6: Verify the whole suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/sim/entities/Cart.ts src/sim/world.ts src/sim/world.cart.test.ts
git commit -s -m "sim: driving a cart into water costs one stroke and a drop back

Edge-triggered per cart so the shallows are not a per-tick drain, with the
last dry position tracked on the cart itself. Same stroke-and-distance shape
the ball's water rule already uses."
```

---

## Task 5: Remove stationary mode, and record it in the docs

Nothing can reach the stationary swing after this task. The code stays as a dormant reference; the input path, the HUD split and the renderer's stationary-only pieces do not.

**Files:**
- Modify: `src/input/InputSource.ts`, `src/input/mapping.ts`, `src/input/ScriptedInputSource.ts`
- Modify: `src/sim/world.ts`
- Modify: `src/ui/hudState.ts`, `src/ui/hud.ts`, `index.html`
- Modify: `src/render/scene.ts`, `src/main.ts`
- Modify: `tools/smoke.mjs`
- Modify: `docs/UI-SPEC.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md`
- Test: `src/input/mapping.test.ts`, `src/input/ScriptedInputSource.test.ts`, `src/ui/hudState.test.ts`, `src/sim/world.cart.test.ts`, `src/sim/world.render.test.ts`

**Interfaces:**
- Consumes: Task 3's per-rig stepping.
- Produces: `PlayerIntent` without `toggleMode`; `HudState` without `modeText`; `FrameView` without `mode`.

- [ ] **Step 1: Write the failing tests**

In `src/ui/hudState.test.ts`, delete the three mode-dependent tests — `"hides them in stationary mode rather than showing them full"`, `"is READY in stationary mode regardless of ammo"`, and `"labels stationary mode STANDING, which smoke.mjs asserts"` — and the `mode:` line from the `source()` helper's default object. Then add:

```ts
  it("always shows health and ammo: there is one HUD configuration now", () => {
    expect(derive(source()).combatVisible).toBe(true);
    expect(derive(source({ cart: { ...source().cart, ammo: 0 } })).combatVisible).toBe(true);
  });
```

In `src/input/mapping.test.ts`, delete the two `toggleMode` assertions at lines 91-92 and the `expect(intent.toggleMode).toBe(false);` at line 57, then add:

```ts
  it("has no mode-toggle binding: C is unbound now that the cart is the only mode", () => {
    const intent = intentFromKeys(held("KeyC"), held("KeyC"), 0);
    expect(intent.throttle).toBe(0);
    expect(intent.steer).toBe(0);
    expect(intent.fire).toBe(false);
    expect(intent.selectClub).toBeNull();
  });
```

In `src/input/ScriptedInputSource.test.ts`, change the press-not-held test to use `selectClub` alone:

```ts
    const source = new ScriptedInputSource([{ ticks: 3, intent: { selectClub: ClubType.Iron } }]);
```

and delete the `expect(seen.map((i) => i.toggleMode)).toEqual([true, false, false]);` line.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/hudState.test.ts src/input/mapping.test.ts`
Expected: FAIL — `combatVisible` is `false` when no mode is supplied, and the source object no longer typechecks.

- [ ] **Step 3: Delete `toggleMode` from the input path**

In `src/input/InputSource.ts`, delete these two lines from `PlayerIntent`:

```ts
  /** Set on the tick the player asks to switch between stationary-swing and cart mode. */
  toggleMode: boolean;
```

and `toggleMode: false,` from `neutralIntent()`.

In `src/input/mapping.ts`, delete `out.toggleMode = keysPressedThisTick.has("KeyC");`.

In `src/input/ScriptedInputSource.ts`, delete `this.current.toggleMode = false;` from `sample()` and `intent.toggleMode = false;` from the module-level `reset()`, and change the comment above the first to read `selectClub is a press, not a held state.`

- [ ] **Step 4: Orphan the mode in the sim**

In `src/sim/world.ts`:

Change the default so a `Sim` is born in cart mode and never leaves it:

```ts
  /**
   * Dormant. Nothing sets this after construction: `PlayerIntent.toggleMode` is gone and the
   * stationary half of `resolveShot` is unreachable. It stays, with `Sim.ball`, `launch()` and
   * the hole-out/water-for-the-ball rules in `step()`, as the working reference for a future
   * "true golf" mode -- a deliberate exception to the delete-stale-code rule, made because that
   * mode is intended and this code is tested.
   */
  mode: SwingMode = SwingMode.Cart;
```

Extend the `SwingMode` docstring with a matching note:

```ts
/**
 * Dormant since cart-only mode. Stationary is Phase 0's mechanic -- you stand at your ball and
 * swing -- and Cart is Phase 2's. `Sim` is constructed in `Cart` and there is no longer any input
 * path that changes it. Kept rather than deleted; see the note on `Sim.mode`.
 */
```

(`parkedIntent` and `parkedScratch` are already gone — Task 3 deleted them, because orphaning a private member fails `noUnusedLocals` in the task that orphans it.)

Add a note at the top of `resolveShot`:

```ts
  /**
   * Cart mode spawns from the ammo-gated BallPool. The stationary half below is unreachable --
   * `mode` is never anything but `Cart` -- and is kept as the reference implementation of the
   * stroke-play swing. See the note on `Sim.mode`.
   */
```

In `src/sim/world.cart.test.ts`, delete `ENTER_CART_MODE` and every reference to it (each was the first step of a `play(...)` script; drop just that element, keeping the rest of each script). Delete the tests `"starts in stationary mode and toggles to cart mode on the mode key"`, `"fires regardless of distance in stationary mode, where the player stands at the ball"`, `"blocks a second shot until the fired club's reload elapses"` (it drives the stationary launch path and asserts `sim.strokes`), and `"does not touch stationary mode's stroke count or ball state"`. Delete the `{ ticks: 1, intent: { toggleMode: true } }` step and the `expect(sim.mode).toBe(SwingMode.Cart)` line from `"drives the whole gate through the input interface with no direct Sim calls"`, and the same `expect` from `"loadHole frees pool slots..."`. If `SwingMode` is then unused in the file, drop it from the import.

Reinstate the reload gate as a cart-mode test, since deleting the stationary one loses that coverage. Add to `describe("cart-mode ammo-aware combat shots", ...)`:

```ts
  it("blocks a second shot until the fired club's reload elapses", () => {
    play(sim, [{ ticks: 1, intent: { selectClub: ClubType.Driver } }]);
    const ammoBefore = sim.cart.ammo;
    play(sim, [
      { ticks: seconds(1.5), intent: { fire: true } },
      { ticks: 2, intent: {} },
      { ticks: seconds(0.2), intent: { fire: true } },
      { ticks: 2, intent: {} },
    ]);
    expect(sim.cart.ammo).toBe(ammoBefore - 1);
  });
```

In `src/sim/world.render.test.ts`, delete every `sim.mode = SwingMode.Cart;` line — the sim is already in cart mode — and drop `SwingMode` from that file's import.

- [ ] **Step 5: One HUD configuration**

In `src/ui/hudState.ts`, delete the `SwingMode` import and the `mode` field from `HudSource`. Delete `modeText` from `HudState` and from `createHudStateScratch()`. In `deriveHudState`, delete the `inCart` local and the `modeText` assignment, and replace the `combatVisible` block:

```ts
  // There is one HUD configuration now: the cart is the only way to play, so health and ammo
  // are always live. UI-SPEC section 5's rule that H6/H7 hide rather than show inert is what
  // this flag exists for, and it gains a real second condition when CTF and TARGETS land.
  out.combatVisible = true;
```

Change `statusText`'s signature to `function statusText(source: HudSource): string`, delete its `if (!inCart) return "READY";` line, and update the call site to `statusText(source)`.

In `src/ui/hud.ts`, delete `mode` from the `Hud` interface, `"hud-mode"` from the `ids` array, `mode` from the destructuring and the returned object, and `setText(hud.mode, state.modeText);` from `drawHud`.

In `index.html`, delete `<span id="hud-mode">STANDING</span>` and update the help line — `C mode` no longer does anything:

```html
      <div id="hud-help">
        WASD drive &middot; F or Space fire &middot; mouse/Q/E aim &middot; 1-2-3 club &middot; Shift brake &middot;
        hold to charge, release to shoot &middot; R reset
      </div>
```

- [ ] **Step 6: Drop the stationary-only rendering**

In `src/render/scene.ts`:

- Delete the `SwingMode` import and the `mode` field from `FrameView`.
- Delete the `aimArrow` field, its construction in the constructor, and the whole `this.aimArrow.visible = ...` block in `draw()`. It was stationary mode's ground-aim indicator; in cart mode the barrel itself shows the line. Deleting it also closes a pre-existing gap — that `ArrowHelper`'s geometry and material were never disposed.
- Delete `frameBall()` and replace the `if (view.mode === SwingMode.Cart) this.frameChase(view); else this.frameBall();` pair with `this.frameChase(view);`.
- Delete the `aimDirScratch` field, now unreferenced.
- Delete `FrameView.aimYaw`. The aim arrow was its only reader, and `main.ts` only ever assigned it from `view.cart.turretYaw`, which the renderer already has. Remove `aimYaw: 0,` from `main.ts`'s `view` initializer and `view.aimYaw = view.cart.turretYaw;` from its render callback.

In `src/main.ts`: drop `SwingMode` from the `./sim/world` import, delete `mode: sim.mode,` from the `view` initializer and `view.mode = sim.mode;` from the render callback, and simplify `turretLoaded`:

```ts
/**
 * What rides the club head is a round of ammo, not the course ball -- images 03 and 04, and what
 * actually fires.
 */
function turretLoaded(sim: Sim): boolean {
  return sim.cart.ammo > 0;
}
```

- [ ] **Step 7: Update the smoke assertions**

In `tools/smoke.mjs`:

- Delete `hudMode: document.getElementById("hud-mode").textContent,` from the `read()` payload.
- Replace the two boot checks with one:

```js
const boot = await read();
check("starts in cart mode", boot.mode === "cart", boot.mode);
```

- Delete the whole `=== MODE TOGGLE (C) ===` block (the `console.log`, the `KeyC` press, the wait and its two checks). Replace the `const carted = await read();` usage that follows by reusing `boot`: change `const before = carted.cart;` to `const before = boot.cart;`.
- Replace the tail of the `=== COMBAT HUD ===` block — the `KeyC` press, the wait, the `standing` read and its check — with:

```js
check("health and ammo are always visible", shot.hudCombatHidden === false);
```

Leave every `puppeteer.launch` argument in the file exactly as it is.

- [ ] **Step 8: Update the docs**

In `docs/UI-SPEC.md` §1, add immediately under the table's paragraph about image 08 (before the image-14 paragraph):

```markdown
**Dormant since cart-only mode.** The two-HUD split above is not live: the cart is the only way
to play, `PlayerIntent.toggleMode` is gone, and `Sim.mode` is fixed at `Cart` for a sim's
lifetime. `hudState.combatVisible` is unconditionally true and there is no `STANDING` label. The
Swing HUD column is kept as the specification for the "true golf" mode `Sim.ball`, `Sim.launch()`
and `SwingMode.Stationary` are being kept in the tree for — see
`docs/superpowers/specs/2026-09-03-cart-combat-mode-design.md` §1 and §3.
```

In `docs/UI-SPEC.md` §5, replace the closing paragraph (`Today the hiding rule is implemented against SwingMode ...`) with:

```markdown
The hiding rule no longer keys off `SwingMode`: cart-only mode made `combatVisible`
unconditionally true, because damage and ammo are always live when the cart is the only way to
play. When `CTF` and `TARGETS` land, the mode-scoped ruleset becomes that flag's first real
condition rather than a second one alongside `SwingMode`.
```

In `docs/BACKLOG.md`, replace the `20b` row:

```markdown
| 20b | Mode-scoped rulesets | **→ Phase 3.5** | One switch deciding whether damage and ammo are live. Cart-only mode settled the near term by removing the other side of the switch: damage and ammo are always on, and `hudState.combatVisible` is unconditionally true. `STROKE` returns as a mode when the dormant stationary swing does, and that is when this switch becomes real. |
```

In `docs/ROADMAP.md` Phase 2, replace the goal paragraph:

```markdown
**Goal:** the "golf cart as tank chassis, turret swaps between putter/iron/driver with
different range/power/reload" mechanic. As of cart-only mode this is the *only* mode: the
stationary swing is unreachable and kept as a dormant reference, see
`docs/superpowers/specs/2026-09-03-cart-combat-mode-design.md`.
```

and append a bullet to Phase 3's list:

```markdown
- [x] **Cart-only combat mode**: strokes are damage taken (one per ball hit, one per water
      entry) against a health bar of `2 x par`, one seeded AI bot cart, a match clock, a
      results overlay and cart nameplates. See
      `docs/superpowers/specs/2026-09-03-cart-combat-mode-design.md` and
      `docs/superpowers/plans/2026-09-03-cart-combat-mode-implementation.md`.
```

- [ ] **Step 9: Verify**

Run: `npm test && npx tsc --noEmit && npm run smoke`
Expected: tests pass, tsc silent, `SMOKE PASS`.

- [ ] **Step 10: Commit**

```bash
git add src/input src/sim/world.ts src/sim/world.cart.test.ts src/sim/world.render.test.ts src/ui src/render/scene.ts src/main.ts index.html tools/smoke.mjs docs/UI-SPEC.md docs/ROADMAP.md docs/BACKLOG.md
git commit -s -m "game: make the cart the only way to play

Deletes the mode toggle from the input path, fixes Sim.mode at Cart for a
sim's lifetime, collapses the two HUD configurations into one, and drops the
stationary-only aim arrow and ball camera. Sim.ball, launch() and the
stationary half of resolveShot stay in the tree, unreachable, as the working
reference for the true-golf mode they are wanted for. UI-SPEC sections 1 and
5, BACKLOG 20b and the roadmap record the split as dormant."
```

---

## Task 6: The AI bot

One pure function. Given a bot's own state and where the player is, it produces the intent the bot would express this tick.

**Files:**
- Create: `src/sim/bot.ts`
- Create: `src/sim/bot.test.ts`
- Modify: `src/sim/world.ts`
- Test: `src/sim/world.cart.test.ts`

**Interfaces:**
- Consumes: `Cart` (charge/ammo/canFire/position/heading/turretYaw), `applyAimSpread`, `hashChannel`/`mulberry32`, `PlayerIntent`.
- Produces:
  - `computeBotIntent(bot: Cart, target: BotTarget, dt: number, random: () => number, out: PlayerIntent): void`
  - `interface BotTarget { readonly x: number; readonly z: number; readonly dead: boolean }`
  - `BOT_ENGAGE_RANGE = 40`, `BOT_STANDOFF = 12`, `BOT_AIM_RATE = 1.2`, `BOT_FIRE_TOLERANCE = 0.12`, `BOT_STEER_FULL = 0.6`, `BOT_CHARGE_RELEASE = 0.8`, `BOT_CHANNEL = 3`.

- [ ] **Step 1: Write the failing tests**

Create `src/sim/bot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { neutralIntent } from "../input/InputSource";
import type { PlayerIntent } from "../input/InputSource";
import { Cart } from "./entities/Cart";
import { mulberry32 } from "./rng";
import {
  BOT_CHARGE_RELEASE,
  BOT_ENGAGE_RANGE,
  BOT_FIRE_TOLERANCE,
  computeBotIntent,
} from "./bot";

const DT = 1 / 60;

function botAt(x: number, z: number, heading = 0): Cart {
  const cart = new Cart({ position: { x, y: 0, z }, heading, maxHealth: 8 });
  return cart;
}

function intentFor(
  bot: Cart,
  target: { x: number; z: number; dead?: boolean },
  random: () => number = mulberry32(1),
): PlayerIntent {
  const out = neutralIntent();
  computeBotIntent(bot, { x: target.x, z: target.z, dead: target.dead ?? false }, DT, random, out);
  return out;
}

describe("computeBotIntent", () => {
  it("idles outside its engagement range rather than pathfinding across the course", () => {
    const intent = intentFor(botAt(0, 0), { x: BOT_ENGAGE_RANGE + 5, z: 0 });
    expect(intent.throttle).toBe(0);
    expect(intent.steer).toBe(0);
    expect(intent.aimDelta).toBe(0);
    expect(intent.fire).toBe(false);
  });

  it("idles against a dead target, so it cannot camp a respawn point", () => {
    const intent = intentFor(botAt(0, 0), { x: 5, z: 0, dead: true });
    expect(intent.throttle).toBe(0);
    expect(intent.fire).toBe(false);
  });

  it("drives at a target it can see and stops closing at the standoff", () => {
    expect(intentFor(botAt(0, 0), { x: 30, z: 0 }).throttle).toBe(1);
    expect(intentFor(botAt(0, 0), { x: 4, z: 0 }).throttle).toBe(0);
  });

  it("steers toward the target and the sign follows which side it is on", () => {
    expect(intentFor(botAt(0, 0), { x: 20, z: 20 }).steer).toBeGreaterThan(0);
    expect(intentFor(botAt(0, 0), { x: 20, z: -20 }).steer).toBeLessThan(0);
  });

  it("slews the turret toward the target at a bounded rate rather than snapping to it", () => {
    const bot = botAt(0, 0);
    // Target dead abeam: a 90 degree aim error the bot must not close in one tick.
    const intent = intentFor(bot, { x: 0, z: 20 });
    expect(intent.aimDelta).toBeGreaterThan(0);
    expect(Math.abs(intent.aimDelta)).toBeLessThan(Math.PI / 2);
    expect(Math.abs(intent.aimDelta)).toBeLessThanOrEqual(1.2 * DT + 1e-9);
  });

  it("holds fire to charge while roughly aimed, then releases", () => {
    const bot = botAt(0, 0);
    expect(intentFor(bot, { x: 20, z: 0 }).fire).toBe(true);

    // Cart.step charges while `fire` is held; once charged enough the bot lets go, and the
    // release edge is what actually fires. This is how a stateless function drives a
    // charge-and-release weapon without carrying a timer of its own.
    (bot as unknown as { chargeHeld: number }).chargeHeld = BOT_CHARGE_RELEASE;
    expect(intentFor(bot, { x: 20, z: 0 }).fire).toBe(false);
  });

  it("does not hold fire while badly off-aim", () => {
    // Target behind the bot: aim error is pi, far outside the fire tolerance.
    expect(intentFor(botAt(0, 0), { x: -20, z: 0 }).fire).toBe(false);
    expect(BOT_FIRE_TOLERANCE).toBeLessThan(Math.PI / 4);
  });

  it("does not hold fire with no ammo", () => {
    const bot = botAt(0, 0);
    bot.ammo = 0;
    expect(intentFor(bot, { x: 20, z: 0 }).fire).toBe(false);
  });

  it("nudges the shot inside the club's spread cone on the release tick", () => {
    const bot = botAt(0, 0);
    (bot as unknown as { chargeHeld: number }).chargeHeld = BOT_CHARGE_RELEASE;
    // A random that returns 1 puts the spread at the positive edge of the cone.
    const spread = intentFor(bot, { x: 20, z: 0 }, () => 1).aimDelta;
    const centred = intentFor(bot, { x: 20, z: 0 }, () => 0.5).aimDelta;
    expect(spread).toBeGreaterThan(centred);
  });

  it("is deterministic for a fixed seed", () => {
    const a = botAt(0, 0);
    const b = botAt(0, 0);
    (a as unknown as { chargeHeld: number }).chargeHeld = BOT_CHARGE_RELEASE;
    (b as unknown as { chargeHeld: number }).chargeHeld = BOT_CHARGE_RELEASE;
    expect(intentFor(a, { x: 20, z: 0 }, mulberry32(7)).aimDelta).toBe(
      intentFor(b, { x: 20, z: 0 }, mulberry32(7)).aimDelta,
    );
  });

  it("never asks to change club", () => {
    expect(intentFor(botAt(0, 0), { x: 20, z: 0 }).selectClub).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/bot.test.ts`
Expected: FAIL — `Cannot find module './bot'`.

- [ ] **Step 3: Write the bot**

Create `src/sim/bot.ts`:

```ts
import { applyAimSpread } from "../physics/Ballistics";
import type { PlayerIntent } from "../input/InputSource";
import type { Cart } from "./entities/Cart";

/**
 * The AI opponent, as one pure function of exactly the state it needs: its own cart, and where
 * the thing it is fighting happens to be. Structural rather than a method on `Cart` or `Sim`,
 * the same way `hudState.ts`'s `HudSource` is -- it makes the whole behaviour testable with no
 * Rapier world and no `Sim` at all.
 *
 * DOM-free and Rapier-free like everything else in `src/sim/**`. Deliberately has no memory:
 * everything it needs to decide is already on the cart it is driving.
 */

/** Metres. Outside this the bot idles rather than pathfinding across the course. */
export const BOT_ENGAGE_RANGE = 40;
/** Metres. Inside this the bot stops closing -- a cart nose-to-nose cannot bring its barrel to bear. */
export const BOT_STANDOFF = 12;
/** Radians per second of turret slew. Bounded so the bot's aim is not instant and omniscient. */
export const BOT_AIM_RATE = 1.2;
/** Radians. Inside this bearing error the bot considers itself on target and starts charging. */
export const BOT_FIRE_TOLERANCE = 0.12;
/** Radians of heading error at which the bot asks for full steering lock. */
export const BOT_STEER_FULL = 0.6;
/** Charge fraction at which the bot lets go of the trigger. */
export const BOT_CHARGE_RELEASE = 0.8;
/**
 * Channel index for a bot's RNG, alongside terrain (0), surfaces (1) and course layout (2).
 * `hashChannel(seed, index, BOT_CHANNEL, botIndex)` gives each bot its own independent stream,
 * so bot behaviour is reproducible per seed and no bot's draws shift another's.
 */
export const BOT_CHANNEL = 3;

/**
 * What the bot is engaging. Not a `Cart`, because the bot must not be able to read its target's
 * ammo, charge or health -- and because `dead` is the only thing about the target beyond its
 * position that the bot is allowed to know.
 */
export interface BotTarget {
  readonly x: number;
  readonly z: number;
  /** A dead target is not engaged at all: that is what stops a bot camping a respawn point. */
  readonly dead: boolean;
}

/**
 * Writes this tick's intent for `bot` into `out`.
 *
 * Aim, drive and fire, and nothing else -- no pathfinding, no hazard avoidance beyond what
 * `cartSpeedScale` already does for free through the shared `Cart.step`, no seeking out an ammo
 * bucket when it runs dry. Those are real navigation problems and are deliberately deferred.
 *
 * The firing model is the interesting part. `Cart.step` charges while `fire` is held and shoots
 * on the *release* edge, so a bot that simply held the trigger would never fire. Instead the bot
 * reads its own `charge` and lets go once it is charged enough -- which makes a charge-and-release
 * weapon drivable from a function with no state of its own.
 *
 * `random` is consumed at most once per call, and only on a release tick.
 */
export function computeBotIntent(
  bot: Cart,
  target: BotTarget,
  dt: number,
  random: () => number,
  out: PlayerIntent,
): void {
  out.throttle = 0;
  out.steer = 0;
  out.brake = false;
  out.aimDelta = 0;
  out.fire = false;
  out.selectClub = null;

  const dx = target.x - bot.position.x;
  const dz = target.z - bot.position.z;
  const distance = Math.hypot(dx, dz);
  if (target.dead || distance > BOT_ENGAGE_RANGE || distance < 1e-6) return;

  const bearing = Math.atan2(dz, dx);

  // Drive: turn the chassis toward the target and close to the standoff, then hold station.
  const headingError = wrapAngle(bearing - bot.heading);
  out.steer = clampSigned(headingError / BOT_STEER_FULL);
  out.throttle = distance > BOT_STANDOFF ? 1 : 0;
  out.brake = distance < BOT_STANDOFF * 0.5;

  // Aim: ease the turret toward the bearing at a bounded rate.
  const aimError = wrapAngle(bearing - bot.turretYaw);
  const maxSlew = BOT_AIM_RATE * dt;
  out.aimDelta = Math.min(maxSlew, Math.max(-maxSlew, aimError));

  const wantsToFire = Math.abs(aimError) < BOT_FIRE_TOLERANCE && bot.ammo > 0;
  out.fire = wantsToFire && bot.charge < BOT_CHARGE_RELEASE;

  // On the release tick, offset the turret inside the club's own accuracy cone. This is the
  // per-shot spread channel `applyAimSpread` was written for and never had a caller for; the
  // player's shots are deliberately unaffected.
  if (wantsToFire && !out.fire) {
    out.aimDelta += applyAimSpread(0, bot.equippedClub, random);
  }
}

/** Folds an angle into [-PI, PI], so an error either side of the wrap turns the short way. */
function wrapAngle(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

function clampSigned(v: number): number {
  return Math.min(1, Math.max(-1, v));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sim/bot.test.ts`
Expected: PASS.

- [ ] **Step 5: Drive the bots with it**

In `src/sim/world.ts`, add to `CartRig`:

```ts
  /**
   * The bot's own seeded stream. `null` for the player's rig, which is not AI-driven.
   * Deliberately not `readonly`: `reset()` re-seeds it so "play again" is a genuine rerun
   * rather than a continuation of the previous match's stream.
   */
  random: (() => number) | null;
  /** Reused per tick so the bot's intent costs no allocation. `null` for the player's rig. */
  readonly intentScratch: PlayerIntent | null;
```

Change `addCartRig`'s signature and its `this.rigs.push(...)`:

```ts
  private addCartRig(cart: Cart, spawn: Vec3, random: (() => number) | null): void {
```

```ts
    this.rigs.push({
      cart,
      body,
      collider,
      fallSpeed: 0,
      random,
      intentScratch: random === null ? null : neutralIntent(),
    });
```

Update the two call sites in `create`:

```ts
    sim.addCartRig(sim.cart, cartSpawnPosition(terrain), null);
```

```ts
    const botCount = options.botCount ?? 1;
    for (let i = 0; i < botCount; i++) {
      const bot = new Cart({ maxHealth: 2 * hole.par });
      sim.bots.push(bot);
      sim.addCartRig(
        bot,
        botSpawnPosition(terrain, i),
        mulberry32(hashChannel(hole.seed, hole.index, BOT_CHANNEL, i)),
      );
    }
```

Replace the loop in `stepCart`:

```ts
    for (const rig of this.rigs) {
      this.stepRig(rig, this.intentFor(rig, intent));
    }
```

and add beside it:

```ts
  /** The player's rig gets the player's intent; a bot's gets whatever `sim/bot.ts` decides. */
  private intentFor(rig: CartRig, playerIntent: PlayerIntent): PlayerIntent {
    if (rig.random === null || rig.intentScratch === null) return playerIntent;
    computeBotIntent(rig.cart, this.botTargetScratch(), FIXED_DT, rig.random, rig.intentScratch);
    return rig.intentScratch;
  }

  /**
   * The player, as the only thing a bot engages in this build. Written into one reused object
   * per the no-allocation rule; a bot never sees the player's `Cart` itself.
   */
  private botTargetScratch(): BotTarget {
    this.botTarget.x = this.cart.position.x;
    this.botTarget.z = this.cart.position.z;
    this.botTarget.dead = this.cart.dead;
    return this.botTarget;
  }
```

Add the scratch field beside the other scratch objects:

```ts
  private readonly botTarget = { x: 0, z: 0, dead: false };
```

`BotTarget`'s fields are `readonly`, which describes the contract for the callee, not the object's own mutability — a `{ x: number; z: number; dead: boolean }` is assignable to it. Extend the imports:

```ts
import { BOT_CHANNEL, computeBotIntent } from "./bot";
import type { BotTarget } from "./bot";
import { hashChannel, mulberry32 } from "./rng";
```

`Sim.reset()` must re-seed the bots. Add to `reset()`'s per-rig loop:

```ts
      if (rig.random !== null) {
        rig.random = mulberry32(
          hashChannel(this.terrain.spec.seed, this.terrain.spec.index, BOT_CHANNEL, this.rigs.indexOf(rig) - 1),
        );
      }
```

- [ ] **Step 6: Write the integration test**

Append to the `describe("bot carts", ...)` block in `src/sim/world.cart.test.ts`:

```ts
  it("stays put while the player is out of its engagement range", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    const bot = sim.bots[0]!;
    const start = { x: bot.position.x, z: bot.position.z };
    for (let i = 0; i < 300; i++) sim.step();
    expect(Math.hypot(bot.position.x - start.x, bot.position.z - start.z)).toBeLessThan(1);
    expect(bot.ammo).toBe(STARTING_AMMO);
  });

  it("closes on the player and spends ammo once the player is in range", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    const bot = sim.bots[0]!;
    // Put the player just inside the bot's engagement range rather than driving there, so the
    // assertion is about the bot rather than about the terrain between the tee and the cup.
    sim.cart.position.x = bot.position.x - 20;
    sim.cart.position.z = bot.position.z;
    const ammoBefore = bot.ammo;
    const distanceBefore = 20;

    for (let i = 0; i < 600; i++) sim.step();

    const distanceAfter = Math.hypot(
      bot.position.x - sim.cart.position.x,
      bot.position.z - sim.cart.position.z,
    );
    expect(distanceAfter).toBeLessThan(distanceBefore);
    expect(bot.ammo).toBeLessThan(ammoBefore);
  });

  it("holds fire at a dead player instead of camping the respawn", async () => {
    const sim = await Sim.create(fixedHoleSpec());
    const bot = sim.bots[0]!;
    sim.cart.position.x = bot.position.x - 15;
    sim.cart.position.z = bot.position.z;
    (sim as unknown as { killCart: (cart: Cart) => void }).killCart(sim.cart);
    const ammoBefore = bot.ammo;

    // Shorter than RESPAWN_DELAY_S, so the player is dead for the whole window.
    for (let i = 0; i < seconds(RESPAWN_DELAY_S - 0.5); i++) sim.step();

    expect(bot.ammo).toBe(ammoBefore);
  });

  it("plays the same match twice from the same seed", async () => {
    const trace = async (): Promise<number[]> => {
      const sim = await Sim.create(fixedHoleSpec());
      sim.cart.position.x = sim.bots[0]!.position.x - 20;
      sim.cart.position.z = sim.bots[0]!.position.z;
      const out: number[] = [];
      for (let i = 0; i < 400; i++) {
        sim.step();
        out.push(sim.bots[0]!.turretYaw);
      }
      return out;
    };
    expect(await trace()).toEqual(await trace());
  });
```

- [ ] **Step 7: Run everything**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, tsc silent. If the "closes on the player" test does not spend ammo, check that `intentFor` is actually reached for the bot rig and that `BOT_ENGAGE_RANGE` covers the 20 m placement.

- [ ] **Step 8: Commit**

```bash
git add src/sim/bot.ts src/sim/bot.test.ts src/sim/world.ts src/sim/world.cart.test.ts
git commit -s -m "sim: a seeded AI bot cart that drives at the player and shoots

One pure function of the bot's own state plus the player's position: turn
toward, close to a standoff, slew the turret at a bounded rate, and hold the
trigger until charged. It reads its own charge to drive a charge-and-release
weapon without carrying state. A dead target is not engaged, so a bot cannot
camp a respawn point, and each bot draws from its own seeded channel."
```

---

## Task 7: Match clock and win condition

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `src/ui/hudState.ts`, `src/ui/hud.ts`, `index.html`
- Test: `src/sim/world.cart.test.ts`, `src/ui/hudState.test.ts`

**Interfaces:**
- Consumes: `Cart.strokesTaken` (Task 1), `SimOptions` (Task 3).
- Produces:
  - `MATCH_DURATION_S = 180` exported from `src/sim/world.ts`.
  - `SimOptions.matchDurationS?: number`.
  - `Sim.matchTimeRemaining: number`, `Sim.matchOver: boolean`.
  - `Sim.matchOutcome(): MatchOutcome`, `type MatchOutcome = "pending" | "player" | "bot" | "draw"`.
  - `HudState.timerText: string`.

- [ ] **Step 1: Write the failing tests**

Append to `src/sim/world.cart.test.ts`:

```ts
describe("the match clock", () => {
  it("counts down from the default duration", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0 });
    expect(sim.matchTimeRemaining).toBe(MATCH_DURATION_S);
    expect(sim.matchOver).toBe(false);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.matchTimeRemaining).toBeCloseTo(MATCH_DURATION_S - 1, 5);
  });

  it("runs to the end in a handful of ticks when a test shortens it", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { botCount: 0, matchDurationS: 5 / 60 });
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchTimeRemaining).toBe(0);
    expect(sim.matchOver).toBe(true);
  });

  it("freezes the world once the match is over", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    for (let i = 0; i < 5; i++) sim.step();
    const frozen = { ...sim.cart.position };
    const botFrozen = { ...sim.bots[0]!.position };

    const intent = neutralIntent();
    intent.throttle = 1;
    for (let i = 0; i < 120; i++) sim.step(intent);

    expect(sim.cart.position.x).toBeCloseTo(frozen.x, 9);
    expect(sim.cart.position.z).toBeCloseTo(frozen.z, 9);
    expect(sim.bots[0]!.position.x).toBeCloseTo(botFrozen.x, 9);
  });

  it("is pending until the clock runs out", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    expect(sim.matchOutcome()).toBe("pending");
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOutcome()).toBe("draw");
  });

  it("gives the win to whoever took fewer strokes", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    sim.bots[0]!.strokesTaken = 3;
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOutcome()).toBe("player");
  });

  it("gives the win to the bot when the player took more", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    sim.cart.strokesTaken = 4;
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOutcome()).toBe("bot");
  });

  it("calls an equal score a draw rather than picking a winner", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    sim.cart.strokesTaken = 2;
    sim.bots[0]!.strokesTaken = 2;
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOutcome()).toBe("draw");
  });

  it("keeps the score a cart died on: a death on the closing tick still counts", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    for (let i = 0; i < 4; i++) sim.step();
    sim.bots[0]!.strokesTaken = 6;
    (sim as unknown as { killCart: (cart: Cart) => void }).killCart(sim.bots[0]!);
    sim.step();
    expect(sim.matchOver).toBe(true);
    expect(sim.bots[0]!.strokesTaken).toBe(6);
    expect(sim.matchOutcome()).toBe("player");
  });

  it("reset re-rolls the clock and clears the result", async () => {
    const sim = await Sim.create(fixedHoleSpec(), { matchDurationS: 5 / 60 });
    for (let i = 0; i < 5; i++) sim.step();
    expect(sim.matchOver).toBe(true);

    sim.reset();

    expect(sim.matchOver).toBe(false);
    expect(sim.matchTimeRemaining).toBeCloseTo(5 / 60, 9);
    expect(sim.matchOutcome()).toBe("pending");
  });
});
```

Add `MATCH_DURATION_S` to the `./world` import and `neutralIntent` from `../input/InputSource` in that file.

Append to `src/ui/hudState.test.ts`:

```ts
  it("renders the clock as minutes and seconds", () => {
    expect(derive(source({ matchTimeRemaining: 180 })).timerText).toBe("3:00");
    expect(derive(source({ matchTimeRemaining: 65.9 })).timerText).toBe("1:05");
    expect(derive(source({ matchTimeRemaining: 9 })).timerText).toBe("0:09");
    expect(derive(source({ matchTimeRemaining: 0 })).timerText).toBe("0:00");
  });
```

and add `matchTimeRemaining: 180,` to that file's `source()` default object.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/world.cart.test.ts src/ui/hudState.test.ts`
Expected: FAIL — `MATCH_DURATION_S` is not exported, `matchTimeRemaining` is undefined.

- [ ] **Step 3: Add the clock**

In `src/sim/world.ts`, add near the other constants:

```ts
/**
 * Match length in seconds. Three minutes is long enough for the engagement range to matter and
 * short enough that a match is a sitting rather than a session. Overridable per `Sim.create` so
 * a test can run a match to its end in a handful of ticks instead of 180 real seconds.
 */
export const MATCH_DURATION_S = 180;

/** Who won, once the clock has run out. */
export type MatchOutcome = "pending" | "player" | "bot" | "draw";
```

Add to `SimOptions`:

```ts
  /** Seconds on the match clock. Defaults to MATCH_DURATION_S. */
  readonly matchDurationS?: number;
```

Add the fields:

```ts
  /** Seconds left on the match clock. Counts down every `step()` until it hits zero. */
  matchTimeRemaining: number;
  /** Set once, on the tick the clock reaches zero. Every later `step()` is a no-op. */
  matchOver = false;
  private readonly matchDurationS: number;
```

Change the private constructor to take and store the duration:

```ts
  private constructor(terrain: Terrain, surfaces: Surfaces, matchDurationS: number) {
    this.matchDurationS = matchDurationS;
    this.matchTimeRemaining = matchDurationS;
```

(keep the rest of the constructor body as it is), and in `create`:

```ts
    const sim = new Sim(
      terrain,
      createSurfaces(hole, terrain),
      options.matchDurationS ?? MATCH_DURATION_S,
    );
```

At the very top of `step()`, before the buffer swaps:

```ts
    // The clock is checked before anything else moves, so a finished match freezes exactly where
    // it stood -- including the previous/current snapshot pairs, which stay equal rather than
    // drifting apart under a renderer that keeps interpolating.
    if (this.matchOver) return;
    this.matchTimeRemaining -= FIXED_DT;
    // Half a tick of slack, not `<= 0`. Repeated subtraction of 1/60 leaves a float residue --
    // a five-tick match ends on 6.9e-18, not on 0 -- so an exact test never fires and the clock
    // runs a tick long, or forever. The threshold makes "the tick that brings it to zero" exact.
    if (this.matchTimeRemaining <= FIXED_DT * 0.5) {
      this.matchTimeRemaining = 0;
      this.matchOver = true;
      return;
    }
```

Add the outcome method after `isResting()`:

```ts
  /**
   * Fewest strokes taken wins; an equal best score is a draw rather than an arbitrary pick.
   *
   * Read off the live `strokesTaken` counters rather than a result snapshot taken at the buzzer:
   * `step()` returns before touching a cart once `matchOver` is set, so the numbers here cannot
   * move after the match ends, and a cart that died on the closing tick keeps the score it died
   * with.
   */
  matchOutcome(): MatchOutcome {
    if (!this.matchOver) return "pending";

    let bestBot = Number.POSITIVE_INFINITY;
    for (const bot of this.bots) bestBot = Math.min(bestBot, bot.strokesTaken);

    const player = this.cart.strokesTaken;
    if (player < bestBot) return "player";
    if (bestBot < player) return "bot";
    return "draw";
  }
```

With no bots, `bestBot` is `Infinity` and the player always wins — correct for a `botCount: 0` sim, which is a test fixture rather than a match.

In `reset()`, add beside the other cleared fields:

```ts
    this.matchTimeRemaining = this.matchDurationS;
    this.matchOver = false;
```

- [ ] **Step 4: Put the clock on the HUD**

In `src/ui/hudState.ts`, add `readonly matchTimeRemaining: number;` to `HudSource`, `timerText: string;` to `HudState`, `timerText: "",` to `createHudStateScratch()`, and in `deriveHudState`:

```ts
  out.timerText = formatClock(source.matchTimeRemaining);
```

with, at the bottom of the file:

```ts
/** m:ss, floored -- a clock that rounds up shows 3:00 for a match that has already started. */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
```

In `src/ui/hud.ts`, add `timer: HTMLElement;` to `Hud`, `"hud-timer"` to the `ids` array (in the position matching the destructuring), `timer` to the destructuring and the returned object, and `setText(hud.timer, state.timerText);` to `drawHud` beside the other `setText` calls.

In `index.html`, put the timer where `#hud-mode` used to be, in `#hud-row`:

```html
        <span id="hud-timer">3:00</span>
```

and add the style beside `#hud-status`:

```css
      #hud-timer { font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, tsc silent.

- [ ] **Step 6: Commit**

```bash
git add src/sim/world.ts src/sim/world.cart.test.ts src/ui/hudState.ts src/ui/hudState.test.ts src/ui/hud.ts index.html
git commit -s -m "sim/ui: a match clock and a fewest-strokes win condition

Three minutes by default, overridable per Sim.create so a test runs a whole
match in five ticks. The clock is checked before anything else moves, so a
finished match freezes where it stood and the closing tick's score is the one
that counts. Ties are reported as draws rather than resolved arbitrarily."
```

---

## Task 8: The results overlay

One DOM overlay gated by one boolean. Explicitly not `ScreenManager` — no enter/exit lifecycle, no second screen to register.

**Files:**
- Create: `src/ui/matchResultsState.ts`, `src/ui/matchResultsState.test.ts`, `src/ui/matchResults.ts`
- Modify: `index.html`, `src/main.ts`, `tools/smoke.mjs`

**Interfaces:**
- Consumes: `Sim.matchOver`, `Sim.matchOutcome()`, `Cart.strokesTaken`.
- Produces:
  - `MatchResultsSource`, `MatchResultsState`, `createMatchResultsScratch()`, `deriveMatchResults(source, out)` in `src/ui/matchResultsState.ts`.
  - `readMatchResults(): MatchResultsDom | null`, `drawMatchResults(dom, source)` in `src/ui/matchResults.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/matchResultsState.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createMatchResultsScratch,
  deriveMatchResults,
} from "./matchResultsState";
import type { MatchResultsSource, MatchResultsState } from "./matchResultsState";

function source(overrides: Partial<MatchResultsSource> = {}): MatchResultsSource {
  return {
    matchOver: true,
    cart: { strokesTaken: 2 },
    bots: [{ strokesTaken: 5 }],
    matchOutcome: () => "player",
    ...overrides,
  };
}

function derive(src: MatchResultsSource): MatchResultsState {
  const out = createMatchResultsScratch();
  deriveMatchResults(src, out);
  return out;
}

describe("deriveMatchResults", () => {
  it("stays hidden while the match is still running", () => {
    const state = derive(source({ matchOver: false, matchOutcome: () => "pending" }));
    expect(state.visible).toBe(false);
  });

  it("announces a player win with both stroke counts", () => {
    const state = derive(source());
    expect(state.visible).toBe(true);
    expect(state.headline).toBe("YOU WIN");
    expect(state.playerText).toBe("YOU 2");
    expect(state.botText).toBe("BOT 5");
  });

  it("announces a bot win", () => {
    const state = derive(
      source({ cart: { strokesTaken: 6 }, bots: [{ strokesTaken: 1 }], matchOutcome: () => "bot" }),
    );
    expect(state.headline).toBe("BOT WINS");
  });

  it("announces a draw", () => {
    const state = derive(
      source({ cart: { strokesTaken: 3 }, bots: [{ strokesTaken: 3 }], matchOutcome: () => "draw" }),
    );
    expect(state.headline).toBe("DRAW");
  });

  it("reports the best bot score when there is more than one", () => {
    const state = derive(source({ bots: [{ strokesTaken: 7 }, { strokesTaken: 4 }] }));
    expect(state.botText).toBe("BOT 4");
  });

  it("reads a dash for the bot score when there is no bot", () => {
    const state = derive(source({ bots: [] }));
    expect(state.botText).toBe("BOT —");
  });

  it("writes into the caller's object rather than allocating", () => {
    const out = createMatchResultsScratch();
    deriveMatchResults(source(), out);
    const first = out;
    deriveMatchResults(source({ matchOutcome: () => "draw" }), out);
    expect(out).toBe(first);
    expect(out.headline).toBe("DRAW");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/matchResultsState.test.ts`
Expected: FAIL — `Cannot find module './matchResultsState'`.

- [ ] **Step 3: Write the derivation**

Create `src/ui/matchResultsState.ts`:

```ts
import type { MatchOutcome } from "../sim/world";

/**
 * The DOM-free half of the results overlay, split from the writing half for the same reason
 * `hudState.ts` is: the rules below -- when it shows, what it says -- get asserted in Vitest's
 * node environment instead of eyeballed in a browser.
 *
 * Reads only. Per AGENTS.md, `src/ui/**` is a pure consumer of sim state.
 */

/** The structural slice of `Sim` this module needs. Structural so tests need no Rapier world. */
export interface MatchResultsSource {
  readonly matchOver: boolean;
  readonly cart: { readonly strokesTaken: number };
  readonly bots: readonly { readonly strokesTaken: number }[];
  matchOutcome(): MatchOutcome;
}

export interface MatchResultsState {
  visible: boolean;
  headline: string;
  playerText: string;
  botText: string;
}

/** A blank scratch object for a caller to hold and pass repeatedly as `out`. */
export function createMatchResultsScratch(): MatchResultsState {
  return { visible: false, headline: "", playerText: "", botText: "" };
}

/**
 * Writes into `out` rather than allocating: `main.ts` calls this from the render callback, which
 * the no-per-frame-allocation rule covers just as it covers the fixed step.
 *
 * The bot's score is the best of them, which is the same number `Sim.matchOutcome` compares the
 * player against -- one rule, stated once, so the headline and the numbers under it cannot
 * disagree.
 */
export function deriveMatchResults(source: MatchResultsSource, out: MatchResultsState): void {
  out.visible = source.matchOver;
  out.headline = HEADLINES[source.matchOutcome()];
  out.playerText = `YOU ${source.cart.strokesTaken}`;

  let bestBot = Number.POSITIVE_INFINITY;
  for (const bot of source.bots) bestBot = Math.min(bestBot, bot.strokesTaken);
  out.botText = Number.isFinite(bestBot) ? `BOT ${bestBot}` : "BOT —";
}

const HEADLINES: Readonly<Record<MatchOutcome, string>> = {
  pending: "",
  player: "YOU WIN",
  bot: "BOT WINS",
  draw: "DRAW",
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/matchResultsState.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the DOM half**

Create `src/ui/matchResults.ts`:

```ts
import { createMatchResultsScratch, deriveMatchResults } from "./matchResultsState";
import type { MatchResultsSource } from "./matchResultsState";

/**
 * The DOM-writing half of the results overlay. Every decision lives in `matchResultsState.ts`;
 * this file only puts strings into elements and toggles one `hidden` flag -- the same split
 * `hud.ts`/`hudState.ts` already established, which is why this file has no tests and
 * `npm run smoke` is what notices an element wired to nothing.
 *
 * Deliberately not Phase 1.75's `ScreenManager`: no enter/exit lifecycle, no scene residency,
 * no second screen to register. One overlay, one boolean -- the smallest thing that gives a
 * match a real ending instead of a freeze.
 */

const stateScratch = createMatchResultsScratch();

export interface MatchResultsDom {
  root: HTMLElement;
  headline: HTMLElement;
  playerScore: HTMLElement;
  botScore: HTMLElement;
  playAgain: HTMLElement;
}

export function readMatchResults(): MatchResultsDom | null {
  const ids = ["match-results", "results-headline", "results-you", "results-bot", "play-again"] as const;
  const found = ids.map((id) => document.getElementById(id));
  if (found.some((element) => element === null)) return null;
  const [root, headline, playerScore, botScore, playAgain] = found as HTMLElement[];
  return {
    root: root!,
    headline: headline!,
    playerScore: playerScore!,
    botScore: botScore!,
    playAgain: playAgain!,
  };
}

export function drawMatchResults(dom: MatchResultsDom, source: MatchResultsSource): void {
  const state = stateScratch;
  deriveMatchResults(source, state);

  if (dom.root.hidden === state.visible) dom.root.hidden = !state.visible;
  if (!state.visible) return;

  setText(dom.headline, state.headline);
  setText(dom.playerScore, state.playerText);
  setText(dom.botScore, state.botText);
}

/** Guarded so an unchanged string does not dirty the DOM every frame at 60fps. */
function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}
```

- [ ] **Step 6: Add the markup**

In `index.html`, add before `<div id="hud">`:

```html
    <div id="match-results" hidden>
      <div id="results-card">
        <h1 id="results-headline">DRAW</h1>
        <div id="results-scores">
          <span id="results-you">YOU 0</span>
          <span id="results-bot">BOT 0</span>
        </div>
        <button id="play-again" type="button">PLAY AGAIN</button>
      </div>
    </div>
```

and the styles, after the `#hud-combat` block:

```css
      /* UI-SPEC section 6's visual language: dark translucent card, white bold condensed type.
         Not S2's full nine-column scorecard -- that is Phase 1.75's screen, and this is one
         overlay gated by one boolean. */
      #match-results {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(8, 12, 16, 0.72);
        font: 600 15px system-ui, sans-serif;
        letter-spacing: 0.06em;
        color: #fff;
      }
      #match-results[hidden] { display: none; }
      #results-card {
        min-width: 300px;
        padding: 28px 34px;
        border-radius: 12px;
        background: rgba(16, 20, 24, 0.94);
        text-align: center;
      }
      #results-headline { margin: 0 0 18px; font-size: 30px; letter-spacing: 0.1em; }
      #results-scores {
        display: flex;
        justify-content: space-between;
        gap: 28px;
        margin-bottom: 22px;
        font-size: 17px;
        font-variant-numeric: tabular-nums;
      }
      #play-again {
        width: 100%;
        padding: 11px 0;
        border: 0;
        border-radius: 8px;
        background: #ef8a2b;
        color: #14181c;
        font: inherit;
        font-size: 15px;
        letter-spacing: 0.1em;
        cursor: pointer;
      }
```

- [ ] **Step 7: Wire it up**

In `src/main.ts`, add the import:

```ts
import { drawMatchResults, readMatchResults } from "./ui/matchResults";
```

after the `readHud()` call:

```ts
  const results = readMatchResults();
  if (!container || !hud || !results) {
    throw new Error("expected #app, the #hud elements and #match-results in index.html");
  }
```

(replacing the existing two-way check), then wire the button beside the existing `KeyR` listener:

```ts
  // Same reset path R already triggers: it re-rolls the clock, clears the result, re-seeds the
  // bots and stands the targets back up.
  results.playAgain.addEventListener("click", () => sim.reset());
```

and add to the render callback, after `drawHud(hud, sim);`:

```ts
      drawMatchResults(results, sim);
```

- [ ] **Step 8: Add the smoke assertions**

In `tools/smoke.mjs`, add `resultsHidden: document.getElementById("match-results").hidden,` to the `read()` payload, and append a block before the `no console errors` check:

```js
console.log("=== MATCH RESULTS ===");
check("results overlay is hidden while the match runs", (await read()).resultsHidden === true);

// Run the clock out rather than waiting three minutes for it.
await page.evaluate(() => {
  window.__teetimeturrets.sim.matchTimeRemaining = 1 / 60;
});
await new Promise((r) => setTimeout(r, 400));
const ended = await page.evaluate(() => ({
  hidden: document.getElementById("match-results").hidden,
  headline: document.getElementById("results-headline").textContent,
}));
check("results overlay appears when the clock runs out", ended.hidden === false);
check("results overlay names an outcome", ended.headline.length > 0, ended.headline);

await page.click("#play-again");
await new Promise((r) => setTimeout(r, 400));
const restarted = await read();
check("play again restarts the match", restarted.resultsHidden === true, `t=${restarted.timer}`);
```

and add `timer: document.getElementById("hud-timer").textContent,` to the `read()` payload so that last detail string is meaningful.

- [ ] **Step 9: Verify**

Run: `npm test && npx tsc --noEmit && npm run smoke`
Expected: tests pass, tsc silent, `SMOKE PASS`.

- [ ] **Step 10: Commit**

```bash
git add src/ui/matchResultsState.ts src/ui/matchResultsState.test.ts src/ui/matchResults.ts index.html src/main.ts tools/smoke.mjs
git commit -s -m "ui: a results overlay so a finished match has an ending

One overlay gated by Sim.matchOver, following hud.ts/hudState.ts's split
between a tested DOM-free derivation and a thin writer. Play again runs the
same reset path R already triggers. Explicitly not the screen manager: no
lifecycle, no second screen, no scene residency question."
```

---

## Task 9: Draw the bot, and put a nameplate over every cart

**Files:**
- Create: `src/ui/nameplates.ts`
- Modify: `src/render/scene.ts`, `src/main.ts`, `index.html`, `tools/smoke.mjs`

**Interfaces:**
- Consumes: `Sim.bots`, `Sim.previousBotCarts`/`currentBotCarts`, `Cart.health`.
- Produces:
  - `RenderScene` constructor gains a `botCount: number` parameter after `targetCount`.
  - `FrameView.botCarts: CartTransform[]`.
  - `RenderScene.projectToScreen(x, y, z, out: { x: number; y: number }): boolean`.
  - `Nameplates` class in `src/ui/nameplates.ts`.

- [ ] **Step 1: Add the bot cart meshes**

In `src/render/scene.ts`:

Add to `FrameView`, after `cart`:

```ts
  /** One entry per bot cart, laid out exactly as `cart` is. */
  botCarts: CartTransform[];
```

Change the constructor signature and build the bot models:

```ts
  constructor(container: HTMLElement, terrain: Terrain, targetCount: number, botCount: number) {
```

and after `this.cart = new GolfClub(); this.scene.add(this.cart);`:

```ts
    // A bot is physically a cart, so it is visually one too -- the same procedural model, no
    // cheaper stand-in. Team colour is Phase 5's; today the nameplate is what tells them apart.
    for (let i = 0; i < botCount; i++) {
      const bot = new GolfClub();
      this.botCarts.push(bot);
      this.scene.add(bot);
    }
```

with the field declared beside `cart`:

```ts
  private readonly botCarts: GolfClub[] = [];
```

Replace `drawCart(view)` with a reusable poser and call it for every cart. Change `draw()`'s `this.drawCart(view);` to:

```ts
    this.poseCart(this.cart, view.cart, view.club, view.charge01, view.turretLoaded);
    for (let i = 0; i < this.botCarts.length; i++) {
      const transform = view.botCarts[i];
      if (transform === undefined) continue;
      // A bot's club and charge are not published to the renderer: it always draws with the
      // default model, which is honest about what the view carries rather than guessing.
      this.poseCart(this.botCarts[i]!, transform, view.club, 0, false);
    }
```

and replace the `drawCart` method with:

```ts
  /**
   * Sim yaw and Three yaw are different conventions and the conversion is easy to get subtly
   * wrong. Sim yaw 0 points down world +X; a Three object with `rotation.y = t` points its local
   * +Z (the cart's forward) at world (sin t, 0, cos t). Setting those equal gives
   * t = PI/2 - yaw. The turret pivot is a *child* of the cart group, so its local rotation is
   * the difference of the two converted angles, which simplifies to (heading - turretYaw).
   */
  private poseCart(
    model: GolfClub,
    c: CartTransform,
    club: ClubType,
    charge01: number,
    loaded: boolean,
  ): void {
    model.position.set(c.position.x, c.position.y - CART_BODY_OFFSET_Y, c.position.z);
    model.rotation.y = Math.PI / 2 - c.heading;
    model.setAimYaw(c.heading - c.turretYaw);
    model.setClub(club);
    model.setChargeVisual(charge01);
    model.setBallLoaded(loaded);
  }
```

Add every bot model to `dispose()`:

```ts
    for (const bot of this.botCarts) bot.dispose();
```

Add the projection, after `dispose()`:

```ts
  /**
   * World point -> canvas pixels, per docs/ARCHITECTURE.md section 2c. Returns false when the
   * point is behind the camera, which is what stops a nameplate being drawn mirrored in front of
   * a viewer looking the other way.
   *
   * Lives here rather than in `src/ui/**` because the camera does, and `src/ui/**` must not
   * import three. Writes into `out`: this runs once per cart per frame.
   */
  projectToScreen(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    this.projectScratch.set(x, y, z).project(this.camera);
    if (this.projectScratch.z > 1) return false;
    const size = this.renderer.getSize(this.sizeScratch);
    out.x = (this.projectScratch.x * 0.5 + 0.5) * size.x;
    out.y = (1 - (this.projectScratch.y * 0.5 + 0.5)) * size.y;
    return true;
  }
```

with the two scratch fields beside the others:

```ts
  private readonly projectScratch = new THREE.Vector3();
  private readonly sizeScratch = new THREE.Vector2();
```

- [ ] **Step 2: Write the nameplate overlay**

Create `src/ui/nameplates.ts`:

```ts
/**
 * A name pill and health bar over each cart -- BACKLOG #34b, images 07 and 09.
 *
 * The elements are built once and repositioned every frame, which is exactly how a nameplate
 * differs from a hit marker: UI-SPEC H11's markers are one-shot nodes that animate themselves
 * and are thrown away, and H13's plates persist. Positioned with `translate3d`, never
 * `left`/`top`, per UI-SPEC's projection rule.
 *
 * DOM only. The world->screen projection happens in `src/render/scene.ts`, which owns the
 * camera; this module never sees three.
 */

export class Nameplates {
  private readonly root: HTMLElement;
  private readonly plates: HTMLElement[] = [];
  private readonly fills: HTMLElement[] = [];

  constructor(container: HTMLElement, labels: readonly string[]) {
    this.root = container;
    for (const label of labels) {
      const plate = document.createElement("div");
      plate.className = "nameplate";
      plate.hidden = true;

      const name = document.createElement("span");
      name.className = "nameplate-name";
      name.textContent = label;

      const track = document.createElement("div");
      track.className = "nameplate-track";
      const fill = document.createElement("div");
      fill.className = "nameplate-fill";
      track.appendChild(fill);

      plate.appendChild(name);
      plate.appendChild(track);
      this.root.appendChild(plate);
      this.plates.push(plate);
      this.fills.push(fill);
    }
  }

  /**
   * Places one plate. `visible` is false when the cart is behind the camera or off screen; the
   * plate is hidden rather than parked, so a plate never appears clamped to a screen edge.
   *
   * Every write is guarded against its current value: this runs per cart per frame at 60fps, and
   * an unguarded write dirties the DOM whether or not anything changed.
   */
  setPlate(index: number, screenX: number, screenY: number, visible: boolean, healthFraction: number): void {
    const plate = this.plates[index];
    const fill = this.fills[index];
    if (plate === undefined || fill === undefined) return;

    if (plate.hidden !== !visible) plate.hidden = !visible;
    if (!visible) return;

    const transform = `translate3d(${Math.round(screenX)}px, ${Math.round(screenY)}px, 0) translate(-50%, -100%)`;
    if (plate.style.transform !== transform) plate.style.transform = transform;

    const width = `${Math.round(clamp01(healthFraction) * 100)}%`;
    if (fill.style.width !== width) fill.style.width = width;
  }

  dispose(): void {
    for (const plate of this.plates) plate.remove();
    this.plates.length = 0;
    this.fills.length = 0;
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
```

- [ ] **Step 3: Add the container and styles**

In `index.html`, add after `<div id="app"></div>`:

```html
    <div id="nameplates"></div>
```

and the styles, after the `#hud-combat` block:

```css
      /* UI-SPEC H13. Built once and repositioned per frame, unlike the one-shot hit markers. */
      #nameplates { position: fixed; inset: 0; pointer-events: none; }
      .nameplate {
        position: absolute;
        top: 0;
        left: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        padding: 4px 8px;
        border-radius: 6px;
        background: rgba(16, 20, 24, 0.62);
        font: 600 11px system-ui, sans-serif;
        letter-spacing: 0.08em;
        color: #fff;
        white-space: nowrap;
      }
      .nameplate[hidden] { display: none; }
      .nameplate-track {
        width: 62px;
        height: 4px;
        border-radius: 2px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.5);
      }
      .nameplate-fill { height: 100%; width: 100%; background: #46c46a; }
```

- [ ] **Step 4: Wire both into the frame**

In `src/main.ts`:

```ts
import { Nameplates } from "./ui/nameplates";
```

Change the scene construction and add the overlay:

```ts
  const render = new RenderScene(container, sim.terrain, sim.targets.length, sim.bots.length);
  const plateRoot = document.getElementById("nameplates");
  if (!plateRoot) throw new Error("expected #nameplates in index.html");
  const nameplates = new Nameplates(plateRoot, ["YOU", ...sim.bots.map((_, i) => `BOT ${i + 1}`)]);
```

Add to the `view` initializer:

```ts
    botCarts: sim.currentBotCarts.map(cloneCart),
```

Add to the render callback, after the existing `interpolateCart(...)` line:

```ts
      for (let i = 0; i < view.botCarts.length; i++) {
        interpolateCart(sim.previousBotCarts[i]!, sim.currentBotCarts[i]!, alpha, view.botCarts[i]!);
      }
```

and after `render.draw(view);`:

```ts
      drawNameplates(render, nameplates, view, sim);
```

with, near the other helpers:

```ts
/** Metres above a cart's capsule centre that its plate floats. Clears the turret's club head. */
const NAMEPLATE_HEIGHT = 2.6;
const plateScratch = { x: 0, y: 0 };

/**
 * Projects each cart's plate anchor and places it. Reads health straight off the sim -- a read,
 * never a mutation, per the AGENTS.md rule that src/ui/** consumes sim state.
 */
function drawNameplates(render: RenderScene, plates: Nameplates, view: FrameView, sim: Sim): void {
  placeNameplate(render, plates, 0, view.cart, sim.cart.health);
  for (let i = 0; i < view.botCarts.length; i++) {
    const bot = sim.bots[i];
    if (bot === undefined) continue;
    placeNameplate(render, plates, i + 1, view.botCarts[i]!, bot.health);
  }
}

/** Module-level rather than nested inside `drawNameplates`: a function declared inside a function
 *  body allocates a fresh closure on every call, and this one is called every frame. */
function placeNameplate(
  render: RenderScene,
  plates: Nameplates,
  index: number,
  cart: CartTransform,
  health: { readonly hp: number; readonly max: number },
): void {
  const visible = render.projectToScreen(
    cart.position.x,
    cart.position.y + NAMEPLATE_HEIGHT,
    cart.position.z,
    plateScratch,
  );
  plates.setPlate(
    index,
    plateScratch.x,
    plateScratch.y,
    visible,
    health.max > 0 ? health.hp / health.max : 0,
  );
}
```

- [ ] **Step 5: Add the smoke assertions**

In `tools/smoke.mjs`, add to the `read()` payload:

```js
      nameplates: document.querySelectorAll("#nameplates .nameplate").length,
```

and a block before the `=== MATCH RESULTS ===` block:

```js
console.log("=== NAMEPLATES ===");
const plated = await read();
check("one nameplate per cart", plated.nameplates === 2, `${plated.nameplates}`);
```

- [ ] **Step 6: Verify, including the geometry gate**

Run: `npm test && npx tsc --noEmit && npm run gate && npm run smoke`
Expected: tests pass, tsc silent, `SMOKE PASS`. The gate renders individual procedural subjects on its own rig and does not build a `RenderScene`, so it should be unaffected — if it reports a drift, **stop and read the diff PNG** before touching a baseline. Do not pass `--update-baseline` to make a failure go away.

- [ ] **Step 7: Commit**

```bash
git add src/render/scene.ts src/ui/nameplates.ts src/main.ts index.html tools/smoke.mjs
git commit -s -m "render/ui: draw the bot cart and put a nameplate over every cart

A bot is physically a cart, so it gets the same procedural model rather than a
stand-in. Nameplates are built once and repositioned per frame from the
projection in ARCHITECTURE section 2c, which is what separates them from the
one-shot hit markers; the player gets one too, because symmetric is simpler
than a special case and multiplayer will want every cart plated."
```

---

## Task 10: Whole-branch verification and the pull request

**Files:** none changed unless verification turns something up.

- [ ] **Step 1: Run every verification layer**

They answer different questions; do not substitute one for another.

```bash
npm test
npx tsc --noEmit
npm run gate
npm run smoke
npm run probe
```

Expected:
- `npm test` — every test passes.
- `npx tsc --noEmit` — silent.
- `npm run gate` — passes with no baseline update.
- `npm run smoke` — `SMOKE PASS`.
- `npm run probe` — the **same single** `driver distance` failure as the baseline (`106.4 m total ... drift 17.6%`) and nothing else. A new probe failure is a regression this branch caused; fix it rather than recording it.

- [ ] **Step 2: Re-verify tunneling after the physics-adjacent changes**

Per AGENTS.md, a change touching cart/ball physics needs the bounded-Y check, and this branch added a per-cart water reposition. The probe's full-power shot table above is that check: confirm the driver row's `apex 4.0` and a finite `total`, not a diverging Y.

- [ ] **Step 3: Confirm no session metadata reached git**

```bash
git log origin/main..HEAD --format='%H%n%B' | grep -inE 'co-authored-by|claude|anthropic|generated with|https://claude' || echo "clean"
```

Expected: `clean`. If anything matches, rewrite the offending commits before pushing — this exact leak forced a history rewrite once already.

- [ ] **Step 4: Push and open the pull request**

```bash
git push -u origin cart-only-mode
gh pr create --base main --head cart-only-mode --title "Cart-only combat mode" --body "$(cat <<'BODY'
The cart and its turret are now the only way to play. Strokes are damage
taken, an AI bot cart fights back, a match clock decides the winner, and a
results overlay reports it.

- Health is sized at `2 x par`; a ball hit and a water entry each cost exactly
  one stroke and one point of health. Cart-vs-cart shunting keeps its
  velocity-scaled damage and costs no stroke.
- `Sim` holds an array of cart rigs. `Sim.cart` is still the player's; `Sim.bots`
  holds the AI carts, each with its own body, collider, health and seeded RNG
  channel.
- `src/sim/bot.ts` is one pure function: turn toward the player, close to a
  standoff, slew the turret at a bounded rate, hold the trigger until charged,
  and let go. A dead target is not engaged, so a bot cannot camp a respawn
  point.
- A three-minute match clock, overridable per `Sim.create` so a test runs a
  whole match in five ticks. Fewest strokes wins; an equal score is a draw.
- `Sim.ball`, `Sim.launch()`, `SwingMode` and the stationary half of
  `resolveShot` stay in the tree, unreachable, as the working reference for the
  true-golf mode they are wanted for. `docs/UI-SPEC.md` sections 1 and 5,
  `docs/BACKLOG.md` #20b and `docs/ROADMAP.md` record the split as dormant.

Design: `docs/superpowers/specs/2026-09-03-cart-combat-mode-design.md`
Plan: `docs/superpowers/plans/2026-09-03-cart-combat-mode-implementation.md`

Verification: `npm test`, `npx tsc --noEmit`, `npm run gate` and `npm run smoke`
all pass. `npm run probe` shows the same single pre-existing `driver distance`
failure as `main` and no other.
BODY
)"
```

Note the PR body carries no session URL and no generated-with footer, per the Global Constraints.

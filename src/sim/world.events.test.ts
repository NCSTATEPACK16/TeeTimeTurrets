import { describe, expect, it } from "vitest";
import { ClubType } from "../physics/Ballistics";
import { fixedHoleSpec } from "./course";
import type { HoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { BUCKET_REFILL_AMMO, CART_COLLIDER, RESPAWN_DELAY_S } from "./entities/Cart";
import type { Cart } from "./entities/Cart";
import { NO_TARGET_RIG } from "./events";
import type { SimEvent, SimEventKind } from "./events";
import { neutralIntent } from "./intent";
import type { PlayerIntent } from "./intent";
import { NO_KILLER } from "./matchConfig";
import { SurfaceId } from "./surfaces";
import { Sim } from "./world";

const TPS = 60;

function holeSim(spec: HoleSpec = fixedHoleSpec(), botCount = 0): Promise<Sim> {
  return Sim.create(arenaFromHole(spec), { botCount });
}

/** Copies of every event pushed since `from`, oldest first. Copies: the log rewrites its records. */
function eventsSince(sim: Sim, from: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let s = sim.events.firstUnread(from); s < sim.events.head; s++) out.push({ ...sim.events.at(s)! });
  return out;
}

function ofKind(events: SimEvent[], kind: SimEventKind): SimEvent[] {
  return events.filter((e) => e.kind === kind);
}

/** Holds the trigger for `ticks`, then lets go on one more tick. */
function pullTrigger(sim: Sim, ticks: number): void {
  const intent: PlayerIntent = neutralIntent();
  intent.fire = true;
  for (let i = 0; i < ticks; i++) sim.step(intent);
  intent.fire = false;
  sim.step(intent);
}

/** Stands bot 0 `range` metres east of the player, facing it. Teleported once. */
function standBotOff(sim: Sim, range: number): Cart {
  const player = sim.cart;
  const bot = sim.bots[0]!;
  const x = player.position.x + range;
  const y = sim.heightAt(x, player.position.z) + CART_COLLIDER.groundOffset;
  bot.position.x = x;
  bot.position.y = y;
  bot.position.z = player.position.z;
  bot.heading = Math.PI;
  const rig = (sim as unknown as { rigs: { cart: Cart; body: { setTranslation(v: unknown, w: boolean): void } }[] }).rigs[1]!;
  rig.body.setTranslation({ x, y, z: player.position.z }, true);
  return bot;
}

describe("Sim.events", () => {
  it("logs the player's shot with its club, charge and muzzle", async () => {
    const sim = await holeSim();
    const select = neutralIntent();
    select.selectClub = ClubType.Putter;
    sim.step(select);
    const from = sim.events.head;

    pullTrigger(sim, 10);

    const shots = ofKind(eventsSince(sim, from), "shot");
    expect(shots).toHaveLength(1);
    const shot = shots[0]!;
    expect(shot.actor).toBe(0);
    expect(shot.club).toBe(ClubType.Putter);
    expect(shot.amount).toBe(1); // ten ticks is past the putter's 0.08 s charge
    // The muzzle rides the turret about 2.4 m up; the cart barely moves in eleven ticks.
    expect(Math.hypot(shot.x - sim.cart.position.x, shot.z - sim.cart.position.z)).toBeLessThan(3);
    expect(shot.y).toBeGreaterThan(sim.cart.position.y + 1);
  });

  it("logs an empty trigger as a dry fire, never as a shot", async () => {
    const sim = await holeSim();
    sim.cart.ammo = 0;
    const from = sim.events.head;

    pullTrigger(sim, 10);

    const events = eventsSince(sim, from);
    expect(ofKind(events, "shot")).toHaveLength(0);
    expect(ofKind(events, "dryfire").map((e) => e.actor)).toEqual([0]);
  });

  it("logs a hit with shooter, victim and damage, and a kill with the stroke it cost", async () => {
    const sim = await holeSim(fixedHoleSpec(), 1);
    for (let i = 0; i < TPS; i++) sim.step();
    standBotOff(sim, 20);
    sim.cart.health.hp = 2;
    const from = sim.events.head;

    // The bot does the shooting; the player sits still until it is down.
    for (let i = 0; i < 20 * TPS && !sim.cart.dead; i++) sim.step();
    expect(sim.cart.dead, "the bot never killed the player, so the test proves nothing").toBe(true);

    const events = eventsSince(sim, from);
    const hits = ofKind(events, "hit").filter((e) => e.target === 0);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const hit of hits) {
      expect(hit.actor).toBe(1);
      expect(hit.amount).toBe(1); // the putter's damage
    }
    const kills = ofKind(events, "kill");
    expect(kills.map((e) => [e.actor, e.target])).toEqual([[1, 0]]);
    const strokes = ofKind(events, "stroke");
    expect(strokes.map((e) => [e.target, e.amount])).toEqual([[0, 1]]);
    // In that order: the kill that cost it comes first.
    expect(strokes[0]!.seq).toBeGreaterThan(kills[0]!.seq);
  });

  it("logs a drowning as a splash and a death, and keeps both past the tick it happened on", async () => {
    // The old hit-marker buffer was cleared after the carts had stepped, so a death in the water
    // -- which happens inside the carts' step -- was wiped before anything could read it.
    const pond: HoleSpec = {
      ...fixedHoleSpec(),
      water: [{ points: [{ x: -20, z: 30 }, { x: 20, z: 30 }, { x: 20, z: 60 }, { x: -20, z: 60 }] }],
    };
    const sim = await holeSim(pond);
    sim.step();
    let water: { x: number; z: number } | null = null;
    for (let x = -18; x <= 18 && water === null; x += 2) {
      for (let z = 32; z <= 58 && water === null; z += 2) {
        if (sim.surfaces.surfaceAt(x, z) === SurfaceId.Water) water = { x, z };
      }
    }
    expect(water).not.toBeNull();
    sim.cart.health.hp = 1;
    sim.cart.position.x = water!.x;
    sim.cart.position.z = water!.z;
    const from = sim.events.head;

    sim.step();
    sim.step();

    const events = eventsSince(sim, from);
    const splash = ofKind(events, "splash");
    expect(splash.map((e) => e.target)).toEqual([0]);
    expect(splash[0]!.x).toBeCloseTo(water!.x, 0);
    expect(ofKind(events, "kill").map((e) => [e.actor, e.target])).toEqual([[NO_KILLER, 0]]);
  });

  it("logs a respawn at the point the cart comes back to", async () => {
    const sim = await holeSim();
    (sim as unknown as { killCart(c: Cart, v: number, k: number): void }).killCart(sim.cart, 0, NO_KILLER);
    const from = sim.events.head;

    for (let i = 0; i < Math.ceil(RESPAWN_DELAY_S * TPS) + 2 && sim.cart.dead; i++) sim.step();
    expect(sim.cart.dead).toBe(false);

    const respawns = ofKind(eventsSince(sim, from), "respawn");
    expect(respawns).toHaveLength(1);
    expect(respawns[0]!.target).toBe(0);
    expect(respawns[0]!.actor).toBe(NO_TARGET_RIG);
    expect(respawns[0]!.x).toBeCloseTo(sim.cart.position.x, 0);
    expect(respawns[0]!.z).toBeCloseTo(sim.cart.position.z, 0);
  });

  it("logs a pickup with the rounds it gave", async () => {
    const sim = await holeSim();
    sim.step();
    const bucket = sim.pickups[0]!.position;
    sim.cart.ammo = 0;
    sim.cart.position.x = bucket.x;
    sim.cart.position.z = bucket.z;
    const from = sim.events.head;

    sim.step();

    const pickups = ofKind(eventsSince(sim, from), "pickup");
    expect(pickups.map((e) => [e.actor, e.amount])).toEqual([[0, BUCKET_REFILL_AMMO]]);
  });

  it("keeps its numbering across a rematch, so a reader's cursor stays good", async () => {
    const sim = await holeSim();
    pullTrigger(sim, 10);
    const before = sim.events.head;
    expect(before).toBeGreaterThan(0);
    sim.reset();
    expect(sim.events.head).toBe(before);
  });
});

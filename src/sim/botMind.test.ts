import { describe, expect, it } from "vitest";
import { fixedHoleSpec } from "./course";
import { arenaFromHole } from "./arena";
import { neutralIntent } from "./intent";
import type { BotMind } from "./bot";
import { CART_COLLIDER } from "./entities/Cart";
import { ClubType } from "../physics/Ballistics";
import { Sim } from "./world";

const TPS = 60;

interface RigLike {
  mind: BotMind | null;
}

interface PooledBallLike {
  state: string;
  body: { translation(): { x: number; y: number; z: number } };
}

interface RigBody {
  body: { setTranslation(v: { x: number; y: number; z: number }, wake: boolean): void };
}

describe("bot minds in the world", () => {
  it("a bot with an empty magazine goes and gets more", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 1 });
    const bot = sim.bots[0]!;
    bot.ammo = 0;

    // Stand the bot 20 m off the player's side, square to the player-bucket line. Fighting the
    // player holds it at the standoff, about 18 m from the bucket, so it refills only if it goes
    // looking. Not directly behind the player: its straight run to the bucket would then go
    // through the player's cart and shove the player onto the bucket first, which puts the bucket
    // on cooldown with the bot still empty. Teleported once.
    const bucket = sim.pickups[0]!.site;
    const p = sim.cart.position;
    const away = Math.atan2(p.z - bucket.z, p.x - bucket.x) + Math.PI / 2;
    const x = p.x + Math.cos(away) * 20;
    const z = p.z + Math.sin(away) * 20;
    const y = sim.heightAt(x, z) + CART_COLLIDER.groundOffset;
    bot.position.x = x;
    bot.position.y = y;
    bot.position.z = z;
    bot.heading = away + Math.PI;
    (sim as unknown as { rigs: RigBody[] }).rigs[1]!.body.setTranslation({ x, y, z }, true);

    let refilled = false;
    for (let tick = 0; tick < 30 * TPS && !refilled; tick++) {
      sim.step(neutralIntent());
      refilled = bot.ammo > 0;
    }
    expect(refilled).toBe(true);
  }, 60_000);

  it("goes for a landed ball, not a bucket on cooldown", async () => {
    const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 1 });
    const bot = sim.bots[0]!;
    const balls = (sim as unknown as { ballPool: { all: readonly PooledBallLike[] } }).ballPool.all;

    // The bucket is the other ammo on the ground, so it is out of the picture from the first tick,
    // and the bot starts empty so none of its own shots end up on the ground as well.
    sim.pickups[0]!.readyAt = 60;
    bot.ammo = 0;

    // The player puts one short putt on the ground.
    const fire = neutralIntent();
    fire.selectClub = ClubType.Putter;
    fire.fire = true;
    for (let tick = 0; tick < 10; tick++) sim.step(fire);
    let landed: PooledBallLike | undefined;
    for (let tick = 0; tick < 10 * TPS && landed === undefined; tick++) {
      sim.step(neutralIntent());
      landed = balls.find((b) => b.state === "landed");
    }
    expect(landed).toBeDefined();

    // 25 m off the bucket, square to the bucket-ball line and on the far side from the player. The
    // cooling bucket is then the nearer ammo, so a bot that ignored the cooldown would park on it;
    // and neither its run to the ball nor fighting the player takes it within reach of the ball
    // by accident.
    const ball = landed!.body.translation();
    const bucket = sim.pickups[0]!.site;
    const p = sim.cart.position;
    const along = Math.atan2(ball.z - bucket.z, ball.x - bucket.x);
    // Which side of the bucket-ball line the player is on: positive is the side `along + PI/2` faces.
    const playerLeft = -Math.sin(along) * (p.x - bucket.x) + Math.cos(along) * (p.z - bucket.z) > 0;
    const side = along + (playerLeft ? -Math.PI / 2 : Math.PI / 2);
    const x = bucket.x + Math.cos(side) * 25;
    const z = bucket.z + Math.sin(side) * 25;
    expect(Math.hypot(x - bucket.x, z - bucket.z)).toBeLessThan(Math.hypot(x - ball.x, z - ball.z));
    const y = sim.heightAt(x, z) + CART_COLLIDER.groundOffset;
    bot.position.x = x;
    bot.position.y = y;
    bot.position.z = z;
    bot.heading = side + Math.PI;
    (sim as unknown as { rigs: RigBody[] }).rigs[1]!.body.setTranslation({ x, y, z }, true);
    bot.ammo = 0;

    let refilled = false;
    for (let tick = 0; tick < 30 * TPS && !refilled; tick++) {
      sim.step(neutralIntent());
      refilled = bot.ammo > 0;
    }
    expect(refilled).toBe(true);
    // One ball is one round: a bucket would have given a full refill.
    expect(bot.ammo).toBe(1);
  }, 60_000);

  it("gives each bot its own skill, the same on every run of the same course", async () => {
    const skills = async (): Promise<number[]> => {
      const sim = await Sim.create(arenaFromHole(fixedHoleSpec()), { botCount: 4 });
      const rigs = (sim as unknown as { rigs: RigLike[] }).rigs;
      return rigs.slice(1).map((r) => r.mind!.skill);
    };
    const a = await skills();
    const b = await skills();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    for (const s of a) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

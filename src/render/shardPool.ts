/**
 * The particle bookkeeping behind `effects.ts`: a fixed set of shards, each a position, a
 * velocity, a colour and a remaining life. No three.js here, so it can be tested in node; the
 * effects layer copies the live shards into one `InstancedMesh` each frame.
 *
 * Fixed-size and recycled, never grown: effects fire from match events, a busy 4v4 fires dozens a
 * second, and the render loop is covered by the AGENTS.md no-allocation rule. When every shard is
 * busy, a new burst takes the ones closest to dying, which are the least visible.
 */

export interface Shard {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds left; 0 is dead. */
  life: number;
  /** The life it started with, for the shrink-as-it-dies scale. */
  maxLife: number;
  size: number;
  gravity: number;
  color: number;
  /** A per-shard spin, radians per second, so a burst does not tumble in lockstep. */
  spin: number;
  angle: number;
}

export interface BurstSpec {
  count: number;
  /** Outward speed, m/s; each shard gets 50-100% of it. */
  speed: number;
  life: number;
  gravity: number;
  size: number;
  color: number;
  /** Extra upward speed, m/s, so a puff rises and a splash throws water up. */
  lift?: number;
}

/** Air drag on a shard's velocity, per second: a puff slows and hangs rather than flying off. */
const SHARD_DRAG = 2.5;

export class ShardPool {
  readonly shards: Shard[];

  /** `random` is injected so a scene-gate capture can be reproducible. */
  constructor(
    capacity: number,
    private readonly random: () => number = Math.random,
  ) {
    this.shards = Array.from({ length: capacity }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0, gravity: 0, color: 0, spin: 0, angle: 0,
    }));
  }

  get liveCount(): number {
    let n = 0;
    for (const s of this.shards) if (s.life > 0) n++;
    return n;
  }

  burst(x: number, y: number, z: number, spec: BurstSpec): void {
    for (let i = 0; i < spec.count; i++) {
      const s = this.freeShard();
      // A direction on the unit sphere, then a speed in the upper half of the range.
      const u = this.random() * 2 - 1;
      const theta = this.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const speed = spec.speed * (0.5 + 0.5 * this.random());
      s.x = x;
      s.y = y;
      s.z = z;
      s.vx = r * Math.cos(theta) * speed;
      s.vy = u * speed + (spec.lift ?? 0);
      s.vz = r * Math.sin(theta) * speed;
      s.life = spec.life * (0.7 + 0.3 * this.random());
      s.maxLife = s.life;
      s.size = spec.size * (0.6 + 0.4 * this.random());
      s.gravity = spec.gravity;
      s.color = spec.color;
      s.spin = (this.random() * 2 - 1) * 8;
      s.angle = this.random() * Math.PI * 2;
    }
  }

  update(dt: number): void {
    const drag = Math.exp(-SHARD_DRAG * dt);
    for (const s of this.shards) {
      if (s.life <= 0) continue;
      s.life = Math.max(0, s.life - dt);
      s.vy -= s.gravity * dt;
      s.vx *= drag;
      s.vy *= drag;
      s.vz *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.angle += s.spin * dt;
    }
  }

  /** Draw scale: full size for most of its life, shrinking to nothing over the last 40%. */
  scaleOf(s: Shard): number {
    if (s.life <= 0) return 0;
    return s.size * Math.min(1, s.life / (s.maxLife * 0.4));
  }

  clear(): void {
    for (const s of this.shards) s.life = 0;
  }

  /** A dead shard, or failing that the one with the least life left. */
  private freeShard(): Shard {
    let pick = this.shards[0]!;
    for (const s of this.shards) {
      if (s.life <= 0) return s;
      if (s.life < pick.life) pick = s;
    }
    return pick;
  }
}

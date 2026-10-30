/**
 * The bookkeeping behind `spriteParticles.ts`: camera-facing sprites for smoke, fire, dust,
 * flashes, confetti and spray. The sibling of `ShardPool`: shards are the solid chips, sprites the
 * soft volume around them.
 *
 * No three.js, so it is node-tested. Fixed-size and recycled, never grown: when every slot is busy
 * a new emission takes the sprites closest to dying, which are the faintest on screen.
 */

/** Atlas cells, in `spriteAtlas.ts` order. */
export const SpriteFrame = {
  Puff: 0,
  Smoke: 1,
  Flash: 2,
  Spark: 3,
  Confetti: 4,
  Ring: 5,
  Clump: 6,
  Drop: 7,
} as const;
export type SpriteFrame = (typeof SpriteFrame)[keyof typeof SpriteFrame];

export interface Sprite {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds left; 0 is dead. */
  life: number;
  maxLife: number;
  sizeStart: number;
  sizeEnd: number;
  gravity: number;
  drag: number;
  color: number;
  alpha: number;
  frame: number;
  angle: number;
  spin: number;
}

export interface SpriteSpec {
  count: number;
  /** Outward speed, m/s; each sprite gets 40-100% of it. */
  speed: number;
  /** Extra upward speed, m/s. */
  lift?: number;
  /** Start position jitter, metres, in each axis. */
  jitter?: number;
  life: number;
  sizeStart: number;
  sizeEnd: number;
  /** m/s^2, positive pulls down; negative makes smoke rise. */
  gravity: number;
  /** Velocity damping per second. */
  drag: number;
  /** One colour, or a palette each sprite picks from (confetti). */
  color: number | readonly number[];
  alpha: number;
  frame: SpriteFrame;
  /** Spin, radians per second, either way. */
  spin?: number;
  /**
   * 0 throws in every direction; 1 throws only along the emit direction. Between, a cone that
   * narrows as it rises. Ignored when no direction is given.
   */
  focus?: number;
}

export class SpritePool {
  readonly sprites: Sprite[];

  /** `random` is injected so a capture is reproducible; see `fxRandom.ts`. */
  constructor(
    capacity: number,
    private readonly random: () => number,
  ) {
    this.sprites = Array.from({ length: capacity }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, sizeStart: 0, sizeEnd: 0,
      gravity: 0, drag: 0, color: 0xffffff, alpha: 1, frame: 0, angle: 0, spin: 0,
    }));
  }

  get liveCount(): number {
    let n = 0;
    for (const s of this.sprites) if (s.life > 0) n++;
    return n;
  }

  /**
   * Emits `spec.count` sprites at a point. `dx/dy/dz` is an optional unit direction that
   * `spec.focus` biases the throw towards: a wheel's roost goes backwards, a plume goes up.
   */
  emit(x: number, y: number, z: number, spec: SpriteSpec, dx = 0, dy = 0, dz = 0, countScale = 1): void {
    const count = Math.round(spec.count * countScale);
    const focus = dx === 0 && dy === 0 && dz === 0 ? 0 : (spec.focus ?? 0);
    const jitter = spec.jitter ?? 0;
    for (let i = 0; i < count; i++) {
      const s = this.free();
      const u = this.random() * 2 - 1;
      const theta = this.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      let ux = r * Math.cos(theta) * (1 - focus) + dx * focus;
      let uy = u * (1 - focus) + dy * focus;
      let uz = r * Math.sin(theta) * (1 - focus) + dz * focus;
      const len = Math.hypot(ux, uy, uz) || 1;
      ux /= len;
      uy /= len;
      uz /= len;
      const speed = spec.speed * (0.4 + 0.6 * this.random());
      s.x = x + (this.random() * 2 - 1) * jitter;
      s.y = y + (this.random() * 2 - 1) * jitter * 0.5;
      s.z = z + (this.random() * 2 - 1) * jitter;
      s.vx = ux * speed;
      s.vy = uy * speed + (spec.lift ?? 0);
      s.vz = uz * speed;
      s.life = spec.life * (0.7 + 0.3 * this.random());
      s.maxLife = s.life;
      const k = 0.75 + 0.5 * this.random();
      s.sizeStart = spec.sizeStart * k;
      s.sizeEnd = spec.sizeEnd * k;
      s.gravity = spec.gravity;
      s.drag = spec.drag;
      const color = spec.color;
      s.color = typeof color === "number" ? color : color[Math.floor(this.random() * color.length)]!;
      s.alpha = spec.alpha;
      s.frame = spec.frame;
      s.angle = this.random() * Math.PI * 2;
      s.spin = (this.random() * 2 - 1) * (spec.spin ?? 1);
    }
  }

  update(dt: number): void {
    for (const s of this.sprites) {
      if (s.life <= 0) continue;
      s.life = Math.max(0, s.life - dt);
      const drag = Math.exp(-s.drag * dt);
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

  /** 0 at birth to 1 at death. */
  ageOf(s: Sprite): number {
    return 1 - s.life / s.maxLife;
  }

  /** Size eases from start to end over the life. */
  sizeOf(s: Sprite): number {
    if (s.life <= 0) return 0;
    const t = this.ageOf(s);
    return s.sizeStart + (s.sizeEnd - s.sizeStart) * (1 - (1 - t) * (1 - t));
  }

  /** A quick fade-in over the first 8%, then fading out over the last 60%. */
  alphaOf(s: Sprite): number {
    if (s.life <= 0) return 0;
    const t = this.ageOf(s);
    const fadeIn = Math.min(1, t / 0.08);
    const fadeOut = Math.min(1, (1 - t) / 0.6);
    return s.alpha * fadeIn * fadeOut;
  }

  clear(): void {
    for (const s of this.sprites) s.life = 0;
  }

  private free(): Sprite {
    let pick = this.sprites[0]!;
    for (const s of this.sprites) {
      if (s.life <= 0) return s;
      if (s.life < pick.life) pick = s;
    }
    return pick;
  }
}

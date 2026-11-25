import { chillChase, type ChaseSettings } from './cameraConfig';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export type GroundHeight = (x: number, z: number) => number;

export interface ChaseExtras {
  /** Cart speed, m/s, for the FOV kick. */
  speed?: number;
  /** No driver input and the cart is parked; lets the scenic orbit start. */
  idle?: boolean;
}

const DEG = Math.PI / 180;

/**
 * Damped chase camera. Pure math (no three.js) so it runs in tests; the game copies
 * `position`, `target` and `fovDeg` into a PerspectiveCamera each frame.
 */
export class ChaseCamera {
  readonly position: V3 = { x: 0, y: 0, z: 0 };
  readonly target: V3 = { x: 0, y: 0, z: 0 };
  fovDeg: number;
  private heading = { x: 0, z: -1 };
  private idleTime = 0;
  private orbit = 0;
  private shake = 0;
  private clock = 0;

  constructor(private cfg: ChaseSettings = chillChase) {
    this.fovDeg = cfg.fovDeg;
  }

  get settings(): ChaseSettings {
    return this.cfg;
  }

  /** Switch presets; the follow smoothing blends to the new framing. */
  setSettings(cfg: ChaseSettings): void {
    this.cfg = cfg;
    if (cfg.idleOrbitAfter === null) this.stopOrbit();
  }

  /** Jump straight to the resting pose behind the cart. */
  snap(cartPos: V3, cartForward: V3, ground: GroundHeight): void {
    this.updateHeading(cartForward);
    this.stopOrbit();
    this.shake = 0;
    this.fovDeg = this.cfg.fovDeg;
    const [p, t] = this.desired(cartPos, ground);
    Object.assign(this.position, p);
    Object.assign(this.target, t);
  }

  /** Kick the camera on a landing; touchdown speed in m/s. */
  addShake(impactSpeed: number): void {
    this.shake = Math.min(this.shake + impactSpeed * this.cfg.shakePerMps, this.cfg.shakeMax);
  }

  /** True while the scenic idle orbit is turning the camera. */
  get orbiting(): boolean {
    return this.orbit !== 0;
  }

  /** Follow the cart; frame-rate independent exponential smoothing. */
  update(dt: number, cartPos: V3, cartForward: V3, ground: GroundHeight, extras: ChaseExtras = {}): void {
    const c = this.cfg;
    this.clock += dt;
    this.updateHeading(cartForward);

    // Scenic idle orbit (Chill): any input stops it at once.
    if (extras.idle && c.idleOrbitAfter !== null) {
      this.idleTime += dt;
      if (this.idleTime >= c.idleOrbitAfter) this.orbit += c.idleOrbitDegPerS * DEG * dt;
    } else {
      this.stopOrbit();
    }

    const [p, t] = this.desired(cartPos, ground);
    const kp = 1 - Math.exp(-c.positionRate * dt);
    const kt = 1 - Math.exp(-c.lookRate * dt);
    approach(this.position, p, kp);
    approach(this.target, t, kt);

    // Landing shake: a decaying wobble on top of the follow position.
    if (this.shake > 1e-4) {
      const w = 2 * Math.PI * c.shakeHz * this.clock;
      this.position.x += this.shake * Math.sin(w * 1.3) * kp;
      this.position.y += this.shake * Math.sin(w) * kp;
      this.position.z += this.shake * Math.sin(w * 0.7 + 1) * kp;
      this.shake *= Math.exp(-c.shakeDecay * dt);
    } else {
      this.shake = 0;
    }

    const floor = ground(this.position.x, this.position.z) + c.minGroundClearance;
    if (this.position.y < floor) this.position.y = floor;

    const speed = Math.abs(extras.speed ?? 0);
    const kick = c.fovKickDeg * Math.min(Math.max((speed - c.fovKickFrom) / (c.fovKickTo - c.fovKickFrom), 0), 1);
    this.fovDeg += (c.fovDeg + kick - this.fovDeg) * (1 - Math.exp(-c.fovRate * dt));
  }

  private stopOrbit(): void {
    this.idleTime = 0;
    this.orbit = 0;
  }

  private updateHeading(forward: V3): void {
    const len = Math.hypot(forward.x, forward.z);
    // Pointing nearly straight up or down (flipped or airborne nose-down): keep the last heading.
    if (len > 0.2) this.heading = { x: forward.x / len, z: forward.z / len };
  }

  private desired(cart: V3, ground: GroundHeight): [V3, V3] {
    const { distance, height, lookAhead, lookHeight, minGroundClearance } = this.cfg;
    const cos = Math.cos(this.orbit);
    const sin = Math.sin(this.orbit);
    // Orbit turns the camera's viewing direction about +Y around the cart.
    const h = { x: this.heading.x * cos - this.heading.z * sin, z: this.heading.x * sin + this.heading.z * cos };
    const px = cart.x - h.x * distance;
    const pz = cart.z - h.z * distance;
    const py = Math.max(cart.y + height, ground(px, pz) + minGroundClearance);
    const look = this.orbit === 0 ? lookAhead : 0;
    return [
      { x: px, y: py, z: pz },
      { x: cart.x + h.x * look, y: cart.y + lookHeight, z: cart.z + h.z * look },
    ];
  }
}

function approach(v: V3, to: V3, k: number): void {
  v.x += (to.x - v.x) * k;
  v.y += (to.y - v.y) * k;
  v.z += (to.z - v.z) * k;
}

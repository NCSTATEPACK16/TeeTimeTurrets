import * as THREE from "three";
import { BallSwarm } from "../entities/BallSwarm";
import { AimArc } from "../entities/AimArc";
import { EffectsLayer } from "./effects";
import { GolfClub, placeCart } from "../entities/GolfClub";
import { ClubType } from "../physics/Ballistics";
import type { Surfaces } from "../sim/surfaces";
import type { CartTransform, Vec3 } from "../sim/world";
import type { CourseTerrain } from "../sim/courseTerrain";
import { BIOMES } from "./biomes";
import { CHASE_POSITION_LERP, CHASE_TARGET_LERP, chasePose, chaseSmoothing } from "./chaseCamera";
import { createCourseGround } from "./courseGround";
import { createTreeline } from "./treeline";
import type { Treeline } from "./treeline";
import type { SouthBoundary } from "../sim/courseBarrier";
import type { CourseGround } from "./courseGround";

/** Keeps the chase eye out of the terrain when the cart backs toward a slope. */
const CHASE_MIN_GROUND_CLEARANCE = 1.5;

/**
 * The renderer has no per-bot club, charge or loaded-round state to draw from -- `Sim` doesn't
 * publish one per bot today -- so every bot cart draws a fixed default club, never charged, never
 * showing a loaded round, regardless of what that bot is actually doing. That is a known gap, not
 * a guess dressed up as one: a bot mid-charge or holding a different club looks identical to one
 * standing idle. It is the putter because that is the club every bot is built holding.
 */
const BOT_DEFAULT_CLUB = ClubType.Putter;

/** The course a match is fought on, as the renderer needs it. */
export interface ArenaSource {
  readonly course: CourseTerrain;
  readonly surfaces: Surfaces;
  /**
   * The course's southern boundary, when it has one. Optional so a generated arena course -- which
   * has bounds but no road -- simply gets no treeline rather than one drawn against a line it does
   * not have.
   */
  readonly southBoundary?: SouthBoundary;
  /**
   * The course seed, so the treeline is placed deterministically the way `Trees.ts`'s wood is --
   * what makes a scene-gate screenshot of the horizon mean anything. `CourseTerrain` does not carry
   * its own seed, so it is passed beside it.
   */
  readonly seed?: number;
}

/**
 * Everything the renderer needs for one frame. Passed as one object the caller reuses rather
 * than as a growing positional argument list -- and reused rather than rebuilt, because
 * GameLoop's frame callback is covered by the AGENTS.md no-allocation rule.
 */
export interface FrameView {
  cart: CartTransform;
  charge01: number;
  /**
   * How far through the reload the cart is: 0 on the frame the shot went off, 1 when it can
   * fire again. With `charge01` this is the whole swing -- backswing, downswing, follow-through,
   * address -- and it is derived, not stored, so a frame cannot get out of step with the sim.
   */
  reload01: number;
  club: ClubType;
  /** True while a round of ammo rides the club head: drawn on the turret. Loaded does not mean
   * fireable -- `Cart.canFire` also gates on the reload timer, so a loaded round can still be
   * mid-reload. */
  turretLoaded: boolean;
  /** Interpolated pooled-ball transforms, laid out exactly as Sim publishes them. */
  poolTransforms: Float32Array;
  /** One entry per bot cart, laid out exactly as `cart` is. */
  botCarts: CartTransform[];
  /**
   * Seconds since the match opened, for cosmetic cycles that are not simulated. Accumulated from
   * the fixed step rather than read off a wall clock, so a scene-gate render is reproducible.
   */
  elapsedSeconds: number;
  /** Wall-clock seconds since the last drawn frame, for the camera's frame-rate-independent
   *  smoothing. Zero holds the camera still. */
  frameSeconds: number;
  /** The player's aim arc from `Sim.previewTrajectory`: the first `aimArcCount` points. */
  aimArc: Vec3[];
  aimArcCount: number;
  /** The player's cart is out of the world awaiting respawn, so it is not drawn. */
  playerDead: boolean;
  /** Per bot, as `botCarts`: out of the world awaiting respawn. */
  botDead: boolean[];
}

/** Pure consumer of sim state: builds the scene once, then reads interpolated transforms every frame. */
export class RenderScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cart: GolfClub;
  private readonly botCarts: GolfClub[] = [];
  private readonly pooledBalls: BallSwarm;
  private readonly aimArc: AimArc;
  /** Puffs, sparks, death bursts and splashes; triggered by `MatchScreen` from `Sim.events`. */
  readonly effects: EffectsLayer;
  private readonly courseGround: CourseGround;
  /** The band of trees beyond the road, on a course that has one. */
  private readonly treeline: Treeline | null;
  /** Ground height under the chase camera, so the eye never dips into a hillside. */
  private readonly groundHeightAt: (x: number, z: number) => number;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly chaseEyeScratch = new THREE.Vector3();
  private readonly chaseLookScratch = new THREE.Vector3();
  private readonly projectScratch = new THREE.Vector3();
  private readonly sizeScratch = new THREE.Vector2();
  private readonly resizeListener: () => void;

  /**
   * `renderer` is passed in rather than created here. One WebGL context is shared by every screen
   * -- title backdrop, round, clubhouse turntable -- because a context per screen would be both
   * a hard browser limit and a guaranteed leak across transitions. `ScreenManager` owns its
   * lifetime; this class only borrows it, and `dispose()` below deliberately does not free it.
   */
  constructor(renderer: THREE.WebGLRenderer, arena: ArenaSource, botCount: number) {
    // The draw distance the fog and far plane are cut to: the diagonal of the course's bounds, so
    // the far plane still reaches the horizon from any tee.
    const fieldSize = Math.hypot(
      arena.course.bounds.maxX - arena.course.bounds.minX,
      arena.course.bounds.maxZ - arena.course.bounds.minZ,
    );
    // The course opens and closes in parkland, and the clubhouse sits in it: that is its sky.
    const palette = BIOMES.parkland;

    this.renderer = renderer;

    this.scene = new THREE.Scene();
    // Sky and fog share one colour, so the horizon dissolves rather than banding.
    this.scene.background = new THREE.Color(palette.sky);
    this.scene.fog = new THREE.Fog(palette.sky, fieldSize * 0.5, fieldSize * 2);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      fieldSize * 2.5,
    );

    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(12, 18, 8);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    this.courseGround = createCourseGround(arena.course, arena.surfaces);
    this.scene.add(this.courseGround.group);
    this.treeline =
      arena.southBoundary === undefined
        ? null
        : createTreeline(
            arena.southBoundary,
            arena.course.bounds,
            (x, z) => arena.course.heightAt(x, z),
            arena.seed ?? 0,
          );
    if (this.treeline?.mesh) this.scene.add(this.treeline.mesh);
    this.groundHeightAt = (x, z) => arena.course.heightAt(x, z);

    this.cart = new GolfClub();
    this.scene.add(this.cart);

    // A bot is physically a cart, so it is visually one too -- the same procedural model, no
    // cheaper stand-in. Team colour is Phase 5's; today the nameplate is what tells them apart.
    for (let i = 0; i < botCount; i++) {
      const bot = new GolfClub();
      this.botCarts.push(bot);
      this.scene.add(bot);
    }

    this.pooledBalls = new BallSwarm();
    this.scene.add(this.pooledBalls);

    this.aimArc = new AimArc();
    this.scene.add(this.aimArc);

    this.effects = new EffectsLayer();
    this.scene.add(this.effects.group);

    this.cameraTarget.set(0, 0, 0);
    this.onResize();
    // Kept as a field so `dispose` can detach it. An anonymous listener here would outlive every
    // round the player ever plays, holding this whole scene alive with it.
    this.resizeListener = (): void => this.onResize();
    window.addEventListener("resize", this.resizeListener);
  }

  draw(view: FrameView): void {
    this.poseCart(this.cart, view.cart, view.club, view.charge01, view.reload01, view.turretLoaded);
    // A dead cart has burst (`EffectsLayer.death`) and is out of the world until it respawns.
    this.cart.visible = !view.playerDead;
    for (let i = 0; i < this.botCarts.length; i++) {
      const transform = view.botCarts[i];
      if (transform === undefined) continue;
      this.botCarts[i]!.visible = !view.botDead[i];
      // reload01 = 1 is "loaded and idle", so a bot stands at address. Same reason as the club
      // and the charge above: Sim publishes no per-bot reload, and a guessed swing would be a
      // bot that looks like it is shooting when it is not.
      this.poseCart(this.botCarts[i]!, transform, BOT_DEFAULT_CLUB, 0, 1, false);
    }
    this.pooledBalls.setFromTransforms(view.poolTransforms);
    this.aimArc.setPoints(view.aimArc, view.aimArcCount);
    this.effects.update(view.frameSeconds);

    this.frameChase(view);

    // After `frameChase`, so the tiles refine toward where the camera now is rather than where it
    // was last frame. `update` is internally budgeted to BUILD_BUDGET_MS, so this cannot blow the
    // frame however far the cart has driven.
    this.courseGround.update(this.camera.position.x, this.camera.position.z);

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Frees everything this scene allocated. See the AGENTS.md resource-cleanup rule.
   *
   * The renderer is pointedly NOT disposed: it belongs to `ScreenManager` and outlives this
   * scene, so freeing it here would take the WebGL context down with the first round that ended.
   */
  dispose(): void {
    window.removeEventListener("resize", this.resizeListener);
    this.cart.dispose();
    for (const bot of this.botCarts) bot.dispose();
    this.pooledBalls.dispose();
    this.aimArc.dispose();
    this.effects.dispose();
    this.treeline?.dispose();
    this.courseGround.dispose();
    this.scene.clear();
  }

  /**
   * World point -> canvas pixels, per docs/ARCHITECTURE.md section 2c. Returns false when the
   * point is behind the camera (stops a nameplate being drawn mirrored in front of a viewer
   * looking the other way) or outside the horizontal/vertical frustum (stops a plate for a cart
   * off to the side or above/below frame from being placed at an off-viewport pixel coordinate
   * instead of hidden -- at four carts on screen at once, most of them are off to a side more
   * often than dead ahead).
   *
   * Lives here rather than in `src/ui/**` because the camera does, and `src/ui/**` must not
   * import three. Writes into `out`: this runs once per cart per frame.
   */
  projectToScreen(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    this.projectScratch.set(x, y, z).project(this.camera);
    if (this.projectScratch.z > 1) return false;
    if (Math.abs(this.projectScratch.x) > 1 || Math.abs(this.projectScratch.y) > 1) return false;
    const size = this.renderer.getSize(this.sizeScratch);
    out.x = (this.projectScratch.x * 0.5 + 0.5) * size.x;
    out.y = (1 - (this.projectScratch.y * 0.5 + 0.5)) * size.y;
    return true;
  }

  /** Chassis placement lives in `GolfClub.placeCart`; what is left here is the per-frame state. */
  private poseCart(
    model: GolfClub,
    c: CartTransform,
    club: ClubType,
    charge01: number,
    reload01: number,
    loaded: boolean,
  ): void {
    placeCart(model, c.position, c.heading, c.turretYaw);
    model.setClub(club);
    model.setSwing(charge01, reload01);
    model.setBallLoaded(loaded);
  }

  private frameChase(view: FrameView): void {
    chasePose(view.cart, this.chaseEyeScratch, this.chaseLookScratch);

    // Keep the eye above the terrain it is flying over, or a chase camera reversing into a
    // hillside ends up underground looking at the inside of the heightfield.
    const groundAtEye = this.groundHeightAt(this.chaseEyeScratch.x, this.chaseEyeScratch.z);
    this.chaseEyeScratch.y = Math.max(this.chaseEyeScratch.y, groundAtEye + CHASE_MIN_GROUND_CLEARANCE);

    this.camera.position.lerp(this.chaseEyeScratch, chaseSmoothing(CHASE_POSITION_LERP, view.frameSeconds));
    this.cameraTarget.lerp(this.chaseLookScratch, chaseSmoothing(CHASE_TARGET_LERP, view.frameSeconds));
    this.camera.lookAt(this.cameraTarget);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

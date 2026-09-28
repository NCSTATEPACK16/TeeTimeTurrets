import * as THREE from "three";
import { BallSwarm } from "../entities/BallSwarm";
import { AimArc } from "../entities/AimArc";
import { GolfClub, placeCart } from "../entities/GolfClub";
import { ClubType } from "../physics/Ballistics";
import type { Surfaces } from "../sim/surfaces";
import type { CartTransform } from "../sim/frame";
import type { Vec3 } from "../sim/course";
import type { CourseTerrain } from "../sim/courseTerrain";
import { SKY, createSky, skyColourAt, sunDirection } from "./sky";
import type { SkyRig } from "./sky";
import { LIGHT_LEVELS, createLighting } from "./lighting";
import { createPost } from "./post";
import { ZoneStakes } from "./zoneStakes";
import { courseTreesFor } from "./courseTrees";
import { coursePropsFor } from "./courseProps";
import { createWater } from "./water";
import { GrassCarpet } from "./grassCarpet";
import { createCartPathRibbons } from "./cartPathRibbons";
import type { CartPathRibbons } from "./cartPathRibbons";
import type { CartPath } from "../sim/cartPaths";
import type { Water } from "./water";
import type { CourseProps } from "./courseProps";
import type { CourseTrees } from "./courseTrees";
import { CartSuspension } from "./cartSuspension";
import type { ArenaZone } from "../sim/arenaZone";
import type { Post } from "./post";
import type { Lighting } from "./lighting";
import { QUALITY } from "./quality";
import type { QualityPreset } from "./quality";
import { CHASE_BASE_FOV, CHASE_POSITION_LERP, CHASE_TARGET_LERP, chaseFov, chasePose, chaseSmoothing, clearTerrain } from "./chaseCamera";
import { Trauma, traumaFor } from "./cameraShake";
import type { ShakeOffset } from "./cameraShake";
import { Effects } from "./effects";
import type { SimEvent } from "../sim/events";
import { courseGroundFor } from "./courseGround";
import { treelineFor } from "./treeline";
import type { Treeline } from "./treeline";
import type { SouthBoundary } from "../sim/courseBarrier";
import type { CourseGround } from "./courseGround";

/**
 * The fog is 95% of the sky's colour at this share of the course's diagonal: the far holes are
 * haze, the arena's own is clear.
 */
const FOG_REACH = 1.2;

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
  /**
   * The heights the ground is drawn on: the playfield's, the heightfield the carts collide with.
   * Without it, the course's exact blend.
   */
  readonly heightAt?: (x: number, z: number) => number;
  /** Where the match is played; its edge is staked out. None on a ground that is all playable. */
  readonly zone?: ArenaZone | null;
  /** The cart paths, drawn as gravel strips. */
  readonly paths?: readonly CartPath[];
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
  /** The player's forward speed, m/s, for the speed FOV. */
  speed: number;
  /** A dead cart is out of the world until it respawns, and is not drawn. */
  playerDead: boolean;
  /** One per bot, as `botCarts`. */
  botDead: boolean[];
}

/** How fast the field of view follows the speed, per 60 Hz frame. Slower than the camera, so the
 *  kick reads as a rush rather than a twitch. */
const FOV_LERP = 0.06;

/** Pure consumer of sim state: builds the scene once, then reads interpolated transforms every frame. */
export class RenderScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cart: GolfClub;
  private readonly botCarts: GolfClub[] = [];
  private readonly pooledBalls: BallSwarm;
  private readonly aimArc: AimArc;
  private readonly effects: Effects;
  /** Camera shake. See `cameraShake.ts`. */
  private readonly trauma = new Trauma();
  private readonly shakeScratch: ShakeOffset = { x: 0, y: 0, roll: 0 };
  /** Wall seconds the shake's noise is sampled at. */
  private shakeClock = 0;
  /** Where the chase camera is before the shake is laid on top, so the shake never feeds back into
   *  the smoothing and drifts the camera. */
  private readonly chaseRig = new THREE.Vector3();
  private readonly courseGround: CourseGround;
  /** Ground tiles built when the lighting last adopted the ground's materials. */
  private adoptedNearBuilds = -1;
  private readonly sky: SkyRig;
  private readonly lighting: Lighting;
  /** High only; null draws straight to the canvas. */
  private readonly post: Post | null;
  private readonly zoneStakes: ZoneStakes | null;
  /** Borrowed like the ground: one wood per course and tree cap. */
  private readonly courseTrees: CourseTrees;
  /** Tee markers, benches, bins and a flagstick on every green; borrowed like the trees. */
  private readonly courseProps: CourseProps;
  private readonly water: Water;
  private readonly grass: GrassCarpet;
  private readonly pathRibbons: CartPathRibbons | null;
  /** Each cart model's springs, made on the first frame it is posed. */
  private readonly suspension = new Map<GolfClub, CartSuspension>();
  private suspensionDt = 0;
  private readonly quality: QualityPreset;
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
  constructor(
    renderer: THREE.WebGLRenderer,
    arena: ArenaSource,
    botCount: number,
    quality: QualityPreset = QUALITY.medium,
  ) {
    // The draw distance the fog and far plane are cut to: the diagonal of the course's bounds, so
    // the far plane still reaches the horizon from any tee.
    const fieldSize = Math.hypot(
      arena.course.bounds.maxX - arena.course.bounds.minX,
      arena.course.bounds.maxZ - arena.course.bounds.minZ,
    );
    this.renderer = renderer;
    this.quality = quality;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      CHASE_BASE_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      fieldSize * 2.5,
    );

    // The sky dome, its baked environment and the fog in its horizon's colour, so the far course
    // dissolves into the sky rather than banding against it. Then the sun and its shadows.
    this.sky = createSky(renderer, this.scene, {
      radius: this.camera.far * 0.9,
      fogDistance: fieldSize * FOG_REACH,
      environmentIntensity: LIGHT_LEVELS.environment,
    });
    this.lighting = createLighting(this.scene, this.camera, quality);
    this.post = createPost(renderer, this.scene, this.camera, quality);

    // Borrowed, not built: one ground and one treeline per course for the page's life, so a
    // second match does not rebuild either. `dispose` hands them back rather than freeing them.
    this.courseGround = courseGroundFor(arena);
    this.scene.add(this.courseGround.group);
    this.treeline = treelineFor(arena);
    if (this.treeline?.mesh) this.scene.add(this.treeline.mesh);
    this.groundHeightAt = arena.heightAt ?? ((x, z) => arena.course.heightAt(x, z));
    this.courseTrees = courseTreesFor(arena.course, arena.surfaces, arena.seed ?? 0, quality.treeCap);
    this.scene.add(this.courseTrees.group);
    this.courseProps = coursePropsFor(arena.course);
    this.scene.add(this.courseProps.group);
    this.water = createWater(arena.course, quality);
    this.scene.add(this.water.group);
    this.grass = new GrassCarpet(arena.surfaces, this.groundHeightAt, quality);
    this.scene.add(this.grass.mesh);
    this.pathRibbons = arena.paths && arena.paths.length > 0 ? createCartPathRibbons(arena.paths, this.groundHeightAt) : null;
    if (this.pathRibbons) this.scene.add(this.pathRibbons.mesh);
    this.zoneStakes = arena.zone ? new ZoneStakes(arena.zone, this.groundHeightAt) : null;
    if (this.zoneStakes) this.scene.add(this.zoneStakes);

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

    this.effects = new Effects();
    this.scene.add(this.effects);

    // Carts and the balls in flight cast; carts receive their own and each other's. The ground
    // receives by its own construction. A ball's shadow on the turf is most of how its height reads.
    for (const cart of [this.cart, ...this.botCarts]) {
      cart.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.castShadow = true;
        child.receiveShadow = true;
      });
    }
    this.pooledBalls.traverse((child) => {
      child.castShadow = true;
    });
    this.lighting.adopt(this.scene);

    this.cameraTarget.set(0, 0, 0);
    this.onResize();
    // Kept as a field so `dispose` can detach it. An anonymous listener here would outlive every
    // round the player ever plays, holding this whole scene alive with it.
    this.resizeListener = (): void => this.onResize();
    window.addEventListener("resize", this.resizeListener);
  }

  draw(view: FrameView): void {
    this.suspensionDt = view.frameSeconds;
    this.poseCart(this.cart, view.cart, view.club, view.charge01, view.reload01, view.turretLoaded);
    this.cart.visible = !view.playerDead;
    for (let i = 0; i < this.botCarts.length; i++) {
      const transform = view.botCarts[i];
      if (transform === undefined) continue;
      this.botCarts[i]!.visible = view.botDead[i] !== true;
      // reload01 = 1 is "loaded and idle", so a bot stands at address. Same reason as the club
      // and the charge above: Sim publishes no per-bot reload, and a guessed swing would be a
      // bot that looks like it is shooting when it is not.
      this.poseCart(this.botCarts[i]!, transform, BOT_DEFAULT_CLUB, 0, 1, false);
    }
    this.pooledBalls.setFromTransforms(view.poolTransforms);
    this.aimArc.setPoints(view.aimArc, view.aimArcCount);
    this.effects.update(view.frameSeconds);
    this.courseProps.update(view.elapsedSeconds);
    this.water.update(view.elapsedSeconds);
    this.trauma.update(view.frameSeconds);
    this.shakeClock += view.frameSeconds;

    this.frameChase(view);

    // After `frameChase`, so the tiles refine toward where the camera now is rather than where it
    // was last frame. `update` is internally budgeted to BUILD_BUDGET_MS, so this cannot blow the
    // frame however far the cart has driven.
    this.courseGround.update(this.camera.position.x, this.camera.position.z);
    this.grass.update(this.camera.position.x, this.camera.position.z, view.elapsedSeconds);
    // Tiles built since the last frame bring new materials, which cascaded shadows have to adopt
    // before they compile.
    if (this.courseGround.nearBuilds !== this.adoptedNearBuilds) {
      this.adoptedNearBuilds = this.courseGround.nearBuilds;
      this.lighting.adopt(this.courseGround.group);
    }

    this.sky.follow(this.camera);
    this.lighting.update(this.camera);
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);
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
    this.zoneStakes?.dispose();
    this.water.dispose();
    this.grass.dispose();
    this.pathRibbons?.dispose();
    // Before the ground is handed back: cascaded shadows give its materials back as they found them.
    this.post?.dispose();
    this.lighting.dispose();
    this.sky.dispose();
    // The ground and treeline belong to the course, not to this match: taken out, not freed.
    this.scene.remove(this.courseGround.group);
    this.scene.remove(this.courseTrees.group);
    this.scene.remove(this.courseProps.group);
    if (this.treeline?.mesh) this.scene.remove(this.treeline.mesh);
    this.scene.clear();
  }

  /**
   * What the scene is lit with, for the smoke check and the console. `modelHorizon` is
   * `skyColourAt`'s horizon away from the sun; `fogColour` is what the drawn dome read back, so the
   * two agreeing is the dome's shader agreeing with the model.
   */
  describeLighting(): {
    quality: string;
    shadowLights: number;
    environment: boolean;
    fog: string;
    fogColour: [number, number, number];
    modelHorizon: [number, number, number];
  } {
    let shadowLights = 0;
    this.scene.traverse((child) => {
      if ((child as THREE.DirectionalLight).isDirectionalLight && child.castShadow) shadowLights++;
    });
    const fog = this.scene.fog;
    const sun = sunDirection(SKY);
    const across = Math.hypot(sun.x, sun.z);
    const model = new THREE.Color();
    skyColourAt(SKY, -sun.x / across, 0, -sun.z / across, model);
    return {
      quality: this.quality.name,
      shadowLights,
      environment: this.scene.environment !== null,
      fog: fog instanceof THREE.FogExp2 ? "FogExp2" : fog === null ? "none" : "Fog",
      fogColour: fog ? [fog.color.r, fog.color.g, fog.color.b] : [0, 0, 0],
      modelHorizon: [model.r, model.g, model.b],
    };
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

  /**
   * What an event looks like: smoke at the muzzle, dust where a ball struck, a cart going up, a
   * ring on the water -- and what it does to the camera. Called once per event by the match
   * screen, which owns the cursor into `Sim.events`.
   */
  react(e: SimEvent): void {
    switch (e.kind) {
      case "shot":
        if (e.club !== null) this.effects.muzzle(e.x, e.y, e.z, e.club);
        break;
      case "hit":
        this.effects.impact(e.x, e.y, e.z);
        break;
      case "kill":
        this.effects.burst(e.x, e.y, e.z);
        break;
      case "splash":
        this.effects.splash(e.x, this.groundHeightAt(e.x, e.z), e.z);
        break;
      default:
        break;
    }
    this.trauma.add(traumaFor(e));
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
    // The body rides the ground under its wheels: pitch, roll and a landing dip, drawn only.
    let suspension = this.suspension.get(model);
    if (suspension === undefined) {
      suspension = new CartSuspension();
      this.suspension.set(model, suspension);
      model.rotation.order = "YXZ";
    }
    suspension.update(this.suspensionDt, model.position.x, model.position.y, model.position.z, c.heading, this.groundHeightAt);
    model.rotation.x = -suspension.pitch;
    model.rotation.z = suspension.roll;
    model.position.y += suspension.heave;
    model.setClub(club);
    model.setSwing(charge01, reload01);
    model.setBallLoaded(loaded);
  }

  private frameChase(view: FrameView): void {
    chasePose(view.cart, this.chaseEyeScratch, this.chaseLookScratch);

    // Keep the eye above the terrain it is flying over, or a chase camera reversing into a
    // hillside ends up underground looking at the inside of the heightfield.
    // Checked along the whole sight line, so a bank between the camera and the cart lifts the
    // camera over it too.
    clearTerrain(this.chaseEyeScratch, this.chaseLookScratch, this.groundHeightAt, CHASE_MIN_GROUND_CLEARANCE);

    this.chaseRig.lerp(this.chaseEyeScratch, chaseSmoothing(CHASE_POSITION_LERP, view.frameSeconds));
    this.cameraTarget.lerp(this.chaseLookScratch, chaseSmoothing(CHASE_TARGET_LERP, view.frameSeconds));
    this.camera.position.copy(this.chaseRig);
    this.camera.lookAt(this.cameraTarget);

    // The shake goes on last, in the camera's own frame, and is gone again by the next frame's copy.
    this.trauma.offset(this.shakeClock, this.shakeScratch);
    if (this.shakeScratch.x !== 0 || this.shakeScratch.y !== 0) {
      this.camera.translateX(this.shakeScratch.x);
      this.camera.translateY(this.shakeScratch.y);
      this.camera.rotateZ(this.shakeScratch.roll);
    }

    const fov = this.camera.fov + (chaseFov(view.speed) - this.camera.fov) * chaseSmoothing(FOV_LERP, view.frameSeconds);
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post?.setSize(window.innerWidth, window.innerHeight);
  }
}

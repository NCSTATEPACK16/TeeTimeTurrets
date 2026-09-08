import * as THREE from "three";
import { BallSwarm, BALL_RADIUS, BALL_WIDTH_SEGMENTS, BALL_HEIGHT_SEGMENTS } from "../entities/BallSwarm";
import { GolfClub, placeCart } from "../entities/GolfClub";
import { TargetRig } from "../entities/TargetRig";
import { ClubType } from "../physics/Ballistics";
import type { Terrain } from "../sim/terrain";
import type { Surfaces } from "../sim/surfaces";
import type { BallTransform, CartTransform } from "../sim/world";
import { BIOMES } from "./biomes";
import { createGround } from "./ground";
import type { Ground } from "./ground";
import { createTrees } from "./Trees";
import type { Trees } from "./Trees";

/**
 * Chase framing, from image 03: cart low in frame, horizon high, enough lead to read the next
 * hazard.
 *
 * The camera tracks the **chassis**, not the turret. Tracking the turret is the usual choice for
 * a tank game, but here it hides the thing the game is about: the barrel is a golf club, and a
 * camera welded behind the turret keeps that club permanently foreshortened to a stub pointing
 * away from the viewer. Behind the chassis instead, swinging the turret sweeps the club across
 * frame -- image 03 exactly, and the reason that shot reads as golf rather than as artillery.
 * Aiming costs nothing in orientation either, since the turret defaults to the chassis heading.
 */
const CHASE_DISTANCE = 6.5;
const CHASE_HEIGHT = 3.6;
const CHASE_LOOK_AHEAD = 8;
/**
 * The look target sits *below* the cart, not above it. That pitches the camera down, which is
 * what pushes the cart into the lower third of the frame and leaves the horizon high -- image
 * 03's framing. Aiming at or above the cart pitches up and centres it instead.
 */
const CHASE_LOOK_DROP = 0.3;
/** Per-frame lerp factors. Position lags further than the look target so turns read as weight. */
const CHASE_POSITION_LERP = 0.12;
const CHASE_TARGET_LERP = 0.2;
/** Keeps the chase eye out of the terrain when the cart backs toward a slope. */
const CHASE_MIN_GROUND_CLEARANCE = 1.5;

/**
 * The renderer has no per-bot club, charge or loaded-round state to draw from -- `Sim` doesn't
 * publish one per bot today -- so every bot cart draws a fixed default club, never charged, never
 * showing a loaded round, regardless of what that bot is actually doing. That is a known gap, not
 * a guess dressed up as one: a bot mid-charge or holding a different club looks identical to one
 * standing idle with a driver.
 */
const BOT_DEFAULT_CLUB = ClubType.Driver;

/**
 * Everything the renderer needs for one frame. Passed as one object the caller reuses rather
 * than as a growing positional argument list -- and reused rather than rebuilt, because
 * GameLoop's frame callback is covered by the AGENTS.md no-allocation rule.
 */
export interface FrameView {
  ball: BallTransform;
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
  /** Interpolated target part transforms, laid out exactly as Sim publishes them. */
  targetTransforms: Float32Array;
  /** Number of valid transforms in `targetTransforms`. */
  targetPartCount: number;
  /** Interpolated pooled-ball transforms, laid out exactly as Sim publishes them. */
  poolTransforms: Float32Array;
  /** One entry per bot cart, laid out exactly as `cart` is. */
  botCarts: CartTransform[];
}

/** Pure consumer of sim state: builds the scene once, then reads interpolated transforms every frame. */
export class RenderScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly terrain: Terrain;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly ball: THREE.Mesh;
  private readonly cart: GolfClub;
  private readonly botCarts: GolfClub[] = [];
  private readonly targets: TargetRig;
  private readonly pooledBalls: BallSwarm;
  private readonly ground: Ground;
  private readonly trees: Trees;
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
    terrain: Terrain,
    surfaces: Surfaces,
    targetCount: number,
    botCount: number,
  ) {
    this.terrain = terrain;
    const fieldSize = terrain.spec.fieldSize;
    const palette = BIOMES[terrain.spec.biome];

    this.renderer = renderer;

    this.scene = new THREE.Scene();
    // Sky and fog take the biome's colour and share it, so the horizon dissolves rather than
    // banding. This is the cheapest half of "eighteen holes look like three places": an overcast
    // links sky and a hazy marsh sky read as different weather before any geometry loads.
    this.scene.background = new THREE.Color(palette.sky);
    // Fog and far plane are sized to fieldSize: at the old 25/65 the fog closed in well
    // inside the playable area and hid most of a full drive's landing zone.
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

    this.ground = createGround(terrain, surfaces);
    this.scene.add(this.ground.mesh);

    this.trees = createTrees(terrain, surfaces);
    if (this.trees.mesh !== null) this.scene.add(this.trees.mesh);

    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, BALL_WIDTH_SEGMENTS, BALL_HEIGHT_SEGMENTS);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    this.ball = new THREE.Mesh(ballGeo, ballMat);
    this.scene.add(this.ball);

    this.cart = new GolfClub();
    this.scene.add(this.cart);

    // A bot is physically a cart, so it is visually one too -- the same procedural model, no
    // cheaper stand-in. Team colour is Phase 5's; today the nameplate is what tells them apart.
    for (let i = 0; i < botCount; i++) {
      const bot = new GolfClub();
      this.botCarts.push(bot);
      this.scene.add(bot);
    }

    this.targets = new TargetRig(targetCount);
    this.scene.add(this.targets);

    this.pooledBalls = new BallSwarm();
    this.scene.add(this.pooledBalls);

    this.cameraTarget.set(0, 0, 0);
    this.onResize();
    // Kept as a field so `dispose` can detach it. An anonymous listener here would outlive every
    // round the player ever plays, holding this whole scene alive with it.
    this.resizeListener = (): void => this.onResize();
    window.addEventListener("resize", this.resizeListener);
  }

  draw(view: FrameView): void {
    this.ball.position.set(view.ball.position.x, view.ball.position.y, view.ball.position.z);
    this.ball.quaternion.set(
      view.ball.rotation.x,
      view.ball.rotation.y,
      view.ball.rotation.z,
      view.ball.rotation.w,
    );

    this.poseCart(this.cart, view.cart, view.club, view.charge01, view.reload01, view.turretLoaded);
    for (let i = 0; i < this.botCarts.length; i++) {
      const transform = view.botCarts[i];
      if (transform === undefined) continue;
      // reload01 = 1 is "loaded and idle", so a bot stands at address. Same reason as the club
      // and the charge above: Sim publishes no per-bot reload, and a guessed swing would be a
      // bot that looks like it is shooting when it is not.
      this.poseCart(this.botCarts[i]!, transform, BOT_DEFAULT_CLUB, 0, 1, false);
    }
    this.targets.setFromTransforms(view.targetTransforms, view.targetPartCount);
    this.pooledBalls.setFromTransforms(view.poolTransforms);

    this.frameChase(view);

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
    this.targets.dispose();
    this.pooledBalls.dispose();
    this.ground.dispose();
    this.trees.dispose();
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
    const c = view.cart;
    const forwardX = Math.cos(c.heading);
    const forwardZ = Math.sin(c.heading);

    this.chaseEyeScratch.set(
      c.position.x - forwardX * CHASE_DISTANCE,
      c.position.y + CHASE_HEIGHT,
      c.position.z - forwardZ * CHASE_DISTANCE,
    );
    this.chaseLookScratch.set(
      c.position.x + forwardX * CHASE_LOOK_AHEAD,
      c.position.y - CHASE_LOOK_DROP,
      c.position.z + forwardZ * CHASE_LOOK_AHEAD,
    );

    // Keep the eye above the terrain it is flying over, or a chase camera reversing into a
    // hillside ends up underground looking at the inside of the heightfield.
    const groundAtEye = this.terrain.heightAt(this.chaseEyeScratch.x, this.chaseEyeScratch.z);
    this.chaseEyeScratch.y = Math.max(this.chaseEyeScratch.y, groundAtEye + CHASE_MIN_GROUND_CLEARANCE);

    this.camera.position.lerp(this.chaseEyeScratch, CHASE_POSITION_LERP);
    this.cameraTarget.lerp(this.chaseLookScratch, CHASE_TARGET_LERP);
    this.camera.lookAt(this.cameraTarget);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}


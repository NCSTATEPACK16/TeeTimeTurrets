import * as THREE from "three";
import { KeyboardMouseSource } from "../../input/KeyboardMouseSource";
import { RenderScene } from "../../render/scene";
import type { ArenaSource, FrameView } from "../../render/scene";
import { CLUB_STATS, ClubType as Club } from "../../physics/Ballistics";
import { CART_TUNING } from "../../sim/entities/Cart";
import type { ClubType } from "../../physics/Ballistics";
import { FIXED_DT, POOL_TRANSFORM_STRIDE, Sim, TRANSFORM_STRIDE, createPreviewBuffer } from "../../sim/world";
import type { CartTransform } from "../../sim/world";
import type { SimEventCursor, SimEventKind } from "../../sim/events";
import { drawHud, readHud } from "../hud";
import type { Hud } from "../hud";
import { drawBanner, readBanner } from "../banner";
import type { BannerDom } from "../banner";
import { BannerFeed, createBannerView } from "../bannerFeed";
import type { BannerSource } from "../bannerFeed";
import { HitMarkers } from "../hitMarkers";
import { KillFeed, drawKillFeed } from "../killFeed";
import { DamageIndicators, damageScreenAngle, lowHpIntensity, markerLabel } from "../hitFeedback";
import { Nameplates } from "../nameplates";
import { plateTeamOf } from "../plateState";
import type { PlateTeam } from "../plateState";
import { hasLineOfSight } from "../../sim/lineOfSight";
import type { HeightSampler } from "../../sim/lineOfSight";
import type { Screen } from "../../app/ScreenManager";

/**
 * One arena match on screen: sim, scene, input, HUD, nameplates, banners and hit markers, with a
 * lifetime. The Sim is created before `enter()` because `Sim.create` is async and the screen
 * lifecycle is not; `main.ts` awaits it and hands over a live one. `exit()` is the single place
 * that gives everything back.
 */

export interface MatchScreenOptions {
  readonly renderer: THREE.WebGLRenderer;
  readonly sim: Sim;
  readonly arena: ArenaSource;
  readonly hudRoot: HTMLElement;
  readonly nameplateRoot: HTMLElement;
  /** Called once, when the match clock runs out. Drives the transition to `MatchResultsScreen`. */
  readonly onMatchOver: () => void;
}

export class MatchScreen implements Screen {
  private readonly options: MatchScreenOptions;
  private render: RenderScene | null = null;
  private input: KeyboardMouseSource | null = null;
  private nameplates: Nameplates | null = null;
  private hud: Hud | null = null;
  /** UI-SPEC H12. Optional: if index.html has no #event-banner the match still runs without it. */
  private banner: BannerDom | null = null;
  private bannerFeed = new BannerFeed();
  private readonly bannerView = createBannerView();
  /** Reused each frame so the banner update allocates nothing in the render loop. */
  private readonly bannerSourceScratch = {
    playerInWater: false,
    playerDead: false,
    playerKills: 0,
  };
  /** Wall-clock ms of the last banner update, for a frame-rate-independent fade. */
  private lastBannerMs = 0;
  /** UI-SPEC H11. Optional like the banner; the match runs without #hit-markers. */
  private hitMarkers: HitMarkers | null = null;
  /** This screen's place in `Sim.events`, so each event is handled exactly once however many
   *  ticks ran since the last frame. Made on `enter`, which starts it at the present. */
  private eventCursor: SimEventCursor | null = null;
  private readonly hitScreenScratch = { x: 0, y: 0 };
  /** Optional like the banner; the match runs without #kill-feed. */
  private killFeedRoot: HTMLElement | null = null;
  private killFeed = new KillFeed();
  private killFeedDrawn = -1;
  /** Damage-direction flashes (#damage-indicators) and the low-HP vignette (#low-hp). Optional. */
  private readonly damageIndicators = new DamageIndicators();
  private damageRoot: HTMLElement | null = null;
  private lowHp: HTMLElement | null = null;
  private view: FrameView | null = null;
  /** Guards `onMatchOver`: called once. */
  private matchOverReported = false;
  /**
   * Sim time since this screen was entered, for the renderer's cosmetic cycles. Accumulated from
   * the fixed step rather than sampled from a wall clock, so the scene gate is reproducible.
   */
  private elapsedSeconds = 0;
  /**
   * Wall-clock milliseconds at which each bot was last in line of sight, indexed by bot. Drives
   * the enemy plate's fade-out; an index that has never been seen is simply absent. A wall clock on
   * purpose: this is a presentation fade and need not be reproducible frame-for-frame.
   */
  private readonly lastSeenAtMs: number[] = [];
  /** Wall-clock time of the last drawn frame, for `FrameView.frameSeconds`. */
  private lastDrawMs = 0;

  constructor(options: MatchScreenOptions) {
    this.options = options;
  }

  enter(): void {
    const { renderer, sim, hudRoot, nameplateRoot, arena } = this.options;

    this.render = new RenderScene(renderer, arena, sim.bots.length);
    this.nameplates = new Nameplates(
      nameplateRoot,
      sim.bots.map((_, i) => `BOT ${i + 1}`),
      // Bot i is rig i + 1; the player is rig 0.
      sim.bots.map((_, i) => plateTeamOf(i + 1, 0)),
    );
    this.lastSeenAtMs.length = 0;
    this.input = new KeyboardMouseSource(renderer.domElement);
    this.hud = readHud();
    if (!this.hud) throw new Error("expected the #hud elements in index.html");
    hudRoot.hidden = false;
    // Optional polish -- a missing #event-banner leaves `banner` null and the match runs without it.
    this.banner = readBanner();
    this.bannerFeed = new BannerFeed();
    this.lastBannerMs = performance.now();
    const hitRoot = document.getElementById("hit-markers");
    this.hitMarkers = hitRoot ? new HitMarkers(hitRoot) : null;
    this.eventCursor = sim.events.cursor();
    this.killFeedRoot = document.getElementById("kill-feed");
    this.killFeed = new KillFeed();
    this.killFeedDrawn = -1;
    this.damageRoot = document.getElementById("damage-indicators");
    this.lowHp = document.getElementById("low-hp");
    this.damageIndicators.clear();
    this.matchOverReported = false;

    // Rebuilt per entry rather than per frame: GameLoop's callbacks are covered by the AGENTS.md
    // no-allocation rule just as the fixed step is.
    this.view = {
      cart: cloneCart(sim.currentCart),
      charge01: 0,
      reload01: 1,
      club: sim.cart.equippedClub,
      turretLoaded: sim.cart.ammo > 0,
      poolTransforms: new Float32Array(sim.currentPoolTransforms.length),
      botCarts: sim.currentBotCarts.map(cloneCart),
      elapsedSeconds: 0,
      frameSeconds: 0,
      aimArc: createPreviewBuffer(),
      aimArcCount: 0,
      playerDead: sim.cart.dead,
      botDead: sim.bots.map((b) => b.dead),
      speed01: 0,
    };
    this.lastDrawMs = performance.now();
  }

  step(): void {
    const { sim } = this.options;
    if (!this.input) return;
    sim.step(this.input.sample());
    this.input.endTick();
    this.elapsedSeconds += FIXED_DT;

    if (!this.matchOverReported && sim.matchOver) {
      this.matchOverReported = true;
      this.options.onMatchOver();
    }
  }

  draw(alpha: number): void {
    const { sim } = this.options;
    const view = this.view;
    if (!view || !this.render || !this.hud || !this.nameplates) return;

    interpolateCart(sim.previousCart, sim.currentCart, alpha, view.cart);
    for (let i = 0; i < view.botCarts.length; i++) {
      interpolateCart(sim.previousBotCarts[i]!, sim.currentBotCarts[i]!, alpha, view.botCarts[i]!);
    }
    view.charge01 = sim.cart.charge;
    view.club = sim.cart.equippedClub;
    // Derived rather than stored, so the swing cannot drift from the reload it is animating. A club
    // swap deliberately does not clear the reload, so read the club here too rather than caching it.
    view.reload01 = reloadFraction(sim.cart.reloadRemaining, sim.cart.equippedClub);
    view.turretLoaded = sim.cart.ammo > 0;
    view.playerDead = sim.cart.dead;
    view.speed01 = sim.cart.speed / CART_TUNING.topSpeed;
    for (let i = 0; i < view.botDead.length; i++) view.botDead[i] = sim.bots[i]!.dead;
    view.elapsedSeconds = this.elapsedSeconds;
    const now = performance.now();
    // Capped, so a frame after the tab was hidden does not snap the camera across the course.
    view.frameSeconds = Math.min((now - this.lastDrawMs) / 1000, MAX_FRAME_SECONDS);
    this.lastDrawMs = now;
    // The arc for the shot being charged, or a full-power one while the trigger is up, so the
    // player can aim before committing. Nothing while dead: there is no turret to aim.
    view.aimArcCount = sim.cart.dead
      ? 0
      : sim.previewTrajectory(sim.cart.charge > 0 ? sim.cart.charge : 1, sim.cart.turretYaw, view.aimArc);
    interpolateTransforms(
      sim.previousPoolTransforms,
      sim.currentPoolTransforms,
      alpha,
      view.poolTransforms,
      POOL_TRANSFORM_STRIDE,
    );

    this.render.draw(view);
    this.drawNameplates();
    this.drainEvents(sim);
    drawHud(this.hud, sim);
    this.updateBanner(sim);
  }

  /** The live scene, for the dev console hook and the smoke harness. */
  get scene(): RenderScene | null {
    return this.render;
  }

  /** Renders one frame without advancing anything -- the results screen's backdrop. */
  drawStill(): void {
    if (!this.view || !this.render) return;
    this.view.frameSeconds = 0;
    this.render.draw(this.view);
  }

  exit(): void {
    this.options.hudRoot.hidden = true;
    // #hud-combat is a sibling of #hud, not a child, so hiding the HUD root leaves the health
    // and ammo cards lit over whatever screen comes next.
    if (this.hud) this.hud.combat.hidden = true;
    if (this.banner) this.banner.root.hidden = true;
    this.killFeedRoot?.replaceChildren();
    this.killFeedRoot = null;
    this.damageRoot?.replaceChildren();
    this.damageRoot = null;
    if (this.lowHp) this.lowHp.style.opacity = "0";
    this.lowHp = null;
    this.hitMarkers?.dispose();
    this.hitMarkers = null;
    this.input?.dispose();
    this.input = null;
    this.nameplates?.dispose();
    this.nameplates = null;
    this.render?.dispose();
    this.render = null;
    this.view = null;
    this.hud = null;
  }

  /**
   * Feeds public sim events to the banner and writes the current one to the DOM. The fade is timed
   * off a wall clock so it looks the same at any frame rate.
   */
  private updateBanner(sim: Sim): void {
    const now = performance.now();
    const dt = Math.max(0, (now - this.lastBannerMs) / 1000);
    this.lastBannerMs = now;

    const source: BannerSource = this.bannerSourceScratch;
    this.bannerSourceScratch.playerInWater = sim.cart.wasInWater;
    this.bannerSourceScratch.playerDead = sim.cart.dead;
    this.bannerSourceScratch.playerKills = sim.match.pointsFor(0);

    this.bannerFeed.update(source, dt);
    this.bannerFeed.view(this.bannerView);
    if (this.banner) drawBanner(this.banner, this.bannerView);

    this.killFeed.update(dt);
    if (this.killFeedRoot) this.killFeedDrawn = drawKillFeed(this.killFeedRoot, this.killFeed, this.killFeedDrawn);

    this.damageIndicators.update(dt);
    if (this.damageRoot) drawDamageIndicators(this.damageRoot, this.damageIndicators);
    if (this.lowHp) {
      const intensity = lowHpIntensity(sim.cart.health.hp, sim.cart.health.max).toFixed(2);
      if (this.lowHp.style.opacity !== intensity) this.lowHp.style.opacity = intensity;
    }
  }

  /**
   * Everything that reacts to the match reads `Sim.events` here, once per frame: each event since
   * the last frame, exactly once, however many ticks ran in between. Runs after `render.draw`, so
   * the camera `projectToScreen` reads is this frame's.
   */
  private drainEvents(sim: Sim): void {
    const cursor = this.eventCursor;
    if (!cursor) return;
    const log = sim.events;
    for (let s = cursor.begin(); s < log.total; s++) {
      const e = log.at(s)!;
      if (e.kind === "kill") this.killFeed.onKill(e.actor, e.target);
      this.playEffect(e.kind, e.x, e.y, e.z);
      this.addTrauma(sim, e.kind, e.actor, e.target, e.club, e.x, e.z);
      // Markers are the player's feedback: the player's own hits, rams and kills, nobody else's.
      if (e.actor === 0) {
        if (e.kind === "hit" || e.kind === "ram") this.spawnHitMarker("hit", markerLabel("hit", e.amount), e.x, e.y, e.z);
        else if (e.kind === "kill") this.spawnHitMarker("kill", markerLabel("kill", 0), e.x, e.y, e.z);
      }
      // The player was hurt: flash the side it came from, pointing at the cart that did it.
      if (e.target === 0 && (e.kind === "hit" || e.kind === "ram") && e.actor > 0) {
        const from = sim.currentBotCarts[e.actor - 1];
        if (from) {
          const me = sim.cart.position;
          this.damageIndicators.add(damageScreenAngle(from.position.x, from.position.z, me.x, me.z, sim.cart.turretYaw));
        }
      }
    }
    cursor.end();
  }

  /**
   * How hard an event shakes the player's camera: firing the heavy clubs, taking a hit, making a
   * kill, dying, and a kill going off close by.
   */
  private addTrauma(sim: Sim, kind: SimEventKind, actor: number, target: number, club: ClubType | null, x: number, z: number): void {
    const trauma = this.render?.trauma;
    if (!trauma) return;
    if (kind === "shot" && actor === 0) {
      if (club === Club.Driver) trauma.add(TRAUMA_DRIVER);
      else if (club === Club.Iron) trauma.add(TRAUMA_IRON);
    } else if ((kind === "hit" || kind === "ram") && target === 0) {
      trauma.add(TRAUMA_HURT);
    } else if (kind === "kill") {
      if (target === 0) trauma.add(TRAUMA_DEATH);
      else if (actor === 0) trauma.add(TRAUMA_KILL);
      else {
        const d = Math.hypot(x - sim.cart.position.x, z - sim.cart.position.z);
        if (d < NEAR_BLAST_M) trauma.add(TRAUMA_NEAR_BLAST * (1 - d / NEAR_BLAST_M));
      }
    }
  }

  /** The world effect for an event, if it has one. */
  private playEffect(kind: SimEventKind, x: number, y: number, z: number): void {
    const fx = this.render?.effects;
    if (!fx) return;
    if (kind === "shot") fx.muzzle(x, y, z);
    else if (kind === "hit") fx.impact(x, y, z);
    else if (kind === "ram") fx.ram(x, y, z);
    else if (kind === "kill") fx.death(x, y, z);
    // A splash event is at the cart's body centre; the water is drawn on the ground under it.
    else if (kind === "splash") fx.splash(x, this.options.sim.heightAt(x, z), z);
  }

  private spawnHitMarker(kind: "hit" | "kill", label: string, x: number, y: number, z: number): void {
    if (!this.hitMarkers || !this.render) return;
    // Lift the marker to about turret height so it reads over the cart rather than at its wheels.
    if (this.render.projectToScreen(x, y + HIT_MARKER_LIFT, z, this.hitScreenScratch)) {
      this.hitMarkers.spawn(kind, label, this.hitScreenScratch.x, this.hitScreenScratch.y);
    }
  }

  private drawNameplates(): void {
    const { sim } = this.options;
    const view = this.view;
    if (!view || !this.render || !this.nameplates) return;
    const now = performance.now();
    for (let i = 0; i < view.botCarts.length; i++) {
      const bot = sim.bots[i];
      if (bot === undefined) continue;
      placeNameplate(
        this.render,
        this.nameplates,
        i,
        view.cart,
        view.botCarts[i]!,
        bot.health,
        sim,
        this.lastSeenAtMs,
        now,
      );
    }
  }
}

/** Longest frame the camera smoothing is given: a frame after a hidden tab is not 30 s long. */
/** Camera trauma per event (0..1; shake is its square). See `addTrauma`. */
const TRAUMA_DRIVER = 0.35;
const TRAUMA_IRON = 0.15;
const TRAUMA_HURT = 0.45;
const TRAUMA_KILL = 0.3;
const TRAUMA_DEATH = 0.9;
const TRAUMA_NEAR_BLAST = 0.35;
/** A kill closer to the player than this shakes the camera, less with distance. */
const NEAR_BLAST_M = 25;

const MAX_FRAME_SECONDS = 0.1;

/** Metres above a cart's capsule centre that its plate floats. Clears the turret's club head. */
const NAMEPLATE_HEIGHT = 2.6;

/** Metres a hit marker is lifted above the impact point, so it reads over a cart, not at its wheels. */
const HIT_MARKER_LIFT = 1.5;

const plateScratch = { x: 0, y: 0 };

/** Reused per cart per frame; the render loop is covered by the no-allocation rule. Mutable so it
 *  can be rewritten in place, then read through the readonly `PlateSource` view. */
const plateSourceScratch = {
  team: "enemy" as PlateTeam,
  distanceM: 0,
  healthFraction: 0,
  onScreen: false,
  hasLineOfSight: false,
  secondsSinceLastSeen: 0,
};

/** Module-level rather than nested inside the method: a function declared inside a function body
 *  allocates a fresh closure on every call, and this one runs once per cart per frame. */
function placeNameplate(
  render: RenderScene,
  plates: Nameplates,
  index: number,
  player: CartTransform,
  cart: CartTransform,
  health: { readonly hp: number; readonly max: number },
  terrain: HeightSampler,
  lastSeenAtMs: number[],
  nowMs: number,
): void {
  const onScreen = render.projectToScreen(
    cart.position.x,
    cart.position.y + NAMEPLATE_HEIGHT,
    cart.position.z,
    plateScratch,
  );

  // Sight is measured cart to cart at plate height, not from the camera: the chase camera floats
  // behind and above the player, so a ridge the cart is actually hiding behind would read as
  // clear from the camera's vantage. The plate answers "can I see them", not "can the camera".
  // An ally's plate shows through terrain regardless, so its sight line is never walked.
  const team = plateTeamOf(index + 1, 0);
  const seen = team === "ally" || hasLineOfSight(
    terrain,
    player.position.x,
    player.position.y + NAMEPLATE_HEIGHT,
    player.position.z,
    cart.position.x,
    cart.position.y + NAMEPLATE_HEIGHT,
    cart.position.z,
  );
  if (seen) lastSeenAtMs[index] = nowMs;
  const lastSeen = lastSeenAtMs[index];

  // Flat rather than three-dimensional: a range is a distance along the ground, and folding in the
  // drop to a cart below you overstates it.
  plateSourceScratch.distanceM = Math.hypot(
    cart.position.x - player.position.x,
    cart.position.z - player.position.z,
  );
  plateSourceScratch.team = team;
  plateSourceScratch.healthFraction = health.max > 0 ? health.hp / health.max : 0;
  plateSourceScratch.onScreen = onScreen;
  plateSourceScratch.hasLineOfSight = seen;
  // Never seen at all reads as infinitely stale, so a plate cannot appear before its first sighting.
  plateSourceScratch.secondsSinceLastSeen =
    lastSeen === undefined ? Number.POSITIVE_INFINITY : (nowMs - lastSeen) / 1000;

  plates.setPlate(index, plateScratch.x, plateScratch.y, plateSourceScratch);
}

const scratchA = new THREE.Quaternion();
const scratchB = new THREE.Quaternion();
const scratchOut = new THREE.Quaternion();

/**
 * Plain lerp on the angles is correct here rather than a shortest-arc slerp: heading and turret
 * yaw accumulate without ever being wrapped to [-PI, PI], so successive values never straddle a
 * discontinuity and a naive interpolation cannot take the long way round.
 */
function interpolateCart(
  previous: CartTransform,
  current: CartTransform,
  alpha: number,
  out: CartTransform,
): void {
  out.position.x = lerp(previous.position.x, current.position.x, alpha);
  out.position.y = lerp(previous.position.y, current.position.y, alpha);
  out.position.z = lerp(previous.position.z, current.position.z, alpha);
  out.heading = lerp(previous.heading, current.heading, alpha);
  out.turretYaw = lerp(previous.turretYaw, current.turretYaw, alpha);
}

/** Lerps positions and slerps rotations for a whole flat transform buffer in place. */
function interpolateTransforms(
  previous: Float32Array,
  current: Float32Array,
  alpha: number,
  out: Float32Array,
  stride: number = TRANSFORM_STRIDE,
): void {
  const count = Math.min(previous.length, current.length, out.length);
  for (let i = 0; i + stride <= count; i += stride) {
    out[i] = lerp(previous[i]!, current[i]!, alpha);
    out[i + 1] = lerp(previous[i + 1]!, current[i + 1]!, alpha);
    out[i + 2] = lerp(previous[i + 2]!, current[i + 2]!, alpha);

    scratchA.set(previous[i + 3]!, previous[i + 4]!, previous[i + 5]!, previous[i + 6]!);
    scratchB.set(current[i + 3]!, current[i + 4]!, current[i + 5]!, current[i + 6]!);
    scratchOut.slerpQuaternions(scratchA, scratchB, alpha);
    out[i + 3] = scratchOut.x;
    out[i + 4] = scratchOut.y;
    out[i + 5] = scratchOut.z;
    out[i + 6] = scratchOut.w;

    // Anything past the transform itself is a flag, not a value: copy, never interpolate. A
    // half-active ball would be drawn at half scale on the frame it spawns.
    for (let extra = TRANSFORM_STRIDE; extra < stride; extra++) {
      out[i + extra] = current[i + extra]!;
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * `Cart.reloadRemaining` counts down in seconds; the renderer wants 0-at-the-shot rising to 1.
 * A club with no reload left is 1, which the swing reads as "at address".
 */
function reloadFraction(remainingSeconds: number, club: ClubType): number {
  const total = CLUB_STATS[club].reloadSeconds;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - remainingSeconds / total));
}

function cloneCart(t: CartTransform): CartTransform {
  return { position: { ...t.position }, heading: t.heading, turretYaw: t.turretYaw };
}

/**
 * One arc per active flash, rotated to its direction and faded by its age. At most four, so the
 * nodes are reused rather than rebuilt: extra ones are hidden, missing ones are added.
 */
function drawDamageIndicators(root: HTMLElement, indicators: DamageIndicators): void {
  const active = indicators.active;
  while (root.children.length < active.length) {
    const arc = document.createElement("div");
    arc.className = "damage-indicator";
    root.appendChild(arc);
  }
  for (let i = 0; i < root.children.length; i++) {
    const node = root.children[i] as HTMLElement;
    const ind = active[i];
    if (!ind) {
      if (node.style.opacity !== "0") node.style.opacity = "0";
      continue;
    }
    node.style.transform = `rotate(${ind.angle}rad)`;
    node.style.opacity = ind.opacity.toFixed(2);
  }
}

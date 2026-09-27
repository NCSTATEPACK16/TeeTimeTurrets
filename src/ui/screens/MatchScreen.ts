import * as THREE from "three";
import { KeyboardMouseSource } from "../../input/KeyboardMouseSource";
import { RenderScene } from "../../render/scene";
import type { ArenaSource, FrameView } from "../../render/scene";
import type { HolePlacement } from "../../sim/courseGeometry";
import { CLUB_STATS } from "../../physics/Ballistics";
import type { ClubType } from "../../physics/Ballistics";
import { FIXED_DT, POOL_TRANSFORM_STRIDE, Sim, TRANSFORM_STRIDE, createPreviewBuffer } from "../../sim/world";
import type { CartTransform } from "../../sim/world";
import { drawHud, readHud } from "../hud";
import type { Hud } from "../hud";
import { drawBanner, readBanner } from "../banner";
import type { BannerDom } from "../banner";
import { BannerFeed, createBannerView } from "../bannerFeed";
import type { BannerSource } from "../bannerFeed";
import { HitMarkers } from "../hitMarkers";
import { KillFeed } from "../killFeed";
import { DamageFlashes, damageBearing } from "../damageFlash";
import { DamageFlashDom, KillFeedDom } from "../feedbackDom";
import { Nameplates } from "../nameplates";
import { plateTeamOf } from "../plateState";
import type { PlateTeam } from "../plateState";
import { hasLineOfSight } from "../../sim/lineOfSight";
import type { HeightSampler } from "../../sim/lineOfSight";
import type { Screen } from "../../app/ScreenManager";
import type { Settings } from "../../app/settings";
import type { AudioEngine } from "../../audio/synth";
import { createCueRequest, cueFor } from "../../audio/cues";
import { lowHealthVignette } from "../hudState";
import { PauseOverlay } from "../pauseOverlay";
import type { PauseMode } from "../pauseOverlay";
import { on } from "../dom";
import { CourseMap } from "../courseMap";
import type { MapMarker } from "../courseMap";
import { buildMapHoles, nearestHoleNumber } from "../courseMapHoles";
import { COARSE_RANGE_M, ENEMY_FADE_S } from "../plateState";
import { LosSchedule } from "../losSchedule";

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
  /** Where the pause overlay mounts: the screens layer, above the HUD. */
  readonly screensRoot: HTMLElement;
  /** Null plays the match silent -- a browser with no WebAudio, or a harness. */
  readonly audio: AudioEngine | null;
  readonly settings: () => Settings;
  readonly onSettingsChange: (next: Settings) => void;
  /** MAIN MENU from the pause overlay. */
  readonly onMainMenu: () => void;
  /** True on a player's first match: it opens paused on the controls card. */
  readonly showControls: boolean;
  /** The controls card was dismissed. */
  readonly onControlsSeen: () => void;
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
  /** The next `Sim.events` seq this screen reads, so each event is reacted to exactly once however
   *  many frames render between steps. */
  private eventCursor = 0;
  private killFeed = new KillFeed();
  private killFeedDom: KillFeedDom | null = null;
  private damageFlashes = new DamageFlashes();
  private damageFlashDom: DamageFlashDom | null = null;
  private scoreStrip: HTMLElement | null = null;
  /** Wall-clock ms of the last feedback update, for frame-rate-independent fades. */
  private lastFeedbackMs = 0;
  /** True while the sim is frozen behind the pause overlay or the controls card. */
  private paused = false;
  private pause: PauseOverlay | null = null;
  private readonly teardown: (() => void)[] = [];
  /** Whether the canvas held the pointer lock last time it changed, so losing it can pause. */
  private hadPointerLock = false;
  private readonly cueScratch = createCueRequest();
  private readonly listenerScratch = { x: 0, z: 0, yaw: 0 };
  /** When each enemy plate next walks its line of sight, and what it saw last time. */
  private los = new LosSchedule(0, LOS_PERIOD_MS);
  private readonly losSeen: boolean[] = [];
  /** The `M` map. Its course layer is sampled the first time it opens. */
  private courseMap: CourseMap | null = null;
  private readonly hitScreenScratch = { x: 0, y: 0 };
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
    this.los = new LosSchedule(sim.bots.length, LOS_PERIOD_MS);
    this.losSeen.length = 0;
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
    this.eventCursor = sim.events.head;
    this.killFeed = new KillFeed();
    this.damageFlashes = new DamageFlashes();
    const feedRoot = document.getElementById("kill-feed");
    this.killFeedDom = feedRoot ? new KillFeedDom(feedRoot) : null;
    const flashRoot = document.getElementById("damage-flash");
    this.damageFlashDom = flashRoot ? new DamageFlashDom(flashRoot) : null;
    this.scoreStrip = document.getElementById("score-strip");
    this.lastFeedbackMs = performance.now();
    this.matchOverReported = false;
    this.input.sensitivity = this.options.settings().sensitivity;

    this.paused = false;
    this.pause = new PauseOverlay(this.options.screensRoot, this.options.settings, {
      resume: () => this.resume(),
      mainMenu: () => this.options.onMainMenu(),
      settingsChanged: (next) => {
        this.options.onSettingsChange(next);
        if (this.input) this.input.sensitivity = next.sensitivity;
      },
    });
    this.hadPointerLock = false;
    this.teardown.push(on(window, "keydown", (event) => this.onKey(event)));
    const onVisibility = (): void => {
      if (document.hidden) this.pauseMatch("paused");
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.teardown.push(() => document.removeEventListener("visibilitychange", onVisibility));
    const onLockChange = (): void => {
      const locked = document.pointerLockElement === renderer.domElement;
      // Esc while the pointer is captured is swallowed by the browser to release it, so the only
      // sign the player wanted out is the lock going. A lock the match itself let go of (the
      // buzzer, a screen change) is not that: those tear this listener down first.
      if (this.hadPointerLock && !locked) this.pauseMatch("paused");
      this.hadPointerLock = locked;
    };
    document.addEventListener("pointerlockchange", onLockChange);
    this.teardown.push(() => document.removeEventListener("pointerlockchange", onLockChange));
    const holes = arena.course.holes;
    this.courseMap = new CourseMap(nameplateRoot, () => buildMapHoles(holes));
    if (this.options.showControls) this.pauseMatch("controls");
    this.options.audio?.startMatch();

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
      speed: 0,
      playerDead: false,
      botDead: sim.bots.map(() => false),
    };
    this.lastDrawMs = performance.now();
  }

  step(): void {
    const { sim } = this.options;
    if (!this.input) return;
    if (this.paused) {
      // A press made while paused must not fire the tick play resumes on.
      this.input.endTick();
      return;
    }
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
    view.speed = sim.cart.speed;
    view.playerDead = sim.cart.dead;
    for (let i = 0; i < view.botDead.length; i++) view.botDead[i] = sim.bots[i]!.dead;
    view.elapsedSeconds = this.elapsedSeconds;
    const now = performance.now();
    // Capped, so a frame after the tab was hidden does not snap the camera across the course.
    // Zero while paused: the smoke, the shake and the camera hold still with the sim.
    view.frameSeconds = this.paused ? 0 : Math.min((now - this.lastDrawMs) / 1000, MAX_FRAME_SECONDS);
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
    this.readEvents(sim, view.cart);
    this.drawFeedback();
    this.drawCourseMap();
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

  /** True while the match is frozen behind the pause overlay or the controls card. */
  get isPaused(): boolean {
    return this.paused;
  }

  exit(): void {
    // Listeners first: letting go of the pointer lock below must not read as the player pausing.
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    this.pause?.dispose();
    this.pause = null;
    this.paused = false;
    this.courseMap?.dispose();
    this.courseMap = null;
    this.options.audio?.stopMatch();
    this.options.hudRoot.hidden = true;
    // #hud-combat is a sibling of #hud, not a child, so hiding the HUD root leaves the health
    // and ammo cards lit over whatever screen comes next.
    if (this.hud) this.hud.combat.hidden = true;
    if (this.banner) this.banner.root.hidden = true;
    this.hitMarkers?.dispose();
    this.hitMarkers = null;
    this.killFeedDom?.dispose();
    this.killFeedDom = null;
    this.damageFlashDom?.dispose();
    this.damageFlashDom = null;
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
  }

  /**
   * Everything that reacts to what happened reads `Sim.events` here, once per event: the cursor is
   * what makes it once, since the sim advances at a fixed step while this renders at the display
   * rate. Runs after `render.draw`, so the camera `projectToScreen` reads is this frame's.
   *
   * - The player's hits and kills get a hit marker. Only the player's: bot-on-bot fire would bury
   *   the screen.
   * - Every kill goes in the kill feed.
   * - A hit on the player flashes a wedge toward whoever fired it.
   * - A stroke pulses the score strip.
   */
  private readEvents(sim: Sim, player: CartTransform): void {
    const log = sim.events;
    const listener = this.listenerScratch;
    listener.x = player.position.x;
    listener.z = player.position.z;
    listener.yaw = player.turretYaw;
    const audio = this.options.audio;
    for (let seq = log.firstUnread(this.eventCursor); seq < log.head; seq++) {
      const e = log.at(seq)!;
      this.render?.react(e);
      if (audio && cueFor(e, listener, this.cueScratch)) audio.play(this.cueScratch);
      switch (e.kind) {
        case "hit":
          if (e.actor === 0) this.spawnHitMarker("hit", e.amount, e.x, e.y, e.z);
          if (e.target === 0 && e.actor > 0) {
            const shooter = sim.bots[e.actor - 1];
            if (shooter) {
              this.damageFlashes.push(
                damageBearing(player.position.x, player.position.z, player.turretYaw, shooter.position.x, shooter.position.z),
              );
            }
          }
          break;
        case "kill":
          if (e.actor === 0) this.spawnHitMarker("kill", 0, e.x, e.y, e.z);
          this.killFeed.push(e.actor, e.target);
          break;
        case "stroke":
          this.pulseScoreStrip();
          break;
        default:
          break;
      }
    }
    this.eventCursor = log.head;
  }

  /** Freezes the sim behind the overlay. Letting go of the pointer is part of pausing. */
  private pauseMatch(mode: PauseMode): void {
    if (!this.pause || this.options.sim.matchOver) return;
    if (this.paused && this.pause.mode === mode) return;
    this.paused = true;
    this.pause.show(mode);
    if (document.pointerLockElement !== null) document.exitPointerLock();
  }

  private resume(): void {
    if (!this.paused || !this.pause) return;
    const wasControls = this.pause.mode === "controls";
    this.paused = false;
    this.pause.hide();
    // Measured from now: the paused stretch is not a frame.
    this.lastDrawMs = performance.now();
    if (wasControls) this.options.onControlsSeen();
  }

  private onKey(event: KeyboardEvent): void {
    if (event.code === "KeyM" && !this.paused) {
      this.courseMap?.cycle();
      return;
    }
    if (event.code === "Escape") {
      // An open map is closed first; Esc again pauses.
      if (this.courseMap?.visible) {
        this.courseMap.close();
        return;
      }
      if (!this.paused) this.pauseMatch("paused");
      else this.resume();
      return;
    }
    // The first-play card goes with any of the keys a player would try.
    if (this.pause?.mode === "controls" && (event.code === "Enter" || event.code === "Space")) this.resume();
  }

  /**
   * The `M` map. Costs nothing while closed. The player, every teammate and every bucket are always
   * on it; an enemy only where its nameplate would be -- in sight, or within the plate's fade after
   * sight broke. A map showing every enemy through the hills would give away what the plates keep.
   */
  private drawCourseMap(): void {
    const map = this.courseMap;
    const view = this.view;
    if (!map || !map.visible || !view) return;
    const { sim, arena } = this.options;
    const now = performance.now();

    mapMarkers.length = 0;
    mapMarkers.push({ x: view.cart.position.x, z: view.cart.position.z, kind: "self", heading: view.cart.heading });
    for (let i = 0; i < view.botCarts.length; i++) {
      if (view.botDead[i]) continue;
      const bot = view.botCarts[i]!;
      const team = plateTeamOf(i + 1, 0);
      if (team === "enemy") {
        const lastSeen = this.lastSeenAtMs[i];
        if (lastSeen === undefined || (now - lastSeen) / 1000 > ENEMY_FADE_S) continue;
      }
      mapMarkers.push({ x: bot.position.x, z: bot.position.z, kind: team, heading: bot.heading });
    }
    for (const pickup of sim.pickups) {
      mapMarkers.push({ x: pickup.position.x, z: pickup.position.z, kind: "pickup", heading: 0 });
    }
    map.draw(mapMarkers, nearestHoleNumber(holePlacements(arena), view.cart.position.x, view.cart.position.z));
  }

  private spawnHitMarker(kind: "hit" | "kill", damage: number, x: number, y: number, z: number): void {
    if (!this.hitMarkers || !this.render) return;
    // Lift the marker to about turret height so it reads over the cart rather than at its wheels.
    if (this.render.projectToScreen(x, y + HIT_MARKER_LIFT, z, this.hitScreenScratch)) {
      this.hitMarkers.spawn(kind, damage, this.hitScreenScratch.x, this.hitScreenScratch.y);
    }
  }

  /** Restarts the strip's pulse animation, even if the last one is still running. */
  private pulseScoreStrip(): void {
    const strip = this.scoreStrip;
    if (!strip) return;
    strip.classList.remove("score-strip--pulse");
    void strip.offsetWidth; // a reflow between the two, or the browser merges them into nothing
    strip.classList.add("score-strip--pulse");
  }

  private drawFeedback(): void {
    const now = performance.now();
    const dt = Math.min(Math.max(0, (now - this.lastFeedbackMs) / 1000), MAX_FRAME_SECONDS);
    this.lastFeedbackMs = now;
    const cart = this.options.sim.cart;
    this.options.audio?.update(
      dt,
      cart.speed,
      lowHealthVignette(cart.health.max > 0 ? cart.health.hp / cart.health.max : 0, cart.dead),
      this.paused,
    );
    this.killFeed.update(dt);
    this.damageFlashes.update(dt);
    this.killFeedDom?.draw(this.killFeed.lines);
    this.damageFlashDom?.draw(this.damageFlashes.active);
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
        this.los,
        this.losSeen,
      );
    }
  }
}

/** Milliseconds between one enemy plate's line-of-sight walks: ten a second. */
const LOS_PERIOD_MS = 100;

/** Longest frame the camera smoothing is given: a frame after a hidden tab is not 30 s long. */
const MAX_FRAME_SECONDS = 0.1;

/** Metres above a cart's capsule centre that its plate floats. Clears the turret's club head. */
const NAMEPLATE_HEIGHT = 2.6;

/** Metres a hit marker is lifted above the impact point, so it reads over a cart, not at its wheels. */
const HIT_MARKER_LIFT = 1.5;

const plateScratch = { x: 0, y: 0 };

/** Reused per frame while the map is open; the render loop is covered by the no-allocation rule. */
const mapMarkers: MapMarker[] = [];
const placementCache = new WeakMap<ArenaSource, readonly HolePlacement[]>();

/** The course's hole placements, gathered once per arena rather than mapped every frame. */
function holePlacements(arena: ArenaSource): readonly HolePlacement[] {
  let placements = placementCache.get(arena);
  if (!placements) {
    placements = arena.course.holes.map((h) => h.placement);
    placementCache.set(arena, placements);
  }
  return placements;
}

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
  los: LosSchedule,
  losSeen: boolean[],
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
  // An ally's plate shows through terrain regardless, so its sight line is never walked. Nor is
  // an enemy's that is off screen or past plate range, where the plate cannot show anyway -- it is
  // walked the moment it comes back. Otherwise the walk is scheduled, ten a second per cart and
  // staggered, and the last answer stands between walks.
  const team = plateTeamOf(index + 1, 0);
  // Flat rather than three-dimensional: a range is a distance along the ground, and folding in the
  // drop to a cart below you overstates it.
  const distanceM = Math.hypot(cart.position.x - player.position.x, cart.position.z - player.position.z);
  let seen: boolean;
  if (team === "ally") {
    seen = true;
  } else if (!onScreen || distanceM > COARSE_RANGE_M) {
    seen = false;
    los.invalidate(index);
  } else if (los.due(index, nowMs)) {
    seen = hasLineOfSight(
      terrain,
      player.position.x,
      player.position.y + NAMEPLATE_HEIGHT,
      player.position.z,
      cart.position.x,
      cart.position.y + NAMEPLATE_HEIGHT,
      cart.position.z,
    );
    losSeen[index] = seen;
    los.done(index, nowMs);
  } else {
    seen = losSeen[index] === true;
  }
  if (seen) lastSeenAtMs[index] = nowMs;
  const lastSeen = lastSeenAtMs[index];

  plateSourceScratch.distanceM = distanceM;
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

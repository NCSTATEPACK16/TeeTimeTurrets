import type * as THREE from "three";
import "@fontsource/shrikhand/latin-400.css";
import "@fontsource/rubik/latin-400.css";
import "@fontsource/rubik/latin-600.css";
import "@fontsource/rubik/latin-700.css";
import "@fontsource/rubik/latin-800.css";
import "../title/title.css";
import logoUrl from "../../../art/brand/tee-time-links.svg?url";
import type { Screen } from "../../app/ScreenManager";
import { CLOUDS, FLAG_ICON, RIDE_SCENE, TITLE_SCENE, ballsHtml, cartSvg } from "../title/titleArt";
import { PAINTS, paintHex, type Paint } from "../../render/teamColors";
import { RIDES, TITLE_CONFIG, freeDriveUrl, type Ride, type RideId } from "../title/titleConfig";
import { TitleFlow } from "../title/titleFlow";

/**
 * S1, the front door: the Clubhouse Sunset title and Choose Your Ride, shared by the whole game.
 * TEE OFF goes to ride select, where Turrets starts the arena match and Chill or Joyride open free
 * drive (the separate app in drive/, at /drive/). CLUBHOUSE and SETTINGS are the screens they were;
 * MULTIPLAYER stays visibly disabled until it exists (`ROADMAP.md`: disabled, not absent).
 *
 * DOM only: an illustrated scene, not the old live 3D backdrop, so the title builds no geometry and
 * `exit` only has DOM and listeners to release. The canvas is cleared once so a finished match does
 * not show through a resize.
 */

export interface TitleActions {
  /** Starts an arena match: the Turrets ride. */
  readonly play: () => void;
  /** Opens free drive in a mode. Defaults to navigating to drive/ under the site's base. */
  readonly freeDrive?: (mode: "chill" | "joyride", paint: number) => void;
  readonly clubhouse?: () => void;
  readonly multiplayer?: () => void;
  readonly settings?: () => void;
}

export interface TitleScreenOptions {
  readonly root: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly version: string;
  readonly actions: TitleActions;
}

const KEYS = {
  back: ["Escape", "Backspace"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "NumpadEnter", "Space"],
} as const;

const has = (list: readonly string[], code: string): boolean => list.includes(code);

/** Where the free-drive paint choice is kept between visits. */
const PAINT_KEY = "ttt.drivePaint";

/** The saved paint, or the first (blue) when there is none, it is unknown, or storage is blocked. */
function loadPaint(): Paint {
  try {
    const id = window.localStorage.getItem(PAINT_KEY);
    return PAINTS.find((p) => p.id === id) ?? PAINTS[0]!;
  } catch {
    return PAINTS[0]!;
  }
}

function savePaint(paint: Paint): void {
  try {
    window.localStorage.setItem(PAINT_KEY, paint.id);
  } catch {
    // Private windows and blocked storage: the choice lasts this page only.
  }
}

export class TitleScreen implements Screen {
  private readonly options: TitleScreenOptions;
  private readonly flow = new TitleFlow();
  private container: HTMLElement | null = null;
  private readonly teardown: (() => void)[] = [];
  /** Free drive's cart paint (Chill and Joyride; Turrets paints by team). */
  private paint: Paint = PAINTS[0]!;

  constructor(options: TitleScreenOptions) {
    this.options = options;
  }

  enter(): void {
    const { root, renderer, version, actions } = this.options;
    renderer.clear();

    const c = TITLE_CONFIG;
    const box = document.createElement("div");
    box.className = "mn-root";
    box.style.setProperty("--mn-drive", `${c.driveSeconds}s`);
    box.style.setProperty("--mn-swing", `${c.swingSeconds}s`);
    box.style.setProperty("--mn-flight", `${c.swingSeconds * c.balls}s`);
    box.innerHTML = `
      <section class="mn-screen" data-view="title" aria-label="Title">
        <div class="mn-stage mn-cover">${TITLE_SCENE}${CLOUDS}</div>
        <div class="mn-stage mn-cover mn-fx">
          <div class="mn-drive">
            <div class="mn-puff" style="left:30px;top:222px;width:28px;height:28px"></div>
            <div class="mn-puff" style="left:20px;top:230px;width:20px;height:20px;animation-delay:.3s"></div>
            <div class="mn-puff" style="left:38px;top:232px;width:16px;height:16px;animation-delay:.6s"></div>
            <div class="mn-bob"><div class="mn-recoil">${cartSvg({
              firing: true,
              driving: true,
              speedLines: true,
              label: "A golf cart with a club-swinging turret on its roof, firing golf balls down the fairway",
            })}</div></div>
            ${ballsHtml(c.balls, c.swingSeconds, c.contactAt)}
          </div>
        </div>
        <div class="mn-stage mn-contain mn-ui">
          <div class="mn-wordmark"><h1><img src="${logoUrl}" alt="Tee Time Links" width="430" height="190"></h1><div class="mn-banner">TURRETS</div></div>
          <nav class="mn-title-menu" data-title-menu aria-label="Main menu">
            <button type="button" class="mn-btn mn-btn-primary" data-act="tee">${FLAG_ICON}<span>Tee Off</span></button>
            <div class="mn-row">
              <button type="button" class="mn-btn" data-act="clubhouse">Clubhouse</button>
              <button type="button" class="mn-btn" data-act="settings">Settings</button>
            </div>
            <div class="mn-row">
              <button type="button" class="mn-btn" data-act="multiplayer">Multiplayer</button>
            </div>
          </nav>
          <div class="mn-hint mn-sticker"><span class="mn-key">Enter</span><span>to tee off</span></div>
          <div class="mn-version">${escapeHtml(version)}</div>
        </div>
      </section>
      <section class="mn-screen" data-view="ride" aria-label="Choose your ride" hidden>
        <div class="mn-stage mn-cover">${RIDE_SCENE}</div>
        <div class="mn-stage mn-contain mn-ui">
          <div class="mn-ride-head"><h2>Choose your ride</h2><p class="mn-sticker">Turrets is the arena; Chill and Joyride are free drive on Tee Time Links</p></div>
          <div class="mn-cards" role="group" aria-label="Rides">${RIDES.map(card).join("")}</div>
          <div class="mn-ride-actions">
            <div class="mn-paint mn-sticker" role="radiogroup" aria-label="Free-drive cart paint">
              <span>Paint</span>
              ${PAINTS.map(
                (p) =>
                  `<button type="button" class="mn-swatch" role="radio" aria-checked="false" data-paint="${p.id}" title="${p.name}" aria-label="${p.name}" style="--mn-swatch:#${paintHex(p.canopy)}"></button>`,
              ).join("")}
            </div>
            <button type="button" class="mn-btn" data-act="back">Back</button>
            <button type="button" class="mn-btn mn-btn-primary" data-act="start">Tee Off</button>
          </div>
        </div>
      </section>`;

    // Buttons for screens that do not exist yet are disabled, not absent.
    const wire: Record<string, (() => void) | undefined> = {
      clubhouse: actions.clubhouse,
      settings: actions.settings,
      multiplayer: actions.multiplayer,
    };
    for (const [act, fn] of Object.entries(wire)) {
      const b = box.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!;
      b.disabled = fn === undefined;
      if (fn === undefined) b.title = "Not built yet";
    }

    this.paint = loadPaint();
    root.append(box);
    this.container = box;
    this.listen(box, "click", (e) => this.onClick(e as MouseEvent));
    this.listen(window, "keydown", (e) => this.onKey(e as KeyboardEvent));
    this.listen(window, "resize", () => this.fit());
    this.flow.onChange(() => this.render());
    this.fit();
    this.render();
  }

  step(): void {
    // Nothing simulated: the scene is CSS animation.
  }

  draw(): void {
    // Nothing to draw: the title is DOM over a cleared canvas.
  }

  exit(): void {
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    this.container?.remove();
    this.container = null;
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.teardown.push(() => target.removeEventListener(type, fn));
  }

  /** Scale factors for the 1280 x 720 stages: the scene covers the window, the buttons fit inside it. */
  private fit(): void {
    if (!this.container) return;
    const { width, height } = TITLE_CONFIG.stage;
    const sx = window.innerWidth / width;
    const sy = window.innerHeight / height;
    this.container.style.setProperty("--mn-cover", String(Math.max(sx, sy)));
    this.container.style.setProperty("--mn-contain", String(Math.min(sx, sy)));
  }

  private renderPaint(): void {
    for (const el of this.container?.querySelectorAll<HTMLElement>(".mn-swatch") ?? []) {
      el.setAttribute("aria-checked", String(el.dataset.paint === this.paint.id));
    }
  }

  private render(): void {
    const box = this.container;
    if (!box) return;
    const f = this.flow;
    this.renderPaint();
    for (const s of box.querySelectorAll<HTMLElement>("[data-view]")) s.hidden = s.dataset.view !== f.view;
    for (const cardEl of box.querySelectorAll<HTMLElement>(".mn-card")) {
      cardEl.setAttribute("aria-pressed", String(cardEl.dataset.ride === f.ride));
    }
    // Keyboard focus follows the view, so Enter always does the obvious thing.
    const target =
      f.view === "title"
        ? box.querySelector<HTMLElement>('[data-act="tee"]')
        : box.querySelector<HTMLElement>(`.mn-card[data-ride="${f.ride}"]`);
    if (target && !target.contains(document.activeElement)) target.focus();
  }

  private go(ride: Ride | null): void {
    if (!ride) return;
    const { actions } = this.options;
    if (ride.kind === "match") {
      actions.play();
      return;
    }
    const mode = ride.id === "joyride" ? "joyride" : "chill";
    if (actions.freeDrive) actions.freeDrive(mode, this.paint.canopy);
    else window.location.assign(freeDriveUrl(import.meta.env.BASE_URL, mode, this.paint.canopy));
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act], [data-paint], .mn-card");
    if (!el) return;
    if (el.dataset.paint) {
      this.paint = PAINTS.find((p) => p.id === el.dataset.paint) ?? this.paint;
      savePaint(this.paint);
      this.renderPaint();
      return;
    }
    const f = this.flow;
    const { actions } = this.options;
    if (el.dataset.ride) {
      // A second click on the chosen card tees off.
      if (f.ride === el.dataset.ride) this.go(f.start());
      else f.pick(el.dataset.ride as RideId);
      return;
    }
    switch (el.dataset.act) {
      case "tee":
        return f.teeOff();
      case "start":
        return this.go(f.start());
      case "back":
        f.back();
        return;
      case "clubhouse":
        return actions.clubhouse?.();
      case "settings":
        return actions.settings?.();
      case "multiplayer":
        return actions.multiplayer?.();
    }
  }

  private onKey(e: KeyboardEvent): void {
    const f = this.flow;
    if (has(KEYS.back, e.code)) {
      if (f.back()) e.preventDefault();
    } else if (f.view === "ride" && (has(KEYS.left, e.code) || has(KEYS.right, e.code))) {
      e.preventDefault();
      f.nudge(has(KEYS.left, e.code) ? -1 : 1);
    } else if (f.view === "ride" && has(KEYS.confirm, e.code)) {
      // Enter on a card (or anywhere on ride select but Back) tees off with the chosen ride.
      const active = document.activeElement as HTMLElement | null;
      // On Back or a paint swatch, the key presses that button instead.
      if (active?.dataset.act === "back" || active?.dataset.paint) return;
      e.preventDefault();
      this.go(f.start());
    }
  }
}

function card(ride: Ride): string {
  const turret = ride.kind === "match";
  const swing = TITLE_CONFIG.cardSwingSeconds;
  const fast = ride.id === "joyride";
  return `
    <button type="button" class="mn-card" data-ride="${ride.id}" aria-pressed="false" style="--mn-swing:${swing}s;--mn-flight:${swing * TITLE_CONFIG.balls}s">
      <div class="mn-card-stage">
        ${fast ? '<svg class="mn-speedlines" width="90" height="60" viewBox="0 0 90 60" aria-hidden="true"><path d="M80 14 h-60 M86 30 h-80 M78 46 h-54" stroke="#FFF4DC" stroke-width="6" stroke-linecap="round"/></svg>' : ""}
        <div class="mn-card-cart">
          ${cartSvg({ firing: turret, turret, driving: true, speedLines: false })}
          ${turret ? ballsHtml(TITLE_CONFIG.balls, swing, TITLE_CONFIG.contactAt) : ""}
        </div>
      </div>
      <div class="mn-card-title"><span>${ride.name}</span><span class="mn-badge">${ride.badge}</span></div>
      <p>${ride.blurb}</p>
      <div class="mn-tags">${ride.tags.map((t) => `<span>${t}</span>`).join("")}</div>
    </button>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

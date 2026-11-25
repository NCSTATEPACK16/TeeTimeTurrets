import { inputConfig } from '../core/inputConfig';
import { MODES, type ModeName } from '../modes/modes';
import { CLOUDS, FLAG_ICON, RIDE_SCENE, TITLE_SCENE, cartSvg } from './art';
import type { MenuFlow } from './menuFlow';
import { MPH_PER_MPS, uiConfig } from './uiConfig';

const RIDE_NAMES: readonly ModeName[] = ['chill', 'joyride'];

/** Top speed shown on a ride card, rounded to 5 mph, from the mode's own tuning. */
export function rideTopMph(mode: ModeName): number {
  return Math.round((MODES[mode].cart.drive.topSpeed * MPH_PER_MPS) / 5) * 5;
}

/**
 * The title screen, ride select and the Controls / Credits panels, rendered from a MenuFlow.
 * Mouse, keyboard (Enter, Esc, arrows) and gamepad (A, B, d-pad, Start) all drive the flow.
 */
export class Menus {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly ride: HTMLElement;
  private readonly panels: Record<'controls' | 'credits', HTMLElement>;
  private readonly startButton: HTMLButtonElement;
  private padPrev: boolean[] = [];
  private padAxisLatched = false;
  private raf = 0;
  private lastScreen = '';

  constructor(
    host: HTMLElement,
    private readonly flow: MenuFlow,
    /** Same-site page that launched free drive (settings.home); adds a Main menu button. */
    private readonly home: string | null = null,
  ) {
    const t = uiConfig.title;
    this.root = document.createElement('div');
    this.root.className = 'mn-root';
    this.root.style.setProperty('--mn-drive', `${t.driveSeconds}s`);
    const fastest = Math.max(...RIDE_NAMES.map(rideTopMph));
    const cards = RIDE_NAMES.map((id) => {
      const ride = uiConfig.rides.find((x) => x.id === id)!;
      const mph = rideTopMph(id);
      const fast = id === 'joyride';
      return `
        <button type="button" class="mn-card" data-ride="${id}" aria-pressed="false">
          <div class="mn-card-stage">
            ${fast ? '<svg class="mn-speedlines" width="90" height="60" viewBox="0 0 90 60" aria-hidden="true"><path d="M80 14 h-60 M86 30 h-80 M78 46 h-54" stroke="#FFF4DC" stroke-width="6" stroke-linecap="round"/></svg>' : ''}
            <div class="mn-card-cart">
              ${cartSvg({ driving: true, speedLines: false })}
            </div>
          </div>
          <div class="mn-card-title"><span>${MODES[id].label}</span><span class="mn-badge">${ride.badge}</span></div>
          <p>${ride.blurb}</p>
          <div class="mn-speed"><span>TOP SPEED</span><div class="mn-speed-track"><div style="width:${Math.min(100, (mph / fastest) * 100)}%"></div></div><span>${mph} mph</span></div>
          <div class="mn-tags">${ride.tags.map((tag) => `<span>${tag}</span>`).join('')}</div>
        </button>`;
    }).join('');

    this.root.innerHTML = `
      <section class="mn-screen" data-screen="title" aria-label="Title">
        <div class="mn-stage mn-cover">${TITLE_SCENE}${CLOUDS}</div>
        <div class="mn-stage mn-cover mn-fx">
          <div class="mn-drive">
            <div class="mn-puff" style="left:30px;top:222px;width:28px;height:28px"></div>
            <div class="mn-puff" style="left:20px;top:230px;width:20px;height:20px;animation-delay:.3s"></div>
            <div class="mn-puff" style="left:38px;top:232px;width:16px;height:16px;animation-delay:.6s"></div>
            <div class="mn-bob">${cartSvg({
              driving: true,
              speedLines: true,
              label: uiConfig.title.cartLabel,
            })}</div>
          </div>
        </div>
        <div class="mn-stage mn-contain mn-ui">
          <div class="mn-wordmark"><h1>Golf Cart</h1><div class="mn-banner">SIMULATOR</div></div>
          <nav class="mn-title-menu" aria-label="Main menu">
            <button type="button" class="mn-btn mn-btn-primary" data-act="tee">${FLAG_ICON}<span>Tee Off</span></button>
            <div class="mn-row" role="group" aria-label="Ride">
              ${RIDE_NAMES.map((id) => `<button type="button" class="mn-btn mn-ride-chip" data-pick="${id}" aria-pressed="false">${MODES[id].label}</button>`).join('')}
            </div>
            <div class="mn-row">
              <button type="button" class="mn-btn" data-act="controls">Controls</button>
              <button type="button" class="mn-btn" data-act="credits">Credits</button>
            </div>
            ${home ? '<button type="button" class="mn-btn" data-act="home">Main menu</button>' : ''}
          </nav>
          <div class="mn-hint mn-sticker" data-hint="fresh"><span class="mn-key">Enter</span><span>or</span><span class="mn-key mn-key-round">A</span><span>to tee off</span></div>
          <div class="mn-hint mn-sticker" data-hint="paused" hidden><span class="mn-key">Esc</span><span>or</span><span class="mn-key mn-key-round">B</span><span>to keep playing</span></div>
          <div class="mn-panel mn-sticker" data-panel="controls" role="dialog" aria-label="Controls" hidden>
            <h2>Controls</h2>
            <ul>
              <li><span class="mn-key">W</span><span class="mn-key">S</span><span class="mn-what">Drive, brake and reverse</span></li>
              <li><span class="mn-key">A</span><span class="mn-key">D</span><span class="mn-what">Steer</span></li>
              <li><span class="mn-key">Space</span><span class="mn-what">Handbrake drift</span></li>
              <li><span class="mn-key">Shift</span><span class="mn-what">Boost (Joyride)</span></li>
              <li><span class="mn-key">M</span><span class="mn-what">Switch ride</span></li>
              <li><span class="mn-key">R</span><span class="mn-what">Back to the cart path</span></li>
              <li><span class="mn-key">Esc</span><span class="mn-what">Pause</span></li>
            </ul>
            <p>Gamepad: triggers to drive and brake, left stick to steer, A handbrake, RB boost, Y reset, Back switches ride, Start pauses.</p>
            <button type="button" class="mn-btn" data-act="back">Back</button>
          </div>
          <div class="mn-panel mn-sticker" data-panel="credits" role="dialog" aria-label="Credits" hidden>
            <h2>Credits</h2>
            <p>Course terrain from the NC 2024 QL1 lidar (NC Emergency Management). Layout traced over NC OneMap orthoimagery. Map data © OpenStreetMap contributors, ODbL.</p>
            <p>Water: a port of “Very fast procedural ocean” by afl_ext. Fonts: Shrikhand and Rubik, SIL Open Font License.</p>
            <p>The full list is in ATTRIBUTION.md.</p>
            <button type="button" class="mn-btn" data-act="back">Back</button>
          </div>
        </div>
      </section>
      <section class="mn-screen" data-screen="ride" aria-label="Choose your ride" hidden>
        <div class="mn-stage mn-cover">${RIDE_SCENE}</div>
        <div class="mn-stage mn-contain mn-ui">
          <div class="mn-ride-head"><h2>Choose your ride</h2><p class="mn-sticker">Switch any time with M or the Back button</p></div>
          <div class="mn-cards" role="group" aria-label="Rides">${cards}</div>
          <div class="mn-ride-actions">
            <button type="button" class="mn-btn" data-act="back">Back</button>
            <button type="button" class="mn-btn mn-btn-primary" data-act="start">Tee Off</button>
          </div>
        </div>
      </section>`;
    host.appendChild(this.root);

    this.title = this.root.querySelector('[data-screen="title"]')!;
    this.ride = this.root.querySelector('[data-screen="ride"]')!;
    this.panels = {
      controls: this.root.querySelector('[data-panel="controls"]')!,
      credits: this.root.querySelector('[data-panel="credits"]')!,
    };
    this.startButton = this.root.querySelector('[data-act="start"]')!;

    this.root.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => this.fit());
    flow.onChange(() => this.render());
    this.fit();
    this.render();
  }

  get visible(): boolean {
    return this.flow.screen !== 'play' && !this.root.hidden;
  }

  /** Take the menus down for good (a load error shows instead). */
  hide(): void {
    this.root.dataset.dead = '1';
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Scale factors for the 1280 x 720 stages: the scene covers the window, the buttons fit inside it. */
  private fit(): void {
    const { width, height } = uiConfig.stage;
    const sx = window.innerWidth / width;
    const sy = window.innerHeight / height;
    this.root.style.setProperty('--mn-cover', String(Math.max(sx, sy)));
    this.root.style.setProperty('--mn-contain', String(Math.min(sx, sy)));
  }

  private render(): void {
    const f = this.flow;
    if (this.root.dataset.dead) return;
    this.root.hidden = f.screen === 'play';
    this.title.hidden = f.screen !== 'title';
    this.ride.hidden = f.screen !== 'ride';
    for (const [name, el] of Object.entries(this.panels)) el.hidden = f.panel !== name;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-pick], .mn-card')) {
      const id = el.dataset.pick ?? el.dataset.ride;
      el.setAttribute('aria-pressed', String(id === f.ride));
    }
    this.startButton.disabled = !f.ready;
    this.startButton.textContent = f.ready ? (f.started ? 'Back on the course' : 'Tee Off') : 'Loading course…';
    this.root.querySelector<HTMLElement>('[data-hint="fresh"]')!.hidden = f.started;
    this.root.querySelector<HTMLElement>('[data-hint="paused"]')!.hidden = !f.started;

    // Keyboard focus follows the screen, so Enter always does the obvious thing.
    const key = `${f.screen}:${f.panel ?? ''}`;
    if (key !== this.lastScreen) {
      this.lastScreen = key;
      if (f.screen === 'play') {
        (document.activeElement as HTMLElement | null)?.blur();
      } else if (f.panel) {
        this.panels[f.panel].querySelector<HTMLElement>('[data-act="back"]')?.focus();
      } else if (f.screen === 'title') {
        this.root.querySelector<HTMLElement>('[data-act="tee"]')?.focus();
      } else {
        this.root.querySelector<HTMLElement>(`.mn-card[data-ride="${f.ride}"]`)?.focus();
      }
    }
    if (this.visible && !this.raf) this.raf = requestAnimationFrame(() => this.pollPad());
  }

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act], [data-pick], .mn-card');
    if (!el) return;
    const f = this.flow;
    if (el.dataset.pick) return f.pick(el.dataset.pick as ModeName);
    if (el.dataset.ride) {
      // A second click on the chosen card tees off.
      if (f.ride === el.dataset.ride) f.start();
      else f.pick(el.dataset.ride as ModeName);
      return;
    }
    switch (el.dataset.act) {
      case 'tee':
        return f.teeOff();
      case 'start':
        f.start();
        return;
      case 'controls':
      case 'credits':
        return f.openPanel(el.dataset.act);
      case 'home':
        if (this.home) window.location.assign(this.home);
        return;
      case 'back':
        return f.back();
    }
  }

  private onKey(e: KeyboardEvent): void {
    const f = this.flow;
    const k = inputConfig.menuKeys;
    if (f.screen === 'play') {
      if ((k.pause as readonly string[]).includes(e.code)) {
        e.preventDefault();
        f.pause();
      }
      return;
    }
    if ((k.back as readonly string[]).includes(e.code)) {
      e.preventDefault();
      f.back();
    } else if ((k.left as readonly string[]).includes(e.code) || (k.right as readonly string[]).includes(e.code)) {
      if (f.panel) return;
      e.preventDefault();
      f.nudge((k.left as readonly string[]).includes(e.code) ? -1 : 1);
      if (f.screen === 'ride') this.root.querySelector<HTMLElement>(`.mn-card[data-ride="${f.ride}"]`)?.focus();
    } else if ((k.confirm as readonly string[]).includes(e.code) && f.screen === 'ride') {
      // Enter on a card (or anywhere on ride select) tees off with the chosen ride.
      const focused = document.activeElement as HTMLElement | null;
      if (focused?.dataset.act === 'back') return;
      e.preventDefault();
      f.start();
    }
  }

  /** Gamepad menu navigation, edge-triggered; runs only while a menu is up. */
  private pollPad(): void {
    this.raf = 0;
    if (!this.visible) return;
    const pad = navigator.getGamepads?.().find((p) => p && p.connected && p.mapping === 'standard') ?? null;
    if (pad) {
      const g = inputConfig.menuPad;
      const now = pad.buttons.map((b) => b.pressed);
      const hit = (i: number) => now[i] && !this.padPrev[i];
      const f = this.flow;
      const axis = pad.axes[g.axis] ?? 0;
      const axisDir = Math.abs(axis) > g.axisThreshold ? (Math.sign(axis) as -1 | 1) : 0;
      if (hit(g.left) || (axisDir === -1 && !this.padAxisLatched)) f.nudge(-1);
      if (hit(g.right) || (axisDir === 1 && !this.padAxisLatched)) f.nudge(1);
      this.padAxisLatched = axisDir !== 0;
      if (hit(g.back)) f.back();
      if (hit(g.confirm) || hit(g.start)) {
        if (f.panel) f.back();
        else if (f.screen === 'title') f.teeOff();
        else f.start();
      }
      this.padPrev = now;
    }
    this.raf = requestAnimationFrame(() => this.pollPad());
  }

  /** While driving: the Start button pauses (keyboard Esc is handled in onKey). */
  pollPauseButton(): void {
    const pad = navigator.getGamepads?.().find((p) => p && p.connected && p.mapping === 'standard') ?? null;
    if (!pad) return;
    const i = inputConfig.menuPad.start;
    const down = pad.buttons[i]?.pressed ?? false;
    if (down && !this.padPrev[i]) this.flow.pause();
    this.padPrev = pad.buttons.map((b) => b.pressed);
  }
}

import type { MaterialName } from '@gcs/level-schema';
import type { WheelState } from '../vehicle/VehicleModel';
import type { FrameStats } from './stats';
import { MPH_PER_MPS, uiConfig } from './uiConfig';

export interface HudState {
  modeLabel: string;
  modeName: string;
  /** Boost meter 0..1, or null when the mode has no boost. */
  boost: number | null;
  resetOffered: boolean;
}

/** The surface chip text: the material most wheels touch, or "Airborne!" with no wheel down. */
export function surfaceLabel(wheels: readonly Pick<WheelState, 'inContact' | 'material'>[]): string {
  const counts = new Map<MaterialName, number>();
  for (const w of wheels) if (w.inContact) counts.set(w.material, (counts.get(w.material) ?? 0) + 1);
  let best: MaterialName | null = null;
  let n = 0;
  for (const [m, c] of counts) {
    if (c > n) {
      best = m;
      n = c;
    }
  }
  return best ? uiConfig.surfaceLabels[best] : uiConfig.airborneLabel;
}

/** Speedometer ring rotation in degrees: -sweep/2 at a standstill, +sweep/2 at the full-scale speed. */
export function speedoAngle(mph: number): number {
  const { sweepDeg, fullMph } = uiConfig.speedo;
  return -sweepDeg / 2 + (Math.min(Math.max(mph, 0), fullMph) / fullMph) * sweepDeg;
}

const SURFACE_DOT: Partial<Record<string, string>> = {
  'In the rough': '#6fa56a',
  'On the fairway': '#3da35d',
  'On the fringe': '#4fb566',
  'On the green': '#7ee08c',
  'On the tee box': '#3da35d',
  'In the bunker': '#f2d8a0',
  'In the drink': '#4fa3a5',
  'On the cart path': '#5a6470',
  'In the woods': '#1e4d2b',
  'On the bank': '#c84b31',
};

/** DOM overlay in the Clubhouse Sunset style: ride badge, surface chip, speedometer, boost, keys card. */
export class Hud {
  private readonly speed: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly mode: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly dot: HTMLElement;
  private readonly boost: HTMLElement;
  private readonly boostFill: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly keys: HTMLElement;
  private readonly stats: HTMLElement;
  private lastText = '';
  /** Seconds of play left before the keys card fades (game time, so a slow first frame does not eat it). */
  private keysLeft = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly backend: string,
    debug: boolean,
  ) {
    root.innerHTML = `
      <div class="hud-corner hud-tl"><div class="hud-mode" data-mode></div></div>
      <div class="hud-corner hud-tr"><div class="hud-surface mn-sticker"><span class="hud-dot" data-dot></span><span data-surface></span></div></div>
      <div class="hud-prompt mn-sticker" data-prompt hidden>Stuck? <span class="mn-key">R</span> puts you back on the cart path</div>
      <div class="hud-corner hud-bl">
        <div class="hud-speedo"><div class="hud-ring" data-ring></div><div class="hud-speed" data-speed>0</div><div class="hud-unit">MPH</div></div>
        <div class="hud-boost mn-sticker" data-boost hidden><span class="hud-boost-label">BOOST</span><div class="hud-boost-track"><div class="hud-boost-fill" data-boost-fill><i></i><i></i><i></i></div></div></div>
      </div>
      <div class="hud-corner hud-br" data-keys>
        <div class="hud-keys mn-sticker">
          <div><span class="mn-key">W</span><span class="mn-key">S</span> Drive and brake</div>
          <div><span class="mn-key">Space</span> Handbrake drift</div>
          <div><span class="mn-key">Shift</span> Boost <span class="mn-key">M</span> Ride <span class="mn-key">Esc</span> Pause</div>
        </div>
      </div>
      <pre class="hud-stats" data-stats ${debug ? '' : 'hidden'}></pre>`;
    const q = (s: string) => root.querySelector<HTMLElement>(s)!;
    this.speed = q('[data-speed]');
    this.ring = q('[data-ring]');
    this.mode = q('[data-mode]');
    this.surface = q('[data-surface]');
    this.dot = q('[data-dot]');
    this.boost = q('[data-boost]');
    this.boostFill = q('[data-boost-fill]');
    this.prompt = q('[data-prompt]');
    this.keys = q('[data-keys]');
    this.stats = q('[data-stats]');
    const fit = () =>
      root.style.setProperty('--hud-scale', String(Math.min(1.2, Math.max(0.6, Math.min(innerWidth / 1280, innerHeight / 720)))));
    window.addEventListener('resize', fit);
    fit();
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** Show the keys card again; it fades after uiConfig.controlsCardSeconds of play. */
  showKeys(): void {
    this.keys.classList.remove('hud-faded');
    this.keysLeft = uiConfig.controlsCardSeconds;
  }

  update(
    frameSeconds: number,
    speedMps: number,
    wheels: readonly WheelState[],
    stats: FrameStats,
    state: HudState,
  ): void {
    if (this.keysLeft > 0) {
      this.keysLeft -= frameSeconds;
      if (this.keysLeft <= 0) this.keys.classList.add('hud-faded');
    }
    const mph = Math.abs(speedMps) * MPH_PER_MPS;
    this.speed.textContent = mph.toFixed(0);
    this.ring.style.transform = `rotate(${speedoAngle(mph).toFixed(1)}deg)`;
    this.boost.hidden = state.boost === null;
    if (state.boost !== null) this.boostFill.style.width = `${(state.boost * 100).toFixed(0)}%`;
    this.prompt.hidden = !state.resetOffered;
    const surface = surfaceLabel(wheels);
    const statsText = this.stats.hidden
      ? ''
      : `${this.backend}\n${stats.fps.toFixed(0)} fps  ${stats.frameMs.toFixed(1)} ms\n` +
        `physics ${stats.physicsMs.toFixed(2)} ms\ndraws ${stats.drawCalls}  tris ${(stats.triangles / 1000).toFixed(0)}k\n` +
        wheels.map((w) => `${w.name} ${w.inContact ? w.material : 'air'}`).join(' ');
    const text = state.modeLabel + surface + statsText;
    if (text === this.lastText) return;
    this.lastText = text;
    this.mode.textContent = state.modeLabel;
    this.mode.dataset.mode = state.modeName;
    this.surface.textContent = surface;
    this.dot.style.background = SURFACE_DOT[surface] ?? '#fff4dc';
    this.stats.textContent = statsText;
  }

  static showError(root: HTMLElement, message: string): void {
    root.hidden = false;
    root.innerHTML = `<div class="hud-error"><strong>Golf Cart Simulator failed to start</strong><pre>${escapeHtml(message)}</pre></div>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

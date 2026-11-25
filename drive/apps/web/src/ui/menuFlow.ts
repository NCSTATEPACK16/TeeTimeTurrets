import type { ModeName } from '../modes/modes';

export type Screen = 'title' | 'ride' | 'play';
export type Panel = 'controls' | 'credits' | null;

const RIDES: readonly ModeName[] = ['chill', 'joyride'];

/**
 * Menu state, DOM-free so it runs in Vitest: title -> ride select -> play, with a pause back to
 * the title. The DOM layer (ui/menus.ts) renders whatever this says and forwards input to it.
 */
export class MenuFlow {
  screen: Screen;
  panel: Panel = null;
  ride: ModeName;
  /** The course has loaded, so the round can start. */
  ready = false;
  /** A round is under way (the title is showing as a pause menu). */
  started = false;
  private readonly listeners: (() => void)[] = [];

  constructor(
    ride: ModeName,
    showMenus: boolean,
    /** Called when the round starts or resumes, with the ride to use. */
    private readonly onPlay: (ride: ModeName) => void,
  ) {
    this.ride = ride;
    this.screen = showMenus ? 'title' : 'play';
    this.started = !showMenus;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  setReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.changed();
    if (this.screen === 'play') this.onPlay(this.ride);
  }

  /** Title's Tee Off: on to ride select. */
  teeOff(): void {
    if (this.screen !== 'title') return;
    this.panel = null;
    this.screen = 'ride';
    this.changed();
  }

  pick(ride: ModeName): void {
    if (this.ride === ride) return;
    this.ride = ride;
    this.changed();
  }

  /** Step through the rides (arrow keys, d-pad). */
  nudge(dir: -1 | 1): void {
    const i = RIDES.indexOf(this.ride);
    this.pick(RIDES[(i + dir + RIDES.length) % RIDES.length]!);
  }

  /** Ride select's Tee Off: start (or resume) the round. Does nothing until the course has loaded. */
  start(): boolean {
    if (this.screen !== 'ride' || !this.ready) return false;
    this.screen = 'play';
    this.started = true;
    this.changed();
    this.onPlay(this.ride);
    return true;
  }

  openPanel(panel: Exclude<Panel, null>): void {
    if (this.screen !== 'title') return;
    this.panel = panel;
    this.changed();
  }

  /** Esc / B: close a panel, step back a screen, or (paused) return to the round. */
  back(): void {
    if (this.panel) {
      this.panel = null;
    } else if (this.screen === 'ride') {
      this.screen = 'title';
    } else if (this.screen === 'title' && this.started && this.ready) {
      this.screen = 'play';
      this.changed();
      this.onPlay(this.ride);
      return;
    } else {
      return;
    }
    this.changed();
  }

  /** Esc / Start while driving: the title as a pause menu. */
  pause(): void {
    if (this.screen !== 'play') return;
    this.screen = 'title';
    this.panel = null;
    this.changed();
  }
}

/**
 * One active screen at a time, with an explicit lifecycle.
 *
 * `ROADMAP.md` Phase 1.75 is blunt about why this exists: *"every screen disposes its own geometry
 * and materials on exit -- this is the whole reason the phase exists, and the thing a later
 * clubhouse would otherwise get wrong."* Everything below serves that. A screen is built by its
 * factory on entry and thrown away on exit, so there is no long-lived instance quietly holding a
 * scene graph; and the outgoing screen is always torn down *before* the incoming one is built, so
 * two scenes are never resident at once.
 *
 * Deliberately imports no THREE and touches no DOM. The renderer is a long-lived thing the screens
 * share -- `main.ts` creates it once and closes over it in the factories -- which keeps the
 * transition logic Node-testable and keeps this file honest about what it actually owns: order.
 */

export interface Screen {
  /** Build the scene and DOM. Anything allocated here must be released in `exit`. */
  enter(): void;
  /** Fixed-step update. Screens with nothing to simulate leave it empty. */
  step(): void;
  /** One rendered frame. `alpha` is the fixed-step interpolation factor from GameLoop. */
  draw(alpha: number): void;
  /** Release every geometry, material, texture and DOM node this screen created. */
  exit(): void;
}

export type ScreenFactory = () => Screen;

export class ScreenManager<Name extends string> {
  private readonly factories = new Map<Name, ScreenFactory>();
  private active: Screen | null = null;
  private activeKey: Name | null = null;

  /** The screen currently entered, or null before the first `show` and after `dispose`. */
  get activeName(): Name | null {
    return this.activeKey;
  }

  register(name: Name, factory: ScreenFactory): void {
    this.factories.set(name, factory);
  }

  /**
   * Tear down whatever is showing and build `name` fresh.
   *
   * Re-showing the screen already active still rebuilds it. That is not an accident: Results ->
   * NEXT HOLE -> Round has to hand back a new round rather than the finished one, and a "same
   * screen, do nothing" shortcut here would make that a silent no-op.
   */
  show(name: Name): void {
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(
        `no screen registered as "${name}" (have: ${[...this.factories.keys()].join(", ") || "none"})`,
      );
    }

    this.teardown();

    // Built only after the old screen is gone, so peak GPU residency is one screen, not two --
    // which is the property the Phase 1.75 memory gate measures.
    const screen = factory();
    try {
      screen.enter();
    } catch (error) {
      // Never leave a half-entered screen in `active`: it would be step()'d and draw()'n every
      // frame from here on, turning one construction failure into a per-frame exception storm.
      screen.exit();
      throw error;
    }
    this.active = screen;
    this.activeKey = name;
  }

  step(): void {
    this.active?.step();
  }

  draw(alpha: number): void {
    this.active?.draw(alpha);
  }

  /** Exits the active screen. Idempotent, so a page teardown can call it freely. */
  dispose(): void {
    this.teardown();
  }

  /**
   * A screen that throws while tearing down must not strand the player on it, so the failure is
   * reported and the transition continues. Swallowing it silently would hide exactly the disposal
   * bug the memory gate is looking for, hence the console.error.
   */
  private teardown(): void {
    const screen = this.active;
    this.active = null;
    this.activeKey = null;
    if (!screen) return;
    try {
      screen.exit();
    } catch (error) {
      console.error("screen failed to exit cleanly; continuing the transition", error);
    }
  }
}

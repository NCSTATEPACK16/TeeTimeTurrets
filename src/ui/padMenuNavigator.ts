import { GamepadSource } from "../input/GamepadSource";
import { PAD } from "../input/gamepadMapping";
import { nextFocus } from "./focusNav";
import type { FocusDirection, FocusRect } from "./focusNav";

/**
 * The pad on the DOM screens (Stage 4b, spec §2.3): title, Choose Your Ride, clubhouse, settings,
 * results, and the match's pause menu and controls card. `focusNav.ts` decides where focus goes;
 * this measures the controls and moves it.
 *
 * - D-pad or a firm left-stick push moves focus, repeating while held.
 * - A (the right face button) presses the focused control. B (the bottom one) goes back: it presses
 *   the screen's `[data-pad-back]` control, or sends Esc to a screen that handles that (the title).
 * - Left/right on a slider or a dropdown changes it instead of leaving it.
 *
 * It does nothing while there is nothing to focus, which is a match in play: the cart has the pad
 * then. It runs on its own animation frame, reading its own `GamepadSource`, so it needs no hook
 * in any screen.
 *
 * It also keeps `document.body.dataset.input` at "pad" or "keyboard", whichever was used last,
 * for the focus ring and the glyphs (`index.html`'s `[data-input="pad"]` rules).
 */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';
/** A modal on top: focus stays inside it while it is up. */
const MODAL = ".match-overlay";
/** Stick deflection that counts as a menu move: well past the drive deadzone, so it is deliberate. */
const STICK_MOVE = 0.5;
const REPEAT_DELAY_S = 0.4;
const REPEAT_EVERY_S = 0.15;

export class PadMenuNavigator {
  private readonly pad = new GamepadSource();
  private frame = 0;
  private held: FocusDirection | null = null;
  private heldFor = 0;
  private sinceRepeat = 0;
  private last = 0;

  private readonly onKeyboard = (event: Event): void => {
    // Our own synthetic Esc is the pad, not the keyboard.
    if (event.isTrusted) this.setInput("keyboard");
  };

  start(): void {
    window.addEventListener("keydown", this.onKeyboard);
    window.addEventListener("pointerdown", this.onKeyboard);
    this.last = performance.now();
    const tick = (now: number): void => {
      this.frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
    };
    this.frame = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener("keydown", this.onKeyboard);
    window.removeEventListener("pointerdown", this.onKeyboard);
  }

  private setInput(input: "pad" | "keyboard"): void {
    if (document.body.dataset.input !== input) document.body.dataset.input = input;
  }

  private update(dt: number): void {
    const pad = this.pad;
    pad.poll();
    if (!pad.connected) return;
    if (pad.active) this.setInput("pad");

    const controls = this.controls();
    if (controls.length === 0) {
      this.held = null;
      return;
    }
    const state = pad.state;
    const pressed = (i: number): boolean => (state.buttons[i] ?? 0) > 0 && !((state.prev[i] ?? 0) > 0);

    const direction = this.direction();
    if (direction === null) {
      this.held = null;
    } else if (direction !== this.held) {
      this.held = direction;
      this.heldFor = 0;
      this.sinceRepeat = 0;
      this.move(controls, direction);
    } else {
      this.heldFor += dt;
      this.sinceRepeat += dt;
      if (this.heldFor >= REPEAT_DELAY_S && this.sinceRepeat >= REPEAT_EVERY_S) {
        this.sinceRepeat = 0;
        this.move(controls, direction);
      }
    }

    if (pressed(PAD.right)) {
      const focused = document.activeElement;
      const target = focused instanceof HTMLElement && controls.includes(focused) ? focused : null;
      if (target) target.click();
      else this.focus(controls[0]!);
    }
    if (pressed(PAD.bottom)) this.back(controls);
  }

  private direction(): FocusDirection | null {
    const s = this.pad.state;
    const b = (i: number): boolean => (s.buttons[i] ?? 0) > 0;
    if (b(PAD.up)) return "up";
    if (b(PAD.down)) return "down";
    if (b(PAD.dleft)) return "left";
    if (b(PAD.dright)) return "right";
    const x = s.axes[0] ?? 0;
    const y = s.axes[1] ?? 0;
    if (Math.max(Math.abs(x), Math.abs(y)) < STICK_MOVE) return null;
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? "right" : "left";
    return y > 0 ? "down" : "up";
  }

  /** Every visible control on the top layer, in document order. */
  private controls(): HTMLElement[] {
    const modals = document.querySelectorAll<HTMLElement>(MODAL);
    const scope: ParentNode = modals.length > 0 ? modals[modals.length - 1]! : document;
    const out: HTMLElement[] = [];
    for (const el of scope.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (el.closest("[hidden]") !== null || el.getClientRects().length === 0) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      out.push(el);
    }
    return out;
  }

  private move(controls: HTMLElement[], direction: FocusDirection): void {
    const focused = document.activeElement;
    const current = focused instanceof HTMLElement ? controls.indexOf(focused) : -1;
    // A slider or a dropdown takes left and right for itself.
    if (current >= 0 && (direction === "left" || direction === "right") && this.adjust(controls[current]!, direction)) return;
    const rects: FocusRect[] = controls.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    const next = nextFocus(rects, current, direction);
    if (next >= 0) this.focus(controls[next]!);
  }

  /** Steps a slider or a dropdown; true when it was one. */
  private adjust(el: HTMLElement, direction: "left" | "right"): boolean {
    const up = direction === "right";
    if (el instanceof HTMLInputElement && el.type === "range") {
      if (up) el.stepUp();
      else el.stepDown();
    } else if (el instanceof HTMLSelectElement) {
      const i = el.selectedIndex + (up ? 1 : -1);
      if (i < 0 || i >= el.options.length) return true;
      el.selectedIndex = i;
    } else {
      return false;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  private back(controls: HTMLElement[]): void {
    const marked = controls.find((el) => el.dataset.padBack !== undefined);
    if (marked) {
      marked.click();
      return;
    }
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }));
  }

  private focus(el: HTMLElement): void {
    // `focusVisible` asks for the ring even though no key was pressed; the stylesheet's
    // `[data-input="pad"] :focus` rule covers a browser that ignores it.
    el.focus({ preventScroll: false, focusVisible: true } as FocusOptions);
  }
}

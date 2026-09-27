import { neutralIntent } from "./InputSource";
import type { InputSource, PlayerIntent } from "./InputSource";
import { intentFromKeys } from "./mapping";

/**
 * The desktop InputSource: a thin DOM shell with no binding logic of its own. It collects the
 * three things `intentFromKeys` needs -- held keys and mouse buttons, those pressed this tick,
 * pointer movement --
 * and delegates. Everything worth testing lives in mapping.ts, which is why this file has no
 * test of its own: there is nothing here but listener bookkeeping.
 */

/** Radians of turret yaw per pixel of pointer movement while pointer-locked. */
const POINTER_SENSITIVITY = 0.0025;

/** Keys the game consumes, so the browser's own bindings (scroll, quick-find) stay out of the way. */
const SWALLOWED = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "KeyC",
  "Digit1",
  "Digit2",
  "Digit3",
  "KeyF",
]);

export class KeyboardMouseSource implements InputSource {
  private readonly keysDown = new Set<string>();
  private readonly pressedThisTick = new Set<string>();
  private readonly intent: PlayerIntent = neutralIntent();
  private pointerAimDelta = 0;
  private readonly canvas: HTMLElement;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (SWALLOWED.has(event.code)) event.preventDefault();
    if (event.repeat) return;
    this.keysDown.add(event.code);
    this.pressedThisTick.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    this.pointerAimDelta += event.movementX * POINTER_SENSITIVITY;
  };

  // Mouse buttons join the key sets as `Mouse<button>`, so `intentFromKeys` binds them from the
  // same table. Only while pointer-locked: the click that takes the lock must not also fire.
  private readonly onMouseDown = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    const code = `Mouse${event.button}`;
    this.keysDown.add(code);
    this.pressedThisTick.add(code);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    this.keysDown.delete(`Mouse${event.button}`);
  };

  // Right-click cancels a charge; the browser's own menu would steal the pointer lock.
  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onCanvasClick = (): void => {
    if (document.pointerLockElement !== this.canvas) void this.canvas.requestPointerLock();
  };

  // A window that loses focus mid-drive keeps the key held forever, because the keyup lands on
  // whatever took focus. The cart then drives off on its own until the player clicks back and
  // taps the key again.
  private readonly onBlur = (): void => {
    this.keysDown.clear();
    this.pressedThisTick.clear();
    this.pointerAimDelta = 0;
  };

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    canvas.addEventListener("click", this.onCanvasClick);
  }

  sample(): PlayerIntent {
    return intentFromKeys(this.keysDown, this.pressedThisTick, this.pointerAimDelta, this.intent);
  }

  endTick(): void {
    this.pressedThisTick.clear();
    this.pointerAimDelta = 0;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.removeEventListener("click", this.onCanvasClick);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}

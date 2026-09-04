import { createHudStateScratch, deriveHudState } from "./hudState";
import type { HudSource } from "./hudState";

/** Reused every call rather than allocated per frame -- see deriveHudState's docstring. */
const stateScratch = createHudStateScratch();

/**
 * The DOM-writing half of the HUD. Every decision lives in hudState.ts; this file only puts
 * strings and widths into elements, which is why it has no tests -- npm run smoke drives the real
 * browser and is the layer that notices if an element is wired to nothing.
 *
 * Deliberately not the image-08 HUD. UI-SPEC section 2 assigns exactly two elements to this phase,
 * H6 (health) and H7 (ammo); the power meter, club selector, reload gauge, minimap and the rest
 * are Phase 4's, and Phase 4 lays them out as one layout rather than growing them one span at a
 * time.
 */

export interface Hud {
  powerFill: HTMLElement;
  club: HTMLElement;
  strokes: HTMLElement;
  status: HTMLElement;
  combat: HTMLElement;
  healthFill: HTMLElement;
  healthText: HTMLElement;
  ammoCount: HTMLElement;
  timer: HTMLElement;
}

export function readHud(): Hud | null {
  const ids = [
    "power-fill",
    "hud-club",
    "hud-strokes",
    "hud-status",
    "hud-combat",
    "health-fill",
    "health-text",
    "ammo-count",
    "hud-timer",
  ] as const;

  const found = ids.map((id) => document.getElementById(id));
  if (found.some((element) => element === null)) return null;
  const [powerFill, club, strokes, status, combat, healthFill, healthText, ammoCount, timer] =
    found as HTMLElement[];

  return {
    powerFill: powerFill!,
    club: club!,
    strokes: strokes!,
    status: status!,
    combat: combat!,
    healthFill: healthFill!,
    healthText: healthText!,
    ammoCount: ammoCount!,
    timer: timer!,
  };
}

export function drawHud(hud: Hud, source: HudSource): void {
  const state = stateScratch;
  deriveHudState(source, state);

  setWidth(hud.powerFill, state.charge01);
  setText(hud.club, state.clubText);
  setText(hud.strokes, state.strokesText);
  setText(hud.status, state.status);
  setText(hud.timer, state.timerText);

  // Hidden outright rather than shown full: an inert bar reads as a bug (UI-SPEC section 5).
  if (hud.combat.hidden === state.combatVisible) hud.combat.hidden = !state.combatVisible;
  if (!state.combatVisible) return;

  setWidth(hud.healthFill, state.healthFraction);
  setText(hud.healthText, state.healthText);
  setText(hud.ammoCount, state.ammoText);
}

/** Guarded so an unchanged string does not dirty the DOM every frame at 60fps. */
function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function setWidth(element: HTMLElement, fraction01: number): void {
  const width = `${Math.round(fraction01 * 100)}%`;
  if (element.style.width !== width) element.style.width = width;
}

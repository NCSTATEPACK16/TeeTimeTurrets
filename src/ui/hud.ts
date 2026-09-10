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
  /** Arena's two. Hidden in stroke play, and `strokes` is hidden in arena; never both. */
  teamScore: HTMLElement;
  points: HTMLElement;
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
    "hud-team-score",
    "hud-points",
  ] as const;

  const found = ids.map((id) => document.getElementById(id));
  if (found.some((element) => element === null)) return null;
  const [
    powerFill,
    club,
    strokes,
    status,
    combat,
    healthFill,
    healthText,
    ammoCount,
    timer,
    teamScore,
    points,
  ] = found as HTMLElement[];

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
    teamScore: teamScore!,
    points: points!,
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

  // Which readout is showing. Hidden rather than emptied, per UI-SPEC §5: an element left in
  // place with nothing in it reads as a bug, and a stroke count in a mode with no strokes reads
  // as a worse one. The strings are written either way -- `deriveHudState` derives both sets --
  // so switching mode never leaves a stale value behind a `hidden` that later comes off.
  setText(hud.teamScore, state.teamScoreText);
  setText(hud.points, state.pointsText);
  setHidden(hud.strokes, !state.golfVisible);
  setHidden(hud.teamScore, !state.arenaVisible);
  setHidden(hud.points, !state.arenaVisible);

  // Hidden outright rather than shown full: an inert bar reads as a bug (UI-SPEC section 5).
  if (hud.combat.hidden === state.combatVisible) hud.combat.hidden = !state.combatVisible;
  if (!state.combatVisible) return;

  setWidth(hud.healthFill, state.healthFraction);
  setText(hud.healthText, state.healthText);
  setText(hud.ammoCount, state.ammoText);
}

/** Guarded for the same reason `setText` is: this runs every frame at 60fps. */
function setHidden(element: HTMLElement, hidden: boolean): void {
  if (element.hidden !== hidden) element.hidden = hidden;
}

/** Guarded so an unchanged string does not dirty the DOM every frame at 60fps. */
function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function setWidth(element: HTMLElement, fraction01: number): void {
  const width = `${Math.round(fraction01 * 100)}%`;
  if (element.style.width !== width) element.style.width = width;
}

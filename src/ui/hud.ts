import { HUD_FLAG_CHIPS, createHudStateScratch, deriveHudState } from "./hudState";
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
  status: HTMLElement;
  combat: HTMLElement;
  healthFill: HTMLElement;
  healthText: HTMLElement;
  ammoCount: HTMLElement;
  timer: HTMLElement;
  teamScore: HTMLElement;
  points: HTMLElement;
  zoneWarning: HTMLElement;
  /** One chip per capture flag, built here into `#hud-flags`, which ships empty. */
  flagChips: HTMLElement[];
  bleed: HTMLElement;
  mortar: HTMLElement;
}

export function readHud(): Hud | null {
  const ids = [
    "power-fill",
    "hud-club",
    "hud-status",
    "hud-combat",
    "health-fill",
    "health-text",
    "ammo-count",
    "hud-timer",
    "hud-team-score",
    "hud-points",
    "hud-zone-warning",
    "hud-flags",
    "hud-bleed",
    "hud-mortar",
  ] as const;

  const found = ids.map((id) => document.getElementById(id));
  if (found.some((element) => element === null)) return null;
  const [
    powerFill,
    club,
    status,
    combat,
    healthFill,
    healthText,
    ammoCount,
    timer,
    teamScore,
    points,
    zoneWarning,
    flagRow,
    bleed,
    mortar,
  ] = found as HTMLElement[];

  // The chips are made here, not in markup, so an empty row is all the page shows until the code
  // under test fills it (docs/TEST-AND-SPEC-PITFALLS.md §1, instances 5 and 6).
  flagRow!.replaceChildren();
  const flagChips: HTMLElement[] = [];
  for (let i = 0; i < HUD_FLAG_CHIPS; i++) {
    const chip = document.createElement("span");
    chip.className = "hud-flag";
    chip.hidden = true;
    flagRow!.append(chip);
    flagChips.push(chip);
  }

  return {
    powerFill: powerFill!,
    club: club!,
    status: status!,
    combat: combat!,
    healthFill: healthFill!,
    healthText: healthText!,
    ammoCount: ammoCount!,
    timer: timer!,
    teamScore: teamScore!,
    points: points!,
    zoneWarning: zoneWarning!,
    flagChips,
    bleed: bleed!,
    mortar: mortar!,
  };
}

export function drawHud(hud: Hud, source: HudSource): void {
  const state = stateScratch;
  deriveHudState(source, state);

  setWidth(hud.powerFill, state.charge01);
  setText(hud.club, state.clubText);
  setText(hud.status, state.status);
  setText(hud.timer, state.timerText);

  setText(hud.teamScore, state.teamScoreText);
  setText(hud.points, state.pointsText);
  setText(hud.zoneWarning, state.zoneWarning);
  for (let i = 0; i < hud.flagChips.length; i++) drawFlagChip(hud.flagChips[i]!, state.flags[i]!);
  setText(hud.bleed, state.bleedText);
  hud.bleed.classList.toggle("us", state.bleedingUs);
  if (hud.mortar.hidden === state.mortarReady) hud.mortar.hidden = !state.mortarReady;

  if (hud.combat.hidden) hud.combat.hidden = false;
  setWidth(hud.healthFill, state.healthFraction);
  setText(hud.healthText, state.healthText);
  setText(hud.ammoCount, state.ammoText);
}

/**
 * A chip is its letter, coloured by owner, with a fill that leans toward whoever is taking it.
 * The fill is a CSS custom property so the stylesheet decides how it is drawn.
 */
function drawFlagChip(chip: HTMLElement, flag: (typeof stateScratch.flags)[number]): void {
  if (chip.hidden === flag.shown) chip.hidden = !flag.shown;
  if (!flag.shown) return;
  setText(chip, flag.letter);
  if (chip.dataset.owner !== flag.owner) chip.dataset.owner = flag.owner;
  if (chip.dataset.lean !== flag.leanTo) chip.dataset.lean = flag.leanTo;
  chip.classList.toggle("contested", flag.contested);
  const lean = `${Math.round(flag.lean01 * 100)}%`;
  if (chip.style.getPropertyValue("--lean") !== lean) chip.style.setProperty("--lean", lean);
}

/** Guarded so an unchanged string does not dirty the DOM every frame at 60fps. */
function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function setWidth(element: HTMLElement, fraction01: number): void {
  const width = `${Math.round(fraction01 * 100)}%`;
  if (element.style.width !== width) element.style.width = width;
}

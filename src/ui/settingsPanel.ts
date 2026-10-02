import { SENSITIVITY_MAX, SENSITIVITY_MIN } from "../app/settings";
import type { Settings } from "../app/settings";
import { QUALITY_CHOICES, QUALITY_PRESETS } from "../render/quality";
import type { QualityChoice } from "../render/quality";
import { el } from "./dom";

/**
 * The settings form: master, effects and music volume, mute, mouse sensitivity and graphics
 * quality. One builder,
 * used by the title's SETTINGS screen and by the pause menu, so the two cannot drift apart.
 * `onChange` gets a fresh copy after every edit; the caller applies it and saves it.
 */
export function buildSettingsPanel(initial: Settings, onChange: (next: Settings) => void): HTMLElement {
  const current: Settings = { ...initial };
  const emit = (): void => onChange({ ...current });

  const slider = (
    label: string,
    key: "master" | "sfx" | "music" | "sensitivity",
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
  ): HTMLElement => {
    const value = el("span", { class: "settings__value", text: format(current[key]) });
    const input = el("input", {
      class: "settings__slider",
      attrs: { type: "range", min: String(min), max: String(max), step: String(step), value: String(current[key]), "aria-label": label },
    });
    input.addEventListener("input", () => {
      current[key] = Number(input.value);
      value.textContent = format(current[key]);
      emit();
    });
    return el("label", { class: "settings__row" }, [el("span", { class: "settings__label", text: label }), input, value]);
  };

  const percent = (v: number): string => `${Math.round(v * 100)}%`;
  const mute = el("input", { attrs: { type: "checkbox", "aria-label": "Mute" } });
  mute.checked = current.muted;
  mute.addEventListener("change", () => {
    current.muted = mute.checked;
    emit();
  });

  const quality = el("select", { class: "settings__select", attrs: { "aria-label": "Quality" } });
  for (const choice of QUALITY_CHOICES) {
    const option = el("option", {
      text: choice === "auto" ? "AUTO" : QUALITY_PRESETS[choice].label.toUpperCase(),
      attrs: { value: choice },
    });
    quality.appendChild(option);
  }
  quality.value = current.quality;
  quality.addEventListener("change", () => {
    current.quality = quality.value as QualityChoice;
    emit();
  });

  return el("div", { class: "settings" }, [
    slider("MASTER", "master", 0, 1, 0.05, percent),
    slider("EFFECTS", "sfx", 0, 1, 0.05, percent),
    slider("MUSIC", "music", 0, 1, 0.05, percent),
    el("label", { class: "settings__row" }, [el("span", { class: "settings__label", text: "MUTE" }), mute]),
    slider("MOUSE", "sensitivity", SENSITIVITY_MIN, SENSITIVITY_MAX, 0.05, (v) => `${v.toFixed(2)}x`),
    el("label", { class: "settings__row" }, [el("span", { class: "settings__label", text: "QUALITY" }), quality]),
  ]);
}

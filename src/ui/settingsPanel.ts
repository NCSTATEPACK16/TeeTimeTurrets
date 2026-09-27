import { SENSITIVITY_MAX, SENSITIVITY_MIN } from "../app/settings";
import type { Settings } from "../app/settings";
import { el, on } from "./dom";

/**
 * The settings controls -- three volumes, mute, mouse sensitivity -- as one block of DOM, used by
 * the Settings screen and by the pause overlay. Every change calls `onChange` with a fresh copy;
 * the caller saves it and applies it. Returns its root and the function that removes its listeners.
 */
export function buildSettingsPanel(
  initial: Settings,
  onChange: (next: Settings) => void,
): { root: HTMLElement; dispose: () => void } {
  let current: Settings = { ...initial };
  const teardown: (() => void)[] = [];

  const commit = (patch: Partial<Settings>): void => {
    current = { ...current, ...patch };
    onChange({ ...current });
  };

  const slider = (label: string, key: "master" | "sfx" | "music"): HTMLElement => {
    const input = el("input", {
      class: "settings__range",
      attrs: { type: "range", min: "0", max: "100", step: "1", value: String(Math.round(current[key] * 100)), "data-setting": key },
    });
    const value = el("span", { class: "settings__value", text: `${Math.round(current[key] * 100)}` });
    teardown.push(
      on(input, "input", () => {
        const v = Number(input.value) / 100;
        value.textContent = `${Math.round(v * 100)}`;
        commit({ [key]: v } as Partial<Settings>);
      }),
    );
    return el("label", { class: "settings__row" }, [el("span", { class: "settings__label", text: label }), input, value]);
  };

  const mute = el("input", { attrs: { type: "checkbox", "data-setting": "muted" } });
  mute.checked = current.muted;
  teardown.push(on(mute, "change", () => commit({ muted: mute.checked })));

  const sensitivity = el("input", {
    class: "settings__range",
    attrs: {
      type: "range",
      min: String(Math.round(SENSITIVITY_MIN * 100)),
      max: String(Math.round(SENSITIVITY_MAX * 100)),
      step: "5",
      value: String(Math.round(current.sensitivity * 100)),
      "data-setting": "sensitivity",
    },
  });
  const sensitivityValue = el("span", { class: "settings__value", text: `${current.sensitivity.toFixed(2)}x` });
  teardown.push(
    on(sensitivity, "input", () => {
      const v = Number(sensitivity.value) / 100;
      sensitivityValue.textContent = `${v.toFixed(2)}x`;
      commit({ sensitivity: v });
    }),
  );

  const root = el("div", { class: "settings" }, [
    slider("MASTER", "master"),
    slider("EFFECTS", "sfx"),
    slider("MUSIC", "music"),
    el("label", { class: "settings__row" }, [el("span", { class: "settings__label", text: "MUTE" }), mute]),
    el("label", { class: "settings__row" }, [
      el("span", { class: "settings__label", text: "AIM SENSITIVITY" }),
      sensitivity,
      sensitivityValue,
    ]),
  ]);

  return {
    root,
    dispose: () => {
      for (const off of teardown) off();
      teardown.length = 0;
    },
  };
}

/** The controls, as the pause overlay and the first-play card list them. */
export const CONTROLS: readonly (readonly [string, string])[] = [
  ["W A S D", "drive"],
  ["Mouse", "aim the turret (click the game to capture it)"],
  ["Left button / F / Space", "hold to charge, release to fire"],
  ["Right button", "cancel a charge"],
  ["1 2 3", "putter, iron, driver"],
  ["Q / E", "turn the turret without a mouse"],
  ["Shift", "brake"],
  ["M", "course map"],
  ["Esc", "pause"],
];

export function buildControlsList(): HTMLElement {
  return el(
    "dl",
    { class: "controls" },
    CONTROLS.flatMap(([keys, what]) => [el("dt", { text: keys }), el("dd", { text: what })]),
  );
}

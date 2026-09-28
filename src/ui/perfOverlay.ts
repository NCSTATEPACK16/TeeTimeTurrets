import type { FrameReport } from "../engine/frameStats";

/**
 * A corner readout of frame time and draw calls, for `?perf` in the URL. Development only: it is
 * mounted by `main.ts` when asked for and never otherwise, and it polls four times a second rather
 * than writing to the DOM every frame.
 */
export function mountPerfOverlay(
  root: HTMLElement,
  read: () => FrameReport,
  pixelRatio: () => number,
): void {
  const el = document.createElement("pre");
  el.className = "perf-overlay";
  el.style.cssText =
    "position:fixed;left:8px;bottom:8px;z-index:1000;margin:0;padding:6px 8px;" +
    "font:12px/1.35 ui-monospace,monospace;color:#e8f5e0;background:rgba(0,0,0,.55);" +
    "border-radius:4px;pointer-events:none;white-space:pre";
  root.appendChild(el);
  window.setInterval(() => {
    const r = read();
    el.textContent =
      `frame ${r.frameMs.toFixed(1)} ms  p95 ${r.frameMsP95.toFixed(1)}\n` +
      `work  ${r.workMs.toFixed(1)} ms  p95 ${r.workMsP95.toFixed(1)}\n` +
      `draws ${r.drawCalls} (max ${r.drawCallsMax})  tris ${(r.triangles / 1000).toFixed(0)}k\n` +
      `dpr   ${pixelRatio().toFixed(2)}`;
  }, 250);
}

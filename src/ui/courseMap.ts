/**
 * The `M` map: a top-down plan of the course, with everything live drawn on top of it.
 *
 * UI-SPEC H8, which specified a corner minimap rendering "from `surfaceAt` alone -- no authored
 * map data, so nothing to keep in sync". That argument is kept and taken further: the shape comes
 * from `src/sim/mapGeometry.ts`, the same functions `tools/holePlan.ts` renders the committed
 * plans from, so the map and the reference drawing of the course cannot disagree.
 *
 * Two layers, because they change at completely different rates. The course itself is generated
 * from a seed and never moves, so it is rasterised once to an offscreen canvas and blitted;
 * carts and pickups move every frame and are drawn over the top. Redrawing a few thousand surface
 * runs and several thousand contour segments per frame, to produce a byte-identical image, is the
 * obvious way to make an overlay cost more than the game under it.
 *
 * It lives here rather than behind `ScreenManager` because the manager tears one screen down to
 * show another and has no overlay concept -- the round has to keep running underneath, which is
 * the whole point of a map you open mid-fight.
 *
 * The palette is deliberately not the plan's. The committed SVGs are a blueprint meant to be read
 * on paper; this is a HUD element read at a glance over live gameplay, and it follows the game's
 * own colours (concept sheet 08). Geometry drifting between the two would be a lie about the
 * course; a colour drifting is two media looking like themselves.
 */

import { SurfaceId } from "../sim/surfaces";
import { boundsOf, fitProjection, padBounds, toCourseFrame } from "./mapCamera";
import type { MapProjection, PlacedField } from "./mapCamera";
import type { ContourSegment, CorridorPolylines, SurfaceRun, Vec2 } from "../sim/mapGeometry";

/** Hidden, framed on the hole being played, or framed on the whole course. */
export type MapZoom = "hole" | "course";

/** An ellipse in a hole's local frame. Matches `src/sim/hazards.ts`'s `Ellipse`. */
export interface MapEllipse {
  readonly x: number;
  readonly z: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly rotation: number;
}

/** One hole's static geometry, already sampled, in its own local frame. */
export interface MapHole {
  /** 1-based, as printed on the map and on a tee sign. */
  readonly number: number;
  readonly field: PlacedField;
  readonly samples: number;
  readonly runs: readonly SurfaceRun[];
  readonly contours: readonly ContourSegment[];
  readonly corridor: CorridorPolylines;
  readonly green: MapEllipse;
  readonly tee: Vec2;
  readonly cup: Vec2;
}

/** Something that moves. Positions are in the course frame, already transformed. */
export interface MapMarker {
  readonly x: number;
  readonly z: number;
  readonly kind: "self" | "ally" | "enemy" | "pickup";
  /** Radians, for the heading wedge on `self`. Ignored for every other kind. */
  readonly heading: number;
}

const SURFACE_FILL: Readonly<Record<SurfaceId, string>> = {
  [SurfaceId.Green]: "#7ac95c",
  [SurfaceId.Fairway]: "#5aa544",
  [SurfaceId.Rough]: "#3d7a33",
  [SurfaceId.Sand]: "#d9c48a",
  [SurfaceId.Water]: "#3f7fb5",
  [SurfaceId.Bridge]: "#9a7b52",
};

const MARKER_FILL: Readonly<Record<MapMarker["kind"], string>> = {
  self: "#ffffff",
  ally: "#6fb6ff",
  enemy: "#ff9a5c",
  pickup: "#ffd34d",
};

/** Course-frame metres of breathing room around the fitted content. */
const PAD_M = 12;
/** Canvas pixels held clear inside the panel edge. */
const PAD_PX = 18;

export class CourseMap {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly holes: readonly MapHole[];
  private readonly still: HTMLCanvasElement;
  private zoomMode: MapZoom | null = null;
  /** What the cached still was drawn for. A miss on any of these rebuilds it. */
  private stillKey = "";
  private projection: MapProjection | null = null;
  private readonly scratch = { x: 0, z: 0 };

  constructor(container: HTMLElement, holes: readonly MapHole[]) {
    this.root = document.createElement("div");
    this.root.className = "course-map";
    this.root.hidden = true;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "course-map-canvas";
    this.root.appendChild(this.canvas);
    container.appendChild(this.root);

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("course map needs a 2d canvas context");
    this.ctx = ctx;
    this.holes = holes;
    this.still = document.createElement("canvas");
  }

  /** Null while closed. */
  get zoom(): MapZoom | null {
    return this.zoomMode;
  }

  get visible(): boolean {
    return this.zoomMode !== null;
  }

  /**
   * Closed -> the hole you are on -> the whole course -> closed.
   *
   * One key rather than a key and a modifier: the second press answering "and where is that on
   * the course" is the question the first press provokes, so it is the same gesture twice.
   */
  cycle(): void {
    this.zoomMode = this.zoomMode === null ? "hole" : this.zoomMode === "hole" ? "course" : null;
    this.root.hidden = this.zoomMode === null;
  }

  close(): void {
    this.zoomMode = null;
    this.root.hidden = true;
  }

  /**
   * Draws one frame. `focusHole` is the 1-based hole the "hole" zoom frames; it is ignored in
   * "course" zoom, which always fits everything.
   */
  draw(markers: readonly MapMarker[], focusHole: number): void {
    if (this.zoomMode === null) return;

    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    if (width <= 0 || height <= 0) return;

    const framed = this.zoomMode === "course" ? this.holes : this.holes.filter((h) => h.number === focusHole);
    const shown = framed.length > 0 ? framed : this.holes;

    const key = `${this.zoomMode}|${focusHole}|${width}x${height}`;
    if (this.stillKey !== key) {
      this.projection = fitProjection(
        padBounds(boundsOf(shown.map((h) => h.field)), PAD_M),
        width,
        height,
        PAD_PX,
      );
      this.rebuildStill(shown, width, height);
      this.stillKey = key;
    }
    const projection = this.projection;
    if (!projection) return;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.ctx.clearRect(0, 0, width, height);
    this.ctx.drawImage(this.still, 0, 0);
    this.drawMarkers(markers, projection);
  }

  dispose(): void {
    this.root.remove();
  }

  /** The course itself: everything that is a function of the seed and therefore never moves. */
  private rebuildStill(shown: readonly MapHole[], width: number, height: number): void {
    const projection = this.projection;
    if (!projection) return;
    this.still.width = width;
    this.still.height = height;
    const ctx = this.still.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    for (const hole of shown) this.drawSurfaces(ctx, hole, projection);
    // Contours only when a single hole fills the panel. At course zoom they collapse into a grey
    // wash that hides the thing the view is for, which is where the holes are.
    if (this.zoomMode === "hole") {
      for (const hole of shown) this.drawContours(ctx, hole, projection);
    }
    for (const hole of shown) {
      this.drawCorridor(ctx, hole, projection);
      this.drawGreen(ctx, hole, projection);
      this.drawTeeAndCup(ctx, hole, projection);
    }
  }

  private drawSurfaces(ctx: CanvasRenderingContext2D, hole: MapHole, p: MapProjection): void {
    const { field, samples } = hole;
    const step = field.fieldSize / samples;
    const origin = -field.fieldSize / 2;
    // A run is a rectangle in the hole's local frame, so a rotated hole needs the canvas rotated
    // rather than four corners projected: an axis-aligned fill of a rotated hole would shear it.
    ctx.save();
    ctx.translate(p.x(field.offsetX), p.y(field.offsetZ));
    ctx.rotate(field.rotation);
    const s = p.scale;
    for (const run of hole.runs) {
      ctx.fillStyle = SURFACE_FILL[run.surface];
      const x = (origin + run.colStart * step) * s;
      const y = (origin + run.row * step) * s;
      // +1 px of overdraw on each axis kills the hairline seams between neighbouring runs.
      ctx.fillRect(x, y, (run.colEnd - run.colStart) * step * s + 1, step * s + 1);
    }
    ctx.restore();
  }

  private drawContours(ctx: CanvasRenderingContext2D, hole: MapHole, p: MapProjection): void {
    ctx.save();
    ctx.strokeStyle = "rgba(20, 50, 28, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const seg of hole.contours) {
      toCourseFrame(hole.field, seg.ax, seg.az, this.scratch);
      ctx.moveTo(p.x(this.scratch.x), p.y(this.scratch.z));
      toCourseFrame(hole.field, seg.bx, seg.bz, this.scratch);
      ctx.lineTo(p.x(this.scratch.x), p.y(this.scratch.z));
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawCorridor(ctx: CanvasRenderingContext2D, hole: MapHole, p: MapProjection): void {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    this.strokePolyline(ctx, hole, hole.corridor.centre, p);
    ctx.restore();
  }

  private strokePolyline(
    ctx: CanvasRenderingContext2D,
    hole: MapHole,
    line: readonly Vec2[],
    p: MapProjection,
  ): void {
    if (line.length === 0) return;
    ctx.beginPath();
    for (let i = 0; i < line.length; i++) {
      const point = line[i]!;
      toCourseFrame(hole.field, point.x, point.z, this.scratch);
      const px = p.x(this.scratch.x);
      const py = p.y(this.scratch.z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  private drawGreen(ctx: CanvasRenderingContext2D, hole: MapHole, p: MapProjection): void {
    const g = hole.green;
    toCourseFrame(hole.field, g.x, g.z, this.scratch);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // The green's own rotation composes with the hole's placement in the course frame.
    ctx.ellipse(
      p.x(this.scratch.x),
      p.y(this.scratch.z),
      g.radiusX * p.scale,
      g.radiusZ * p.scale,
      g.rotation + hole.field.rotation,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.restore();
  }

  private drawTeeAndCup(ctx: CanvasRenderingContext2D, hole: MapHole, p: MapProjection): void {
    toCourseFrame(hole.field, hole.tee.x, hole.tee.z, this.scratch);
    const teeX = p.x(this.scratch.x);
    const teeY = p.y(this.scratch.z);
    toCourseFrame(hole.field, hole.cup.x, hole.cup.z, this.scratch);
    const cupX = p.x(this.scratch.x);
    const cupY = p.y(this.scratch.z);

    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.rect(teeX - 3, teeY - 3, 6, 6);
    ctx.fill();

    // The cup is a ringed dot rather than a flag glyph: at course zoom eighteen flags become
    // eighteen smudges, and the ring survives being three pixels across.
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cupX, cupY, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#d94a3d";
    ctx.beginPath();
    ctx.arc(cupX, cupY, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(hole.number), teeX, teeY - 8);
    ctx.restore();
  }

  private drawMarkers(markers: readonly MapMarker[], p: MapProjection): void {
    const ctx = this.ctx;
    for (const marker of markers) {
      const x = p.x(marker.x);
      const y = p.y(marker.z);
      ctx.save();
      ctx.fillStyle = MARKER_FILL[marker.kind];
      if (marker.kind === "self") {
        // A wedge rather than a dot: on a course-wide view "which way am I pointing" is most of
        // what the map is being asked.
        ctx.translate(x, y);
        ctx.rotate(marker.heading);
        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(5, 5);
        ctx.lineTo(0, 2);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, marker.kind === "pickup" ? 3 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

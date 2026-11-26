// Smoke check for the Tee Time Links logo, the one SVG that the title and free drive's menus import.
// It must be well-formed SVG with a viewBox for each of its two views, and its lettering must be
// outlines: a <text> element would render in whatever font the viewer happens to have.
import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import source from "../../../art/brand/tee-time-links.svg?raw";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Parses with every parser report recorded, so a warning fails the check as surely as a fatal error. */
function parse(text: string) {
  const reports: string[] = [];
  try {
    const doc = new DOMParser({ onError: (level, message) => void reports.push(`${level}: ${message}`) }).parseFromString(
      text,
      "image/svg+xml",
    );
    return { doc, reports };
  } catch (e) {
    reports.push(`threw: ${(e as Error).message}`);
    return { doc: undefined, reports };
  }
}

/** A viewBox's four numbers, or undefined unless all four are finite with a positive size. */
function viewBox(value: string | null) {
  const n = (value ?? "").trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite) || n[2] <= 0 || n[3] <= 0) return undefined;
  return { width: n[2], height: n[3] };
}

describe("the Tee Time Links logo (art/brand/tee-time-links.svg)", () => {
  const { doc, reports } = parse(source);

  it("parses as SVG with no parser reports", () => {
    expect(reports).toEqual([]);
    expect(doc?.documentElement?.namespaceURI).toBe(SVG_NS);
    expect(doc?.documentElement?.localName).toBe("svg");
  });

  it("has a viewBox for the wordmark, and a square one for the compact mark", () => {
    expect(doc, "the SVG must parse first").toBeDefined();
    expect(viewBox(doc!.documentElement!.getAttribute("viewBox"))).toBeDefined();
    const views = Array.from(doc!.getElementsByTagNameNS(SVG_NS, "view"));
    const mark = views.find((v) => v.getAttribute("id") === "mark");
    const box = viewBox(mark?.getAttribute("viewBox") ?? null);
    expect(box).toBeDefined();
    expect(box!.width).toBe(box!.height);
  });

  it("draws its lettering as outlines, with no <text>", () => {
    expect(doc, "the SVG must parse first").toBeDefined();
    // The premise: there is artwork at all, so an empty file cannot pass for one without text.
    expect(doc!.getElementsByTagNameNS(SVG_NS, "path").length).toBeGreaterThan(0);
    expect(doc!.getElementsByTagNameNS("*", "text").length).toBe(0);
  });
});

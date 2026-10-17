// Real and virtual junctions are told apart by hue and fill form, whatever the outline source or selection
// (docs/design-system.md §3 "Junctions: real and virtual"; OpenDRIVE 1.8.0 §12.5 virtual junctions).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JUNCTION, OVERLAY } from "../src/design/scene";
import { DRAW_ORDER } from "../src/map/drawOrder";
import { JUNCTION_PATTERNS, junctionDash, junctionEdge, junctionEdgeWidth, junctionFill, junctionPattern, virtualJunctions } from "../src/map/junctionStyle";

const REAL = ["default", "direct", "crossing", "", "Default"];
const AMBER = [OVERLAY.junctionFill, OVERLAY.junctionFillApprox, OVERLAY.junctionEdge].map((c) => c.slice(0, 3).join());

describe("junction style", () => {
  it("only type virtual is virtual (case-insensitive)", () => {
    expect(JUNCTION.kind("virtual")).toBe("virtual");
    expect(JUNCTION.kind("Virtual")).toBe("virtual");
    for (const t of REAL) expect(JUNCTION.kind(t)).toBe("real");
  });
  it("a virtual junction is hatched iris and never gets an amber fill or edge, exact or approximate", () => {
    for (const exact of [true, false]) {
      const m = { type: "virtual", exact };
      expect(junctionPattern(m)).toBe("virtual");
      expect(junctionFill(m, false)).toEqual(exact ? OVERLAY.virtualFill : OVERLAY.virtualFillApprox);
      expect(junctionEdge(m, false)).toEqual(OVERLAY.virtualEdge);
      expect(AMBER).not.toContain(junctionFill(m, false).slice(0, 3).join());
      expect(AMBER).not.toContain(junctionEdge(m, false).slice(0, 3).join());
    }
  });
  it("a real junction is a solid amber tint", () => {
    for (const type of REAL) for (const exact of [true, false]) {
      const m = { type, exact };
      expect(junctionPattern(m)).toBe("solid");
      expect(junctionFill(m, false)).toEqual(exact ? OVERLAY.junctionFill : OVERLAY.junctionFillApprox);
      expect(junctionEdge(m, false)).toEqual(OVERLAY.junctionEdge);
    }
  });
  it("selection keeps the fill form; the line style keeps the outline source", () => {
    expect(junctionPattern({ type: "virtual", exact: true })).toBe("virtual");
    expect(junctionEdge({ type: "virtual", exact: true }, true)).toEqual(OVERLAY.selected);
    expect(junctionEdgeWidth(false)).toBe(JUNCTION.edgeWidth);
    expect(junctionEdgeWidth(true)).toBe(JUNCTION.edgeWidthSelected);
    for (const type of ["virtual", "default"]) {
      expect(junctionDash({ type, exact: true })).toEqual([0, 0]);
      expect(junctionDash({ type, exact: false })).toEqual(JUNCTION.approxDash);
    }
  });
  it("the hatch is the spec's 45°, 3px line, 5px gap, and solid junctions have no pattern entry", () => {
    expect(JUNCTION_PATTERNS.virtual).toEqual({ type: "hatch", angle: 45, strokeWidth: 3, gap: 5 });
    expect(Object.keys(JUNCTION_PATTERNS)).toEqual(["virtual"]); // "solid" falls back to a plain fill
  });
  it("the map's junction layers take fill and edge from junctionStyle (not a literal amber)", () => {
    const src = readFileSync("src/map/MapView.tsx", "utf8");
    const j0 = src.indexOf('id: "junctions"'), real = src.slice(j0, src.indexOf('id: "lanes"', j0)); // the next layer after it
    expect(real).toMatch(/isVirtual\(J\.meta\[index\]\) \? \[0, 0, 0, 0\] : junctionFill\(/); // virtual: not under the lanes
    expect(real).not.toMatch(/OVERLAY\.junctionFill/);
    const virt = src.slice(src.indexOf('id: "junctions-virtual"'), src.indexOf('id: "junctions-virtual"') + 1000);
    expect(virt).toMatch(/getFillColor: [^\n]*junctionFill\(J\.meta\[V\.index\[index\]\]/);
    expect(virt).toMatch(/getFillPattern: [^\n]*junctionPattern\(/);
    expect(virt).toMatch(/proceduralPattern: true/);
    const edge = src.slice(src.indexOf('id: "junction-outlines"'), src.indexOf('id: "junction-outlines"') + 900);
    expect(edge).toMatch(/getColor: [^\n]*junctionEdge\(/);
    expect(edge).toMatch(/getDashArray: [^\n]*junctionDash\(/);
    expect(edge).not.toMatch(/OVERLAY\.junctionEdge/);
  });
  it("the virtual hatch is drawn over the lanes (a virtual junction lies on its through road), real fills under them", () => {
    expect(DRAW_ORDER["junctions-virtual"]).toBeGreaterThan(DRAW_ORDER.lanes);
    expect(DRAW_ORDER.junctions).toBeLessThan(DRAW_ORDER.lanes);
  });
  it("virtualJunctions keeps only the virtual outlines and maps each back to its junction", () => {
    const J = {
      positions: Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, /* virtual */ 5, 5, 1, 6, 5, 1, 6, 6, 1, 5, 6, 1, 0, 0, 0, 2, 0, 0, 2, 2, 0]),
      starts: Uint32Array.from([0, 3, 7, 10]),
      meta: [{ type: "default", exact: true }, { type: "virtual", exact: false }, { type: "crossing", exact: true }],
    };
    const V = virtualJunctions(J);
    expect(V.index).toEqual([1]);
    expect(Array.from(V.starts)).toEqual([0, 4]);
    expect(Array.from(V.positions)).toEqual([5, 5, 1, 6, 5, 1, 6, 6, 1, 5, 6, 1]);
    expect(virtualJunctions(J)).toBe(V); // cached
  });
});

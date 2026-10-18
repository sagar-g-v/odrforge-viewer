// The junction elevation grid (src/xodr/elevationGrid.ts; ASAM OpenDRIVE 1.8.0 §12.11): bicubic interpolation that is
// exact where it must be - on the grid points, on planes (the converter's grids), and on polynomials up to bicubic where
// the grid has the points the tangents need - and the reference-line frame it is read in.
import { describe, expect, it } from "vitest";
import { gridValue, gridZ, junctionGridZ, refLineST } from "../src/xodr/elevationGrid";
import type { ElevationGrid, Geom } from "../src/xodr/model";

// a grid 6 rows long (s 0 .. 25, every 5 m), 3 points left and right of the line, from a function of (s, t)
function grid(fn: (s: number, t: number) => number, rows = 6, side = 3, spacing = 5, sStart = 0): ElevationGrid {
  return {
    gridSpacing: spacing, sStart,
    rows: Array.from({ length: rows }, (_, k) => {
      const s = sStart + k * spacing, lat = (i: number) => fn(s, i * spacing);
      return { center: [lat(0)], left: Array.from({ length: side }, (_, q) => lat(q + 1)), right: Array.from({ length: side }, (_, q) => lat(-(q + 1))) };
    }),
  };
}

describe("junction elevation grid (1.8.0 §12.11)", () => {
  it("returns the grid's own values at its points", () => {
    const g = grid((s, t) => 500 + 0.01 * s * s - 0.3 * t + 0.002 * t * t * t);
    for (let k = 0; k < 6; k++) for (let i = -3; i <= 3; i++) expect(gridZ(g, k * 5, i * 5)).toBeCloseTo(gridValue(g, k, i), 9);
  });
  it("is exact on a plane, everywhere in the grid (edges included: the straight-line tangents of a plane are exact)", () => {
    const plane = (s: number, t: number) => 519.15 - 0.0027 * s + 0.0027 * t;
    const g = grid(plane);
    for (let s = 0; s <= 25; s += 0.7) for (let t = -15; t <= 15; t += 0.9) expect(gridZ(g, s, t)).toBeCloseTo(plane(s, t), 9);
  });
  it("is exact on a bicubic polynomial where the cubic tangents have their points (an inner square)", () => {
    const fn = (s: number, t: number) => 100 + 0.002 * s * s * s - 0.01 * s * t + 0.001 * t * t * t + 0.0001 * s * s * t * t;
    const g = grid(fn);
    for (let s = 5; s <= 15; s += 0.6) for (let t = -5; t <= 5; t += 0.55) expect(gridZ(g, s, t)).toBeCloseTo(fn(s, t), 6);
  });
  it("is NaN outside the grid or where a corner is missing", () => {
    const g = grid(() => 1);
    expect(gridZ(g, -1, 0)).toBeNaN();
    expect(gridZ(g, 26, 0)).toBeNaN();
    expect(gridZ(g, 10, 16)).toBeNaN();
  });
  it("reads (x, y) in the reference line's frame: s along it, t to its left", () => {
    const line: Geom[] = [{ s: 0, x: 10, y: 20, hdg: Math.PI / 2, length: 30, kind: "line" } as Geom];
    const st = refLineST(line, -5, 35);
    const [s, t] = st(7, 32); // 12 m along it (north), 3 m to its left (heading north, west is left)
    expect(s).toBeCloseTo(12, 9);
    expect(t).toBeCloseTo(3, 9);
    const g = grid((s2, t2) => 50 + s2 + 2 * t2), z = junctionGridZ({ refLine: line, elevationGrid: g })!;
    expect(z(7, 32)).toBeCloseTo(50 + 12 + 6, 9);
    expect(z(10, 20)).toBeCloseTo(50, 9); // the line's own start (s 0)
    expect(st(10, 15)[0]).toBeCloseTo(-5, 9); // before its start the line continues straight
  });
});

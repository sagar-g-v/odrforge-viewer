// Guards the 2D plan view (docs/ACCURACY.md §6): every 3D shape has a flat footprint of exactly its position and size,
// ordered as a straight-down look at the 3D scene shows them; 2D draws only those, flat, without terrain.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { viewHeights } from "../src/map/heights";
import { buildRender } from "../src/xodr/build";
import { columnRadius, diskResolution } from "../src/xodr/features";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

const od = parseOpenDrive(readFileSync(new URL("./fixtures/stelvio_standard.xodr", import.meta.url), "utf8"));
const proj = makeProjector(od.header.geoReference);
const F = buildRender(od, proj.forward).features, FP = F.footprints;
const ring = (k: number) => {
  const out: [number, number][] = [];
  for (let v = FP.starts[k]; v < FP.starts[k + 1]; v++) out.push(proj.inverse(FP.positions[3 * v], FP.positions[3 * v + 1]) as [number, number]);
  return out;
};
const area = (r: [number, number][]) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

describe("2D footprints of the 3D shapes", () => {
  const nColumns = F.columns.reduce((n, c) => n + c.meta.length, 0);
  it("one footprint per column and per box", () => {
    expect(FP.meta.length).toBe(nColumns + F.boxes.meta.length);
    expect(FP.meta.length).toBeGreaterThan(30);
  });
  it("a column's footprint is the polygon ColumnLayer draws: its radius, its disk resolution, centred on it", () => {
    let checked = 0;
    for (const c of F.columns) {
      const n = diskResolution(c.radius), polyArea = (n / 2) * c.radius * c.radius * Math.sin((2 * Math.PI) / n);
      for (let i = 0; i < c.meta.length; i++) {
        const [cx, cy] = proj.inverse(c.positions[3 * i], c.positions[3 * i + 1]);
        const k = [...Array(FP.meta.length).keys()].find((j) => { const r = ring(j); if (r.length !== n) return false;
          const mx = r.reduce((a, p) => a + p[0], 0) / n, my = r.reduce((a, p) => a + p[1], 0) / n; return Math.hypot(mx - cx, my - cy) < 1e-4 && Math.abs(area(r) - polyArea) < 1e-4; });
        expect(k).toBeDefined();
        if (++checked > 40) return;
      }
    }
  });
  it("a box's footprint is its own outline", () => {
    for (let b = 0; b < Math.min(F.boxes.meta.length, 20); b++) {
      const s = F.boxes.starts[b], e = F.boxes.starts[b + 1], first = [F.boxes.positions[3 * s], F.boxes.positions[3 * s + 1]];
      const k = [...Array(FP.meta.length).keys()].find((j) => FP.positions[3 * FP.starts[j]] === first[0] && FP.positions[3 * FP.starts[j] + 1] === first[1] && FP.starts[j + 1] - FP.starts[j] === e - s);
      expect(k).toBeDefined();
    }
  });
  it("ordered as seen from above: lowest top first, so a higher part covers a lower one", () => {
    for (let k = 1; k < FP.top.length; k++) expect(FP.top[k]).toBeGreaterThanOrEqual(FP.top[k - 1]);
  });
  it("columns are drawn with the radius they were built with (grouped per centimetre)", () => {
    expect(columnRadius(0.284)).toBe(0.28);
    expect(columnRadius(0.001)).toBe(0.02);
    expect(diskResolution(0.5)).toBe(14);
    expect(diskResolution(0.49)).toBe(8);
  });
});

describe("the 2D map is a flat plan view", () => {
  it("2D: flat heights, no terrain, whatever is chosen for 3D; 3D keeps the choice", () => {
    expect(viewHeights("2d", "absolute", true)).toEqual({ mode: "flat", terrain: false });
    expect(viewHeights("3d", "absolute", true)).toEqual({ mode: "absolute", terrain: true });
  });
  it("MapView: 3D shapes only in 3D, footprints only in 2D, no separate signal dots", () => {
    const src = readFileSync(new URL("../src/map/MapView.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/if \(p\.mode === "3d"\) F\.columns\.forEach/);
    expect(src).toMatch(/if \(p\.mode === "3d" && F\.boxes\.meta\.length\)/);
    expect(src).toMatch(/if \(p\.mode === "2d" && F\.footprints\.meta\.length\)/);
    expect(src).not.toMatch(/id: "signals"/);
    expect(src).toMatch(/viewHeights\(p\.mode, p\.heightMode, p\.layers\.terrain\)/);
  });
});

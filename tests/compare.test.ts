import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRender } from "../src/xodr/build";
import { compareNetworks, polylineDeviation } from "../src/xodr/compare";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

const text = readFileSync(new URL("./fixtures/stelvio_standard.xodr", import.meta.url), "utf8");
const load = (t: string) => { const od = parseOpenDrive(t); return { od, r: buildRender(od, makeProjector(od.header.geoReference).forward) }; };

/** text of road `id` (its <road ...> ... </road> element) */
const roadSpan = (t: string, id: string) => {
  const i = t.indexOf(`id="${id}" junction=`), a = t.lastIndexOf("<road ", i), b = t.indexOf("</road>", i) + "</road>".length;
  return [a, b] as const;
};

describe("comparing two networks (xodr/compare.ts)", () => {
  const A = load(text);
  it("a file against itself: no differences, every road matched", () => {
    const c = compareNetworks(A.od, A.r, A.od, A.r);
    expect(c.items).toEqual([]);
    expect(c.matchedRoads).toBe(A.od.roads.length);
  });
  it("finds planted changes: a road moved 0.5 m, a road removed, a lane retyped", () => {
    let t = text;
    // road 2: every planView geometry shifted 0.5 m in y
    const [a2, b2] = roadSpan(t, "2");
    t = t.slice(0, a2) + t.slice(a2, b2).replace(/(<geometry [^>]*\by=")([-\d.eE]+)"/g, (_, p, y) => `${p}${Number(y) + 0.5}"`) + t.slice(b2);
    // road 3 removed
    const [a3, b3] = roadSpan(t, "3");
    t = t.slice(0, a3) + t.slice(b3);
    // road 1: its first driving lane becomes a shoulder
    const [a1, b1] = roadSpan(t, "1");
    t = t.slice(0, a1) + t.slice(a1, b1).replace('type="driving"', 'type="shoulder"') + t.slice(b1);
    const B = load(t);
    const c = compareNetworks(A.od, A.r, B.od, B.r);
    const by = (id: string) => c.items.filter((x) => x.what === "road" && x.id === id);
    expect(by("3").map((x) => x.kind)).toEqual(["removed"]);
    const moved = by("2")[0];
    expect(moved.kind).toBe("changed");
    expect(Number(moved.detail.match(/moved up to ([\d.]+) m/)![1])).toBeCloseTo(0.5, 2);
    expect(by("1")[0].detail).toMatch(/shoulder/);
    // nothing else changed (connecting roads keep their own geometry and links)
    expect(c.items.filter((x) => !["1", "2", "3"].includes(x.id) || x.what !== "road")).toEqual([]);
  });
  it("polyline deviation: parallel lines 1 m apart, heights 2 m apart", () => {
    // 1 m north of 48° N in degrees: the WGS84 meridian radius of curvature gives 111 190.32 m per degree there
    const m = 1 / 111190.32;
    const a = Float64Array.from([11, 48, 0, 11.001, 48, 0]), b = Float64Array.from([11, 48 + m, 2, 11.001, 48 + m, 2]);
    const d = polylineDeviation(a, b);
    expect(d.horizontal).toBeCloseTo(1, 3);
    expect(d.vertical).toBeCloseTo(2, 9);
  });
});

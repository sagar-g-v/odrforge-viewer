import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evalGeom, evalRoad } from "../src/xodr/geometry";
import { elevationAt, laneBorders, sectionIndex } from "../src/xodr/lanes";
import type { Geom } from "../src/xodr/model";
import { parseOpenDrive } from "../src/xodr/parse";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseXml } from "../src/xodr/xml";
import { boundaryRing } from "../src/xodr/junctions";

const geom = (o: Partial<Geom>): Geom => ({
  s: 0, x: 0, y: 0, hdg: 0, length: 10, kind: "line", k0: 0, k1: 0,
  aU: 0, bU: 1, cU: 0, dU: 0, aV: 0, bV: 0, cV: 0, dV: 0, normalized: true, ...o,
});

describe("reference line (OpenDRIVE 1.8.0 §9)", () => {
  it("line: x = x0 + ds cos(hdg)", () => {
    const p = evalGeom(geom({ hdg: Math.PI / 6 }), 4);
    expect(p.x).toBeCloseTo(4 * Math.cos(Math.PI / 6), 12);
    expect(p.y).toBeCloseTo(2, 12);
  });
  it("arc: a quarter circle of radius 20 ends at (20, 20) heading 90°", () => {
    const g = geom({ kind: "arc", k0: 1 / 20, k1: 1 / 20, length: (Math.PI / 2) * 20 });
    const p = evalGeom(g, g.length);
    expect(p.x).toBeCloseTo(20, 9);
    expect(p.y).toBeCloseTo(20, 9);
    expect(p.hdg).toBeCloseTo(Math.PI / 2, 12);
  });
  it("spiral with equal start / end curvature equals the arc", () => {
    const k = 1 / 35, L = 40;
    const a = evalGeom(geom({ kind: "arc", k0: k, k1: k, length: L }), L);
    const s = evalGeom(geom({ kind: "spiral", k0: k, k1: k, length: L }), L);
    expect(Math.hypot(a.x - s.x, a.y - s.y)).toBeLessThan(1e-7);
  });
  it("paramPoly3 normalized and arcLength ranges describe the same line", () => {
    const n = evalGeom(geom({ kind: "paramPoly3", bU: 10, normalized: true }), 5);
    const a = evalGeom(geom({ kind: "paramPoly3", bU: 1, normalized: false }), 5);
    expect(n.x).toBeCloseTo(5, 12);
    expect(a.x).toBeCloseTo(5, 12);
  });
});

describe("xml reader", () => {
  it("reads attributes, entities, CDATA and self-closing tags", () => {
    const d = parseXml(`<?xml version="1.0"?><a x="1 &amp; 2"><!-- c --><b/><g><![CDATA[+proj=tmerc]]></g></a>`);
    const a = d.children[0];
    expect(a.attrs.x).toBe("1 & 2");
    expect(a.children.map((c) => c.tag)).toEqual(["b", "g"]);
    expect(a.children[1].text).toBe("+proj=tmerc");
  });
});

describe("lane borders against OdrForge's reference sampler (tools/inspect/odrgeom.py), Stelvio", () => {
  const od = parseOpenDrive(readFileSync(new URL("./fixtures/stelvio_standard.xodr", import.meta.url), "utf8"));
  const ref: [string, number, number, number, number, number, number][] = JSON.parse(
    readFileSync(new URL("./fixtures/stelvio_ref.json", import.meta.url), "utf8"),
  );
  const roads = new Map(od.roads.map((r) => [r.id, r]));
  it("each element ends where the file starts the next one (exact closed-form data written by OdrForge): within 1 mm", () => {
    let worst = 0, n = 0;
    for (const road of od.roads)
      for (let i = 1; i < road.geoms.length; i++) {
        const prev = road.geoms[i - 1], next = road.geoms[i];
        const p = evalGeom(prev, prev.length);
        worst = Math.max(worst, Math.hypot(p.x - next.x, p.y - next.y));
        n++;
      }
    expect(n).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-3);
  });
  // odrgeom samples with its own interpolation: measured up to 4.6 mm off the file's exact start point (road 53, s 0)
  it("every outer lane border point within 5 mm of odrgeom (p99 1.4 mm), elevation within 1 mm", () => {
    let worst = 0, worstZ = 0, n = 0;
    for (const [rid, s, lid, , x, y, z] of ref) {
      const road = roads.get(rid)!;
      const sec = road.sections[sectionIndex(road, s)];
      const b = laneBorders(road, sec, s).get(lid);
      if (!b) continue;
      const p = evalRoad(road, s);
      const px = p.x - b.outer * Math.sin(p.hdg), py = p.y + b.outer * Math.cos(p.hdg);
      worst = Math.max(worst, Math.hypot(px - x, py - y));
      worstZ = Math.max(worstZ, Math.abs(elevationAt(road, s) - z));
      n++;
    }
    expect(n).toBeGreaterThan(2000);
    expect(worst).toBeLessThan(5e-3);
    expect(worstZ).toBeLessThan(1e-3);
  });
  it("every junction <boundary> (1.8.0 §12.10) becomes a closed, non-degenerate outline", () => {
    const byId = new Map(od.roads.map((r) => [r.id, r]));
    const withBoundary = od.junctions.filter((j) => j.boundary.length);
    expect(withBoundary.length).toBe(21);
    for (const j of withBoundary) {
      const ring = boundaryRing(j, byId)!;
      expect(ring).not.toBeNull();
      expect(ring.every((p) => p.every(Number.isFinite))).toBe(true);
      let area = 0; // shoelace
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      expect(Math.abs(area) / 2).toBeGreaterThan(10); // m², a real junction area
    }
    const r = buildRender(od, makeProjector(od.header.geoReference).forward);
    expect(r.junctions.meta.filter((m) => m.outline === "boundary").length).toBe(21);
    expect(r.junctions.meta.filter((m) => m.outline === "span").length).toBe(4); // the 4 virtual junctions (§12.5): main-road spans
    expect(r.junctions.meta.filter((m) => m.exact).length).toBe(25);
    expect(r.junctions.meta.length).toBe(od.junctions.length); // the others as approximate hulls
  });
  it("builds render buffers for every road with a geoReference", () => {
    const proj = makeProjector(od.header.geoReference);
    expect(proj.georeferenced).toBe(true);
    const r = buildRender(od, proj.forward);
    expect(r.lanes.meta.length).toBeGreaterThan(300);
    expect(r.lanes.starts.length).toBe(r.lanes.meta.length + 1);
    expect(r.bounds[0]).toBeGreaterThan(10); // Stelvio pass, ~10.45° E
    expect(r.bounds[1]).toBeGreaterThan(46);
  });
});

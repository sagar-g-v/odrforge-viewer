// Junction outlines in the converter's test areas (docs/ACCURACY.md §5): every common junction should carry a <boundary>
// (1.8.0 §12.10) that encloses its connecting-road lanes. The user asked on 2026-10-18 for a boundary on every junction.
// Only common junctions can carry one: the 1.8.1 XSD has `boundary` in t_junction_common (OpenDRIVE_Junction.xsd:253) and
// not in t_junction_direct or t_junction_virtual. Virtual junctions are outlined by their main-road span (§12.5); direct
// junctions are lane-level gores with no connecting roads and no area, so they have no outline and are left out. Until
// the converter publishes the boundaries, the common junctions drawn from the viewer's hull are counted exactly
// (KNOWN_HULLS), so the test fails when the count changes; lower it as the converter fixes them, to 0. Skipped where the
// data is not present.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import earcut from "earcut";
import { PolygonDistance, type P2 } from "../src/review/osmEdges";
import { junctionGridZ } from "../src/xodr/elevationGrid";
import { boundaryRing } from "../src/xodr/junctions";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

const DIR = process.env.ODRF_TESTAREAS ?? "C:/mywork/osm2carla/build/testareas";
// measured 2026-10-18: 65 / 57 / 5 / 58 on the 07:12 outputs; 36 / 44 / 3 / 36 after the contour fallback (OdrForge
// c0f186f); Frankfurt 37 after the sliver fix (c587e37, 23:20 outputs: a traced outline that still looped is withheld);
// London 46 with P2's kerb-anchored edges (2fa2fda, 20:29): junctions 11 and 281 lost their boundary, a regression the
// converter reported and the user accepted with P2 (it is to be won back with P2's junction-corner step)
const KNOWN_HULLS: Record<string, number> = { munich: 36, london: 46, stelvio: 3, frankfurt_kreuz: 37 };

/** proper crossings of a closed outline's edges (beyond 1 mm of their ends), with the smaller loop each one cuts off */
function selfCrossings(ring: number[][]): number[] {
  let p = ring.filter((q, i) => i === 0 || Math.hypot(q[0] - ring[i - 1][0], q[1] - ring[i - 1][1]) > 1e-3);
  if (p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-3) p = p.slice(0, -1);
  const area2 = (q: number[][]) => { let a = 0; for (let m = 0; m < q.length; m++) { const v = q[m], w = q[(m + 1) % q.length]; a += v[0] * w[1] - w[0] * v[1]; } return Math.abs(a) / 2; };
  const whole = area2(p), loops: number[] = [];
  for (let i = 0; i < p.length; i++) for (let k = i + 2; k < p.length; k++) {
    if (i === 0 && k === p.length - 1) continue;
    const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length], [cx, cy] = p[k], [dx, dy] = p[(k + 1) % p.length];
    const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(den) < 1e-12) continue;
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
    const la = Math.hypot(bx - ax, by - ay), lc = Math.hypot(dx - cx, dy - cy), e = 1e-3;
    if (!(t * la > e && (1 - t) * la > e && u * lc > e && (1 - u) * lc > e)) continue;
    const cut = area2([...p.slice(i + 1, k + 1), [ax + t * (bx - ax), ay + t * (by - ay)]]);
    loops.push(Math.min(cut, Math.abs(whole - cut)));
  }
  return loops;
}
// lane vertices outside their junction's boundary: proven <= 0.10 m (Frankfurt; curves sampled apart), limit with margin
const ENCLOSE_LIMIT = 0.15;
// the elevation grid (1.8.0 §12.11) against what it overwrites: connecting-road driving lanes lie on it (proven 2026-10-18:
// at most 0.002 m), and the drawn junction fill is it (the converter's grids are planes: 0 by construction)
const GRID_LIMIT = { lanes: 0.01, fill: 0.01 };

for (const area of ["munich", "london", "stelvio", "frankfurt_kreuz"]) {
  const xodr = `${DIR}/${area}_standard.xodr`;
  describe.skipIf(!existsSync(xodr))(`junction outlines: ${area}`, { timeout: 60000 }, () => {
    it("every common junction is outlined by the file, and its boundary encloses its connecting-road lanes", () => {
      const od = parseOpenDrive(readFileSync(xodr, "utf8")), proj = makeProjector(od.header.geoReference), r = buildRender(od, proj.forward);
      const J = r.junctions, outline = new Map<string, PolygonDistance>();
      J.meta.forEach((m, k) => {
        if (m.outline === "hull") return;
        const ring: P2[] = [];
        for (let v = J.starts[k]; v < J.starts[k + 1]; v++) ring.push(proj.inverse(J.positions[3 * v], J.positions[3 * v + 1]) as P2);
        outline.set(m.id, new PolygonDistance([ring]));
      });
      const hulls = J.meta.filter((m) => m.outline === "hull").length, drawn = new Set(J.meta.map((m) => m.id));
      const kind = (t: string) => (t.toLowerCase() === "direct" ? "direct" : t.toLowerCase() === "virtual" ? "virtual" : "common");
      // without any outline: only direct junctions may be (no connecting roads, no boundary in the schema)
      const unoutlined = od.junctions.filter((j) => !drawn.has(j.id)), direct = unoutlined.filter((j) => kind(j.type) === "direct").length;
      let n = 0, worst = 0;
      const outside = new Set<string>();
      r.lanes.meta.forEach((m, k) => {
        const jid = od.roads[m.road].junction, ring = outline.get(jid);
        if (!ring) return;
        for (let v = r.lanes.starts[k]; v < r.lanes.starts[k + 1]; v++) {
          const d = ring.distance(proj.inverse(r.lanes.positions[3 * v], r.lanes.positions[3 * v + 1]) as P2, 50);
          n++;
          worst = Math.max(worst, d);
          if (d > ENCLOSE_LIMIT) outside.add(jid);
        }
      });
      if (process.env.JUNCTION_OUTLINES) console.log(`JUNCTION-OUTLINES ${area}: ${od.junctions.length} junctions, ${hulls} hulls, ${unoutlined.length} without outline (${direct} direct); ${n} lane vertices in outlined junctions, worst ${worst.toFixed(2)} m outside`);
      expect(n).toBeGreaterThan(1000);
      expect([...outside].sort()).toEqual([]);
      expect(unoutlined.filter((j) => kind(j.type) !== "direct").map((j) => j.id)).toEqual([]);
      expect(J.meta.filter((m) => m.outline === "hull" && kind(m.type) !== "common").map((m) => m.id)).toEqual([]); // virtual: span
      expect(hulls).toBe(KNOWN_HULLS[area]);
    });
    // proven 2026-10-19 (OdrForge c587e37): none, in all four areas (c0f186f had six sliver loops under 0.01 m²)
    it("no boundary crosses itself (beyond 1 mm of a vertex)", () => {
      const od = parseOpenDrive(readFileSync(xodr, "utf8")), byId = new Map(od.roads.map((r) => [r.id, r]));
      const crossing: string[] = [];
      for (const j of od.junctions) {
        const ring = j.boundary.length ? boundaryRing(j, byId) : null;
        const loops = ring ? selfCrossings(ring) : [];
        if (loops.length) crossing.push(`${j.id} (${loops.map((a) => a.toFixed(4)).join(", ")} m²)`);
      }
      expect(crossing).toEqual([]);
    });
    it("every junction fill is triangulated inside its outline (the triangles' area is the outline's)", () => {
      // proven 2026-10-19 once the outline's duplicate points are dropped (build.ts): before, earcut put triangles up to
      // 1.3 m outside Munich junctions 12, 121 and 311 (junction 12: 689.9 m² of triangles in a 672.9 m² outline)
      const od = parseOpenDrive(readFileSync(xodr, "utf8")), proj = makeProjector(od.header.geoReference), r = buildRender(od, proj.forward);
      const J = r.junctions, off: string[] = [];
      J.meta.forEach((m, k) => {
        const xy: number[] = [];
        for (let v = J.starts[k]; v < J.starts[k + 1]; v++) xy.push(...(proj.inverse(J.positions[3 * v], J.positions[3 * v + 1]) as P2));
        const tri = earcut(xy, null, 2), n = xy.length / 2;
        let polygon = 0, triangles = 0;
        for (let i = 0; i < n; i++) { const a = 2 * i, b = 2 * ((i + 1) % n); polygon += xy[a] * xy[b + 1] - xy[b] * xy[a + 1]; }
        for (let q = 0; q < tri.length; q += 3) {
          const [a, b, c] = [2 * tri[q], 2 * tri[q + 1], 2 * tri[q + 2]];
          triangles += Math.abs((xy[b] - xy[a]) * (xy[c + 1] - xy[a + 1]) - (xy[c] - xy[a]) * (xy[b + 1] - xy[a + 1])) / 2;
        }
        polygon = Math.abs(polygon) / 2;
        if (Math.abs(triangles - polygon) > 0.001 * polygon + 0.01) off.push(`${m.id}: ${triangles.toFixed(2)} / ${polygon.toFixed(2)} m²`);
      });
      expect(off).toEqual([]);
    });
    it("inside a boundary the elevation grid holds: it covers the outline, the connecting lanes lie on it, the fill is it", () => {
      const od = parseOpenDrive(readFileSync(xodr, "utf8")), proj = makeProjector(od.header.geoReference), r = buildRender(od, proj.forward);
      const toXY = (lon: number, lat: number) => proj.inverse(lon, lat) as P2, byId = new Map(od.junctions.map((j) => [j.id, j]));
      let grids = 0, uncovered = 0, laneN = 0, laneWorst = 0, fillN = 0, fillWorst = 0;
      const J = r.junctions;
      J.meta.forEach((m, k) => {
        if (m.outline !== "boundary") return;
        const gz = junctionGridZ(byId.get(m.id)!);
        if (!gz) return;
        grids++;
        const xyz: number[] = [];
        for (let v = J.starts[k]; v < J.starts[k + 1]; v++) {
          const [x, y] = toXY(J.positions[3 * v], J.positions[3 * v + 1]);
          if (!Number.isFinite(gz(x, y))) uncovered++;
          xyz.push(x, y, J.positions[3 * v + 2]);
        }
        // the fill as drawn (earcut over the outline), sampled inside every triangle, against the grid there
        const tri = earcut(xyz.filter((_, i) => i % 3 !== 2), null, 2);
        for (let q = 0; q < tri.length; q += 3) {
          const [A, B, C] = [tri[q], tri[q + 1], tri[q + 2]].map((i) => xyz.slice(3 * i, 3 * i + 3));
          for (let a = 0.1; a < 1; a += 0.4) for (let b = 0.1; a + b < 1; b += 0.4) {
            const w = 1 - a - b, x = a * A[0] + b * B[0] + w * C[0], y = a * A[1] + b * B[1] + w * C[1], h = gz(x, y);
            if (!Number.isFinite(h)) continue;
            fillN++;
            fillWorst = Math.max(fillWorst, Math.abs(a * A[2] + b * B[2] + w * C[2] - h));
          }
        }
      });
      r.lanes.meta.forEach((m, k) => {
        const j = byId.get(od.roads[m.road].junction), gz = m.type === "driving" && j ? junctionGridZ(j) : null;
        if (!gz) return;
        for (let v = r.lanes.starts[k]; v < r.lanes.starts[k + 1]; v++) {
          const [x, y] = toXY(r.lanes.positions[3 * v], r.lanes.positions[3 * v + 1]), h = gz(x, y);
          if (!Number.isFinite(h)) continue;
          laneN++;
          laneWorst = Math.max(laneWorst, Math.abs(r.lanes.positions[3 * v + 2] - h));
        }
      });
      if (process.env.JUNCTION_OUTLINES) console.log(`JUNCTION-GRIDS ${area}: ${grids} boundaries with a grid, ${uncovered} outline points outside it; driving lanes ${laneN} points, worst ${laneWorst.toFixed(4)} m off; fill ${fillN} points, worst ${fillWorst.toFixed(4)} m off`);
      expect(grids).toBeGreaterThan(10);
      expect(uncovered).toBe(0);
      expect(laneN).toBeGreaterThan(1000);
      expect(laneWorst).toBeLessThanOrEqual(GRID_LIMIT.lanes);
      expect(fillWorst).toBeLessThanOrEqual(GRID_LIMIT.fill);
    });
  });
}

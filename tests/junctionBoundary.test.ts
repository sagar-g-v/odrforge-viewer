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
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

const DIR = process.env.ODRF_TESTAREAS ?? "C:/mywork/osm2carla/build/testareas";
// measured 2026-10-18 on the 07:12 outputs (8344403 + 92f58db)
const KNOWN_HULLS: Record<string, number> = { munich: 65, london: 57, stelvio: 5, frankfurt_kreuz: 58 };
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

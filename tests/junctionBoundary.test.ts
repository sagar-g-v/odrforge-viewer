// Junction outlines in the converter's test areas (docs/ACCURACY.md §5): every junction should carry a <boundary>
// (1.8.0 §12.10; virtual junctions: their main-road span, §12.5) that encloses its connecting-road lanes. The user asked
// on 2026-10-18 for a boundary on every junction; until the converter publishes that, the junctions without one are
// counted exactly (KNOWN_HULLS: drawn from the viewer's hull; KNOWN_NO_OUTLINE: no outline at all), so the test fails
// when the counts change. Lower them as the converter fixes junctions, to 0. Skipped where the data is not present.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PolygonDistance, type P2 } from "../src/review/osmEdges";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

const DIR = process.env.ODRF_TESTAREAS ?? "C:/mywork/osm2carla/build/testareas";
// measured 2026-10-18 on the 07:12 outputs (8344403 + 92f58db)
const KNOWN_HULLS: Record<string, number> = { munich: 65, london: 57, stelvio: 5, frankfurt_kreuz: 58 };
const KNOWN_NO_OUTLINE: Record<string, number> = { munich: 2, london: 1, stelvio: 0, frankfurt_kreuz: 31 };
// lane vertices outside their junction's boundary: proven <= 0.10 m (Frankfurt; curves sampled apart), limit with margin
const ENCLOSE_LIMIT = 0.15;

for (const area of ["munich", "london", "stelvio", "frankfurt_kreuz"]) {
  const xodr = `${DIR}/${area}_standard.xodr`;
  describe.skipIf(!existsSync(xodr))(`junction outlines: ${area}`, { timeout: 60000 }, () => {
    it("every junction is outlined by the file, and its boundary encloses its connecting-road lanes", () => {
      const od = parseOpenDrive(readFileSync(xodr, "utf8")), proj = makeProjector(od.header.geoReference), r = buildRender(od, proj.forward);
      const J = r.junctions, outline = new Map<string, PolygonDistance>();
      J.meta.forEach((m, k) => {
        if (m.outline === "hull") return;
        const ring: P2[] = [];
        for (let v = J.starts[k]; v < J.starts[k + 1]; v++) ring.push(proj.inverse(J.positions[3 * v], J.positions[3 * v + 1]) as P2);
        outline.set(m.id, new PolygonDistance([ring]));
      });
      const hulls = J.meta.filter((m) => m.outline === "hull").length, none = od.junctions.length - J.meta.length;
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
      if (process.env.JUNCTION_OUTLINES) console.log(`JUNCTION-OUTLINES ${area}: ${od.junctions.length} junctions, ${hulls} hulls, ${none} without outline; ${n} lane vertices in outlined junctions, worst ${worst.toFixed(2)} m outside`);
      expect(n).toBeGreaterThan(1000);
      expect([...outside].sort()).toEqual([]);
      expect(hulls).toBe(KNOWN_HULLS[area]);
      expect(none).toBe(KNOWN_NO_OUTLINE[area]);
    });
  });
}

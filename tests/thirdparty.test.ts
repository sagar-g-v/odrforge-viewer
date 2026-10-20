// OpenDRIVE files from other tools (release readiness: "reads any tool's files", not only OdrForge's). Each file is read
// and built as in the browser and must keep exactly the counts and reading problems measured on 2026-10-20: a change
// either way fails, so a regression (or a fix) is never silent. Skipped where the files are absent; they are not in the
// repo (licences differ): esmini samples (github.com/esmini/esmini resources/xodr, MPL-2.0) and CARLA's TownBig.xodr
// (github.com/carla-simulator/carla PythonAPI/util/opendrive, MIT), downloaded to ODRF_THIRDPARTY.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { evalGeom } from "../src/xodr/geometry";
import { parseOpenDrive } from "../src/xodr/parse";

const DIR = process.env.ODRF_THIRDPARTY ?? "C:/mywork/osm2carla/data/thirdparty_xodr";

// file -> OpenDRIVE version, roads, junctions, drawn junction outlines by kind, lanes drawn, reading problems
const EXPECT: Record<string, { rev: string; roads: number; junctions: number; outlines: Record<string, number>; lanes: number; issues: RegExp[] }> = {
  "esmini/crest-curve.xodr": { rev: "1.6", roads: 1, junctions: 0, outlines: {}, lanes: 4, issues: [] },
  "esmini/curves_elevation.xodr": { rev: "1.4", roads: 1, junctions: 0, outlines: {}, lanes: 6, issues: [] },
  "esmini/e6mini-lht.xodr": { rev: "1.5", roads: 1, junctions: 0, outlines: {}, lanes: 14, issues: [] },
  "esmini/e6mini.xodr": { rev: "1.4", roads: 1, junctions: 0, outlines: {}, lanes: 14, issues: [] },
  "esmini/fabriksgatan.xodr": { rev: "1.4", roads: 16, junctions: 1, outlines: { hull: 1 }, lanes: 44, issues: [] },
  "esmini/multi_intersections.xodr": { rev: "1.4", roads: 63, junctions: 5, outlines: { hull: 5 }, lanes: 242, issues: [] },
  "esmini/parking_demo.xodr": { rev: "1.7", roads: 7, junctions: 1, outlines: { hull: 1 }, lanes: 31, issues: [] },
  // OpenDRIVE 1.9 lane layers (§11.2): the permanent layer is drawn, the temporary (roadworks) one reported
  "esmini/roadworks_permanent_temporary_layers.xodr": { rev: "1.9", roads: 1, junctions: 0, outlines: {}, lanes: 70, issues: [/^road 1: its temporary lane layer/] },
  "esmini/soderleden.xodr": { rev: "1.7", roads: 5, junctions: 1, outlines: {}, lanes: 33, issues: [] }, // a direct junction: no outline
  "esmini/tunnels.xodr": { rev: "1.6", roads: 2, junctions: 0, outlines: {}, lanes: 13, issues: [] },
  "esmini/two_plus_one.xodr": { rev: "1.5", roads: 1, junctions: 0, outlines: {}, lanes: 17, issues: [] },
  "carla/TownBig.xodr": { rev: "1.4", roads: 1923, junctions: 192, outlines: { hull: 192 }, lanes: 5660, issues: [] },
};

for (const [file, want] of Object.entries(EXPECT)) {
  const path = `${DIR}/${file}`;
  describe.skipIf(!existsSync(path))(`third-party file: ${file}`, { timeout: 60000 }, () => {
    it("reads and draws with the measured counts and problems; finite positions; geometry pieces join", () => {
      const od = parseOpenDrive(readFileSync(path, "utf8")), r = buildRender(od, makeProjector(od.header.geoReference).forward);
      expect(`${od.header.revMajor}.${od.header.revMinor}`).toBe(want.rev);
      expect(od.roads.length).toBe(want.roads);
      expect(od.junctions.length).toBe(want.junctions);
      const outlines: Record<string, number> = {};
      for (const m of r.junctions.meta) outlines[m.outline] = (outlines[m.outline] ?? 0) + 1;
      expect(outlines).toEqual(want.outlines);
      expect(r.lanes.meta.length).toBe(want.lanes);
      expect(r.issues?.length).toBe(want.issues.length);
      want.issues.forEach((re, i) => expect(r.issues?.[i]).toMatch(re));
      for (const p of [r.lanes.positions, r.refs.positions, r.marks.positions, r.junctions.positions]) expect(p.every(Number.isFinite)).toBe(true);
      // each geometry element ends where the file starts the next (TownBig's own precision: 5 mm)
      let gap = 0;
      for (const road of od.roads) for (let i = 1; i < road.geoms.length; i++) {
        const e = evalGeom(road.geoms[i - 1], road.geoms[i - 1].length);
        gap = Math.max(gap, Math.hypot(e.x - road.geoms[i].x, e.y - road.geoms[i].y));
      }
      expect(gap).toBeLessThan(0.01);
    });
  });
}

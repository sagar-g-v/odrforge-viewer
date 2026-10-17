// OSM edges against the drawn network (src/review/osmEdges.ts): the geometry, and a per-area report on the converter's test
// areas (kerb lines vs drawn curb lanes, sidewalk ways vs drawn sidewalk lanes). The report prints with OSM_EDGES=1:
//   OSM_EDGES=1 npx vitest run tests/osmEdges.test.ts --silent=false
// No limits yet: the numbers are the baseline for the converter's OSM-geometry mode (2026-10-18); limits follow once a
// result is proven (docs/ACCURACY.md).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coveredShare, densify, edgeStats, headerClip, insideClip, midSamples, osmEdgeLines, osmKerbData, ParallelEdges, plainRoadEdges, PolygonDistance, sharedKerbStats, type ClipBox, type P2 } from "../src/review/osmEdges";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

describe("OSM edge geometry", () => {
  const square: P2[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
  const pd = new PolygonDistance([square]);
  it("inside a lane is 0; outside, the distance to its nearest edge; beyond 10 m unmatched", () => {
    expect(pd.distance([1, 1])).toBe(0);
    expect(pd.distance([2, 3])).toBeCloseTo(1, 9);
    expect(pd.distance([7, 6])).toBeCloseTo(5, 9);
    expect(pd.distance([30, 30])).toBe(Infinity);
  });
  it("samples a line every metre, ends included", () => {
    expect(densify([[0, 0], [3, 0]])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
  });
  it("reads barrier=kerb lines and footway=sidewalk ways from an .osm", () => {
    const osm = `<osm><node id="1" lat="48" lon="11"/><node id="2" lat="48.0001" lon="11"/><node id="3" lat="48.0002" lon="11"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><tag k="barrier" v="kerb"/></way>
      <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="footway"/><tag k="footway" v="sidewalk"/></way>
      <way id="12"><nd ref="1"/><nd ref="3"/><tag k="highway" v="residential"/></way></osm>`;
    const e = osmEdgeLines(osm);
    expect(e.kerbs).toEqual([[[11, 48], [11, 48.0001]]]);
    expect(e.sidewalks).toEqual([[[11, 48.0001], [11, 48.0002]]]);
  });
  it("shared kerb gap: roughly parallel edges only; signed by the edge's outward normal; island kerbs and < 1 m left out", () => {
    // a road along x: left edge at y = 3 (side +1), right edge at y = 0 (side -1); a crossing line at x = 5
    const edges = new ParallelEdges([{ line: [[0, 3], [10, 3]], side: 1 }, { line: [[0, 0], [10, 0]], side: -1 }, { line: [[5, 3.4], [5, 9]], side: 1 }]);
    const none = new PolygonDistance([]);
    expect(sharedKerbStats([[[2, 3.5], [4, 3.5]]], edges, none).medianSigned).toBeCloseTo(0.5, 9); // outside the left edge
    expect(sharedKerbStats([[[2, 2.5], [4, 2.5]]], edges, none).medianSigned).toBeCloseTo(-0.5, 9); // inside it
    expect(sharedKerbStats([[[2, -0.4], [4, -0.4]]], edges, none).medianSigned).toBeCloseTo(0.4, 9); // outside the right edge
    expect(Math.abs(sharedKerbStats([[[5.2, 4], [5.2, 8]]], edges, none).medianSigned)).toBeCloseTo(0.2, 9); // only the crossing line is parallel
    expect(sharedKerbStats([[[2, 3.5], [2.6, 3.5]]], edges, none)).toMatchObject({ samples: 0, dropped: 0 }); // shorter than 1 m
    const island = new PolygonDistance([[[1, 3.2], [5, 3.2], [5, 4], [1, 4]]]);
    expect(sharedKerbStats([[[2, 3.5], [4, 3.5]]], edges, island)).toMatchObject({ dropped: 1, samples: 0 });
  });
  it("reads the clip box an output records in its header", () => {
    expect(headerClip([{ code: "clip", value: "48.132,11.560,48.145,11.585" }])).toEqual([48.132, 11.56, 48.145, 11.585]);
    expect(headerClip([{ code: "clip", value: "48.1,11.5" }])).toBeNull();
    expect(headerClip([])).toBeNull();
  });
  it("samples at 0.5, 1.5 ... m, endpoints left out", () => {
    expect(midSamples([[0, 0], [3, 0]])).toEqual([[0.5, 0], [1.5, 0], [2.5, 0]]);
    expect(midSamples([[0, 0], [0.8, 0]])).toEqual([]);
  });
  it("the share of a polygon's area under covering polygons", () => {
    const lot: P2[] = [[0, 0], [10, 0], [10, 2], [0, 2], [0, 0]];
    expect(coveredShare(lot, new PolygonDistance([[[0, -1], [6, -1], [6, 3], [0, 3]]]))).toBeCloseTo(0.6, 2);
    expect(coveredShare(lot, new PolygonDistance([[[20, 0], [30, 0], [30, 2]]]))).toBe(0);
  });
  it("reads closed parking=street_side|lane|layby ways, open kerbs, islands and pedestrian areas", () => {
    const osm = `<osm><node id="1" lat="48" lon="11"/><node id="2" lat="48" lon="11.0001"/><node id="3" lat="48.0001" lon="11.0001"/>
      <way id="1"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/><tag k="amenity" v="parking"/><tag k="parking" v="street_side"/></way>
      <way id="2"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="parking" v="lane"/></way>
      <way id="3"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/><tag k="amenity" v="parking"/><tag k="parking" v="surface"/></way></osm>`;
    expect(osmKerbData(osm).parking.length).toBe(1);
  });
  it("summarises: matched samples' distances, unmatched counted apart", () => {
    const s = edgeStats([[[1, 1], [1, 5]], [[40, 40], [41, 40]]], pd);
    expect(s.samples).toBe(5 + 2);
    expect(s.matched).toBe(5);
    expect(s.inside).toBe(2); // y = 1, 2 (on the edge counts inside or at 0 distance)
  });
});

const OSM = process.env.ODRF_OSM ?? "C:/mywork/osm2carla/data/testareas";
const OUT = process.env.ODRF_TESTAREAS ?? "C:/mywork/osm2carla/build/testareas";
const WALK = new Set(["sidewalk", "walking"]);
// the converter's --clip boxes (OdrForge tools/inspect/gate.py: lat0, lon0, lat1, lon1): polygons wholly inside count
const CLIP: Record<string, ClipBox> = {
  munich: [48.132, 11.560, 48.145, 11.585], london: [51.505, -0.135, 51.517, -0.115], frankfurt_kreuz: [50.045, 8.585, 50.060, 8.615],
  stelvio: [46.515, 10.440, 46.535, 10.465], tokyo: [35.652, 139.690, 35.664, 139.708],
};

for (const area of ["london", "munich", "frankfurt_kreuz", "tokyo", "stelvio"]) {
  const osmFile = `${OSM}/${area}.osm`, xodr = `${OUT}/${area}_standard.xodr`;
  describe.skipIf(!existsSync(osmFile) || !existsSync(xodr))(`OSM edges vs the drawn network: ${area}`, { timeout: 120000 }, () => {
    it("measures kerb lines against curb lanes and sidewalk ways against sidewalk lanes", () => {
      const od = parseOpenDrive(readFileSync(xodr, "utf8")), proj = makeProjector(od.header.geoReference), r = buildRender(od, proj.forward);
      const toXY = (line: P2[]) => line.map(([lon, lat]) => proj.inverse(lon, lat) as P2);
      const polys = (types: Set<string>) => {
        const out: P2[][] = [];
        r.lanes.meta.forEach((m, k) => {
          if (!types.has(m.type)) return;
          const poly: P2[] = [];
          for (let v = r.lanes.starts[k]; v < r.lanes.starts[k + 1]; v++) poly.push(proj.inverse(r.lanes.positions[3 * v], r.lanes.positions[3 * v + 1]) as P2);
          out.push(poly);
        });
        return out;
      };
      const text = readFileSync(osmFile, "utf8"), e = osmEdgeLines(text), K = osmKerbData(text);
      const anyLane = new PolygonDistance(polys(new Set(r.lanes.meta.map((m) => m.type))));
      const areas = new PolygonDistance([...K.islands, ...K.pedestrian].map(toXY));
      const kerb = sharedKerbStats(K.kerbs.map(toXY), new ParallelEdges(plainRoadEdges(od)), areas);
      const walk = edgeStats(e.sidewalks.map(toXY), new PolygonDistance(polys(WALK)), anyLane);
      if (process.env.OSM_EDGES) {
        const pc = (a: number, b: number) => `${(100 * a / Math.max(1, b)).toFixed(1)} %`;
        const k = kerb.kerbs ? `kerbs (shared measure): ${kerb.kerbs} open kerb ways, ${kerb.dropped} of islands / pedestrian areas dropped; ${kerb.samples} samples, ${pc(kerb.matched, kerb.samples)} with a parallel plain-road edge within 10 m: median ${kerb.medianSigned.toFixed(2)} m (+ road too narrow), |p95| ${kerb.p95abs.toFixed(2)} m, ${pc(kerb.within03, kerb.matched)} within 0.3 m, ${pc(kerb.within05, kerb.matched)} within 0.5 m` : "kerbs: none in OSM";
        const w = walk.samples ? `sidewalk ways: ${walk.samples} samples, ${pc(walk.nearNetwork, walk.samples)} near the network; vs drawn sidewalk lanes ${pc(walk.matched, walk.nearNetwork)} matched, inside ${pc(walk.inside, walk.matched)}, median ${walk.median.toFixed(2)} m, p95 ${walk.p95.toFixed(2)} m` : "sidewalk ways: none in OSM";
        const clip = headerClip(od.header.userData) ?? CLIP[area]; // the file's own record first, gate.py's box otherwise
        const lots = K.parking.filter((l) => insideClip(l, clip)).map(toXY), parkCover = new PolygonDistance(polys(new Set(["parking"])));
        const shares = lots.map((l) => coveredShare(l, parkCover)), mean = shares.reduce((a, b) => a + b, 0) / Math.max(1, shares.length);
        const pk = lots.length ? `street-side parking (street_side|lane|layby, wholly inside the clip): ${shares.filter((v) => v >= 0.8).length}/${lots.length} at least 80 % under drawn parking lanes, mean share ${mean.toFixed(2)}` : "street-side parking: none inside the clip";
        console.log(`OSM-EDGES ${area} | ${k} | ${w} | ${pk}`);
      }
      expect(kerb.dropped).toBeLessThanOrEqual(kerb.kerbs);
    });
  });
}

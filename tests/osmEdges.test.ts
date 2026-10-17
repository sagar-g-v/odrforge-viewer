// OSM edges against the drawn network (src/review/osmEdges.ts): the geometry, and a per-area report on the converter's test
// areas (kerb lines vs drawn curb lanes, sidewalk ways vs drawn sidewalk lanes). The report prints with OSM_EDGES=1:
//   OSM_EDGES=1 npx vitest run tests/osmEdges.test.ts --silent=false
// No limits yet: the numbers are the baseline for the converter's OSM-geometry mode (2026-10-18); limits follow once a
// result is proven (docs/ACCURACY.md).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { carriagewayEdges, coveredShare, densify, edgeStats, kerbStats, LineDistance, osmEdgeLines, osmStreetParking, PolygonDistance, type P2 } from "../src/review/osmEdges";
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
  it("kerb against the carriageway edge: + outside (drawn too narrow), - inside (drawn too wide)", () => {
    const road = new PolygonDistance([[[0, 0], [10, 0], [10, 3], [0, 3]]]), edge = new LineDistance([[[0, 3], [10, 3]]]);
    const out = kerbStats([[[2, 3.5], [3, 3.5]]], edge, road, road), inn = kerbStats([[[2, 2.5], [3, 2.5]]], edge, road, road);
    expect(out.medianSigned).toBeCloseTo(0.5, 9);
    expect(inn.medianSigned).toBeCloseTo(-0.5, 9);
    expect(out.nearNetwork).toBe(2);
  });
  it("the share of a polygon's area under covering polygons", () => {
    const lot: P2[] = [[0, 0], [10, 0], [10, 2], [0, 2], [0, 0]];
    expect(coveredShare(lot, new PolygonDistance([[[0, -1], [6, -1], [6, 3], [0, 3]]]))).toBeCloseTo(0.6, 2);
    expect(coveredShare(lot, new PolygonDistance([[[20, 0], [30, 0], [30, 2]]]))).toBe(0);
  });
  it("reads closed parking=street_side|lane ways only", () => {
    const osm = `<osm><node id="1" lat="48" lon="11"/><node id="2" lat="48" lon="11.0001"/><node id="3" lat="48.0001" lon="11.0001"/>
      <way id="1"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/><tag k="amenity" v="parking"/><tag k="parking" v="street_side"/></way>
      <way id="2"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="parking" v="lane"/></way>
      <way id="3"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/><tag k="amenity" v="parking"/><tag k="parking" v="surface"/></way></osm>`;
    expect(osmStreetParking(osm).length).toBe(1);
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
const KERB = new Set(["curb"]), WALK = new Set(["sidewalk", "walking"]);

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
      const e = osmEdgeLines(readFileSync(osmFile, "utf8"));
      const anyLane = new PolygonDistance(polys(new Set(r.lanes.meta.map((m) => m.type))));
      const carriage = new PolygonDistance(polys(new Set(r.lanes.meta.map((m) => m.type).filter((t) => !["sidewalk", "walking", "curb", "border", "none", "median", "restricted"].includes(t)))));
      const kerb = kerbStats(e.kerbs.map(toXY), new LineDistance(carriagewayEdges(od)), carriage, anyLane);
      const curb = edgeStats(e.kerbs.map(toXY), new PolygonDistance(polys(KERB)), anyLane);
      const walk = edgeStats(e.sidewalks.map(toXY), new PolygonDistance(polys(WALK)), anyLane);
      if (process.env.OSM_EDGES) {
        const pc = (a: number, b: number) => `${(100 * a / Math.max(1, b)).toFixed(1)} %`;
        const k = kerb.samples ? `kerb lines: ${kerb.samples} samples, ${pc(kerb.nearNetwork, kerb.samples)} near the network; vs the carriageway edge: ${pc(kerb.matched, kerb.nearNetwork)} matched, median ${kerb.medianSigned.toFixed(2)} m (+ road too narrow), |p95| ${kerb.p95abs.toFixed(2)} m, ${pc(kerb.within05, kerb.matched)} within 0.5 m, ${pc(kerb.overrun, kerb.matched)} overrun > 0.5 m; on a drawn curb lane ${pc(curb.matched, curb.nearNetwork)} (inside ${pc(curb.inside, curb.matched)})` : "kerb lines: none in OSM";
        const w = walk.samples ? `sidewalk ways: ${walk.samples} samples, ${pc(walk.nearNetwork, walk.samples)} near the network; vs drawn sidewalk lanes ${pc(walk.matched, walk.nearNetwork)} matched, inside ${pc(walk.inside, walk.matched)}, median ${walk.median.toFixed(2)} m, p95 ${walk.p95.toFixed(2)} m` : "sidewalk ways: none in OSM";
        const lots = osmStreetParking(readFileSync(osmFile, "utf8")).map(toXY), parkCover = new PolygonDistance(polys(new Set(["parking"])));
        const shares = lots.map((l) => coveredShare(l, parkCover));
        const pk = lots.length ? `street-side parking polygons: ${shares.filter((v) => v >= 0.8).length}/${lots.length} at least 80 % under drawn parking lanes (median share ${(100 * ([...shares].sort((a, b) => a - b)[shares.length >> 1])).toFixed(0)} %)` : "street-side parking polygons: none in OSM";
        console.log(`OSM-EDGES ${area} | ${k} | ${w} | ${pk}`);
      }
      expect(kerb.samples).toBe(curb.samples);
    });
  });
}

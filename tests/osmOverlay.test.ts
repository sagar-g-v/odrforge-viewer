// The OSM reference overlay (src/review/osmOverlay.ts): which OSM ways it draws as which kind, how it projects them
// through the open network's projector, the layer data (paths, kerb-gap samples, heights), the hover text, and that its
// kerb gaps are the shared kerb measure's (osmEdges.ts sharedKerbStats) sample for sample on a real test area.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OSM_REF } from "../src/design/scene";
import { hoverText } from "../src/map/hoverInfo";
import { osmKerbData, ParallelEdges, plainRoadEdges, PolygonDistance, sharedKerbStats, type P2 } from "../src/review/osmEdges";
import { buildOsmOverlay, gapColor, gapRadius, gapSummary, osmElements, osmHoverText, PATH_STEP_M, withHeights } from "../src/review/osmOverlay";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

// a straight road along x, 40 m: one 3.5 m driving lane each side, so its carriageway edges are y = +3.5 and y = -3.5
const XODR = `<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="8"><geoReference><![CDATA[+proj=tmerc +lat_0=51.5 +lon_0=-0.12 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m]]></geoReference></header>
<road id="7" length="40" junction="-1"><planView><geometry s="0" x="0" y="0" hdg="0" length="40"><line/></geometry></planView>
<lanes><laneSection s="0"><left><lane id="1" type="driving"><width sOffset="0" a="3.5" b="0" c="0" d="0"/></lane></left><center><lane id="0" type="none"/></center>
<right><lane id="-1" type="driving"><width sOffset="0" a="3.5" b="0" c="0" d="0"/></lane></right></laneSection></lanes></road></OpenDRIVE>`;
const od = parseOpenDrive(XODR), proj = makeProjector(od.header.geoReference);

// an .osm whose nodes are file points (x, y) of this network, written as lon / lat through its projector
function osm(nodes: Record<string, P2>, ways: string): string {
  const n = Object.entries(nodes).map(([id, [x, y]]) => { const [lon, lat] = proj.forward(x, y); return `<node id="${id}" lat="${lat.toFixed(12)}" lon="${lon.toFixed(12)}"/>`; });
  return `<osm>${n.join("")}${ways}</osm>`;
}
const NODES: Record<string, P2> = {
  1: [5, 4], 2: [25, 4], //       kerb 0.5 m outside the left edge (road too narrow)
  3: [5, -3.4], 4: [25, -3.4], // kerb 0.1 m inside the right edge: fits
  5: [5, 7], 6: [25, 7], //       sidewalk
  10: [30, 1], 11: [34, 1], 12: [34, 2], 13: [30, 2], // a traffic island in the road
  14: [30.5, 1.5], 15: [33.5, 1.5], //                     its kerb
  20: [0, -6], 21: [20, -6], 22: [20, -4], 23: [0, -4], // street-side parking
};
const OSM = osm(NODES, `
  <way id="101"><nd ref="1"/><nd ref="2"/><tag k="barrier" v="kerb"/><tag k="kerb" v="raised"/></way>
  <way id="102"><nd ref="3"/><nd ref="4"/><tag k="barrier" v="kerb"/></way>
  <way id="103"><nd ref="5"/><nd ref="6"/><tag k="highway" v="footway"/><tag k="footway" v="sidewalk"/></way>
  <way id="104"><nd ref="10"/><nd ref="11"/><nd ref="12"/><nd ref="13"/><nd ref="10"/><tag k="area:highway" v="traffic_island"/></way>
  <way id="105"><nd ref="14"/><nd ref="15"/><tag k="barrier" v="kerb"/></way>
  <way id="106"><nd ref="20"/><nd ref="21"/><nd ref="22"/><nd ref="23"/><nd ref="20"/><tag k="amenity" v="parking"/><tag k="parking" v="street_side"/></way>
  <way id="107"><nd ref="1"/><nd ref="2"/><nd ref="4"/><nd ref="3"/><nd ref="1"/><tag k="area:highway" v="primary"/></way>
  <way id="108"><nd ref="1"/><nd ref="2"/><nd ref="99"/><nd ref="1"/><tag k="area:highway" v="primary"/></way>
  <way id="109"><nd ref="5"/><nd ref="6"/><tag k="highway" v="residential"/></way>
  <way id="110"><nd ref="1"/><nd ref="2"/><nd ref="6"/><nd ref="5"/><nd ref="1"/><tag k="barrier" v="kerb"/></way>`);

describe("OSM reference: which ways, as which kind", () => {
  const els = osmElements(OSM), kind = (id: string) => els.find((e) => e.id === id)?.kind;
  it("kerbs and sidewalks are lines; parking, islands and area:highway are areas; other ways are not drawn", () => {
    expect(kind("101")).toBe("kerb"); expect(kind("102")).toBe("kerb"); expect(kind("105")).toBe("kerb");
    expect(kind("103")).toBe("sidewalk"); expect(kind("104")).toBe("island"); expect(kind("106")).toBe("parking"); expect(kind("107")).toBe("area");
    expect(kind("109")).toBeUndefined();
    expect(kind("108")).toBeUndefined(); // an area with a node the file lacks: not drawn
    expect(kind("110")).toBe("kerb"); // a closed kerb ring is still a kerb line (the measure leaves it out)
  });
  it("keeps every tag for the hover tooltip", () => {
    expect(els.find((e) => e.id === "101")?.tags).toEqual([["barrier", "kerb"], ["kerb", "raised"]]);
  });
  it("its kerbs and islands are the shared measure's (osmKerbData), so both measure the same ways", () => {
    const K = osmKerbData(OSM), open = els.filter((e) => e.kind === "kerb" && !e.closed && e.complete);
    expect(open.map((e) => e.line)).toEqual(K.kerbs);
    expect(els.filter((e) => e.kind === "island").map((e) => e.line)).toEqual([...K.islands, ...K.pedestrian]);
    expect(els.filter((e) => e.kind === "parking").map((e) => e.line)).toEqual(K.parking);
  });
});

describe("OSM reference: projection and layer data", () => {
  const els = osmElements(OSM), o = buildOsmOverlay(els, proj, od)!;
  const xyOf = (pos: Float64Array, v: number) => proj.inverse(pos[3 * v], pos[3 * v + 1]);
  it("places nothing on a network without a geoReference (it would sit at 0° / 0°, OSM elsewhere)", () => {
    expect(buildOsmOverlay(els, makeProjector(""), od)).toBeNull();
  });
  it("lines and areas through the network's projector: back in file metres they are the OSM nodes, vertices ≤ 5 m apart", () => {
    const L = o.lines, k = L.meta.indexOf(els.findIndex((e) => e.id === "101"));
    expect(L.starts.length).toBe(L.meta.length + 1);
    expect(L.starts[L.meta.length]).toBe(L.positions.length / 3);
    const a = L.starts[k], b = L.starts[k + 1];
    // 20 m at most 5 m apart, ends included: 5 vertices (6 when the projection round trip leaves it a hair over 20 m)
    expect(b - a).toBeGreaterThanOrEqual(1 + 20 / PATH_STEP_M); expect(b - a).toBeLessThanOrEqual(2 + 20 / PATH_STEP_M);
    const first = xyOf(L.positions, a), last = xyOf(L.positions, b - 1);
    expect(first[0]).toBeCloseTo(5, 6); expect(first[1]).toBeCloseTo(4, 6);
    expect(last[0]).toBeCloseTo(25, 6); expect(last[1]).toBeCloseTo(4, 6);
    for (let v = a + 1; v < b; v++) { const p = xyOf(L.positions, v - 1), q = xyOf(L.positions, v); expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeLessThanOrEqual(PATH_STEP_M + 1e-6); }
    for (let v = 0; v < L.positions.length / 3; v++) expect(L.positions[3 * v + 2]).toBe(0); // heights come from the map (withHeights)
    expect(o.lines.meta.map((i) => els[i].kind).every((k2) => k2 === "kerb" || k2 === "sidewalk")).toBe(true);
    expect(o.areas.meta.map((i) => els[i].kind).sort()).toEqual(["area", "island", "parking"]);
    expect(o.counts).toEqual({ kerb: 4, sidewalk: 1, parking: 1, island: 1, area: 1 });
  });
  it("kerb gaps: the signed distance to the parallel carriageway edge per 1 m sample, + outside, - inside", () => {
    const G = o.gaps!, of = (id: string) => [...G.gap].filter((_, s) => els[G.meta[s]].id === id);
    expect(of("101").length).toBe(20); // 0.5, 1.5 ... 19.5 m along a 20 m kerb
    for (const g of of("101")) expect(g).toBeCloseTo(0.5, 6);
    for (const g of of("102")) expect(g).toBeCloseTo(-0.1, 6);
    const s = xyOf(G.positions, G.meta.indexOf(els.findIndex((e) => e.id === "101")));
    expect(s[0]).toBeCloseTo(5.5, 6); expect(s[1]).toBeCloseTo(4, 6); // the first mid-sample, 0.5 m in
    expect(gapSummary(G)).toMatchObject({ samples: 40, matched: 40, fit: 20 });
  });
  it("the kerbs the measure leaves out are not sampled, and say why", () => {
    const note = (id: string) => o.notes.get(els.findIndex((e) => e.id === id));
    expect(note("105")).toBe("area"); // bounds the traffic island
    expect(note("110")).toBe("closed");
    expect(note("101")).toBeUndefined();
    expect(buildOsmOverlay(els, proj, null)!.gaps).toBeNull(); // an OdrForge page export: no OpenDRIVE to measure against
  });
  it("dot colour and size: the kerb hue where it fits (≤ 0.3 m), the side it misses on otherwise, larger beyond 1 m", () => {
    expect(gapColor(0.2)).toEqual(OSM_REF.kerb); expect(gapColor(-0.3)).toEqual(OSM_REF.kerb);
    expect(gapColor(0.5)).toEqual(OSM_REF.gapOutside); expect(gapColor(-0.5)).toEqual(OSM_REF.gapInside);
    expect(gapRadius(1.5)).toBeGreaterThan(gapRadius(0.5));
  });
  it("heights: each vertex at the height the map gives for its place, positions untouched", () => {
    const z = withHeights(o.lines.positions, (lon) => lon * 1000);
    for (let v = 0; v < z.length / 3; v++) {
      expect(z[3 * v]).toBe(o.lines.positions[3 * v]);
      expect(z[3 * v + 2]).toBeCloseTo(o.lines.positions[3 * v] * 1000, 9);
    }
  });
  it("hover names the OSM way (id and tags), the reason a kerb is not measured, and a sample's gap", () => {
    const r = buildRender(od, proj.forward), line = (id: string) => o.lines.meta.indexOf(els.findIndex((e) => e.id === id));
    expect(hoverText("osm-lines", line("101"), r, { osm: o })).toBe("OSM way 101 · barrier=kerb · kerb=raised");
    expect(osmHoverText(o, "osm-lines", line("105"))).toBe("OSM way 105 · barrier=kerb (bounds an island or pedestrian area: not measured)");
    expect(osmHoverText(o, "osm-areas", o.areas.meta.indexOf(els.findIndex((e) => e.id === "106")))).toBe("OSM way 106 · amenity=parking · parking=street_side");
    expect(osmHoverText(o, "osm-kerb-gap", 0)).toBe("kerb gap +0.50 m: outside the drawn carriageway edge (road too narrow) · OSM way 101");
    expect(hoverText("osm-lines", 0, r)).toBeNull(); // no overlay: nothing
  });
});

// the overlay's gaps are the shared kerb measure's on a converter test area (skipped without the data)
const OSM_FILE = `${process.env.ODRF_OSM ?? "C:/mywork/osm2carla/data/testareas"}/london.osm`;
const XODR_FILE = `${process.env.ODRF_TESTAREAS ?? "C:/mywork/osm2carla/build/testareas"}/london_standard.xodr`;
describe.skipIf(!existsSync(OSM_FILE) || !existsSync(XODR_FILE))("OSM reference on London: the shared kerb measure, sample for sample", { timeout: 120000 }, () => {
  it("same kerbs, samples, matches and median as sharedKerbStats", () => {
    const text = readFileSync(OSM_FILE, "utf8"), rod = parseOpenDrive(readFileSync(XODR_FILE, "utf8")), rp = makeProjector(rod.header.geoReference);
    const o = buildOsmOverlay(osmElements(text), rp, rod)!, K = osmKerbData(text);
    const toXY = (line: P2[]) => line.map(([lon, lat]) => rp.inverse(lon, lat) as P2);
    const ref = sharedKerbStats(K.kerbs.map(toXY), new ParallelEdges(plainRoadEdges(rod)), new PolygonDistance([...K.islands, ...K.pedestrian].map(toXY)));
    const g = gapSummary(o.gaps!);
    expect(g.samples).toBe(ref.samples);
    expect(g.matched).toBe(ref.matched);
    expect(g.medianSigned).toBe(ref.medianSigned);
    expect(g.fit).toBe(ref.within03);
    expect([...o.notes.values()].filter((n) => n === "area").length).toBe(ref.dropped);
  });
});

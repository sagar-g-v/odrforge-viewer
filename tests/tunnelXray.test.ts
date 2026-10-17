// Tunnel roads seen through the terrain: only lanes of roads with a <tunnel>, only their parts under the ground, and the
// lane's own vertices unchanged (a rendering choice; docs/ACCURACY.md).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DRAW_ORDER } from "../src/map/drawOrder";
import { undergroundRuns } from "../src/map/tunnelXray";

// two lanes as closed outlines (lon, lat, z): lane 0 on road 7 (a tunnel road), lane 1 on road 8 (no tunnel)
const P = [
  // lane 0: 6 vertices; z: 10, -5, -5, 10, 10, -5  (buried: 1-2, and 5 joined across the loop start? no: vertex 0 is above)
  0, 0, 10, 1, 0, -5, 2, 0, -5, 2, 1, 10, 1, 1, 10, 0, 1, -5,
  // lane 1: 4 vertices, all buried, but its road has no tunnel
  5, 5, -9, 6, 5, -9, 6, 6, -9, 5, 6, -9,
];
const L = { positions: Float64Array.from(P), starts: Uint32Array.from([0, 6, 10]), meta: [{ road: 7 }, { road: 8 }] };
const ground0 = (_lon: number, _lat: number, z: number) => z < 0; // the ground at 0

describe("tunnel x-ray", () => {
  it("only lanes of tunnel roads, only their runs under the ground (at least two vertices)", () => {
    const runs = undergroundRuns(L, new Set([7]), ground0);
    expect(runs.map((r) => r.lane)).toEqual([0]);
    expect(runs[0].path).toEqual([[1, 0, -5], [2, 0, -5]]); // vertex 5 alone (vertex 0 is above) is not a path
  });
  it("a run across the loop's start is one path", () => {
    const Q = Float64Array.from([0, 0, -1, 1, 0, 5, 2, 0, 5, 3, 0, -1]); // buried: 3 then 0
    const runs = undergroundRuns({ positions: Q, starts: Uint32Array.from([0, 4]), meta: [{ road: 1 }] }, new Set([1]), ground0);
    expect(runs).toEqual([{ lane: 0, path: [[3, 0, -1], [0, 0, -1]] }]);
  });
  it("a wholly buried tunnel lane is its full closed outline", () => {
    const runs = undergroundRuns(L, new Set([8]), ground0);
    expect(runs).toEqual([{ lane: 1, path: [[5, 5, -9], [6, 5, -9], [6, 6, -9], [5, 6, -9], [5, 5, -9]] }]);
  });
  it("never moves a vertex: every path point is one of the lane's own vertices, bit for bit", () => {
    const own = new Set<string>();
    for (let v = 0; v < P.length / 3; v++) own.add(`${P[3 * v]},${P[3 * v + 1]},${P[3 * v + 2]}`);
    for (const r of undergroundRuns(L, new Set([7, 8]), ground0)) for (const q of r.path) expect(own.has(q.join(","))).toBe(true);
  });
  it("nothing for roads without a tunnel, or when nothing is under the ground", () => {
    expect(undergroundRuns(L, new Set(), ground0)).toEqual([]);
    expect(undergroundRuns(L, new Set([7, 8]), () => false)).toEqual([]);
  });
  it("the map draws it through everything, at the lanes' height transform, and picks it as the lane", () => {
    const src = readFileSync("src/map/MapView.tsx", "utf8");
    const layer = src.slice(src.indexOf('id: "tunnel-xray"'), src.indexOf('id: "tunnel-xray"') + 500);
    expect(layer).toMatch(/modelMatrix/);
    expect(layer).toMatch(/depthCompare: "always"/);
    // a click on the OSM reference goes to what lies under it first (throughOsm), then x-ray picks become their lane
    expect(src).toMatch(/onClick: \(info, event\) => propsRef\.current\.onPick\(asLanePick\(throughOsm\(ov, info, layersRef\.current\)\)/);
    expect(DRAW_ORDER["tunnel-xray"]).toBeDefined();
  });
});

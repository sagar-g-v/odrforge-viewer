// The road wins over the terrain (src/map/roadFloor.ts, docs/ACCURACY.md §4): the drawn ground under every lane is at
// most the lane's height minus FLOOR.epsilon, the ground away from the lanes is unchanged, and tunnels are left alone.
import { describe, expect, it } from "vitest";
import { buildRoadFloor, FLOOR, floorAt, floorRadius, type P2 } from "../src/map/roadFloor";

// one lane ring along x from 0 to 40 m, y from 0 to 3.5 m, rising 0.1 m per metre (10 %), as build.ts writes it:
// inner border forward, outer border back. Coordinates stand for lon / lat (toXY is the identity)
function ring(x0 = 0, x1 = 40, w = 3.5, z0 = 100, grade = 0.1) {
  const inner: number[][] = [], outer: number[][] = [];
  for (let x = x0; x <= x1 + 1e-9; x += 2) { inner.push([x, 0, z0 + grade * (x - x0)]); outer.push([x, w, z0 + grade * (x - x0)]); }
  const pts = [...inner, ...outer.reverse()];
  return { positions: Float64Array.from(pts.flat()), starts: [0, pts.length], meta: [{ road: 0 }] };
}
const id = (x: number, y: number): P2 => [x, y];

describe("the road floor", () => {
  const lane = ring(), f = buildRoadFloor(lane, id)!;
  it("caps the ground under a lane at most epsilon under the lane, at every point of it", () => {
    for (let x = 0; x <= 40; x += 0.37)
      for (let y = 0; y <= 3.5; y += 0.29) expect(floorAt(f, x, y, 0)).toBeLessThanOrEqual(100 + 0.1 * x - FLOOR.epsilon + 1e-4);
  });
  it("is not much lower than the road under it (a lower bound over one cell)", () => {
    for (let x = 1; x <= 39; x += 1.3) expect(floorAt(f, x, 1.7, 0)).toBeGreaterThan(100 + 0.1 * x - FLOOR.epsilon - 0.2);
  });
  it("covers the drawn ground: within the floor radius of a lane point the cap is under that point", () => {
    // a DEM pixel of 0.8 m (z17 at 48 deg): ground pixels up to 1.5 * 0.8 m from a lane point along each axis (diagonals
    // included) are capped under it
    const r = floorRadius(0.8);
    for (let x = 0; x <= 40; x += 1.1)
      for (const [dx, dy] of [[r * 0.99, 0], [0, -r * 0.99], [-0.99 * r, 0.99 * r], [0.99 * r, -0.99 * r]]) expect(floorAt(f, x + dx, 0 + dy, r)).toBeLessThanOrEqual(100 + 0.1 * x - FLOOR.epsilon + 1e-4);
  });
  it("rises at FLOOR.slope away from the lane: ground further off than its height above the road is unchanged", () => {
    expect(floorAt(f, 20, 3.5 + 10, 0)).toBeGreaterThan(102 - FLOOR.epsilon + (10 - FLOOR.cell) * FLOOR.slope - 1e-4); // within a cell of the true cut
    expect(floorAt(f, 20, 3.5 + 10, 0)).toBeLessThan(102 + 10 * FLOOR.slope * 1.09 + 1); // the chamfer cone: within 8 % + a cell
    expect(floorAt(f, 20, 200, 0)).toBe(Infinity); // off the lattice
  });
  it("leaves the ground alone over a tunnel road inside its tunnel's footprint, not under other roads there", () => {
    const tunnel = new Map([[0, [[[10, -1], [30, -1], [30, 5], [10, 5]] as P2[]]]]), t = buildRoadFloor(lane, id, { exclude: tunnel })!;
    expect(floorAt(t, 20, 1.7, 0)).toBeGreaterThan(100 + 0.1 * 20 + 3); // only the cone from the open parts (>= 4 m away)
    expect(floorAt(t, 5, 1.7, 0)).toBeLessThanOrEqual(100.5 - FLOOR.epsilon + 1e-4);
    // a road over the tunnel (another road index) still presses the ground under it
    const over = ring(0, 40, 3.5, 103, 0), both = { positions: Float64Array.from([...lane.positions, ...over.positions]), starts: [0, lane.starts[1], 2 * lane.starts[1]], meta: [{ road: 0 }, { road: 1 }] };
    expect(floorAt(buildRoadFloor(both, id, { exclude: tunnel })!, 20, 1.7, 0)).toBeLessThanOrEqual(103 - FLOOR.epsilon + 1e-4);
  });
  it("takes the lowest of overlapping lanes (a junction)", () => {
    const a = ring(0, 40, 3.5, 100, 0), b = ring(0, 40, 3.5, 99, 0);
    const both = { positions: Float64Array.from([...a.positions, ...b.positions]), starts: [0, a.starts[1], a.starts[1] + b.starts[1]], meta: [{ road: 0 }, { road: 1 }] };
    expect(floorAt(buildRoadFloor(both, id)!, 20, 1.7, 0)).toBeLessThanOrEqual(99 - FLOOR.epsilon + 1e-4);
  });
  it("catches a lane thinner than a cell (a curb)", () => {
    const curb = ring(0, 40, 0.15, 100, 0), c = buildRoadFloor(curb, id)!;
    for (let x = 0; x <= 40; x += 0.5) expect(floorAt(c, x, 0.07, 0)).toBeLessThanOrEqual(100 - FLOOR.epsilon + 1e-4);
  });
  it("presses the ground under a junction surface the file defines, triangulated as drawn; not under a viewer hull", () => {
    // a junction area 20 x 20 m beside the lane, sloping from 100 m (west) to 102 m (east), outline only (no lanes inside)
    const ring = [[50, 0, 100], [70, 0, 102], [70, 20, 102], [50, 20, 100]];
    const areas = (exact: boolean) => ({ positions: Float64Array.from(ring.flat()), starts: [0, 4], meta: [{ exact }] });
    const j = buildRoadFloor(lane, id, { areas: areas(true) })!;
    for (let x = 50; x <= 70; x += 0.9) for (let y = 0; y <= 20; y += 1.3) expect(floorAt(j, x, y, 0)).toBeLessThanOrEqual(100 + 0.1 * (x - 50) - FLOOR.epsilon + 1e-4);
    expect(floorAt(j, 60, 10, 0)).toBeGreaterThan(101 - FLOOR.epsilon - 0.2); // not much lower than the surface
    expect(floorAt(buildRoadFloor(lane, id, { areas: areas(false) })!, 60, 10, 0)).toBeGreaterThan(110); // a hull: only the lane's cut, 10+ m off
  });
  it("no lanes, no floor", () => {
    expect(buildRoadFloor({ positions: new Float64Array(0), starts: [0], meta: [] }, id)).toBeNull();
  });
});

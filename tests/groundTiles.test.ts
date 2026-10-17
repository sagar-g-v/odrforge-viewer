// Guards docs/ACCURACY.md §4: terrain tiles carry the ground grid's heights at their pixel centres, pressed under the
// roads (the road wins), and the viewer tries the road-conformed grid first.
import { describe, expect, it } from "vitest";
import { activeGrid, groundTileFromBase } from "../src/map/groundTiles";
import { groundGridFiles, sampleGrid, type GroundGrid } from "../src/map/odrz";
import { buildRoadFloor, FLOOR } from "../src/map/roadFloor";
import { makeProjector } from "../src/xodr/geo";

const proj = makeProjector("+proj=tmerc +lat_0=46.53 +lon_0=10.45 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m");
// a 400 m x 400 m grid of 1 m cells over a sloping plane: z = 2500 + 0.03 x - 0.12 y
const n = 401, z = new Float32Array(n * n);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = 2500 + 0.03 * (i - 200) - 0.12 * (j - 200);
const grid: GroundGrid = { originX: -200, originY: -200, cell: 1, nx: n, ny: n, levels: 1, datum: "EGM2008", z };

function tileOf(lon: number, lat: number, zoom: number) {
  const k = 2 ** zoom, s = Math.sin((lat * Math.PI) / 180);
  return [Math.floor(((lon + 180) / 360) * k), Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * k)];
}
const pixelCentre = (zoom: number, x: number, y: number, i: number, j: number): [number, number] => {
  const k = 2 ** zoom, u = (x + (i + 0.5) / 256) / k, v = (y + (j + 0.5) / 256) / k;
  return [u * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI];
};

describe("terrain tiles from the network's ground grid", () => {
  it("every pixel inside the grid holds the grid's height at the pixel centre (within 1 cm)", () => {
    const zoom = 17, [x, y] = tileOf(10.45, 46.53, zoom), base = new Float32Array(256 * 256).fill(-999);
    const h = groundTileFromBase(zoom, x, y, activeGrid(grid, proj), base);
    let worst = 0, n2 = 0;
    for (let j = 0; j < 256; j += 5) for (let i = 0; i < 256; i += 5) {
      const [lon, lat] = pixelCentre(zoom, x, y, i, j), [fx, fy] = proj.inverse(lon, lat);
      if (Math.abs(fx) > 160 || Math.abs(fy) > 160) continue; // well inside (the edge blend is 30 m)
      worst = Math.max(worst, Math.abs(h[j * 256 + i] - sampleGrid(grid, fx, fy))); n2++;
    }
    expect(n2).toBeGreaterThan(100);
    expect(worst).toBeLessThan(0.01);
  });
  it("outside the grid the tile keeps the open DEM's heights", () => {
    const zoom = 15, [x, y] = tileOf(10.40, 46.53, zoom), base = new Float32Array(256 * 256).fill(1234);
    expect([...new Set(groundTileFromBase(zoom, x, y, activeGrid(grid, proj), base))]).toEqual([1234]);
  });
  it("the road wins: the drawn terrain mesh is under every lane point; far off it is the grid", () => {
    // a lane 10 m below the ground in a cutting: x -100 .. 100 m, y y0 - 2 .. y0 + 2 m, flat at 2490 m (the grid is ~2500 m
    // there), shifted by fractions of a pixel so its edges fall at every place within the pixel rows
    for (const y0 of [0, 0.13, 0.29, 0.47, 0.61, 0.86]) {
      const inner: number[][] = [], outer: number[][] = [];
      for (let fx = -100; fx <= 100; fx += 2) { inner.push([...proj.forward(fx, y0 - 2), 2490]); outer.push([...proj.forward(fx, y0 + 2), 2490]); }
      const pts = [...inner, ...outer.reverse()];
      // a fine lattice (0.25 m): the cap then reaches little beyond floorRadius, so a radius too short shows
      const floor = buildRoadFloor({ positions: Float64Array.from(pts.flat()), starts: [0, pts.length], meta: [{ road: 0 }] },
        (lon, lat) => proj.inverse(lon, lat) as [number, number], {}, { ...FLOOR, cell: 0.25 })!;
      for (const zoom of [17, 15]) { // z15: 3.3 m pixels, the pixels under the lane reach well beyond it
        const [x, y] = tileOf(10.45, 46.53, zoom), base = new Float32Array(256 * 256).fill(-999);
        const h = groundTileFromBase(zoom, x, y, activeGrid(grid, proj, floor), base);
        // the tile's pixel centres in file coordinates, to find the pixels around a lane point
        const at = (i: number, j: number) => proj.inverse(...pixelCentre(zoom, x, y, i, j));
        const [ax, ay] = at(0, 0), [bx] = at(1, 0), [, cy] = at(0, 1), dx = bx - ax, dy = cy - ay; // pixel steps (dy < 0: rows go south)
        // MapLibre draws a mesh with one cell per DEM pixel, its vertices on pixel corners, each the DEM sampled bilinearly
        // there (the mean of the 4 pixels around it); a point on the mesh is at most its cell's highest vertex
        const corner = (a: number, b: number) => (h[(b - 1) * 256 + a - 1] + h[(b - 1) * 256 + a] + h[b * 256 + a - 1] + h[b * 256 + a]) / 4;
        let checked = 0;
        for (let fx = -60; fx <= 60; fx += 0.7) for (let fy = y0 - 2; fy <= y0 + 2 + 1e-9; fy += 0.25) {
          const u = (fx - ax) / dx, v = (fy - ay) / dy, a0 = Math.floor(u + 0.5), b0 = Math.floor(v + 0.5); // corners a0, a0 + 1 at u = a0 - 0.5, a0 + 0.5
          if (a0 < 1 || b0 < 1 || a0 > 254 || b0 > 254) continue;
          const g = Math.max(corner(a0, b0), corner(a0 + 1, b0), corner(a0, b0 + 1), corner(a0 + 1, b0 + 1));
          expect(g).toBeLessThanOrEqual(2490 - FLOOR.epsilon + 0.01); // Terrarium steps are 1/256 m
          checked++;
        }
        expect(checked).toBeGreaterThan(zoom === 17 ? 1000 : 100);
        if (y0 !== 0) continue;
        // 30 m off the lane the cut (from 2490 m, ~10 m deep) is long over: the grid's own heights
        let far = 0;
        for (let j = 0; j < 256; j += 7) for (let i = 0; i < 256; i += 7) {
          const [fx, fy] = at(i, j);
          if (Math.abs(fx) > 150 || Math.abs(fy) > 150 || Math.abs(fy) < 32) continue;
          expect(h[j * 256 + i]).toBeCloseTo(sampleGrid(grid, fx, fy), 2); far++;
        }
        expect(far).toBeGreaterThan(zoom === 17 ? 50 : 20);
      }
    }
  });
  it("the road-conformed grid is tried before the plain one, for the page and the area name", () => {
    expect(groundGridFiles("stelvio_standard")).toEqual([
      "stelvio_standard_ground_conformed.odrz", "stelvio_ground_conformed.odrz", "stelvio_standard_ground.odrz", "stelvio_ground.odrz",
    ]);
  });
});

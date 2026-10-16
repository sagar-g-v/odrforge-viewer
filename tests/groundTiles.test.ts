// Guards docs/ACCURACY.md §4: terrain tiles carry the ground grid's heights at their pixel centres, and the viewer tries
// the road-conformed grid first.
import { describe, expect, it } from "vitest";
import { activeGrid, groundTileFromBase } from "../src/map/groundTiles";
import { groundGridFiles, sampleGrid, type GroundGrid } from "../src/map/odrz";
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
  it("the road-conformed grid is tried before the plain one, for the page and the area name", () => {
    expect(groundGridFiles("stelvio_standard")).toEqual([
      "stelvio_standard_ground_conformed.odrz", "stelvio_ground_conformed.odrz", "stelvio_standard_ground.odrz", "stelvio_ground.odrz",
    ]);
  });
});

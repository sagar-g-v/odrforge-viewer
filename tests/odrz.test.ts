import { describe, expect, it } from "vitest";
import { decodeTerrarium } from "../src/map/dem";
import { encodeTerrarium } from "../src/map/groundTiles";
import { groundHeight, insideBy, parseOdrz, sampleGrid } from "../src/map/odrz";

/** an .odrz file as odrforge TerrainGrid::save writes it */
function odrz(nx: number, ny: number, cell: number, z: number[][], datum = "DHHN2016", ox = 10, oy = 20): ArrayBuffer {
  const levels = z.length, head = 8 + 24 + 8 + (levels > 1 ? 4 : 0) + 32;
  const buf = new ArrayBuffer(head + levels * nx * ny * 4), v = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode(levels > 1 ? "ODRZGRD2" : "ODRZGRD1"), 0);
  v.setFloat64(8, ox, true); v.setFloat64(16, oy, true); v.setFloat64(24, cell, true);
  v.setInt32(32, nx, true); v.setInt32(36, ny, true);
  let o = 40;
  if (levels > 1) { v.setInt32(40, levels, true); o = 44; }
  new Uint8Array(buf).set(new TextEncoder().encode(datum), o);
  o += 32;
  for (const lv of z) for (const h of lv) { v.setFloat32(o, h, true); o += 4; }
  return buf;
}

describe("converter ground grid (.odrz, odrforge include/odrforge/terrain.hpp)", () => {
  // 3 x 2 cells of 2 m: row 0 (south) 100 101 102, row 1 104 NaN 106
  const g = parseOdrz(odrz(3, 2, 2, [[100, 101, 102, 104, NaN, 106]]));
  it("reads the header and level 0", () => {
    expect([g.originX, g.originY, g.cell, g.nx, g.ny, g.levels, g.datum]).toEqual([10, 20, 2, 3, 2, 1, "DHHN2016"]);
    const v2 = parseOdrz(odrz(2, 1, 1, [[1, 2], [7, 8]], "ODN"));
    expect([v2.levels, v2.datum, [...v2.z]]).toEqual([2, "ODN", [1, 2]]); // ground = level 0
    expect(() => parseOdrz(new ArrayBuffer(80))).toThrow();
  });
  it("samples like TerrainGrid::sample: cell centres at origin + i * cell, NaN cells left out and weights renormalised", () => {
    expect(sampleGrid(g, 10, 20)).toBe(100);
    expect(sampleGrid(g, 11, 20)).toBeCloseTo(100.5, 9);
    // between 100, 101 (south) and 104, NaN (north), a quarter of the way in each direction
    const w = [0.75 * 0.75, 0.25 * 0.75, 0.75 * 0.25];
    expect(sampleGrid(g, 10.5, 20.5)).toBeCloseTo((w[0] * 100 + w[1] * 101 + w[2] * 104) / (w[0] + w[1] + w[2]), 9);
    expect(sampleGrid(g, 100, 100)).toBeNaN();
  });
  it("blends into the fallback within the margin of its edge, replaces NaN and outside by it", () => {
    const flat = parseOdrz(odrz(101, 101, 1, [new Array(101 * 101).fill(50)], "x", 0, 0)); // 100 m square
    expect(insideBy(flat, 50, 50)).toBe(50);
    expect(groundHeight(flat, 50, 50, () => 0, 30)).toBe(50); // deep inside: the grid
    expect(groundHeight(flat, -1, 50, () => 7, 30)).toBe(7); // outside: the fallback
    expect(groundHeight(flat, 15, 50, () => 0, 30)).toBeCloseTo(25, 9); // halfway into the blend: smoothstep(0.5) = 0.5
    expect(groundHeight(g, 12, 22, () => 9)).toBe(9); // the NaN cell alone around (12, 22): fallback
  });
});

describe("Terrarium encoding of the generated DEM tiles", () => {
  it("round-trips heights to 1/256 m", () => {
    const h = Float32Array.from([519.25, -2.26, 0, 2783.638, 8848.86, -432.1]);
    const back = decodeTerrarium(encodeTerrarium(h));
    h.forEach((v, i) => expect(Math.abs(back[i] - v)).toBeLessThanOrEqual(1 / 512 + 1e-4));
  });
});

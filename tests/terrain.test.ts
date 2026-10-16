import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Dem, decodeTerrarium } from "../src/map/dem";
import { drapeRender, terrainLift } from "../src/map/drape";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

// lon / lat of the centre of global pixel (gx, gy) at zoom z (256 px tiles, Web Mercator)
function pixelCentre(gx: number, gy: number, z: number): [number, number] {
  const n = 256 * 2 ** z, x = (gx + 0.5) / n, y = (gy + 0.5) / n;
  return [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI];
}

describe("terrain DEM (Terrarium, sampled as maplibre-gl 6 DEMData.sampleBilinear)", () => {
  it("decodes Terrarium: R * 256 + G + B / 256 - 32768", () => {
    expect([...decodeTerrarium(new Uint8Array([128, 0, 0, 255, 130, 10, 128, 255, 127, 255, 0, 255]))]).toEqual([0, 522.5, -1]);
  });
  // two tiles side by side at zoom 2 whose pixels hold their global column index: heights then read back the column
  const z = 2, t0 = new Float32Array(256 * 256), t1 = new Float32Array(256 * 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { t0[j * 256 + i] = i; t1[j * 256 + i] = 256 + i; }
  const dem = new Dem(z, new Map([[1 * 4 + 1, t0], [1 * 4 + 2, t1]])); // tiles (x 1, y 1) and (x 2, y 1)
  it("pixels sit at cell centres and interpolate bilinearly, across tile edges", () => {
    expect(dem.sample(...pixelCentre(256 + 10, 300, z))).toBeCloseTo(10, 6);
    const [a, lat] = pixelCentre(256 + 255, 300, z), [b] = pixelCentre(512, 300, z);
    expect(dem.sample((a + b) / 2, lat)).toBeCloseTo(255.5, 4); // halfway between the last column of one tile and the next
  });
  it("is NaN where no tile was loaded", () => {
    expect(dem.sample(...pixelCentre(10, 10, z))).toBeNaN();
  });
});

describe("draping a network on the terrain (map/drape.ts)", () => {
  const od = parseOpenDrive(readFileSync(new URL("./fixtures/stelvio_standard.xodr", import.meta.url), "utf8"));
  const r = buildRender(od, makeProjector(od.header.geoReference).forward);
  const ground = (lon: number) => 1800 + (lon - r.bounds[0]) * 1000; // a slope across the network
  it("relative: ground + the file's height above the road level; flat: on the ground", () => {
    const rel = drapeRender(r, ground, "relative").render, flat = drapeRender(r, ground, "flat").render;
    for (const v of [0, 7, 100]) {
      const lon = r.lanes.positions[3 * v];
      expect(rel.lanes.positions[3 * v + 2]).toBeCloseTo(ground(lon) + r.lanes.positions[3 * v + 2] - r.zGround, 9);
      expect(flat.lanes.positions[3 * v + 2]).toBeCloseTo(ground(lon), 9);
      expect(rel.lanes.positions[3 * v]).toBe(lon);
    }
    expect(rel.features.boxes.positions.length).toBe(r.features.boxes.positions.length);
    expect(r.lanes.positions[2]).not.toBe(rel.lanes.positions[2]); // the source buffers are left as they are
  });
  it("vertices without DEM data take the median ground", () => {
    const d = drapeRender(r, () => NaN, "flat");
    expect(d.probe.lon.length).toBe(0);
    expect(d.render.lanes.positions[2]).toBe(0);
  });
  it("the lift covers the drawn terrain's rise above the sampled ground (95th percentile) plus the base", () => {
    const { probe } = drapeRender(r, ground, "flat");
    expect(terrainLift(probe, (lon) => 2 * ground(lon) + 3, 2, 0.2)).toBeCloseTo(3.2, 6);
    expect(terrainLift(probe, (lon) => 2 * ground(lon) - 5, 2, 0.2)).toBeCloseTo(0.2, 6); // drawn below: base only
    expect(terrainLift(probe, () => null, 2, 0.4)).toBe(0.4);
  });
});

// Real-data regression checks (docs/ACCURACY.md §5): the converter's test areas against the ground the viewer draws.
// Limits come from the results proven on 2026-10-17 (road-conformed grids: Munich / London |p95| 0.15 m, Stelvio 0.13 m)
// with a margin; they fail when a converter or viewer change moves roads off their ground. Skipped where the data is not
// present (ODRF_TESTAREAS, default C:/mywork/osm2carla/build/testareas).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heightPlan, hasRealHeights } from "../src/map/heights";
import { datumMismatch, groundGridFiles, parseOdrz, sampleGrid, type GroundGrid } from "../src/map/odrz";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { evalRoad } from "../src/xodr/geometry";
import { elevationAt } from "../src/xodr/lanes";
import { parseOpenDrive } from "../src/xodr/parse";

const DIR = process.env.ODRF_TESTAREAS ?? "C:/mywork/osm2carla/build/testareas";
const AREAS = ["munich", "london", "stelvio"]; // built with absolute heights and road-conformed grids
const LIMIT = { conformedP95: 0.3, conformedMedian: 0.2, frameMedian: 0.1, drivingMedian: 0.05, objectBase: 0.3 }; // m (driving: measured <= 0.002; objects: <= 0.0001)

const grid = (file: string): GroundGrid => { const b = readFileSync(`${DIR}/${file}`); return parseOdrz(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const stats = (d: number[]) => { const a = d.map(Math.abs).sort((x, y) => x - y), s = [...d].sort((x, y) => x - y); return { n: d.length, median: s[s.length >> 1], p95abs: a[Math.floor(0.95 * (a.length - 1))] }; };

for (const area of AREAS) {
  const xodr = `${DIR}/${area}_standard.xodr`;
  describe.skipIf(!existsSync(xodr))(`real data: ${area}`, () => {
    // read lazily, inside the tests: a skipped describe's body still runs (to collect its tests) where the data is absent
    let loaded: { proj: ReturnType<typeof makeProjector>; r: ReturnType<typeof buildRender>; L: Float64Array } | null = null;
    const data = () => {
      if (!loaded) {
        const od = parseOpenDrive(readFileSync(xodr, "utf8")), proj = makeProjector(od.header.geoReference), r = buildRender(od, proj.forward);
        loaded = { proj, r, L: r.lanes.positions };
      }
      return loaded;
    };
    const against = (g: GroundGrid) => {
      const { proj, L } = data();
      const d: number[] = [];
      for (let v = 0; v < L.length / 3; v++) { const [x, y] = proj.inverse(L[3 * v], L[3 * v + 1]); const h = sampleGrid(g, x, y); if (Number.isFinite(h)) d.push(L[3 * v + 2] - h); }
      return stats(d);
    };
    it("the viewer finds a road-conformed grid for it, and every lane lies on that grid", () => {
      const { L } = data(), file = groundGridFiles(`${area}_standard`).find((f) => existsSync(`${DIR}/${f}`));
      expect(file).toMatch(/_ground_conformed\.odrz$/);
      const s = against(grid(file!));
      expect(s.n).toBeGreaterThan(0.95 * (L.length / 3));
      expect(s.p95abs).toBeLessThanOrEqual(LIMIT.conformedP95);
      expect(Math.abs(s.median)).toBeLessThanOrEqual(LIMIT.conformedMedian);
    });
    it("driving lanes sit on that grid (it holds the road surface; curbs and sidewalks stand their curb height above it)", () => {
      // proven 2026-10-17: driving-lane median +0.002 (Stelvio), 0.000 (Munich, London); curb / walking +0.150. The overall
      // median mixes the two (Stelvio +0.133 with 56 % curb and walking lanes), so the road fit is checked on driving lanes
      const { proj, r } = data(), file = groundGridFiles(`${area}_standard`).find((f) => existsSync(`${DIR}/${f}`))!, g = grid(file);
      const L = r.lanes.positions, M = r.lanes.meta, S = r.lanes.starts, d: number[] = [];
      for (let k = 0; k < M.length; k++) {
        if (M[k].type !== "driving") continue;
        for (let v = S[k]; v < S[k + 1]; v++) { const [x, y] = proj.inverse(L[3 * v], L[3 * v + 1]); const h = sampleGrid(g, x, y); if (Number.isFinite(h)) d.push(L[3 * v + 2] - h); }
      }
      const s = stats(d);
      expect(s.n).toBeGreaterThan(1000);
      expect(Math.abs(s.median)).toBeLessThanOrEqual(LIMIT.drivingMedian);
    });
    it("trees, poles and other point objects stand on that ground (off bridges): base = elevation(s) + zOffset (1.8.1 XSD)", () => {
      // proven 2026-10-17 after the converter seated them (02a8d5c): max |base - ground| 0.0001 m in Munich, London, Stelvio,
      // Frankfurt; before, Munich had 141 of 679 more than 0.3 m off (worst 8.2 m under the ground)
      const od = parseOpenDrive(readFileSync(xodr, "utf8"));
      const g = grid(groundGridFiles(`${area}_standard`).find((f) => existsSync(`${DIR}/${f}`))!);
      const off: string[] = [];
      let n = 0;
      for (const road of od.roads) for (const o of road.objects) {
        if (o.outlines.length || o.repeats.length) continue;
        if (road.structures.some((st) => st.kind === "bridge" && o.s >= st.s - 1e-6 && o.s <= st.s + st.length + 1e-6)) continue;
        const p = evalRoad(road, o.s), x = p.x - o.t * Math.sin(p.hdg), y = p.y + o.t * Math.cos(p.hdg), h = sampleGrid(g, x, y);
        if (!Number.isFinite(h)) continue;
        n++;
        const d = elevationAt(road, o.s) + o.zOffset - h;
        if (Math.abs(d) > LIMIT.objectBase) off.push(`${road.id}/${o.id} ${d.toFixed(2)}`);
      }
      expect(n).toBeGreaterThan(0);
      expect(off).toEqual([]);
    });
    it("the file and the grid the viewer draws are heights above the same vertical datum", () => {
      const file = groundGridFiles(`${area}_standard`).find((f) => existsSync(`${DIR}/${f}`))!;
      const od = parseOpenDrive(readFileSync(xodr, "utf8"));
      const fileDatum = od.header.userData.find((u) => u.code === "verticalDatum")?.value;
      expect(fileDatum).toBeTruthy();
      expect(datumMismatch(fileDatum, grid(file).datum)).toBeNull();
    });
    it("its heights are real (on the plain DEM grid, same frame and datum): drawn as they are over terrain, never draped", () => {
      const { proj, r, L } = data(), g = grid(`${area}_ground.odrz`), s = against(g);
      expect(Math.abs(s.median)).toBeLessThanOrEqual(LIMIT.frameMedian);
      const ground = (lon: number, lat: number) => { const [x, y] = proj.inverse(lon, lat); return sampleGrid(g, x, y); };
      const real = hasRealHeights(L, ground);
      expect(real).toBe(true);
      for (const mode of ["absolute", "relative"] as const)
        expect(heightPlan({ mode, terrain: true, groundReady: true, zGround: r.zGround, realHeights: real, exaggeration: 1 })).toMatchObject({ drape: null, base: 0 });
    });
  });
}

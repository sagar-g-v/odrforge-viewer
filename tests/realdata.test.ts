// Real-data regression checks (docs/ACCURACY.md §5): the converter's test areas against the ground the viewer draws.
// Limits come from the results proven on 2026-10-17 (road-conformed grids: Munich / London |p95| 0.15 m, Stelvio 0.13 m)
// with a margin; they fail when a converter or viewer change moves roads off their ground. Skipped where the data is not
// present (ODRF_TESTAREAS, default C:/mywork/osm2carla/build/testareas).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heightPlan, hasRealHeights } from "../src/map/heights";
import { datumMismatch, groundGridFiles, parseOdrz, sampleGrid, type GroundGrid } from "../src/map/odrz";
import earcut from "earcut";
import { buildRoadFloor, FLOOR, floorAt, floorRadius } from "../src/map/roadFloor";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { evalRoad } from "../src/xodr/geometry";
import { elevationAt } from "../src/xodr/lanes";
import { parseOpenDrive } from "../src/xodr/parse";

const DIR = process.env.ODRF_TESTAREAS ?? "C:/mywork/osm2carla/build/testareas";
const AREAS = ["munich", "london", "stelvio", "frankfurt_kreuz"]; // built with absolute heights and road-conformed grids (Frankfurt from 2026-10-17, OdrForge 6537d93)
const LIMIT = { conformedP95: 0.3, conformedMedian: 0.2, frameMedian: 0.1, drivingMedian: 0.05, objectBase: 0.3, buried: 2, cliff: 0.5, heldShare: 0.08 }; // m (driving: measured <= 0.002; objects: <= 0.0001); share
// The published conformed grid carries the road floor (OdrForge 085a330, user decision 2026-10-18; map/roadFloor.ts):
// under every lane it is the road surface minus FLOOR.epsilon, so the grid fit is measured against road - FLOOR.epsilon
// (as the converter's terrain contract measures it). Where a surface more than HELD.dz lower lies within HELD.r (a road
// stacked under it, a hairpin's lower leg) the lower road wins and presses the ground under the higher one: those points
// are left out of the fit and counted (at most LIMIT.heldShare of the points; measured 2026-10-18: Stelvio 7.0 %,
// Munich 0.6 %, London 0.9 %, Frankfurt 1.1 %), and they appear in the road-floor report's floating count.
const HELD = { dz: 0.5, r: 3 }; // m

// known open defects, by area: roads with a lane buried more than LIMIT.buried (remove an entry when the converter fixes it)
const KNOWN_BURIED: Record<string, string[]> = {}; // Stelvio road 22 fixed by the road floor (OdrForge 085a330, 2026-10-18)
// roads steeper than LIMIT.cliff between 0.25 m samples (the converter's contract "cliffs" check): known open cases, exactly
const KNOWN_CLIFFS: Record<string, string[]> = { london: ["250"], stelvio: ["31"] }; // measured 2026-10-17: 61 %, 54 %
const grid = (file: string): GroundGrid => { const b = readFileSync(`${DIR}/${file}`); return parseOdrz(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const stats = (d: number[]) => { const a = d.map(Math.abs).sort((x, y) => x - y), s = [...d].sort((x, y) => x - y); return { n: d.length, median: s[s.length >> 1], p95abs: a[Math.floor(0.95 * (a.length - 1))] }; };

for (const area of AREAS) {
  const xodr = `${DIR}/${area}_standard.xodr`;
  describe.skipIf(!existsSync(xodr))(`real data: ${area}`, { timeout: 60000 }, () => {
    // read lazily, inside the tests: a skipped describe's body still runs (to collect its tests) where the data is absent
    let loaded: { od: ReturnType<typeof parseOpenDrive>; proj: ReturnType<typeof makeProjector>; r: ReturnType<typeof buildRender>; L: Float64Array } | null = null;
    const data = () => {
      if (!loaded) {
        const od = parseOpenDrive(readFileSync(xodr, "utf8")), proj = makeProjector(od.header.geoReference), r = buildRender(od, proj.forward);
        loaded = { od, proj, r, L: r.lanes.positions };
      }
      return loaded;
    };
    // a lane surface more than HELD.dz lower within HELD.r of (x, y): the lower road wins there (lane vertices on a hash)
    let held: ((x: number, y: number, z: number) => boolean) | null = null;
    const heldDown = (x: number, y: number, z: number) => {
      if (!held) {
        const { proj, L } = data(), nv = L.length / 3, X = new Float64Array(nv), Y = new Float64Array(nv), cells = new Map<string, number[]>();
        for (let v = 0; v < nv; v++) {
          const [px, py] = proj.inverse(L[3 * v], L[3 * v + 1]), key = `${Math.floor(px / HELD.r)},${Math.floor(py / HELD.r)}`;
          X[v] = px; Y[v] = py;
          (cells.get(key) ?? cells.set(key, []).get(key)!).push(v);
        }
        held = (px, py, pz) => {
          const cx = Math.floor(px / HELD.r), cy = Math.floor(py / HELD.r);
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
            for (const q of cells.get(`${cx + a},${cy + b}`) ?? []) if (L[3 * q + 2] < pz - HELD.dz && Math.hypot(X[q] - px, Y[q] - py) <= HELD.r) return true;
          return false;
        };
      }
      return held(x, y, z);
    };
    // lane vertices against a grid; onGround: only roads without a bridge or tunnel (those lie off the ground on purpose);
    // floor: the grid carries the road floor (measured against road - FLOOR.epsilon, points held down by a lower road apart)
    const against = (g: GroundGrid, onGround = false, floor = false) => {
      const { proj, L, r, od: all } = data(), od = onGround ? all : null;
      const d: number[] = [];
      let total = 0, heldPts = 0;
      for (let k = 0; k < r.lanes.meta.length; k++) {
        if (od && od.roads[r.lanes.meta[k].road].structures.length) continue;
        for (let v = r.lanes.starts[k]; v < r.lanes.starts[k + 1]; v++) {
          total++;
          const [x, y] = proj.inverse(L[3 * v], L[3 * v + 1]), z = L[3 * v + 2], h = sampleGrid(g, x, y);
          if (!Number.isFinite(h)) continue;
          if (floor && heldDown(x, y, z)) { heldPts++; continue; }
          d.push(z - (floor ? FLOOR.epsilon : 0) - h);
        }
      }
      return { ...stats(d), total, held: heldPts };
    };
    it("the viewer finds a road-conformed grid for it, and every lane off bridges and tunnels lies on that grid", () => {
      // off bridges and tunnels, measured 2026-10-17: |p95| 0.151 Munich, 0.150 London, 0.192 Stelvio, 0.151 Frankfurt (whose
      // bridges and car-park tunnels made the all-lane p95 5.9 m: they are off the ground by design). With the road floor
      // (2026-10-18, against road - 0.05 m, held-down points apart): 0.152, 0.152, 0.193, 0.151 - the fit is unchanged;
      // with the held-down points Stelvio's p95 is 0.394 (its hairpins)
      const file = groundGridFiles(`${area}_standard`).find((f) => existsSync(`${DIR}/${f}`));
      expect(file).toMatch(/_ground_conformed\.odrz$/);
      const s = against(grid(file!), true, true);
      expect(s.n + s.held).toBeGreaterThan(0.95 * s.total);
      expect(s.held).toBeLessThanOrEqual(LIMIT.heldShare * s.total);
      expect(s.p95abs).toBeLessThanOrEqual(LIMIT.conformedP95);
      expect(Math.abs(s.median)).toBeLessThanOrEqual(LIMIT.conformedMedian);
    });
    it("driving lanes sit on that grid (it holds the road surface; curbs and sidewalks stand their curb height above it)", () => {
      // proven 2026-10-17: driving-lane median +0.002 (Stelvio), 0.000 (Munich, London); curb / walking +0.150. The overall
      // median mixes the two (Stelvio +0.133 with 56 % curb and walking lanes), so the road fit is checked on driving lanes.
      // Against road - FLOOR.epsilon since the road floor (2026-10-18): +0.000 Munich / London / Frankfurt, +0.003 Stelvio
      const { proj, r, od } = data(), file = groundGridFiles(`${area}_standard`).find((f) => existsSync(`${DIR}/${f}`))!, g = grid(file);
      const L = r.lanes.positions, M = r.lanes.meta, S = r.lanes.starts, d: number[] = [];
      for (let k = 0; k < M.length; k++) {
        if (M[k].type !== "driving" || od.roads[M[k].road].structures.length) continue; // off bridges and tunnels (the car park P15 depth is provisional)
        for (let v = S[k]; v < S[k + 1]; v++) { const [x, y] = proj.inverse(L[3 * v], L[3 * v + 1]); const h = sampleGrid(g, x, y); if (Number.isFinite(h)) d.push(L[3 * v + 2] - FLOOR.epsilon - h); }
      }
      const s = stats(d);
      expect(s.n).toBeGreaterThan(1000);
      expect(Math.abs(s.median)).toBeLessThanOrEqual(LIMIT.drivingMedian);
    });
    it("no lane is buried: off bridges and tunnels, no lane point is more than 2 m under that ground", () => {
      // proven 2026-10-17 (OdrForge 145cd82 + ef47f9b: underpasses, tunnel ends, car-park junctions): none in Munich, London
      // and Frankfurt; Stelvio road 22 too since the road floor (085a330, 2026-10-18). The list must match exactly, so the
      // test also fails when a known case is fixed (then remove it from KNOWN_BURIED)
      const { proj, r } = data(), od = data().od;
      const g = grid(groundGridFiles(`${area}_standard`).find((f) => existsSync(`${DIR}/${f}`))!);
      const L = r.lanes.positions, M = r.lanes.meta, S = r.lanes.starts, buried = new Set<string>();
      for (let k = 0; k < M.length; k++) {
        const road = od.roads[M[k].road];
        if (road.structures.length) continue; // bridges and tunnels lie off the ground on purpose
        for (let v = S[k]; v < S[k + 1]; v++) {
          const [x, y] = proj.inverse(L[3 * v], L[3 * v + 1]), h = sampleGrid(g, x, y);
          if (Number.isFinite(h) && L[3 * v + 2] - h < -LIMIT.buried) buried.add(road.id);
        }
      }
      expect([...buried].sort()).toEqual(KNOWN_BURIED[area] ?? []);
    });
    it("no road has a cliff: at most 50 % between 0.25 m samples (OdrForge contract 'cliffs')", () => {
      // proven 2026-10-17 after the deck filter (OdrForge 6537d93): none in Munich and Frankfurt; London 250 and Stelvio 31
      // are the converter's known open cases. Exact list: the test also fails when one is fixed (then update KNOWN_CLIFFS)
      const { od } = data(), cliffs: string[] = [];
      for (const road of od.roads) {
        for (let s = 0; s + 0.25 <= road.length + 1e-9; s += 0.25)
          if (Math.abs(elevationAt(road, s + 0.25) - elevationAt(road, s)) / 0.25 > LIMIT.cliff) { cliffs.push(road.id); break; }
      }
      expect(cliffs.sort()).toEqual(KNOWN_CLIFFS[area] ?? []);
    });
    it("trees, poles and other point objects stand on that ground (off bridges): base = elevation(s) + zOffset (1.8.1 XSD)", () => {
      // proven 2026-10-17 after the converter seated them (02a8d5c): max |base - ground| 0.0001 m in Munich, London, Stelvio,
      // Frankfurt; before, Munich had 141 of 679 more than 0.3 m off (worst 8.2 m under the ground)
      const { od } = data();
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
    it("the road wins: with the floor, the ground drawn under every lane point (not in a tunnel) and junction surface is under it", () => {
      // the floor the viewer builds (map/roadFloor.ts) over the grid it draws: min(grid, floor within the z17 radius) at
      // every lane vertex outside tunnel footprints must be at least FLOOR.epsilon under the vertex. Proven 2026-10-18:
      // 0 above in all four areas (before: every driving lane on the conformed grid, half its points under it). The cost,
      // reported with ROAD_FLOOR=1: lanes next to a lower road within the floor radius float over the pressed ground
      const { proj, r } = data(), g = grid(groundGridFiles(`${area}_standard`).find((f) => existsSync(`${DIR}/${f}`))!);
      const toXY = (lon: number, lat: number) => proj.inverse(lon, lat) as [number, number], S = r.features.structures, tunnels = new Map<number, [number, number][][]>();
      S.meta.forEach((m, k) => {
        if (!m.tunnel) return;
        const ring: [number, number][] = [];
        for (let v = S.starts[k]; v < S.starts[k + 1]; v++) ring.push(toXY(S.positions[3 * v], S.positions[3 * v + 1]));
        tunnels.set(m.road, [...(tunnels.get(m.road) ?? []), ring]);
      });
      const t0 = performance.now(), f = buildRoadFloor(r.lanes, toXY, { exclude: tunnels, areas: r.junctions })!, ms = performance.now() - t0;
      const tunnelRoads = new Set(S.meta.filter((m) => m.tunnel).map((m) => m.road));
      const L = r.lanes.positions, M = r.lanes.meta, St = r.lanes.starts, R = floorRadius(0.8);
      let n = 0, above = 0, pressed = 0, deepest = 0, gridAbove = 0;
      let floatBefore = 0, floatAfter = 0;
      const deep = new Map<string, number>(); // roads (off bridges and tunnels) the grid stands more than 0.3 m above
      for (let k = 0; k < M.length; k++) {
        if (tunnelRoads.has(M[k].road)) continue; // tunnel roads keep the ground over them (their open approaches are checked by the unit tests)
        for (let v = St[k]; v < St[k + 1]; v++) {
          const [x, y] = toXY(L[3 * v], L[3 * v + 1]), h = sampleGrid(g, x, y);
          if (!Number.isFinite(h)) continue;
          n++;
          const drawn = Math.min(h, floorAt(f, x, y, R)), z = L[3 * v + 2];
          if (drawn > z - FLOOR.epsilon + 1e-4) above++;
          if (h > z - FLOOR.epsilon + 0.01) gridAbove++; // the published grid alone (OdrForge 085a330 bakes the floor in)
          if (drawn < h - 1e-4) { pressed++; deepest = Math.max(deepest, h - drawn); }
          if (!data().od.roads[M[k].road].structures.length) {
            if (z - h > 1) floatBefore++;
            if (z - drawn > 1) floatAfter++;
            if (h - z > 0.3) { const id = data().od.roads[M[k].road].id; deep.set(id, Math.max(deep.get(id) ?? 0, h - z)); }
          }
        }
      }
      if (process.env.ROAD_FLOOR) console.log(`ROAD-FLOOR ${area}: ${n} lane points, ${above} above, ${pressed} pressed, deepest ${deepest.toFixed(2)} m; floor ${f.nx} x ${f.ny} cells in ${ms.toFixed(0)} ms; lane points more than 1 m over the drawn ground (off bridges and tunnels) ${floatBefore} -> ${floatAfter}; grid > 0.3 m over the road: ${[...deep].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ') || 'none'}`);
      expect(n).toBeGreaterThan(1000);
      expect(above).toBe(0);
      expect(gridAbove).toBe(0); // proven 2026-10-18 on the 18:13 outputs: 0 in all four areas, as the converter measured
      // junction surfaces the file defines (<boundary> §12.10, virtual span §12.5), sampled inside every triangle of the
      // fill as deck.gl draws it (earcut): proven 2026-10-18, 0 above in all four areas (before: 3.5 % of Munich's
      // boundary-surface samples, worst 0.35 m; Frankfurt worst 1.95 m). Hulls (the viewer's approximation) and junctions
      // with a tunnel road (underground: Frankfurt's car park, up to 34 m under the ground) are left out, as the converter
      // leaves them out. The published grid alone: the inside of a boundary has no height in OpenDRIVE (unless an
      // elevationGrid, §12.9), so the converter's surface differs from the viewer's earcut fill a little: proven 2026-10-18
      // at most 0.13 m above the viewer's surface - 0.05 m (London; Munich 0.10, Frankfurt 0.04), limit JUNCTION_GRID_SLACK
      const J = r.junctions, JUNCTION_GRID_SLACK = 0.15;
      let jn = 0, jAbove = 0, jGridAbove = 0, jGridWorst = 0;
      J.meta.forEach((m, k) => {
        if (!m.exact || m.tunnel) return;
        const xyz: number[] = [];
        for (let v = J.starts[k]; v < J.starts[k + 1]; v++) xyz.push(...toXY(J.positions[3 * v], J.positions[3 * v + 1]), J.positions[3 * v + 2]);
        const tri = earcut(xyz.filter((_, i) => i % 3 !== 2), null, 2);
        for (let q = 0; q < tri.length; q += 3) {
          const [A, B, C] = [tri[q], tri[q + 1], tri[q + 2]].map((i) => xyz.slice(3 * i, 3 * i + 3));
          for (let a = 0.1; a < 1; a += 0.2) for (let b = 0.1; a + b < 1; b += 0.2) {
            const w = 1 - a - b, x = a * A[0] + b * B[0] + w * C[0], y = a * A[1] + b * B[1] + w * C[1], z = a * A[2] + b * B[2] + w * C[2];
            const h = sampleGrid(g, x, y);
            if (!Number.isFinite(h)) continue;
            jn++;
            if (Math.min(h, floorAt(f, x, y, R)) > z - FLOOR.epsilon + 1e-4) jAbove++;
            if (h > z - FLOOR.epsilon + 0.01) jGridAbove++;
            jGridWorst = Math.max(jGridWorst, h - (z - FLOOR.epsilon));
          }
        }
      });
      if (process.env.ROAD_FLOOR) console.log(`ROAD-FLOOR ${area} junction surfaces: ${jn} points, ${jAbove} above, ${jGridAbove} with the published grid alone above by > 1 cm (worst ${jGridWorst.toFixed(2)} m); lanes: ${gridAbove} with the grid alone above`);
      expect(jn).toBeGreaterThan(area === "stelvio" ? 1000 : 10000);
      expect(jAbove).toBe(0);
      expect(jGridWorst).toBeLessThanOrEqual(JUNCTION_GRID_SLACK);
    });
    it("the file and the grid the viewer draws are heights above the same vertical datum", () => {
      const file = groundGridFiles(`${area}_standard`).find((f) => existsSync(`${DIR}/${f}`))!;
      const { od } = data();
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

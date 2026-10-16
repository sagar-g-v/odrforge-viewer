// Lay a network whose heights are not above sea level on the terrain: every vertex (lanes, marks, outlines, furniture)
// gets z' = ground(lon, lat) + (z - zGround) in "relative" mode (bridges and tunnels keep their height over / under the
// surrounding road level), or z' = ground(lon, lat) in "flat" mode. "absolute" mode leaves the file's heights as they are.
import type { Binary, RenderData } from "../xodr/build";

export type Ground = (lon: number, lat: number) => number;

/** lon / lat / ground height of a spread of lane vertices: compared with the drawn terrain to size the lift above it */
export interface GroundProbe { lon: Float64Array; lat: Float64Array; ground: Float64Array; }

function drapePos(pos: Float64Array, ground: Ground, dz: (z: number) => number, fallback: number): Float64Array {
  const out = new Float64Array(pos.length);
  let lastLon = NaN, lastLat = NaN, last = fallback; // consecutive duplicates (column trunk + crown, ring ends) sample once
  for (let i = 0; i < pos.length; i += 3) {
    const lon = pos[i], lat = pos[i + 1];
    if (lon !== lastLon || lat !== lastLat) {
      const g = ground(lon, lat);
      last = Number.isFinite(g) ? g : fallback;
      lastLon = lon; lastLat = lat;
    }
    out[i] = lon; out[i + 1] = lat; out[i + 2] = last + dz(pos[i + 2]);
  }
  return out;
}

export function drapeRender(r: RenderData, ground: Ground, mode: "flat" | "relative"): { render: RenderData; probe: GroundProbe } {
  // fallback for vertices without DEM data: the median ground under the lanes
  const L = r.lanes.positions, nv = L.length / 3, step = Math.max(1, Math.floor(nv / 4000));
  const pl: number[] = [], pa: number[] = [], pg: number[] = [];
  for (let v = 0; v < nv; v += step) {
    const g = ground(L[3 * v], L[3 * v + 1]);
    if (Number.isFinite(g)) { pl.push(L[3 * v]); pa.push(L[3 * v + 1]); pg.push(g); }
  }
  const sorted = [...pg].sort((a, b) => a - b), fallback = sorted.length ? sorted[sorted.length >> 1] : 0;
  const dz = mode === "flat" ? () => 0 : (z: number) => z - r.zGround;
  const d = (pos: Float64Array) => drapePos(pos, ground, dz, fallback);
  const bin = <T extends Binary>(b: T): T => ({ ...b, positions: d(b.positions) });
  const F = r.features;
  const render: RenderData = {
    ...r,
    lanes: bin(r.lanes), marks: bin(r.marks), refs: bin(r.refs), objects: bin(r.objects), objectLines: bin(r.objectLines), arrows: bin(r.arrows), junctions: bin(r.junctions),
    points: { ...r.points, positions: d(r.points.positions) },
    grids: { lines: bin(r.grids.lines), points: { ...r.grids.points, positions: d(r.grids.points.positions) }, refLines: bin(r.grids.refLines) },
    features: {
      columns: F.columns.map((c) => ({ ...c, positions: d(c.positions) })),
      boxes: { ...F.boxes, positions: d(F.boxes.positions) },
      labels: { ...F.labels, positions: d(F.labels.positions) },
      structures: { ...F.structures, positions: d(F.structures.positions) },
      crossPaths: { ...F.crossPaths, positions: d(F.crossPaths.positions) },
    },
  };
  return { render, probe: { lon: Float64Array.from(pl), lat: Float64Array.from(pa), ground: Float64Array.from(pg) } };
}

/**
 * Lift (m) that keeps the draped roads above the terrain as drawn: MapLibre draws coarser DEM levels when zoomed out (and
 * for distant tiles in a tilted view), so the drawn surface can rise above the finest-level ground the roads were laid
 * on. The 95th percentile of that rise over the probe vertices (drawn height from map.queryTerrainElevation, which
 * includes the exaggeration) plus a small base clearance.
 */
export function terrainLift(probe: GroundProbe, drawn: (lon: number, lat: number) => number | null, exaggeration: number, base: number): number {
  const rise: number[] = [];
  for (let i = 0; i < probe.lon.length; i++) {
    const h = drawn(probe.lon[i], probe.lat[i]);
    if (h !== null && Number.isFinite(h)) rise.push(Math.max(0, h - exaggeration * probe.ground[i]));
  }
  if (!rise.length) return base;
  rise.sort((a, b) => a - b);
  return base + rise[Math.min(rise.length - 1, Math.floor(rise.length * 0.95))];
}

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

/** ground heights under up to `samples` vertices of a lon / lat / z buffer (the lift's probe: the ground, never the roads) */
export function groundProbe(positions: Float64Array, ground: Ground, samples = 4000): GroundProbe {
  const nv = positions.length / 3, step = Math.max(1, Math.floor(nv / samples));
  const lon: number[] = [], lat: number[] = [], g: number[] = [];
  for (let v = 0; v < nv; v += step) {
    const h = ground(positions[3 * v], positions[3 * v + 1]);
    if (Number.isFinite(h)) { lon.push(positions[3 * v]); lat.push(positions[3 * v + 1]); g.push(h); }
  }
  return { lon: Float64Array.from(lon), lat: Float64Array.from(lat), ground: Float64Array.from(g) };
}

export function drapeRender(r: RenderData, ground: Ground, mode: "flat" | "relative"): { render: RenderData; probe: GroundProbe } {
  // fallback for vertices without DEM data: the median ground under the lanes
  const probe = groundProbe(r.lanes.positions, ground);
  const sorted = [...probe.ground].sort((a, b) => a - b), fallback = sorted.length ? sorted[sorted.length >> 1] : 0;
  const dz = mode === "flat" ? () => 0 : (z: number) => z - r.zGround;
  const d = (pos: Float64Array) => drapePos(pos, ground, dz, fallback);
  const bin = <T extends Binary>(b: T): T => ({ ...b, positions: d(b.positions) });
  const F = r.features;
  const render: RenderData = {
    ...r,
    lanes: bin(r.lanes), marks: bin(r.marks), refs: bin(r.refs), objects: bin(r.objects), objectLines: bin(r.objectLines), arrows: bin(r.arrows), junctions: bin(r.junctions),
    points: { ...r.points, positions: d(r.points.positions) },
    // the temporary lane layers (1.9.0 §11.2) lie on the same surface as the permanent lanes: laid on the ground with them
    temporary: r.temporary ? { lanes: bin(r.temporary.lanes), arrows: bin(r.temporary.arrows), marks: bin(r.temporary.marks) } : r.temporary,
    grids: { lines: bin(r.grids.lines), points: { ...r.grids.points, positions: d(r.grids.points.positions) }, refLines: bin(r.grids.refLines) },
    features: {
      footprints: { ...F.footprints, positions: d(F.footprints.positions) },
      columns: F.columns.map((c) => ({ ...c, positions: d(c.positions) })),
      boxes: { ...F.boxes, positions: d(F.boxes.positions) },
      labels: { ...F.labels, positions: d(F.labels.positions) },
      structures: { ...F.structures, positions: d(F.structures.positions) },
      crossPaths: { ...F.crossPaths, positions: d(F.crossPaths.positions) },
      barrierLines: { ...F.barrierLines, positions: d(F.barrierLines.positions) },
    },
  };
  return { render, probe };
}

/**
 * Lift (m) that keeps the draped roads above the terrain as drawn: MapLibre draws coarser DEM levels when zoomed out (and
 * for distant tiles in a tilted view), so the drawn surface can rise above the finest-level ground the roads were laid
 * on. The 95th percentile of that rise over the probe vertices (drawn height from map.queryTerrainElevation, which
 * includes the exaggeration) plus a small base clearance.
 */
export function terrainLift(probe: GroundProbe, drawn: (lon: number, lat: number) => number | null, exaggeration: number, base: number,
  inView: (lon: number, lat: number) => boolean = () => true): number {
  // only the points in view: elsewhere MapLibre answers from coarse (or no) DEM tiles, which says nothing about what is
  // drawn on screen and lifted the roads of central London 9 m in a street-level view
  const rise: number[] = [];
  for (let i = 0; i < probe.lon.length; i++) {
    if (!inView(probe.lon[i], probe.lat[i])) continue;
    const h = drawn(probe.lon[i], probe.lat[i]);
    if (h !== null && Number.isFinite(h)) rise.push(Math.max(0, h - exaggeration * probe.ground[i]));
  }
  if (!rise.length) return base;
  rise.sort((a, b) => a - b);
  return base + rise[Math.min(rise.length - 1, Math.floor(rise.length * 0.95))];
}

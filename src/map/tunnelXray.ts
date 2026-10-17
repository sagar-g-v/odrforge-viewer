// Tunnel roads seen through the terrain (docs/design-system.md §8, docs/ACCURACY.md): a lane on a road that carries a
// <tunnel> (an OpenDRIVE <objects> element, type standard or underpass) lies under the ground, so with terrain on in 3D the surface hides it and it cannot be
// reviewed or clicked. The parts of its outline that are under the drawn ground are drawn again, dashed, on top of
// everything. A rendering choice only: the overlay uses the lane's own vertices, unchanged, with the same height transform
// as the lanes. Guarded by tests/tunnelXray.test.ts.

export interface XrayPath { path: [number, number, number][]; lane: number } // lane: index into the lanes buffer

/** metres the drawn lane must be under the drawn ground before it is shown through it (no flicker at portals) */
export const XRAY_TOLERANCE = 0.5;

/**
 * The runs of each tunnel-road lane outline (a closed loop) whose vertices are below the ground, as open paths of at least
 * two vertices; a run across the loop's start is joined into one. `below(lon, lat, z)` decides per vertex.
 */
export function undergroundRuns(
  L: { positions: Float64Array; starts: Uint32Array; meta: { road: number }[] },
  tunnelRoads: Set<number>,
  below: (lon: number, lat: number, z: number) => boolean,
): XrayPath[] {
  const out: XrayPath[] = [], P = L.positions;
  for (let k = 0; k < L.meta.length; k++) {
    if (!tunnelRoads.has(L.meta[k].road)) continue;
    const s = L.starts[k], e = L.starts[k + 1];
    const runs: [number, number, number][][] = [];
    let run: [number, number, number][] | null = null;
    for (let v = s; v < e; v++) {
      const p: [number, number, number] = [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
      if (below(p[0], p[1], p[2])) (run ??= []).push(p);
      else if (run) { runs.push(run); run = null; }
    }
    if (run) {
      // the loop closes on itself: a run reaching the last vertex continues with one starting at the first
      if (runs.length && below(P[3 * s], P[3 * s + 1], P[3 * s + 2])) runs[0] = [...run, ...runs[0]];
      else runs.push(run);
    }
    const whole = runs.length === 1 && runs[0].length === e - s;
    for (const r of runs) {
      const path = whole ? [...r, r[0]] : r; // a wholly buried lane: its full closed outline
      if (path.length >= 2) out.push({ path, lane: k });
    }
  }
  return out;
}

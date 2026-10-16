// How the viewer turns the file's heights into drawn heights: one pure decision, unit-tested (tests/heights.test.ts), so
// the rules in docs/ACCURACY.md cannot drift apart inside the map component.
//
// The rules:
// - The file's heights are drawn as they are. The only transformations are the ones a mode states: "flat" ignores z,
//   "relative" draws from the road level, and the height exaggeration scales z.
// - A file with real heights (its lanes on the ground: median |z - ground| < REAL_HEIGHTS_MEDIAN) keeps them in relative
//   mode over terrain. Re-basing it and laying it on the terrain would invent a surface no other tool shows.
// - A file without real heights is laid on the terrain in flat / relative mode (drape.ts). Bridges and tunnels keep
//   their height difference.
// - Absolute heights need a ground. Without terrain (the map is a plane at 0 m) a network more than NO_GROUND_LEVEL
//   above or below 0 is drawn from its road level, and the map says so.
// - A lift is only ever applied over terrain, and only measured against the ground itself (never against the roads):
//   it makes up for MapLibre drawing a coarser ground than the grid. A road the file puts below the ground stays below it.

export type HeightMode = "flat" | "relative" | "absolute";
export const REAL_HEIGHTS_MEDIAN = 2; // m: median |lane z - ground| below which a file has real heights
export const NO_GROUND_LEVEL = 25; // m: |road level| above which absolute heights without terrain are drawn from the road level

export type Ground = (lon: number, lat: number) => number;

/** median |z - ground| over up to `samples` vertices of a lon / lat / z buffer; null where no vertex has ground */
export function medianOffset(positions: Float64Array, ground: Ground, samples = 1000): number | null {
  const nv = positions.length / 3, step = Math.max(1, Math.floor(nv / samples)), d: number[] = [];
  for (let v = 0; v < nv; v += step) {
    const g = ground(positions[3 * v], positions[3 * v + 1]);
    if (Number.isFinite(g)) d.push(Math.abs(positions[3 * v + 2] - g));
  }
  if (!d.length) return null;
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

/** median ground height under up to `samples` vertices; null where none has ground */
export function medianGround(positions: Float64Array, ground: Ground, samples = 1000): number | null {
  const nv = positions.length / 3, step = Math.max(1, Math.floor(nv / samples)), g: number[] = [];
  for (let v = 0; v < nv; v += step) { const h = ground(positions[3 * v], positions[3 * v + 1]); if (Number.isFinite(h)) g.push(h); }
  if (!g.length) return null;
  g.sort((a, b) => a - b);
  return g[g.length >> 1];
}

export const hasRealHeights = (lanePositions: Float64Array, ground: Ground): boolean => {
  const m = medianOffset(lanePositions, ground);
  return m !== null && m < REAL_HEIGHTS_MEDIAN;
};

/**
 * The 2D map is a plan view: everything is drawn flat (as height mode "flat") and the terrain is off. Seen from straight
 * above, heights change nothing but cost tiles and GPU; 3D uses the chosen height mode and terrain.
 */
export function viewHeights(view: "2d" | "3d", mode: HeightMode, terrain: boolean): { mode: HeightMode; terrain: boolean } {
  return view === "2d" ? { mode: "flat", terrain: false } : { mode, terrain };
}

export interface HeightPlan {
  drape: "flat" | "relative" | null; // lay the network on the ground (drape.ts) in this mode
  base: number; // subtracted from z before scaling
  scale: number; // z scale (the exaggeration; 0 = flat)
  liftFromGround: boolean; // apply the lift measured against the drawn ground (terrain only)
  noGround: boolean; // absolute heights without terrain, drawn from the road level (the map says so)
}

export function heightPlan(o: {
  mode: HeightMode; terrain: boolean; groundReady: boolean; zGround: number; realHeights: boolean; exaggeration: number;
}): HeightPlan {
  const plan: HeightPlan = { drape: null, base: 0, scale: o.exaggeration, liftFromGround: false, noGround: false };
  const overTerrain = o.terrain && o.groundReady;
  if (overTerrain && o.mode !== "absolute" && !o.realHeights) return { ...plan, drape: o.mode, liftFromGround: true };
  if (o.mode === "flat") return { ...plan, scale: 0 };
  const absoluteView = o.mode === "absolute" || (o.mode === "relative" && o.realHeights && o.terrain);
  if (absoluteView && o.terrain) return { ...plan, liftFromGround: overTerrain };
  if (o.mode === "absolute") return Math.abs(o.zGround) > NO_GROUND_LEVEL ? { ...plan, base: o.zGround, noGround: true } : plan;
  return { ...plan, base: o.zGround };
}

/** z' = (z - base) * scale + lift: the model matrix's z row */
export const drawnZ = (p: HeightPlan, z: number, lift: number) => (z - p.base) * p.scale + (p.liftFromGround ? lift : 0);

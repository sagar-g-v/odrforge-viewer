// Point queries for the inspector: where a clicked point lies on a road (s, t) and the lane there.
import { evalRoad } from "./geometry";
import { laneBorders, laneById, sectionIndex, surfaceZ, superelevationAt } from "./lanes";
import { sampleS } from "./build";
import type { Lane, Road } from "./model";

/** s and t of point (x, y) on the road's reference line: nearest sampled segment, refined by Newton steps */
export function projectToRoad(road: Road, x: number, y: number): { s: number; t: number } {
  const S = sampleS(road);
  let best = { s: 0, d: Infinity };
  let prev = evalRoad(road, S[0]);
  for (let i = 1; i < S.length; i++) {
    const cur = evalRoad(road, S[i]);
    const dx = cur.x - prev.x, dy = cur.y - prev.y, L2 = dx * dx + dy * dy;
    const u = L2 > 0 ? Math.max(0, Math.min(1, ((x - prev.x) * dx + (y - prev.y) * dy) / L2)) : 0;
    const px = prev.x + u * dx, py = prev.y + u * dy, d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { s: S[i - 1] + u * (S[i] - S[i - 1]), d };
    prev = cur;
  }
  let s = best.s;
  for (let k = 0; k < 4; k++) {
    const p = evalRoad(road, s);
    s = Math.max(0, Math.min(road.length, s + (x - p.x) * Math.cos(p.hdg) + (y - p.y) * Math.sin(p.hdg)));
  }
  const p = evalRoad(road, s);
  return { s, t: -(x - p.x) * Math.sin(p.hdg) + (y - p.y) * Math.cos(p.hdg) };
}

export interface LaneProbe {
  s: number; t: number; z: number; superelevation: number;
  section: number; sectionStart: number;
  lane: Lane | undefined; width: number | null; inner: number | null; outer: number | null;
}

export function probe(road: Road, laneId: number | null, x: number, y: number): LaneProbe {
  const { s, t } = projectToRoad(road, x, y);
  const k = sectionIndex(road, s), sec = road.sections[k];
  let lane: Lane | undefined, width = null, inner = null, outer = null;
  if (sec) {
    const b = laneBorders(road, sec, s);
    let id = laneId;
    if (id === null) for (const [lid, v] of b) if ((t - v.inner) * (t - v.outer) <= 0) id = lid;
    if (id !== null) {
      lane = laneById(sec, id);
      const v = b.get(id);
      if (v) { inner = v.inner; outer = v.outer; width = Math.abs(v.outer - v.inner); }
    }
  }
  return { s, t, z: surfaceZ(road, s, t), superelevation: superelevationAt(road, s), section: k, sectionStart: sec?.s ?? 0, lane, width, inner, outer };
}

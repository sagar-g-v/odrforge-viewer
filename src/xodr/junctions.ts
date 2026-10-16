// Junction areas for the map: the file's <boundary> (ASAM OpenDRIVE 1.8.0 §12.10) as a closed outline, else an
// approximate outline (convex hull of the junction's connecting-road lanes) for files without one (1.4 - 1.7).
import { evalRoad } from "./geometry";
import { laneBorders, laneOffsetAt, sectionIndex, surfaceZ } from "./lanes";
import { sampleS } from "./build";
import type { OpenDrive, Road } from "./model";

/**
 * outline: "boundary" = the file's <boundary> (1.8.0 §12.10); "span" = a virtual junction's stretch of its main road
 * (mainRoad, sStart..sEnd, §12.5), full width; "hull" = approximate (convex hull of the connecting-road lanes).
 * exact = the file defines the outline (boundary or span): drawn solid, a hull dashed.
 */
export interface JunctionMeta { id: string; exact: boolean; outline: "boundary" | "span" | "hull"; connections: number; type: string; }

type P3 = [number, number, number]; // file x, y, z

/** outer border t of lane `lane` at s (lane 0: the lane offset line) */
function borderT(road: Road, s: number, lane: number): number | null {
  if (lane === 0) return laneOffsetAt(road, s);
  const sec = road.sections[sectionIndex(road, s)];
  const b = sec ? laneBorders(road, sec, s).get(lane) : undefined;
  return b ? b.outer : null;
}

/** outermost border t on both sides at s: the full cross section a joint spans */
function crossSection(road: Road, s: number): [number, number] {
  const sec = road.sections[sectionIndex(road, s)];
  let lo = laneOffsetAt(road, s), hi = lo;
  if (sec) for (const b of laneBorders(road, sec, s).values()) { lo = Math.min(lo, b.inner, b.outer); hi = Math.max(hi, b.inner, b.outer); }
  return [lo, hi];
}

const at = (road: Road, s: number, t: number): P3 => {
  const p = evalRoad(road, s);
  return [p.x - t * Math.sin(p.hdg), p.y + t * Math.cos(p.hdg), surfaceZ(road, s, t)];
};

/** the boundary outline in file coordinates, or null when it cannot be followed (unknown road / lane) */
export function boundaryRing(j: OpenDrive["junctions"][number], byId: Map<string, Road>): P3[] | null {
  const parts: P3[][] = [];
  for (const sg of j.boundary) {
    const road = byId.get(sg.roadId);
    if (!road) return null;
    if (sg.type === "joint") {
      const s = sg.contactPoint === "start" ? 0 : road.length;
      let [lo, hi] = crossSection(road, s);
      if (sg.jointLaneStart !== null && sg.jointLaneEnd !== null) {
        const a = borderT(road, s, sg.jointLaneStart), b = borderT(road, s, sg.jointLaneEnd);
        if (a !== null && b !== null) { lo = Math.min(a, b); hi = Math.max(a, b); }
      }
      parts.push([at(road, s, lo), at(road, s, hi)]);
    } else {
      const sOf = (v: string) => (v === "start" ? 0 : v === "end" ? road.length : Number(v));
      const s0 = sOf(sg.sStart), s1 = sOf(sg.sEnd);
      const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
      const S = [lo, ...sampleS(road).filter((s) => s > lo + 1e-6 && s < hi - 1e-6), hi];
      if (s1 < s0) S.reverse();
      const pts: P3[] = [];
      for (const s of S) {
        const t = borderT(road, s, sg.boundaryLane);
        if (t === null) return null;
        pts.push(at(road, s, t));
      }
      parts.push(pts);
    }
  }
  if (!parts.length) return null;
  // joints carry no direction: run each from the end nearer the previous part's last point
  const d2 = (a: P3, b: P3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const ring: P3[] = [...parts[0]];
  for (let i = 1; i < parts.length; i++) {
    let p = parts[i];
    const last = ring[ring.length - 1];
    if (j.boundary[i].type === "joint" && d2(p[p.length - 1], last) < d2(p[0], last)) p = [...p].reverse();
    ring.push(...p);
  }
  // a first joint is oriented by its successor
  if (j.boundary[0].type === "joint" && parts.length > 1) {
    const next = ring[2];
    if (next && d2(ring[0], next) < d2(ring[1], next)) [ring[0], ring[1]] = [ring[1], ring[0]];
  }
  return ring;
}

/**
 * A virtual junction's area (1.8.0 §12.5: mainRoad, sStart, sEnd; it lies on the main road, which it does not split):
 * the main road between sStart and sEnd, from its outermost left border to its outermost right border. Null when the
 * road is unknown or the span empty. Without it the hull of the junction's connecting roads (often one crossing path)
 * collapsed to a line across the road: no area to draw.
 */
export function virtualSpanRing(j: OpenDrive["junctions"][number], byId: Map<string, Road>): P3[] | null {
  const road = j.mainRoad !== null ? byId.get(j.mainRoad) : undefined;
  if (!road || j.sStart === null || j.sEnd === null || !Number.isFinite(j.sStart) || !Number.isFinite(j.sEnd)) return null;
  const s0 = Math.max(0, Math.min(j.sStart, j.sEnd)), s1 = Math.min(road.length, Math.max(j.sStart, j.sEnd));
  if (s1 - s0 < 1e-6) return null;
  const S = [s0, ...sampleS(road).filter((s) => s > s0 + 1e-6 && s < s1 - 1e-6), s1];
  const left = S.map((s) => at(road, s, crossSection(road, s)[1]));
  const right = S.map((s) => at(road, s, crossSection(road, s)[0])).reverse();
  return [...left, ...right];
}

/** convex hull (monotone chain) of 2D points carrying z; the approximate area of a junction without a boundary */
export function hull(points: P3[]): P3[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: P3, a: P3, b: P3) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P3[] = [], upper: P3[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Lanes along a road (ASAM OpenDRIVE 1.8.0 §11): lane offset §11.4, lane sections §11.3, width §11.6.1 /
// border §11.6.2, lane height §11.10; road surface height: elevation §10.5.1 and superelevation §10.5.2.
import type { Lane, LaneSection, Poly3, Road } from "./model";

/** the record valid at x (records sorted by s; the first one before its start) evaluated at x - record.s */
export function polyAt(recs: Poly3[], x: number): number {
  if (!recs.length) return 0;
  let lo = 0, hi = recs.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (recs[m].s <= x + 1e-9) lo = m; else hi = m - 1; }
  const r = recs[lo], d = x - r.s;
  return r.a + d * (r.b + d * (r.c + d * r.d));
}

export const laneOffsetAt = (road: Road, s: number) => polyAt(road.laneOffset, s);
export const elevationAt = (road: Road, s: number) => polyAt(road.elevation, s);
export const superelevationAt = (road: Road, s: number) => polyAt(road.superelevation, s);

/** road surface height at (s, t): elevation plus the roll about the reference line, positive falling to the right */
export function surfaceZ(road: Road, s: number, t: number): number {
  return elevationAt(road, s) + t * Math.tan(superelevationAt(road, s));
}

export function sectionIndex(road: Road, s: number): number {
  const ss = road.sections;
  let lo = 0, hi = ss.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ss[m].s <= s + 1e-9) lo = m; else hi = m - 1; }
  return lo;
}

export function sectionEnd(road: Road, k: number): number {
  return k + 1 < road.sections.length ? road.sections[k + 1].s : road.length;
}

/** lane height (inner, outer raise) at ds within its section: each record holds until the next one */
export function laneHeight(l: Lane, ds: number): [number, number] {
  let h: [number, number] = [0, 0];
  for (const r of l.heights) if (r.s <= ds + 1e-9) h = [r.inner, r.outer];
  return h;
}

export interface Border { inner: number; outer: number; }

/** t of every lane's inner / outer border at s in section `sec` (lane 0 at the lane offset; left +t, right -t) */
export function laneBorders(road: Road, sec: LaneSection, s: number): Map<number, Border> {
  const ds = s - sec.s;
  const t0 = laneOffsetAt(road, s);
  const out = new Map<number, Border>();
  for (const [lanes, sign] of [[sec.left, 1], [sec.right, -1]] as const) {
    let t = t0;
    for (const l of lanes) {
      // border records give the outer border's distance from the lane offset (used by some exporters instead of width)
      const outer = l.widths.length || !l.borders.length ? t + sign * polyAt(l.widths, ds) : t0 + sign * polyAt(l.borders, ds);
      out.set(l.id, { inner: t, outer });
      t = outer;
    }
  }
  return out;
}

export function laneById(sec: LaneSection, id: number): Lane | undefined {
  return (id > 0 ? sec.left : id < 0 ? sec.right : []).find((l) => l.id === id) ?? (id === 0 ? sec.center ?? undefined : undefined);
}

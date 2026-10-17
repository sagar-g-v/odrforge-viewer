// OSM edges against the drawn network: an independent check of how the generated roads follow the edges OSM measures
// (barrier=kerb lines, footway=sidewalk ways), read straight from the .osm and compared with the lanes the viewer draws.
// Nothing from the converter's code is used, so the two sides can cross-check each other. Per sample along an OSM line
// (every 1 m): its distance to the nearest drawn lane of the matching kind (0 = inside it). Samples farther than
// UNMATCHED_M from any such lane are counted as unmatched (the network has no counterpart there), not as distances.
// Guarded by tests/osmEdges.test.ts.
import { sampleS } from "../xodr/build";
import { evalRoad } from "../xodr/geometry";
import { laneBorders, sectionIndex } from "../xodr/lanes";
import type { OpenDrive } from "../xodr/model";
import { kids, parseXml } from "../xodr/xml";

export type P2 = [number, number];
export const UNMATCHED_M = 10; // m
export const STEP_M = 1; // m between samples along an OSM line

export interface OsmEdgeLines { kerbs: P2[][]; sidewalks: P2[][] } // lon / lat polylines

/** barrier=kerb lines and footway=sidewalk ways of an .osm file, as lon / lat polylines */
export function osmEdgeLines(osmText: string): OsmEdgeLines {
  const osm = parseXml(osmText);
  const root = kids(osm, "osm")[0] ?? osm;
  const nodes = new Map<string, P2>();
  for (const n of kids(root, "node")) nodes.set(n.attrs.id ?? "", [Number(n.attrs.lon), Number(n.attrs.lat)]);
  const out: OsmEdgeLines = { kerbs: [], sidewalks: [] };
  for (const w of kids(root, "way")) {
    const tags = new Map(kids(w, "tag").map((t) => [t.attrs.k ?? "", t.attrs.v ?? ""]));
    const kerb = tags.get("barrier") === "kerb", sidewalk = tags.get("footway") === "sidewalk";
    if (!kerb && !sidewalk) continue;
    const line = kids(w, "nd").map((nd) => nodes.get(nd.attrs.ref ?? "")).filter((p): p is P2 => !!p);
    if (line.length < 2) continue;
    (kerb ? out.kerbs : out.sidewalks).push(line);
  }
  return out;
}

/** points every `step` metres along a polyline (file metres), ends included */
export function densify(line: P2[], step = STEP_M): P2[] {
  const out: P2[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i], len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** distance from points to a set of polygons (0 inside), through a grid of polygon edges */
export class PolygonDistance {
  private readonly cells = new Map<string, number[]>();
  private readonly polys: P2[][];
  private readonly cell: number;
  constructor(polys: P2[][], cell = 10) {
    this.polys = polys; this.cell = cell;
    polys.forEach((poly, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++)
        for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
          const k = `${cx},${cy}`; const l = this.cells.get(k); if (l) l.push(i); else this.cells.set(k, [i]);
        }
    });
  }
  /** distance in metres to the nearest polygon within `maxDist`, 0 inside one; Infinity when none is that close */
  distance([px, py]: P2, maxDist = UNMATCHED_M): number {
    const r = Math.ceil(maxDist / this.cell), cx = Math.floor(px / this.cell), cy = Math.floor(py / this.cell), seen = new Set<number>();
    let best = Infinity;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (const i of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
      if (seen.has(i)) continue;
      seen.add(i);
      const poly = this.polys[i];
      let inside = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const [xa, ya] = poly[a], [xb, yb] = poly[b];
        if ((ya > py) !== (yb > py) && px < ((xb - xa) * (py - ya)) / (yb - ya) + xa) inside = !inside;
        const ex = xb - xa, ey = yb - ya, l2 = ex * ex + ey * ey;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - xa) * ex + (py - ya) * ey) / l2)) : 0;
        best = Math.min(best, Math.hypot(px - (xa + t * ex), py - (ya + t * ey)));
      }
      if (inside) return 0;
    }
    return best <= maxDist ? best : Infinity;
  }
}

export interface EdgeStats { samples: number; nearNetwork: number; matched: number; inside: number; median: number; p95: number; within05: number }

/**
 * distances of every sample to the polygons: matched ones summarised; unmatched (no polygon within UNMATCHED_M) counted.
 * With `near`, only samples near the network (any lane within UNMATCHED_M) count: OSM beyond the built roads is left out
 */
export function edgeStats(lines: P2[][], polys: PolygonDistance, near?: PolygonDistance): EdgeStats {
  const d: number[] = [];
  let samples = 0, nearNetwork = 0;
  for (const line of lines) for (const p of densify(line)) {
    samples++;
    if (near && !Number.isFinite(near.distance(p))) continue;
    nearNetwork++;
    const v = polys.distance(p); if (Number.isFinite(v)) d.push(v);
  }
  d.sort((a, b) => a - b);
  const q = (f: number) => (d.length ? d[Math.floor(f * (d.length - 1))] : NaN);
  return { samples, nearNetwork, matched: d.length, inside: d.filter((v) => v === 0).length, median: q(0.5), p95: q(0.95), within05: d.filter((v) => v <= 0.5).length };
}

/** lane types that are not the carriageway: the kerb lies between these and it */
const OFF_CARRIAGEWAY = new Set(["sidewalk", "walking", "curb", "border", "none", "median", "restricted"]);

/**
 * The drawn carriageway edge of every road (file metres): on each side, the outer border of the outermost lane that is
 * part of the carriageway (driving, parking, biking, bus, shoulder, ...), along the road. An OSM kerb line should lie on it.
 */
export function carriagewayEdges(od: OpenDrive): P2[][] {
  const out: P2[][] = [];
  for (const road of od.roads) {
    const left: P2[] = [], right: P2[] = [];
    for (const s of sampleS(road)) {
      const sec = road.sections[sectionIndex(road, s)];
      if (!sec) continue;
      const b = laneBorders(road, sec, s), p = evalRoad(road, s);
      for (const [lanes, side] of [[sec.left, left], [sec.right, right]] as const) {
        let t: number | null = null;
        for (const l of lanes) if (!OFF_CARRIAGEWAY.has(l.type)) t = b.get(l.id)?.outer ?? t; // lanes run inside out
        if (t !== null) side.push([p.x - t * Math.sin(p.hdg), p.y + t * Math.cos(p.hdg)]);
      }
    }
    if (left.length > 1) out.push(left);
    if (right.length > 1) out.push(right);
  }
  return out;
}

/** distance to a set of polylines through a grid of their segments; Infinity beyond maxDist */
export class LineDistance {
  private readonly cells = new Map<string, [P2, P2][]>();
  private readonly cell: number;
  constructor(lines: P2[][], cell = 10) {
    this.cell = cell;
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      for (let cx = Math.floor(Math.min(a[0], b[0]) / cell); cx <= Math.floor(Math.max(a[0], b[0]) / cell); cx++)
        for (let cy = Math.floor(Math.min(a[1], b[1]) / cell); cy <= Math.floor(Math.max(a[1], b[1]) / cell); cy++) {
          const k = `${cx},${cy}`; const l = this.cells.get(k); if (l) l.push([a, b]); else this.cells.set(k, [[a, b]]);
        }
    }
  }
  distance([px, py]: P2, maxDist = UNMATCHED_M): number {
    const r = Math.ceil(maxDist / this.cell), cx = Math.floor(px / this.cell), cy = Math.floor(py / this.cell);
    let best = Infinity;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (const [[xa, ya], [xb, yb]] of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
      const ex = xb - xa, ey = yb - ya, l2 = ex * ex + ey * ey, t = l2 > 0 ? Math.max(0, Math.min(1, ((px - xa) * ex + (py - ya) * ey) / l2)) : 0;
      best = Math.min(best, Math.hypot(px - (xa + t * ex), py - (ya + t * ey)));
    }
    return best <= maxDist ? best : Infinity;
  }
}

export interface KerbStats { samples: number; nearNetwork: number; matched: number; medianSigned: number; p95abs: number; within05: number; overrun: number }

/**
 * Kerb lines against the drawn carriageway edge: per sample near the network (any lane within UNMATCHED_M), the signed
 * distance to the nearest edge: positive when the kerb lies outside the drawn carriageway (the road is drawn too narrow),
 * negative when inside it (drawn too wide, overrunning the kerb). Samples with no edge within UNMATCHED_M are unmatched.
 */
export function kerbStats(lines: P2[][], edges: LineDistance, carriageway: PolygonDistance, anyLane: PolygonDistance): KerbStats {
  const d: number[] = [];
  let samples = 0, near = 0;
  for (const line of lines) for (const p of densify(line)) {
    samples++;
    if (!Number.isFinite(anyLane.distance(p))) continue;
    near++;
    const e = edges.distance(p);
    if (!Number.isFinite(e)) continue;
    d.push(carriageway.distance(p, 0.001) === 0 ? -e : e);
  }
  const s = [...d].sort((a, b) => a - b), a = d.map(Math.abs).sort((x, y) => x - y);
  return {
    samples, nearNetwork: near, matched: d.length, medianSigned: s.length ? s[s.length >> 1] : NaN,
    p95abs: a.length ? a[Math.floor(0.95 * (a.length - 1))] : NaN, within05: a.filter((v) => v <= 0.5).length, overrun: d.filter((v) => v < -0.5).length,
  };
}

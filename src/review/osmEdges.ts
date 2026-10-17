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

/** the share of a polygon's area (file metres) inside any of `cover`'s polygons, on a grid of `step` metres */
export function coveredShare(poly: P2[], cover: PolygonDistance, step = 0.25): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  let n = 0, inside = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
    let inPoly = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const [xa, ya] = poly[a], [xb, yb] = poly[b];
      if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inPoly = !inPoly;
    }
    if (!inPoly) continue;
    n++;
    if (cover.distance([x, y], 0.001) === 0) inside++;
  }
  return n ? inside / n : 0;
}

// ---- the shared definitions agreed with the converter (2026-10-18), so both sides measure the same thing ----------------

/** lat0, lon0, lat1, lon1 of the converter's --clip box per area (OdrForge tools/inspect/gate.py) */
export type ClipBox = [number, number, number, number];
export const insideClip = (ring: P2[], c: ClipBox) => ring.every(([lon, lat]) => lat >= c[0] && lat <= c[2] && lon >= c[1] && lon <= c[3]);

export interface OsmKerbData {
  kerbs: P2[][]; // open barrier=kerb ways (closed rings dropped)
  islands: P2[][]; // area:highway=traffic_island, footway=traffic_island polygons
  pedestrian: P2[][]; // highway=pedestrian areas and area:highway=pedestrian polygons
  parking: P2[][]; // closed parking=street_side|lane|layby ways
}

/** everything the shared kerb and parking measures need from an .osm (lon / lat) */
export function osmKerbData(osmText: string): OsmKerbData {
  const osm = parseXml(osmText);
  const root = kids(osm, "osm")[0] ?? osm;
  const nodes = new Map<string, P2>();
  for (const n of kids(root, "node")) nodes.set(n.attrs.id ?? "", [Number(n.attrs.lon), Number(n.attrs.lat)]);
  const out: OsmKerbData = { kerbs: [], islands: [], pedestrian: [], parking: [] };
  for (const w of kids(root, "way")) {
    const t = new Map(kids(w, "tag").map((x) => [x.attrs.k ?? "", x.attrs.v ?? ""]));
    const refs = kids(w, "nd").map((nd) => nd.attrs.ref ?? ""), closed = refs.length >= 4 && refs[0] === refs[refs.length - 1];
    const line = refs.map((r) => nodes.get(r)).filter((p): p is P2 => !!p);
    if (line.length !== refs.length || line.length < 2) continue;
    if (t.get("barrier") === "kerb" && !closed) out.kerbs.push(line);
    if (closed && (t.get("area:highway") === "traffic_island" || t.get("footway") === "traffic_island")) out.islands.push(line);
    if (closed && (t.get("area:highway") === "pedestrian" || (t.get("highway") === "pedestrian" && t.get("area") === "yes"))) out.pedestrian.push(line);
    if (closed && ["street_side", "lane", "layby"].includes(t.get("parking") ?? "")) out.parking.push(line);
  }
  return out;
}

export interface Seg { a: P2; b: P2 }

/** the drawn carriageway edge of every plain (non-junction) road, as directed segments */
export function plainRoadEdges(od: OpenDrive): P2[][] {
  return carriagewayEdges({ ...od, roads: od.roads.filter((r) => r.junction === "-1") });
}

/** nearest segment within maxDist whose direction is within maxAngle of `dir` (either way); Infinity when none */
export class ParallelEdges {
  private readonly cells = new Map<string, Seg[]>();
  private readonly cell: number;
  constructor(lines: P2[][], cell = 10) {
    this.cell = cell;
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      for (let cx = Math.floor(Math.min(a[0], b[0]) / cell); cx <= Math.floor(Math.max(a[0], b[0]) / cell); cx++)
        for (let cy = Math.floor(Math.min(a[1], b[1]) / cell); cy <= Math.floor(Math.max(a[1], b[1]) / cell); cy++) {
          const k = `${cx},${cy}`; const l = this.cells.get(k); if (l) l.push({ a, b }); else this.cells.set(k, [{ a, b }]);
        }
    }
  }
  distance([px, py]: P2, dir: P2, maxDist = UNMATCHED_M, maxAngleDeg = 25): number {
    const r = Math.ceil(maxDist / this.cell), cx = Math.floor(px / this.cell), cy = Math.floor(py / this.cell), cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    let best = Infinity;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (const { a: [xa, ya], b: [xb, yb] } of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
      const ex = xb - xa, ey = yb - ya, l2 = ex * ex + ey * ey;
      if (l2 === 0) continue;
      if (Math.abs((ex * dir[0] + ey * dir[1]) / (Math.sqrt(l2) * dl)) < cosMax) continue; // not roughly parallel
      const t = Math.max(0, Math.min(1, ((px - xa) * ex + (py - ya) * ey) / l2));
      best = Math.min(best, Math.hypot(px - (xa + t * ex), py - (ya + t * ey)));
    }
    return best <= maxDist ? best : Infinity;
  }
}

/** a kerb that bounds an island or a pedestrian area: half or more of its samples inside or within 0.5 m of one */
export function kerbOfArea(kerb: P2[], areas: PolygonDistance): boolean {
  const s = densify(kerb);
  return s.filter((p) => areas.distance(p, 0.5) <= 0.5).length * 2 >= s.length;
}

export interface SharedKerbStats { kerbs: number; dropped: number; samples: number; matched: number; medianSigned: number; p95abs: number; within05: number; within03: number }

/**
 * The shared kerb-gap measure (P2's proof): every 1 m along each kept kerb, the signed distance to the nearest roughly
 * parallel (< 25°) plain-road carriageway edge within 10 m: + outside the drawn carriageway (road too narrow), - inside.
 * Closed kerbs are not passed in; kerbs of islands and pedestrian areas are dropped.
 */
export function sharedKerbStats(kerbs: P2[][], edges: ParallelEdges, carriageway: PolygonDistance, areas: PolygonDistance): SharedKerbStats {
  const d: number[] = [];
  let samples = 0, dropped = 0;
  for (const k of kerbs) {
    if (kerbOfArea(k, areas)) { dropped++; continue; }
    const s = densify(k);
    for (let i = 0; i < s.length; i++) {
      samples++;
      const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)];
      const e = edges.distance(s[i], [b[0] - a[0], b[1] - a[1]]);
      if (Number.isFinite(e)) d.push(carriageway.distance(s[i], 0.001) === 0 ? -e : e);
    }
  }
  const sorted = [...d].sort((x, y) => x - y), abs = d.map(Math.abs).sort((x, y) => x - y);
  return {
    kerbs: kerbs.length, dropped, samples, matched: d.length, medianSigned: sorted.length ? sorted[sorted.length >> 1] : NaN,
    p95abs: abs.length ? abs[Math.floor(0.95 * (abs.length - 1))] : NaN, within05: abs.filter((v) => v <= 0.5).length, within03: abs.filter((v) => v <= 0.3).length,
  };
}

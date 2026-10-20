// OSM edges against the drawn network: an independent check of how the generated roads follow the edges OSM measures
// (barrier=kerb lines, footway=sidewalk ways), read straight from the .osm and compared with the lanes the viewer draws.
// Nothing from the converter's code is used, so the two sides can cross-check each other. Per sample along an OSM line
// (every 1 m): its distance to the nearest drawn lane of the matching kind (0 = inside it). Samples farther than
// UNMATCHED_M from any such lane are counted as unmatched (the network has no counterpart there), not as distances.
// Guarded by tests/osmEdges.test.ts.
import { sampleS } from "../xodr/build";
import { evalRoad } from "../xodr/geometry";
import { laneBorders, laneOffsetAt, sectionIndex } from "../xodr/lanes";
import type { OpenDrive } from "../xodr/model";
import { kids, parseXml } from "../xodr/xml";

export type P2 = [number, number];
export const UNMATCHED_M = 10; // m
export const STEP_M = 1; // m between samples along an OSM line

export interface OsmEdgeLines { kerbs: P2[][]; sidewalks: P2[][] } // lon / lat polylines

/** one OSM way: its id, tags and node refs, and the lon / lat of the nodes the file has (a node it lacks is left out) */
export interface OsmWay { id: string; tags: Map<string, string>; refs: string[]; line: P2[]; closed: boolean }

/** every way of an .osm file; closed: at least 4 refs, the first equal to the last */
export function osmWays(osmText: string): OsmWay[] {
  const osm = parseXml(osmText);
  const root = kids(osm, "osm")[0] ?? osm;
  const nodes = new Map<string, P2>();
  for (const n of kids(root, "node")) nodes.set(n.attrs.id ?? "", [Number(n.attrs.lon), Number(n.attrs.lat)]);
  return kids(root, "way").map((w) => {
    const refs = kids(w, "nd").map((nd) => nd.attrs.ref ?? "");
    return {
      id: w.attrs.id ?? "", tags: new Map(kids(w, "tag").map((t) => [t.attrs.k ?? "", t.attrs.v ?? ""])), refs,
      line: refs.map((r) => nodes.get(r)).filter((p): p is P2 => !!p), closed: refs.length >= 4 && refs[0] === refs[refs.length - 1],
    };
  });
}

// what each OSM edge is, by its tags (the definitions the measures below and the OSM reference overlay share)
type Tags = Map<string, string>;
export const isKerb = (t: Tags) => t.get("barrier") === "kerb";
export const isSidewalk = (t: Tags) => t.get("footway") === "sidewalk";
export const isTrafficIsland = (t: Tags) => t.get("area:highway") === "traffic_island" || t.get("footway") === "traffic_island";
export const isPedestrianArea = (t: Tags) => t.get("area:highway") === "pedestrian" || (t.get("highway") === "pedestrian" && t.get("area") === "yes");
export const isStreetParking = (t: Tags) => ["street_side", "lane", "layby"].includes(t.get("parking") ?? "");

/** barrier=kerb lines and footway=sidewalk ways of an .osm file, as lon / lat polylines */
export function osmEdgeLines(osmText: string): OsmEdgeLines {
  const out: OsmEdgeLines = { kerbs: [], sidewalks: [] };
  for (const w of osmWays(osmText)) {
    const kerb = isKerb(w.tags), sidewalk = isSidewalk(w.tags);
    if ((!kerb && !sidewalk) || w.line.length < 2) continue;
    (kerb ? out.kerbs : out.sidewalks).push(w.line);
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
export interface SidedEdge { line: P2[]; side: 1 | -1 } // side: +1 the road's left edge, -1 its right edge (s increasing)

export function carriagewayEdges(od: OpenDrive): SidedEdge[] {
  const out: SidedEdge[] = [];
  for (const road of od.roads) {
    const left: P2[] = [], right: P2[] = [];
    for (const s of sampleS(road)) {
      const sec = road.sections[sectionIndex(road, s)];
      if (!sec) continue;
      const b = laneBorders(road, sec, s), p = evalRoad(road, s);
      const outer = (lanes: typeof sec.left) => {
        let t: number | null = null;
        for (const l of lanes) if (!OFF_CARRIAGEWAY.has(l.type)) t = b.get(l.id)?.outer ?? t; // lanes run inside out
        return t;
      };
      let tl = outer(sec.left), tr = outer(sec.right);
      // a side without carriageway lanes (one carriageway of a dual road): its edge is the lane-0 line (the lane offset),
      // so a kerb in the central median meets its own edge, not the far edge across the carriageway
      const t0 = laneOffsetAt(road, s);
      if (tl === null && tr !== null) tl = t0;
      if (tr === null && tl !== null) tr = t0;
      if (tl !== null) left.push([p.x - tl * Math.sin(p.hdg), p.y + tl * Math.cos(p.hdg)]);
      if (tr !== null) right.push([p.x - tr * Math.sin(p.hdg), p.y + tr * Math.cos(p.hdg)]);
    }
    if (left.length > 1) out.push({ line: left, side: 1 });
    if (right.length > 1) out.push({ line: right, side: -1 });
  }
  return out;
}

/**
 * the carriageway edges of the junctions' connecting roads, only on the sides that have carriageway lanes: a connecting
 * road usually has lanes on one side, and the lane-0 fallback of plain roads would put an edge through the junction
 */
export function connectingRoadEdges(od: OpenDrive): SidedEdge[] {
  const out: SidedEdge[] = [];
  for (const road of od.roads) {
    if (road.junction === "-1") continue;
    const left: P2[] = [], right: P2[] = [];
    for (const s of sampleS(road)) {
      const sec = road.sections[sectionIndex(road, s)];
      if (!sec) continue;
      const b = laneBorders(road, sec, s), p = evalRoad(road, s);
      const outer = (lanes: typeof sec.left) => {
        let t: number | null = null;
        for (const l of lanes) if (!OFF_CARRIAGEWAY.has(l.type)) t = b.get(l.id)?.outer ?? t;
        return t;
      };
      const tl = outer(sec.left), tr = outer(sec.right);
      if (tl !== null) left.push([p.x - tl * Math.sin(p.hdg), p.y + tl * Math.cos(p.hdg)]);
      if (tr !== null) right.push([p.x - tr * Math.sin(p.hdg), p.y + tr * Math.cos(p.hdg)]);
    }
    if (left.length > 1) out.push({ line: left, side: 1 });
    if (right.length > 1) out.push({ line: right, side: -1 });
  }
  return out;
}

/**
 * The edges the shared kerb gap is measured against (agreed with the converter 2026-10-20): every plain road's
 * carriageway edge, and the junction connecting roads' carriageway edges on the sides with carriageway lanes. Kerbs at
 * junction corners bound the junction's carriageway: with plain roads only, 14 % of London's samples matched an arm's
 * end point, which no edge position can reach
 */
export const kerbGapEdges = (od: OpenDrive): SidedEdge[] => [...plainRoadEdges(od), ...connectingRoadEdges(od)];

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
/** the clip box an output records in its header (userData code "clip" = "lat0,lon0,lat1,lon1"), or null */
export function headerClip(userData: { code: string; value: string }[]): ClipBox | null {
  const v = userData.find((u) => u.code === "clip")?.value.split(",").map(Number);
  return v && v.length === 4 && v.every(Number.isFinite) ? [v[0], v[1], v[2], v[3]] : null;
}
export const insideClip = (ring: P2[], c: ClipBox) => ring.every(([lon, lat]) => lat >= c[0] && lat <= c[2] && lon >= c[1] && lon <= c[3]);

export interface OsmKerbData {
  kerbs: P2[][]; // open barrier=kerb ways (closed rings dropped)
  islands: P2[][]; // area:highway=traffic_island, footway=traffic_island polygons
  pedestrian: P2[][]; // highway=pedestrian areas and area:highway=pedestrian polygons
  parking: P2[][]; // closed parking=street_side|lane|layby ways
  parkingIds: string[]; // their OSM way ids, in the same order
}

/** everything the shared kerb and parking measures need from an .osm (lon / lat); ways missing a node are left out */
export function osmKerbData(osmText: string): OsmKerbData {
  const out: OsmKerbData = { kerbs: [], islands: [], pedestrian: [], parking: [], parkingIds: [] };
  for (const { id, tags: t, refs, line, closed } of osmWays(osmText)) {
    if (line.length !== refs.length || line.length < 2) continue;
    if (isKerb(t) && !closed) out.kerbs.push(line);
    if (closed && isTrafficIsland(t)) out.islands.push(line);
    if (closed && isPedestrianArea(t)) out.pedestrian.push(line);
    if (closed && isStreetParking(t)) { out.parking.push(line); out.parkingIds.push(id); }
  }
  return out;
}

export interface Seg { a: P2; b: P2; out: P2 } // out: the unit normal pointing away from the road

/** the drawn carriageway edge of every plain (non-junction) road, with its side */
export function plainRoadEdges(od: OpenDrive): SidedEdge[] {
  return carriagewayEdges({ ...od, roads: od.roads.filter((r) => r.junction === "-1") });
}

/**
 * Nearest edge segment within maxDist whose direction is within maxAngle of `dir` (either way), and on which side of it
 * the point lies: + away from its road (outside the drawn carriageway), - towards it. Signed by the edge's own outward
 * normal (left edges: the left normal of the road's direction; right edges: the right normal), agreed with the converter.
 */
export class ParallelEdges {
  private readonly cells = new Map<string, Seg[]>();
  private readonly cell: number;
  constructor(edges: SidedEdge[], cell = 10) {
    this.cell = cell;
    for (const { line, side } of edges) for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l === 0) continue;
      const out: P2 = side === 1 ? [-(b[1] - a[1]) / l, (b[0] - a[0]) / l] : [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
      for (let cx = Math.floor(Math.min(a[0], b[0]) / cell); cx <= Math.floor(Math.max(a[0], b[0]) / cell); cx++)
        for (let cy = Math.floor(Math.min(a[1], b[1]) / cell); cy <= Math.floor(Math.max(a[1], b[1]) / cell); cy++) {
          const k = `${cx},${cy}`; const c = this.cells.get(k); if (c) c.push({ a, b, out }); else this.cells.set(k, [{ a, b, out }]);
        }
    }
  }
  /** signed distance (see the class comment); NaN when no roughly parallel edge is within maxDist */
  signed([px, py]: P2, dir: P2, maxDist = UNMATCHED_M, maxAngleDeg = 25): number {
    const r = Math.ceil(maxDist / this.cell), cx = Math.floor(px / this.cell), cy = Math.floor(py / this.cell), cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    let best = Infinity, sign = 1;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (const { a: [xa, ya], b: [xb, yb], out } of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
      const ex = xb - xa, ey = yb - ya, l2 = ex * ex + ey * ey;
      if (Math.abs((ex * dir[0] + ey * dir[1]) / (Math.sqrt(l2) * dl)) < cosMax) continue; // not roughly parallel
      const t = Math.max(0, Math.min(1, ((px - xa) * ex + (py - ya) * ey) / l2)), fx = xa + t * ex, fy = ya + t * ey;
      const d = Math.hypot(px - fx, py - fy);
      if (d < best) { best = d; sign = (px - fx) * out[0] + (py - fy) * out[1] >= 0 ? 1 : -1; }
    }
    return best <= maxDist ? sign * best : NaN;
  }
}

/**
 * Samples at 0.5, 1.5, 2.5 ... m along a line (endpoints left out, so consecutive ways never share a sample); none for a
 * line shorter than 1 m. The kerb sampling agreed with the converter
 */
export function midSamples(line: P2[], step = 1): P2[] {
  const out: P2[] = [];
  let next = step / 2, run = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i], len = Math.hypot(bx - ax, by - ay);
    while (len > 0 && next <= run + len) { const f = (next - run) / len; out.push([ax + (bx - ax) * f, ay + (by - ay) * f]); next += step; }
    run += len;
  }
  return run < 1 ? [] : out;
}

/** a kerb that bounds an island or a pedestrian area: half or more of its samples inside or within 0.5 m of one */
export function kerbOfArea(kerb: P2[], areas: PolygonDistance): boolean {
  const s = midSamples(kerb);
  return s.filter((p) => areas.distance(p, 0.5) <= 0.5).length * 2 >= s.length;
}

/** the signed gap (ParallelEdges.signed) at each of a kerb's samples `s` (its midSamples); NaN where no edge is parallel */
export function sampleGaps(kerb: P2[], s: P2[], edges: ParallelEdges): number[] {
  return s.map((p, i) => {
    // the kerb's local direction from its neighbouring samples (a one-sample kerb: its own end-to-end direction)
    const a = s.length > 1 ? s[Math.max(0, i - 1)] : kerb[0], b = s.length > 1 ? s[Math.min(s.length - 1, i + 1)] : kerb[kerb.length - 1];
    return edges.signed(p, [b[0] - a[0], b[1] - a[1]]);
  });
}

export interface SharedKerbStats { kerbs: number; dropped: number; samples: number; matched: number; medianSigned: number; p95abs: number; within05: number; within03: number }

/**
 * The shared kerb-gap measure (P2's proof): every 1 m along each kept kerb, the signed distance to the nearest roughly
 * parallel (< 25°) plain-road carriageway edge within 10 m: + outside the drawn carriageway (road too narrow), - inside.
 * Closed kerbs are not passed in; kerbs shorter than 1 m are skipped; kerbs of islands and pedestrian areas are dropped.
 */
export function sharedKerbStats(kerbs: P2[][], edges: ParallelEdges, areas: PolygonDistance): SharedKerbStats {
  const d: number[] = [];
  let samples = 0, dropped = 0;
  for (const k of kerbs) {
    const s = midSamples(k);
    if (!s.length) continue; // shorter than 1 m
    if (kerbOfArea(k, areas)) { dropped++; continue; }
    for (const e of sampleGaps(k, s, edges)) { samples++; if (Number.isFinite(e)) d.push(e); }
  }
  const sorted = [...d].sort((x, y) => x - y), abs = d.map(Math.abs).sort((x, y) => x - y);
  return {
    kerbs: kerbs.length, dropped, samples, matched: d.length, medianSigned: sorted.length ? sorted[sorted.length >> 1] : NaN,
    p95abs: abs.length ? abs[Math.floor(0.95 * (abs.length - 1))] : NaN, within05: abs.filter((v) => v <= 0.5).length, within03: abs.filter((v) => v <= 0.3).length,
  };
}

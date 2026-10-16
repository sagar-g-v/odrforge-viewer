// Comparing two networks (A: the one under review, B: another build of the same area): roads and junctions matched by
// id, then per matched road the length, the reference line's position and height (sampled polylines, nearest-segment
// distance), the lane layout of every lane section, links, junction membership and signal / object counts.
// Ids are a converter's choice: when B renumbers its roads the id match says little and the map overlay (B drawn over
// A) is the comparison to trust; the summary reports how many roads matched.
import type { RenderData } from "./build";
import type { OpenDrive, Road } from "./model";

export type DiffKind = "added" | "removed" | "changed";
export interface DiffItem { kind: DiffKind; what: "road" | "junction"; id: string; detail: string; lon: number; lat: number; }
export interface CompareResult {
  a: { roads: number; junctions: number; lanes: number; km: number; signals: number; objects: number };
  b: { roads: number; junctions: number; lanes: number; km: number; signals: number; objects: number };
  matchedRoads: number; items: DiffItem[];
  tolerance: { position: number; height: number; length: number };
}

const TOL = { position: 0.05, height: 0.05, length: 0.01 }; // m: smaller differences are not reported

/** the reference line polyline (lon, lat, z) of road index ri from render.refs */
function refLine(r: RenderData, ri: number): Float64Array | null {
  const k = r.refs.meta.indexOf(ri);
  if (k < 0) return null;
  return r.refs.positions.subarray(3 * r.refs.starts[k], 3 * r.refs.starts[k + 1]);
}

/**
 * largest horizontal distance (m) from the points of b to the polyline a, and the largest height difference there;
 * nearest segment searched in a window that follows the last match (both lines run the same way along s)
 */
export function polylineDeviation(a: Float64Array, b: Float64Array): { horizontal: number; vertical: number; at: [number, number] } {
  const na = a.length / 3, nb = b.length / 3;
  if (na < 2 || nb < 1) return { horizontal: Infinity, vertical: Infinity, at: [b[0] ?? a[0], b[1] ?? a[1]] };
  // metres per degree of longitude / latitude on the WGS84 ellipsoid at the road's latitude (series to ~1 mm per km)
  const f = (a[1] * Math.PI) / 180;
  const mx = 111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f) + 0.118 * Math.cos(5 * f);
  const my = 111132.92 - 559.82 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f) - 0.0023 * Math.cos(6 * f);
  let best = 0, bestV = 0, at: [number, number] = [b[0], b[1]], seg = 0;
  for (let j = 0; j < nb; j++) {
    const px = b[3 * j] * mx, py = b[3 * j + 1] * my, pz = b[3 * j + 2];
    let dMin = Infinity, zAt = 0;
    const scan = (i0: number, i1: number) => {
      for (let i = Math.max(0, i0); i < Math.min(na - 1, i1); i++) {
        const ax = a[3 * i] * mx, ay = a[3 * i + 1] * my, bx = a[3 * i + 3] * mx, by = a[3 * i + 4] * my;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const t = L2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
        const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
        if (d < dMin) { dMin = d; seg = i; zAt = a[3 * i + 2] + t * (a[3 * i + 5] - a[3 * i + 2]); }
      }
    };
    scan(seg - 8, seg + 40);
    if (dMin > 1) scan(0, na - 1); // lost the track (a changed shape): search the whole line
    if (dMin > best) { best = dMin; at = [b[3 * j], b[3 * j + 1]]; }
    const dv = Math.abs(pz - zAt);
    if (dMin < 1 && dv > bestV) bestV = dv; // heights compared where the lines coincide
  }
  return { horizontal: best, vertical: bestV, at };
}

const layout = (road: Road) => road.sections.map((sec) =>
  [...sec.left.slice().reverse(), ...sec.right].map((l) => `${l.id}:${l.type}`).join(" ")).join(" | ");
const link = (l: Road["pred"]) => (l ? `${l.type} ${l.id}${l.contact ? ` ${l.contact}` : ""}` : "none");

function stats(od: OpenDrive, r: RenderData) {
  return {
    roads: od.roads.length, junctions: od.junctions.length, lanes: r.stats.lanes, km: r.stats.lengthKm,
    signals: od.roads.reduce((n, x) => n + x.signals.length, 0), objects: od.roads.reduce((n, x) => n + x.objects.length, 0),
  };
}

const mid = (r: RenderData, ri: number): [number, number] => {
  const p = refLine(r, ri);
  if (!p || !p.length) return [NaN, NaN];
  const k = 3 * Math.floor(p.length / 6);
  return [p[k], p[k + 1]];
};

export function compareNetworks(A: OpenDrive, rA: RenderData, B: OpenDrive, rB: RenderData): CompareResult {
  const items: DiffItem[] = [];
  const ia = new Map(A.roads.map((x, i) => [x.id, i])), ib = new Map(B.roads.map((x, i) => [x.id, i]));
  let matched = 0;
  for (const [id, i] of ia) {
    if (ib.has(id)) continue;
    const [lon, lat] = mid(rA, i);
    items.push({ kind: "removed", what: "road", id, detail: `only in A (${A.roads[i].length.toFixed(1)} m)`, lon, lat });
  }
  for (const [id, j] of ib) {
    if (ia.has(id)) continue;
    const [lon, lat] = mid(rB, j);
    items.push({ kind: "added", what: "road", id, detail: `only in B (${B.roads[j].length.toFixed(1)} m)`, lon, lat });
  }
  for (const [id, i] of ia) {
    const j = ib.get(id);
    if (j === undefined) continue;
    matched++;
    const a = A.roads[i], b = B.roads[j], notes: string[] = [];
    let [lon, lat] = mid(rA, i);
    if (Math.abs(a.length - b.length) > TOL.length) notes.push(`length ${a.length.toFixed(2)} → ${b.length.toFixed(2)} m`);
    const pa = refLine(rA, i), pb = refLine(rB, j);
    if (pa && pb) {
      const d = polylineDeviation(pa, pb), d2 = polylineDeviation(pb, pa);
      const h = Math.max(d.horizontal, d2.horizontal), v = Math.max(d.vertical, d2.vertical);
      if (h > TOL.position) { notes.push(`reference line moved up to ${h.toFixed(2)} m`); [lon, lat] = d.horizontal >= d2.horizontal ? d.at : d2.at; }
      if (v > TOL.height) notes.push(`height differs up to ${v.toFixed(2)} m`);
    }
    if (layout(a) !== layout(b)) notes.push(`lanes ${a.sections.length} section(s) [${layout(a)}] → ${b.sections.length} [${layout(b)}]`);
    if (link(a.pred) !== link(b.pred)) notes.push(`predecessor ${link(a.pred)} → ${link(b.pred)}`);
    if (link(a.succ) !== link(b.succ)) notes.push(`successor ${link(a.succ)} → ${link(b.succ)}`);
    if (a.junction !== b.junction) notes.push(`junction ${a.junction} → ${b.junction}`);
    if (a.signals.length !== b.signals.length) notes.push(`signals ${a.signals.length} → ${b.signals.length}`);
    if (a.objects.length !== b.objects.length) notes.push(`objects ${a.objects.length} → ${b.objects.length}`);
    if (notes.length) items.push({ kind: "changed", what: "road", id, detail: notes.join("; "), lon, lat });
  }
  // junctions: by id, connection count and boundary
  const ja = new Map(A.junctions.map((x) => [x.id, x])), jb = new Map(B.junctions.map((x) => [x.id, x]));
  const jPos = (r: RenderData, id: string): [number, number] => {
    const k = r.junctions.meta.findIndex((m) => m.id === id);
    if (k < 0) return [NaN, NaN];
    const s = r.junctions.starts[k], e = r.junctions.starts[k + 1];
    let lon = 0, lat = 0;
    for (let v = s; v < e; v++) { lon += r.junctions.positions[3 * v]; lat += r.junctions.positions[3 * v + 1]; }
    return [lon / (e - s), lat / (e - s)];
  };
  for (const [id, x] of ja) {
    const y = jb.get(id);
    if (!y) { const [lon, lat] = jPos(rA, id); items.push({ kind: "removed", what: "junction", id, detail: `only in A (${x.connections.length} connections)`, lon, lat }); continue; }
    const notes: string[] = [];
    if (x.connections.length !== y.connections.length) notes.push(`connections ${x.connections.length} → ${y.connections.length}`);
    const la = x.connections.reduce((n, c) => n + c.laneLinks.length, 0), lb = y.connections.reduce((n, c) => n + c.laneLinks.length, 0);
    if (la !== lb) notes.push(`lane links ${la} → ${lb}`);
    if ((x.boundary.length > 0) !== (y.boundary.length > 0)) notes.push(`boundary ${x.boundary.length ? "yes" : "no"} → ${y.boundary.length ? "yes" : "no"}`);
    if (x.type !== y.type) notes.push(`type ${x.type} → ${y.type}`);
    if (notes.length) { const [lon, lat] = jPos(rA, id); items.push({ kind: "changed", what: "junction", id, detail: notes.join("; "), lon, lat }); }
  }
  for (const [id, y] of jb)
    if (!ja.has(id)) { const [lon, lat] = jPos(rB, id); items.push({ kind: "added", what: "junction", id, detail: `only in B (${y.connections.length} connections)`, lon, lat }); }
  return { a: stats(A, rA), b: stats(B, rB), matchedRoads: matched, items, tolerance: TOL };
}

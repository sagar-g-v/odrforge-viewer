// OpenDrive model -> compact render buffers (lon, lat, z per vertex) for deck.gl binary layers.
// Sampling: every element and record boundary, at most 2 m apart, closer on curves (chord error <= 1 cm).
import { curvatureAt, evalGeom, evalRoad, type Pose } from "./geometry";
import { elevationAt, laneBorders, laneHeight, sectionEnd, surfaceZ, laneOffsetAt } from "./lanes";
import type { Geom, OpenDrive, OutlineCorner, Road, RoadMark } from "./model";
import { FeatureBuilder, signalKind, type Features, type Rgba } from "./features";
import { MARK } from "../design/scene";
import { boundaryRing, hull, virtualSpanRing, type JunctionMeta } from "./junctions";

export type Project = (x: number, y: number) => [number, number];

export interface LaneMeta { road: number; section: number; lane: number; type: string; junction: boolean; }
/** one drawn mark line: colour, width (m), dash (m on, m off) or null for a continuous line */
/** a driving-direction arrow on a lane: both = @direction="both" (or the deprecated type bidirectional), double-headed */
export interface ArrowMeta { road: number; lane: number; forward: boolean; both: boolean; }
export interface MarkMeta { road: number; color: Rgba; width: number; dash: [number, number] | null; }
export interface PointMeta { road: number; index: number; kind: "signal" | "object"; dynamic: boolean; label: string; stop?: boolean; }

export interface Binary { positions: Float64Array; starts: Uint32Array; } // starts: vertex index of each item, plus the total

export interface RenderData {
  lanes: Binary & { meta: LaneMeta[] };
  marks: Binary & { meta: MarkMeta[] };
  refs: Binary & { meta: number[] }; // road index
  objects: Binary & { meta: PointMeta[] }; // flat object outline areas
  objectLines: Binary & { meta: PointMeta[] }; // object outlines that are line features (@closed false)
  arrows: Binary & { meta: ArrowMeta[] }; // driving direction of every traffic lane (1.8.0 §11.2.1), flat on the lane
  junctions: Binary & { meta: JunctionMeta[] }; // closed outlines: the file's <boundary>, else an approximate hull
  features: Features; // signals, objects, bridges / tunnels, cross paths as 3D shapes
  points: { positions: Float64Array; meta: PointMeta[] };
  // junction reference lines (1.8.0 §12.9) and elevation grids (§12.11); meta: index into junctions (-1: no drawn area)
  grids: { lines: Binary & { meta: number[] }; points: { positions: Float64Array; meta: number[] }; refLines: Binary & { meta: number[] } };
  bounds: [number, number, number, number]; // lon/lat
  zRange: [number, number];
  zGround: number; // median lane height: the level the surrounding ground is drawn at in relative mode
  stats: { roads: number; junctions: number; lanes: number; lengthKm: number; vertices: number };
  roads?: { id: string; name: string }[]; // by road index (refs / lane meta .road): the map tooltip names roads
}

class Buf {
  pos: number[] = [];
  starts: number[] = [];
  begin() { this.starts.push(this.pos.length / 3); }
  push(lon: number, lat: number, z: number) { this.pos.push(lon, lat, z); }
  done(): Binary { return { positions: Float64Array.from(this.pos), starts: Uint32Array.from([...this.starts, this.pos.length / 3]) }; }
}

const CHORD = 0.01; // m

/** lane types that carry traffic in a driving direction (sidewalks, curbs, shoulders, parking, medians do not) */
const DIRECTED = new Set(["driving", "bus", "taxi", "hov", "biking", "entry", "exit", "onramp", "offramp", "connectingramp",
  "bidirectional", "slipLane".toLowerCase(), "tram", "rail"]);
const ARROW_EVERY = 20; // m between arrows along a lane

/**
 * Driving direction of a lane (1.8.0 §11.2.1): with @rule RHT the right lanes (negative id) run along the reference
 * line (+s) and the left lanes against it; LHT the other way round; @direction="reversed" flips that,
 * @direction="both" (and the deprecated type bidirectional) allows both
 */
export function laneDirection(rule: "RHT" | "LHT", laneId: number, direction: string, type: string): { forward: boolean; both: boolean } {
  const std = rule === "RHT" ? laneId < 0 : laneId > 0;
  return { forward: direction === "reversed" ? !std : std, both: direction === "both" || type === "bidirectional" };
}
const MAX_STEP = 2.0; // m

/** sample positions along a road: element / record / section boundaries and curvature-adaptive steps */
export function sampleS(road: Road): number[] {
  const S: number[] = [0, road.length];
  for (const g of road.geoms) {
    S.push(g.s);
    let ds = 0;
    while (ds < g.length) {
      const k = Math.abs(curvatureAt(g, ds));
      const step = k > 1e-9 ? Math.min(MAX_STEP, Math.max(0.05, Math.sqrt((8 * CHORD) / k))) : MAX_STEP;
      ds = Math.min(g.length, ds + step);
      S.push(g.s + ds);
    }
  }
  for (const r of road.laneOffset) S.push(r.s);
  for (const r of road.elevation) S.push(r.s);
  for (const sec of road.sections) {
    S.push(sec.s);
    for (const l of [...sec.left, ...sec.right]) {
      for (const w of l.widths) S.push(sec.s + w.s);
      for (const h of l.heights) S.push(sec.s + h.s);
    }
  }
  const out = S.filter((s) => s >= 0 && s <= road.length + 1e-9).sort((a, b) => a - b);
  return out.filter((s, i) => i === 0 || s - out[i - 1] > 1e-6);
}

/** median z of a position buffer (every k-th vertex: at most ~20000 sampled) */
export function medianZ(pos: Float64Array): number {
  const n = pos.length / 3;
  if (!n) return 0;
  const k = Math.max(1, Math.floor(n / 20000)), zs: number[] = [];
  for (let i = 0; i < n; i += k) zs.push(pos[3 * i + 2]);
  zs.sort((a, b) => a - b);
  return zs[zs.length >> 1];
}

// road mark colours (1.8.0 e_roadMarkColor; "standard" is white): the design system's paint (design/scene.ts MARK)
const MARK_COLOR: Record<string, Rgba> = MARK;
const markColor = (c: string): Rgba => MARK_COLOR[c] ?? MARK_COLOR.standard;
// display defaults where OpenDRIVE leaves the pattern to the country: broken 3 m on / 9 m off, Botts' dots every 1.2 m
const BROKEN: [number, number] = [3, 9], DOTS: [number, number] = [0.12, 1.08];

export interface MarkLineSpec { off: number; color: Rgba; width: number; dash: [number, number] | null; }
/**
 * The lines of one <roadMark> (1.8.0 §11.8): its explicit <type><line> elements (tOffset, length / space), else the
 * lines its type names. Two-line types are ordered "from inside to outside, centre lane from left to right"
 * (1.9.0 Annex A, e_roadMarkType); `inside` is the t direction of the inside (+1 / -1), 0 for the centre lane.
 */
export function markLines(m: RoadMark, inside: number): MarkLineSpec[] {
  const w = m.width > 0 ? m.width : 0.12;
  if (m.lines.length)
    return m.lines.map((l) => ({ off: l.tOffset, color: markColor(l.color), width: l.width > 0 ? l.width : w, dash: l.space > 0 ? [l.length, l.space] : null }));
  const one = (t: string, off: number): MarkLineSpec | null => {
    if (t === "solid" || t === "edge" || t === "custom") return { off, color: markColor(m.color), width: w, dash: null };
    if (t === "broken") return { off, color: markColor(m.color), width: w, dash: BROKEN };
    if (t === "botts dots") return { off, color: markColor(m.color), width: Math.max(w, 0.1), dash: DOTS };
    if (t === "curb") return { off, color: MARK.curb, width: Math.max(w, 0.15), dash: null };
    if (t === "grass") return { off, color: MARK.grass, width: Math.max(w, 0.3), dash: null };
    return null;
  };
  if (m.type === "none" || !m.type) return [];
  if (m.type === "botts dots") return [one("botts dots", 0)!];
  const parts = m.type.split(" ");
  if (parts.length === 2) {
    const first = inside === 0 ? 1 : inside, d = w; // lines w apart (centre to centre 2 w)
    return [one(parts[0], first * d), one(parts[1], -first * d)].filter((x): x is MarkLineSpec => !!x);
  }
  const single = one(m.type, 0);
  return single ? [single] : [];
}

/** pose on a junction reference line at s; past its end the last element continues straight (grid rows can lie there) */
export function refLinePose(geoms: Geom[], s: number): Pose {
  let g = geoms[0];
  for (const q of geoms) if (q.s <= s + 1e-9) g = q;
  const ds = s - g.s;
  if (ds <= g.length || g.kind === "line") return evalGeom(g, Math.max(0, ds));
  const e = evalGeom(g, g.length);
  return { x: e.x + (ds - g.length) * Math.cos(e.hdg), y: e.y + (ds - g.length) * Math.sin(e.hdg), hdg: e.hdg };
}

export function buildRender(od: OpenDrive, project: Project): RenderData {
  const lanes = new Buf(), marks = new Buf(), refs = new Buf(), objs = new Buf(), objLines = new Buf(), objLineMeta: PointMeta[] = [];
  const arrows = new Buf(), arrowMeta: ArrowMeta[] = [];
  const laneMeta: LaneMeta[] = [], markMeta: MarkMeta[] = [], refMeta: number[] = [], objMeta: PointMeta[] = [];
  const pts: number[] = [], ptMeta: PointMeta[] = [];
  const junctionPts = new Map<string, [number, number, number][]>(); // connecting-road lane borders per junction
  const off = od.header.offset, co = Math.cos(off.hdg), so = Math.sin(off.hdg);
  // file coordinates -> inertial (1.8.0 §6.3 header offset) -> lon / lat
  const geo = (x: number, y: number): [number, number] => project(co * x - so * y + off.x, so * x + co * y + off.y);
  const features = new FeatureBuilder(geo, off.z);
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity, zMin = Infinity, zMax = -Infinity;
  let nLanes = 0, len = 0;
  const at = (x: number, y: number, z: number, b: Buf) => {
    const [lon, lat] = geo(x, y);
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
    b.push(lon, lat, z + off.z);
  };

  od.roads.forEach((road, ri) => {
    if (!road.geoms.length) return;
    len += road.length;
    const S = sampleS(road);
    const poses = S.map((s) => evalRoad(road, s));
    const ptAt = (i: number, t: number) => {
      const p = poses[i];
      return [p.x - t * Math.sin(p.hdg), p.y + t * Math.cos(p.hdg)] as const;
    };
    // reference line
    refs.begin();
    refMeta.push(ri);
    S.forEach((s, i) => at(poses[i].x, poses[i].y, surfaceZ(road, s, 0), refs));

    road.sections.forEach((sec, k) => {
      const s1 = sectionEnd(road, k);
      const idx: number[] = [];
      S.forEach((s, i) => { if (s >= sec.s - 1e-9 && s <= s1 + 1e-9) idx.push(i); });
      if (idx.length < 2) return;
      const borders = idx.map((i) => laneBorders(road, sec, S[i]));
      for (const l of [...sec.left, ...sec.right]) {
        let wmax = 0;
        for (const b of borders) { const v = b.get(l.id)!; wmax = Math.max(wmax, Math.abs(v.outer - v.inner)); }
        if (wmax < 0.02) continue;
        lanes.begin();
        laneMeta.push({ road: ri, section: k, lane: l.id, type: l.type, junction: road.junction !== "-1" });
        nLanes++;
        // ring: inner border forward, outer border back (heights: §11.10 inner / outer raise)
        const jp = road.junction !== "-1" ? (junctionPts.get(road.junction) ?? junctionPts.set(road.junction, []).get(road.junction)!) : null;
        idx.forEach((i, j) => {
          const b = borders[j].get(l.id)!, [hIn] = laneHeight(l, S[i] - sec.s);
          const [x, y] = ptAt(i, b.inner);
          at(x, y, surfaceZ(road, S[i], b.inner) + hIn, lanes);
        });
        for (let j = idx.length - 1; j >= 0; j--) {
          const i = idx[j], b = borders[j].get(l.id)!, [, hOut] = laneHeight(l, S[i] - sec.s);
          const [x, y] = ptAt(i, b.outer);
          const z = surfaceZ(road, S[i], b.outer) + hOut;
          at(x, y, z, lanes);
          if (jp && (j % 3 === 0 || j === 0 || j === idx.length - 1)) jp.push([x, y, z]);
        }
        // driving direction: an arrow every ARROW_EVERY m (one in the middle of a shorter lane), each vertex placed along
        // the lane itself at its centre line and on its surface, so the arrow follows curves and lane heights
        if (DIRECTED.has(l.type.toLowerCase())) {
          const dir = laneDirection(road.rule, l.id, l.direction, l.type), sgn = dir.forward ? 1 : -1, span = s1 - sec.s;
          const centres = span >= ARROW_EVERY ? Array.from({ length: Math.floor(span / ARROW_EVERY) }, (_, q) => sec.s + ARROW_EVERY / 2 + q * ARROW_EVERY)
            : span >= 3 ? [sec.s + span / 2] : [];
          for (const sc of centres) {
            const b0 = laneBorders(road, sec, sc).get(l.id)!, w = Math.abs(b0.outer - b0.inner);
            if (w < 1) continue;
            const L = Math.min(4.5, Math.max(2.4, 1.2 * w), span * 0.8), hl = Math.min(1.4, L * 0.4), hw = Math.min(0.9, w * 0.3), sw = hw * 0.36;
            const shape: [number, number][] = dir.both
              ? [[-L / 2, 0], [-L / 2 + hl, -hw], [-L / 2 + hl, -sw], [L / 2 - hl, -sw], [L / 2 - hl, -hw], [L / 2, 0], [L / 2 - hl, hw], [L / 2 - hl, sw], [-L / 2 + hl, sw], [-L / 2 + hl, hw]]
              : [[-L / 2, -sw], [L / 2 - hl, -sw], [L / 2 - hl, -hw], [L / 2, 0], [L / 2 - hl, hw], [L / 2 - hl, sw], [-L / 2, sw]];
            arrows.begin();
            arrowMeta.push({ road: ri, lane: l.id, forward: dir.forward, both: dir.both });
            for (const [u, v] of shape) {
              // u along the driving direction, v to its left: on the reference line s = sc + sgn u, t = centre + sgn v
              const sv = Math.min(Math.max(sc + sgn * u, sec.s), s1), p = evalRoad(road, sv), b = laneBorders(road, sec, sv).get(l.id)!;
              const t = (b.inner + b.outer) / 2 + sgn * v, [hIn, hOut] = laneHeight(l, sv - sec.s);
              at(p.x - t * Math.sin(p.hdg), p.y + t * Math.cos(p.hdg), surfaceZ(road, sv, t) + (hIn + hOut) / 2, arrows);
            }
          }
        }
        // road marks on the lane's outer border (1.8.0 §11.8): every line of every <roadMark> record
        l.marks.forEach((m, mi) => {
          const a = sec.s + m.s, e = mi + 1 < l.marks.length ? sec.s + l.marks[mi + 1].s : s1;
          const seg = idx.map((i, j) => [i, j] as const).filter(([i]) => S[i] >= a - 1e-9 && S[i] <= e + 1e-9);
          if (seg.length < 2) return;
          for (const ln of markLines(m, l.id < 0 ? 1 : -1)) {
            marks.begin();
            markMeta.push({ road: ri, color: ln.color, width: ln.width, dash: ln.dash });
            for (const [i, j] of seg) {
              const b = borders[j].get(l.id)!, [, hOut] = laneHeight(l, S[i] - sec.s), t = b.outer + ln.off;
              const [x, y] = ptAt(i, t);
              at(x, y, surfaceZ(road, S[i], t) + hOut, marks);
            }
          }
        });
      }
      // centre lane marks on lane 0 (two-line types from left to right)
      const c = sec.center;
      if (c) c.marks.forEach((m, mi) => {
        const a = sec.s + m.s, e = mi + 1 < c.marks.length ? sec.s + c.marks[mi + 1].s : s1;
        const seg = idx.filter((i) => S[i] >= a - 1e-9 && S[i] <= e + 1e-9);
        if (seg.length < 2) return;
        for (const ln of markLines(m, 0)) {
          marks.begin();
          markMeta.push({ road: ri, color: ln.color, width: ln.width, dash: ln.dash });
          for (const i of seg) {
            const t = laneOffsetAt(road, S[i]) + ln.off;
            const [x, y] = ptAt(i, t);
            at(x, y, surfaceZ(road, S[i], t), marks);
          }
        }
      });
    });

    // signals (points) and objects with an outline (polygons)
    road.signals.forEach((sg, si) => {
      const p = evalRoad(road, sg.s);
      const x = p.x - sg.t * Math.sin(p.hdg), y = p.y + sg.t * Math.cos(p.hdg);
      const [lon, lat] = geo(x, y);
      pts.push(lon, lat, elevationAt(road, sg.s) + sg.zOffset + off.z); // zOffset: relative to the reference line's elevation (1.8.1 XSD)
      ptMeta.push({ road: ri, index: si, kind: "signal", dynamic: sg.dynamic, stop: signalKind(sg) === "stop",
        label: sg.name || `${sg.type}${sg.subtype && sg.subtype !== "-1" ? "-" + sg.subtype : ""}` });
    });
    road.objects.forEach((o, oi) => {
      const p = evalRoad(road, o.s);
      const x0 = p.x - o.t * Math.sin(p.hdg), y0 = p.y + o.t * Math.cos(p.hdg);
      const h = p.hdg + o.hdg, z0 = elevationAt(road, o.s) + o.zOffset; // zOffset: relative to the reference line's elevation (1.8.1 XSD)
      const meta: PointMeta = { road: ri, index: oi, kind: "object", dynamic: false, label: o.name || o.type };
      if (o.repeats.length) return;
      // corners in file coordinates: <cornerLocal> rotated by the object's heading about its insertion point (z from the
      // object's base), <cornerRoad> at (s, t) with z = reference line elevation + dz (1.8.0 §13.3.1 / §13.3.2)
      const xyz = (c: OutlineCorner): [number, number, number, number] => {
        if (c.kind === "local")
          return [x0 + c.u * Math.cos(h) - c.v * Math.sin(h), y0 + c.u * Math.sin(h) + c.v * Math.cos(h), z0 + c.z, c.height];
        const q = evalRoad(road, Math.min(Math.max(c.s, 0), road.length));
        return [q.x - c.t * Math.sin(q.hdg), q.y + c.t * Math.cos(q.hdg), elevationAt(road, c.s) + c.dz, c.height];
      };
      let outlines = o.outlines.map((ol) => ({ closed: ol.closed, pts: ol.corners.map(xyz) }));
      if (!outlines.length && o.length > 0 && o.width > 0 && o.height <= 0.05) { // flat, without outline: a marking area
        const L = o.length / 2, W = o.width / 2;
        outlines = [{ closed: true, pts: [[-L, -W], [L, -W], [L, W], [-L, W]].map(([u, v]) => xyz({ kind: "local", u, v, z: 0, height: 0 })) }];
      }
      for (const ol of outlines) {
        const top = Math.max(0, ...ol.pts.map((q) => q[3]));
        if (ol.closed && ol.pts.length >= 3 && top > 0.05) features.prism(ol.pts, top, { kind: "object", road: ri, index: oi });
        else if (ol.closed && ol.pts.length >= 3) {
          objs.begin();
          objMeta.push(meta);
          for (const [x, y, z] of ol.pts) at(x, y, z, objs);
        } else if (ol.pts.length >= 2) {
          objLines.begin();
          objLineMeta.push(meta);
          for (const [x, y, z] of ol.pts) at(x, y, z, objLines);
        }
      }
    });
    features.addRoad(road, ri);
  });
  features.addCrossPaths(od, new Map(od.roads.map((r, i) => [r.id, i])));

  // junction areas: the <boundary> outline (1.8.0 §12.10) where the file has one, a virtual junction's main-road span
  // (§12.5) next, else the hull of its connecting roads
  const juncs = new Buf(), juncMeta: JunctionMeta[] = [];
  const byId = new Map(od.roads.map((r) => [r.id, r]));
  for (const j of od.junctions) {
    let ring = j.boundary.length ? boundaryRing(j, byId) : null, outline: JunctionMeta["outline"] = "boundary";
    if (!ring || ring.length < 3) { ring = j.type.toLowerCase() === "virtual" ? virtualSpanRing(j, byId) : null; outline = "span"; }
    if (!ring || ring.length < 3) { ring = hull(junctionPts.get(j.id) ?? []); outline = "hull"; }
    if (!ring || ring.length < 3) continue;
    juncs.begin();
    const tunnel = j.connections.some((c) => [c.incomingRoad, c.connectingRoad].some((id) => byId.get(id)?.structures.some((st) => st.kind === "tunnel")));
    juncMeta.push({ id: j.id, exact: outline !== "hull", outline, connections: j.connections.length, type: j.type, tunnel });
    for (const [x, y, z] of ring) at(x, y, z, juncs); // drawn under the lanes by depth bias (MapView)
  }

  const L = lanes.done();
  const zGround = medianZ(L.positions);

  // junction reference lines and elevation grids, at the grid's z-values (the reference line itself has no elevation,
  // §12.9: drawn at the road level)
  const gLines = new Buf(), gLineMeta: number[] = [], gPts = new Buf(), gPtMeta: number[] = [], jRef = new Buf(), jRefMeta: number[] = [];
  const areaIndex = new Map(juncMeta.map((m, i) => [m.id, i]));
  for (const j of od.junctions) {
    if (!j.refLine.length) continue;
    const ji = areaIndex.get(j.id) ?? -1, end = j.refLine.reduce((a, g) => Math.max(a, g.s + g.length), 0);
    const pose = (s: number) => refLinePose(j.refLine, s);
    jRef.begin();
    jRefMeta.push(ji);
    const g = j.elevationGrid;
    // the line has no elevation of its own (§12.9): drawn at its grid's centre values (linear between rows), else the road level
    const centre = g && g.gridSpacing > 0 ? g.rows.map((r) => r.center[0]) : [];
    const zAt = (s: number) => {
      if (!g || !centre.length || !centre.every(Number.isFinite)) return zGround;
      const f = Math.min(Math.max((s - g.sStart) / g.gridSpacing, 0), centre.length - 1), k = Math.min(Math.floor(f), centre.length - 2);
      return centre.length === 1 ? centre[0] : centre[k] + (f - k) * (centre[k + 1] - centre[k]);
    };
    const n = Math.max(1, Math.ceil(end / 2));
    for (let k = 0; k <= n; k++) { const s = (end * k) / n, p = pose(s); at(p.x, p.y, zAt(s), jRef); }
    if (!g || !(g.gridSpacing > 0)) continue;
    // grid point (row k, lateral index i: 0 centre, +i left, -i right) -> x, y, z
    const rows = g.rows.map((r, k) => {
      const p = pose(g.sStart + k * g.gridSpacing), nx = -Math.sin(p.hdg), ny = Math.cos(p.hdg);
      const pts = new Map<number, [number, number, number]>();
      const put = (i: number, z: number) => { if (Number.isFinite(z)) pts.set(i, [p.x + nx * i * g.gridSpacing, p.y + ny * i * g.gridSpacing, z]); };
      if (r.center.length) put(0, r.center[0]);
      r.left.forEach((z, q) => put(q + 1, z));
      r.right.forEach((z, q) => put(-(q + 1), z));
      return pts;
    });
    for (const pts of rows) {
      for (const [x, y, z] of pts.values()) { gPts.begin(); gPtMeta.push(ji); at(x, y, z, gPts); }
      const idx = [...pts.keys()].sort((a, b) => a - b); // across the line: right outermost .. left outermost
      for (let q = 0; q + 1 < idx.length; q++) {
        if (idx[q + 1] !== idx[q] + 1) continue; // only between neighbouring grid points
        gLines.begin(); gLineMeta.push(ji);
        for (const i of [idx[q], idx[q + 1]]) { const [x, y, z] = pts.get(i)!; at(x, y, z, gLines); }
      }
    }
    for (let k = 0; k + 1 < rows.length; k++) // along the line: the same lateral index in consecutive rows
      for (const [i, a] of rows[k]) {
        const b = rows[k + 1].get(i);
        if (!b) continue;
        gLines.begin(); gLineMeta.push(ji);
        at(a[0], a[1], a[2], gLines); at(b[0], b[1], b[2], gLines);
      }
  }

  return {
    grids: { lines: { ...gLines.done(), meta: gLineMeta }, points: { positions: gPts.done().positions, meta: gPtMeta }, refLines: { ...jRef.done(), meta: jRefMeta } },
    junctions: { ...juncs.done(), meta: juncMeta },
    features: features.finish(),
    zGround,
    lanes: { ...L, meta: laneMeta },
    marks: { ...marks.done(), meta: markMeta },
    refs: { ...refs.done(), meta: refMeta },
    objects: { ...objs.done(), meta: objMeta },
    objectLines: { ...objLines.done(), meta: objLineMeta },
    arrows: { ...arrows.done(), meta: arrowMeta },
    points: { positions: Float64Array.from(pts), meta: ptMeta },
    bounds: [minLon, minLat, maxLon, maxLat],
    zRange: [Number.isFinite(zMin) ? zMin : 0, Number.isFinite(zMax) ? zMax : 0],
    stats: { roads: od.roads.length, junctions: od.junctions.length, lanes: nLanes, lengthKm: len / 1000, vertices: L.positions.length / 3 },
    roads: od.roads.map((rd) => ({ id: rd.id, name: rd.name })),
  };
}

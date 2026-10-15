// OpenDrive model -> compact render buffers (lon, lat, z per vertex) for deck.gl binary layers.
// Sampling: every element and record boundary, at most 2 m apart, closer on curves (chord error <= 1 cm).
import { curvatureAt, evalRoad } from "./geometry";
import { laneBorders, laneHeight, sectionEnd, surfaceZ, laneOffsetAt } from "./lanes";
import type { OpenDrive, Road } from "./model";

export type Project = (x: number, y: number) => [number, number];

export interface LaneMeta { road: number; section: number; lane: number; type: string; junction: boolean; }
export interface MarkMeta { road: number; color: "white" | "yellow"; broken: boolean; double: boolean; width: number; }
export interface PointMeta { road: number; index: number; kind: "signal" | "object"; dynamic: boolean; label: string; }

export interface Binary { positions: Float64Array; starts: Uint32Array; } // starts: vertex index of each item, plus the total

export interface RenderData {
  lanes: Binary & { meta: LaneMeta[] };
  marks: Binary & { meta: MarkMeta[] };
  refs: Binary & { meta: number[] }; // road index
  objects: Binary & { meta: PointMeta[] };
  points: { positions: Float64Array; meta: PointMeta[] };
  bounds: [number, number, number, number]; // lon/lat
  zRange: [number, number];
  zGround: number; // median lane height: the level the surrounding ground is drawn at in relative mode
  stats: { roads: number; junctions: number; lanes: number; lengthKm: number; vertices: number };
}

class Buf {
  pos: number[] = [];
  starts: number[] = [];
  begin() { this.starts.push(this.pos.length / 3); }
  push(lon: number, lat: number, z: number) { this.pos.push(lon, lat, z); }
  done(): Binary { return { positions: Float64Array.from(this.pos), starts: Uint32Array.from([...this.starts, this.pos.length / 3]) }; }
}

const CHORD = 0.01; // m
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

const markColor = (c: string): "white" | "yellow" => (c === "yellow" || c === "orange" ? "yellow" : "white");

export function buildRender(od: OpenDrive, project: Project): RenderData {
  const lanes = new Buf(), marks = new Buf(), refs = new Buf(), objs = new Buf();
  const laneMeta: LaneMeta[] = [], markMeta: MarkMeta[] = [], refMeta: number[] = [], objMeta: PointMeta[] = [];
  const pts: number[] = [], ptMeta: PointMeta[] = [];
  const off = od.header.offset, co = Math.cos(off.hdg), so = Math.sin(off.hdg);
  // file coordinates -> inertial (1.8.0 §6.3 header offset) -> lon / lat
  const geo = (x: number, y: number): [number, number] => project(co * x - so * y + off.x, so * x + co * y + off.y);
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
        idx.forEach((i, j) => {
          const b = borders[j].get(l.id)!, [hIn] = laneHeight(l, S[i] - sec.s);
          const [x, y] = ptAt(i, b.inner);
          at(x, y, surfaceZ(road, S[i], b.inner) + hIn, lanes);
        });
        for (let j = idx.length - 1; j >= 0; j--) {
          const i = idx[j], b = borders[j].get(l.id)!, [, hOut] = laneHeight(l, S[i] - sec.s);
          const [x, y] = ptAt(i, b.outer);
          at(x, y, surfaceZ(road, S[i], b.outer) + hOut, lanes);
        }
        // road marks on the lane's outer border (1.8.0 §11.8), one path per <roadMark> record
        l.marks.forEach((m, mi) => {
          if (m.type === "none" || m.type === "curb" || m.type === "grass" || m.type === "edge") return;
          const a = sec.s + m.s, e = mi + 1 < l.marks.length ? sec.s + l.marks[mi + 1].s : s1;
          const seg = idx.map((i, j) => [i, j] as const).filter(([i]) => S[i] >= a - 1e-9 && S[i] <= e + 1e-9);
          if (seg.length < 2) return;
          marks.begin();
          markMeta.push({ road: ri, color: markColor(m.color), broken: m.type.startsWith("broken"), double: m.type.includes(" "), width: m.width || 0.12 });
          for (const [i, j] of seg) {
            const b = borders[j].get(l.id)!, [, hOut] = laneHeight(l, S[i] - sec.s);
            const [x, y] = ptAt(i, b.outer);
            at(x, y, surfaceZ(road, S[i], b.outer) + hOut + 0.02, marks);
          }
        });
      }
      // centre lane marks on lane 0
      const c = sec.center;
      if (c) c.marks.forEach((m, mi) => {
        if (m.type === "none") return;
        const a = sec.s + m.s, e = mi + 1 < c.marks.length ? sec.s + c.marks[mi + 1].s : s1;
        const seg = idx.filter((i) => S[i] >= a - 1e-9 && S[i] <= e + 1e-9);
        if (seg.length < 2) return;
        marks.begin();
        markMeta.push({ road: ri, color: markColor(m.color), broken: m.type.startsWith("broken"), double: m.type.includes(" "), width: m.width || 0.12 });
        for (const i of seg) {
          const t = laneOffsetAt(road, S[i]);
          const [x, y] = ptAt(i, t);
          at(x, y, surfaceZ(road, S[i], t) + 0.02, marks);
        }
      });
    });

    // signals (points) and objects with an outline (polygons)
    road.signals.forEach((sg, si) => {
      const p = evalRoad(road, sg.s);
      const x = p.x - sg.t * Math.sin(p.hdg), y = p.y + sg.t * Math.cos(p.hdg);
      const [lon, lat] = geo(x, y);
      pts.push(lon, lat, surfaceZ(road, sg.s, sg.t) + sg.zOffset + off.z);
      ptMeta.push({ road: ri, index: si, kind: "signal", dynamic: sg.dynamic, label: sg.name || `${sg.type}${sg.subtype && sg.subtype !== "-1" ? "-" + sg.subtype : ""}` });
    });
    road.objects.forEach((o, oi) => {
      const p = evalRoad(road, o.s);
      const x0 = p.x - o.t * Math.sin(p.hdg), y0 = p.y + o.t * Math.cos(p.hdg);
      const h = p.hdg + o.hdg, z0 = surfaceZ(road, o.s, o.t) + o.zOffset;
      let corners = o.outline;
      if (!corners.length && o.length > 0 && o.width > 0) {
        const L = o.length / 2, W = o.width / 2;
        corners = [{ u: -L, v: -W, z: 0 }, { u: L, v: -W, z: 0 }, { u: L, v: W, z: 0 }, { u: -L, v: W, z: 0 }];
      }
      if (corners.length >= 3) {
        objs.begin();
        objMeta.push({ road: ri, index: oi, kind: "object", dynamic: false, label: o.name || o.type });
        for (const cn of corners)
          at(x0 + cn.u * Math.cos(h) - cn.v * Math.sin(h), y0 + cn.u * Math.sin(h) + cn.v * Math.cos(h), z0 + cn.z + 0.01, objs);
      } else {
        const [lon, lat] = geo(x0, y0);
        pts.push(lon, lat, z0 + off.z);
        ptMeta.push({ road: ri, index: oi, kind: "object", dynamic: false, label: o.name || o.type });
      }
    });
  });

  const L = lanes.done();
  return {
    zGround: medianZ(L.positions),
    lanes: { ...L, meta: laneMeta },
    marks: { ...marks.done(), meta: markMeta },
    refs: { ...refs.done(), meta: refMeta },
    objects: { ...objs.done(), meta: objMeta },
    points: { positions: Float64Array.from(pts), meta: ptMeta },
    bounds: [minLon, minLat, maxLon, maxLat],
    zRange: [Number.isFinite(zMin) ? zMin : 0, Number.isFinite(zMax) ? zMax : 0],
    stats: { roads: od.roads.length, junctions: od.junctions.length, lanes: nLanes, lengthKm: len / 1000, vertices: L.positions.length / 3 },
  };
}

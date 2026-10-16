// Road furniture as 3D shapes at their OpenDRIVE positions and sizes: signals (1.8.0 §14: boards, traffic lights,
// stop / waiting lines), objects (§13: trees, poles, street lamps, barriers stretched by <repeat>, sized boxes and
// cylinders), bridges and tunnels (§13.11 / §13.12) and junction cross paths (§12.12).
// Shapes are built from two primitives deck.gl draws without extra packages: round columns (ColumnLayer: radius,
// base height, extrusion) and extruded rectangles (SolidPolygonLayer, base at the polygon's z).
import { evalRoad } from "./geometry";
import { laneBorders, laneOffsetAt, sectionIndex, surfaceZ } from "./lanes";
import { sampleS } from "./build";
import type { OpenDrive, Road, RoadObject, Signal } from "./model";

export interface FeatureRef { kind: "signal" | "object" | "structure" | "crossPath"; road: number; index: number; }
export type Rgba = [number, number, number, number];

/** columns of one radius (ColumnLayer's radius is per layer): base position (lon, lat, z), extrusion, colour */
export interface ColumnSet { radius: number; positions: Float64Array; elevations: Float32Array; colors: Uint8Array; meta: FeatureRef[]; }
/** extruded rectangles: closed rings (lon, lat, z of the base), extrusion, colour */
export interface BoxSet { positions: Float64Array; starts: Uint32Array; elevations: Float32Array; colors: Uint8Array; meta: FeatureRef[]; }
export interface Features {
  columns: ColumnSet[];
  boxes: BoxSet;
  labels: { positions: Float64Array; texts: string[] };
  structures: { positions: Float64Array; starts: Uint32Array; meta: (FeatureRef & { tunnel: boolean })[] };
  crossPaths: { positions: Float64Array; starts: Uint32Array; meta: FeatureRef[] };
}

const C = {
  trunk: [112, 82, 52, 255] as Rgba, crown: [62, 138, 66, 225] as Rgba, pole: [150, 155, 162, 255] as Rgba,
  lamp: [255, 214, 120, 255] as Rgba, barrier: [182, 188, 196, 255] as Rgba, object: [196, 160, 90, 230] as Rgba,
  housing: [32, 35, 42, 255] as Rgba, red: [235, 52, 52, 255] as Rgba, amber: [245, 170, 40, 255] as Rgba,
  green: [46, 204, 98, 255] as Rgba, white: [246, 246, 246, 255] as Rgba, stop: [204, 32, 40, 255] as Rgba,
  sign: [44, 98, 206, 255] as Rgba, line: [250, 250, 250, 255] as Rgba,
};

const SPEED = new Set(["274", "R2-1", "323", "670", "B14", "R4-1"]);
const STOP = new Set(["206", "R1-1", "601.1", "AB4", "330", "Ra-1"]);
const YIELD = new Set(["205", "R1-2", "602", "AB3a", "329", "Ra-2"]);
const LIGHT = new Set(["1000001", "1000002", "1000011"]);

export type SignalKind = "light" | "speed" | "stop" | "yield" | "line" | "sign";
export function signalKind(sg: Signal): SignalKind {
  if (sg.dynamic || LIGHT.has(sg.type)) return "light";
  // a road marking signal: stop / waiting lines (OpenDRIVE 1100001, 294 DE) are flat and wide
  if (sg.type === "1100001" || sg.type === "294" || (sg.height > 0 && sg.height < 0.1 && sg.width > 1)) return "line";
  if (SPEED.has(sg.type) || sg.semantics.some((x) => x.startsWith("speed"))) return "speed";
  if (STOP.has(sg.type)) return "stop";
  if (YIELD.has(sg.type)) return "yield";
  return "sign";
}

type Geo = (x: number, y: number) => [number, number];

export class FeatureBuilder {
  private cols = new Map<number, { pos: number[]; elev: number[]; col: number[]; meta: FeatureRef[] }>();
  private box = { pos: [] as number[], starts: [] as number[], elev: [] as number[], col: [] as number[], meta: [] as FeatureRef[] };
  private lab = { pos: [] as number[], texts: [] as string[] };
  private str = { pos: [] as number[], starts: [] as number[], meta: [] as (FeatureRef & { tunnel: boolean })[] };
  private cp = { pos: [] as number[], starts: [] as number[], meta: [] as FeatureRef[] };

  private geo: Geo;
  private zOff: number;
  constructor(geo: Geo, zOff: number) {
    this.geo = geo;
    this.zOff = zOff;
  }

  private column(x: number, y: number, z: number, radius: number, height: number, color: Rgba, ref: FeatureRef) {
    const key = Math.max(0.02, Math.round(radius * 100) / 100);
    const c = this.cols.get(key) ?? this.cols.set(key, { pos: [], elev: [], col: [], meta: [] }).get(key)!;
    const [lon, lat] = this.geo(x, y);
    c.pos.push(lon, lat, z + this.zOff);
    c.elev.push(Math.max(0.01, height));
    c.col.push(...color);
    c.meta.push(ref);
  }

  /** a rectangle centred at (x, y), half-length hu along heading a, half-width hv across, from z up by height */
  private rect(x: number, y: number, a: number, hu: number, hv: number, z: number, height: number, color: Rgba, ref: FeatureRef) {
    const ca = Math.cos(a), sa = Math.sin(a);
    this.box.starts.push(this.box.pos.length / 3);
    for (const [u, v] of [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]]) {
      const [lon, lat] = this.geo(x + u * ca - v * sa, y + u * sa + v * ca);
      this.box.pos.push(lon, lat, z + this.zOff);
    }
    this.box.elev.push(Math.max(0.01, height));
    this.box.col.push(...color);
    this.box.meta.push(ref);
  }

  /**
   * an object outline with height: the area extruded to its greatest corner height (one extrusion per polygon in
   * SolidPolygonLayer; corners of different heights are drawn at the highest), base at each corner's z
   */
  prism(ring: [number, number, number, number][], height: number, ref: FeatureRef) {
    this.box.starts.push(this.box.pos.length / 3);
    for (const [x, y, z] of ring) {
      const [lon, lat] = this.geo(x, y);
      this.box.pos.push(lon, lat, z + this.zOff);
    }
    this.box.elev.push(height);
    this.box.col.push(...C.object);
    this.box.meta.push(ref);
  }

  private label(x: number, y: number, z: number, text: string) {
    const [lon, lat] = this.geo(x, y);
    this.lab.pos.push(lon, lat, z + this.zOff);
    this.lab.texts.push(text);
  }

  addRoad(road: Road, ri: number) {
    road.signals.forEach((sg, i) => this.signal(road, ri, sg, i));
    road.objects.forEach((o, i) => this.object(road, ri, o, i));
    road.structures.forEach((st, i) => this.structure(road, ri, st.s, st.length, st.kind === "tunnel", i));
  }

  private signal(road: Road, ri: number, sg: Signal, index: number) {
    const ref: FeatureRef = { kind: "signal", road: ri, index };
    const p = evalRoad(road, Math.min(Math.max(sg.s, 0), road.length));
    const x = p.x - sg.t * Math.sin(p.hdg), y = p.y + sg.t * Math.cos(p.hdg), ground = surfaceZ(road, sg.s, sg.t);
    const a = p.hdg + sg.hOffset; // the board spans across the road; it is thin along it
    const kind = signalKind(sg);
    const w = sg.width > 0 ? sg.width : kind === "light" ? 0.4 : 0.6, h = sg.height > 0 ? sg.height : kind === "light" ? 1 : 0.6;
    const base = ground + sg.zOffset;
    if (kind === "line") {
      this.rect(x, y, a, 0.15, w / 2, ground, Math.max(0.02, sg.height), C.line, ref); // a flat bar across the lanes
      return;
    }
    if (sg.zOffset > 0.05) this.column(x, y, ground, kind === "light" ? 0.06 : 0.04, sg.zOffset, C.pole, ref); // post
    if (kind === "light") {
      this.rect(x, y, a, 0.14, w / 2, base, h, C.housing, ref);
      // the lamps face the traffic the signal is for: "+" -> traffic along +s, which comes from -s
      const face = sg.orientation === "-" ? 1 : -1, d = 0.17;
      const lx = x + face * d * Math.cos(a), ly = y + face * d * Math.sin(a), r = Math.min(0.11, w / 3);
      [[C.red, 0.78], [C.amber, 0.5], [C.green, 0.22]].forEach(([c, f]) => this.column(lx, ly, base + h * (f as number) - r, r, 2 * r, c as Rgba, ref));
      return;
    }
    const color = kind === "speed" || kind === "yield" ? C.white : kind === "stop" ? C.stop : C.sign;
    this.rect(x, y, a, 0.03, w / 2, base, h, color, ref);
    const text = kind === "speed" && sg.value !== null ? String(sg.value) : kind === "stop" ? "STOP" : kind === "yield" ? "▽" : sg.text;
    if (text) this.label(x, y, base + h + 0.25, text);
  }

  private object(road: Road, ri: number, o: RoadObject, index: number) {
    const ref: FeatureRef = { kind: "object", road: ri, index };
    if (o.outlines.length && !o.repeats.length) return; // outlines are drawn from build.ts (flat areas, lines, prisms)
    const at = (s: number, t: number) => {
      const p = evalRoad(road, Math.min(Math.max(s, 0), road.length));
      return { x: p.x - t * Math.sin(p.hdg), y: p.y + t * Math.cos(p.hdg), hdg: p.hdg, z: surfaceZ(road, s, t) };
    };
    if (o.repeats.length) {
      for (const r of o.repeats) {
        const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
        if (r.distance > 0) {
          // discrete copies every `distance`
          for (let d = 0; d <= r.length + 1e-6; d += r.distance) {
            const f = r.length > 0 ? d / r.length : 0, q = at(r.s + d, lerp(r.tStart, r.tEnd, f));
            this.single(o, q.x, q.y, q.hdg + o.hdg, q.z + lerp(r.zOffsetStart, r.zOffsetEnd, f), lerp(r.heightStart, r.heightEnd, f) || o.height,
              lerp(r.widthStart, r.widthEnd, f) || o.width, lerp(r.lengthStart, r.lengthEnd, f) || o.length, ref);
          }
        } else {
          // one continuous object stretched along the road (guard rails, walls, fences): pieces of at most 2 m
          const n = Math.max(1, Math.ceil(r.length / 2));
          for (let k = 0; k < n; k++) {
            const f0 = k / n, f1 = (k + 1) / n, fm = (f0 + f1) / 2;
            const a = at(r.s + r.length * f0, lerp(r.tStart, r.tEnd, f0)), b = at(r.s + r.length * f1, lerp(r.tStart, r.tEnd, f1));
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len < 1e-3) continue;
            this.rect((a.x + b.x) / 2, (a.y + b.y) / 2, Math.atan2(b.y - a.y, b.x - a.x), len / 2, Math.max(0.03, lerp(r.widthStart, r.widthEnd, fm)) / 2,
              (a.z + b.z) / 2 + lerp(r.zOffsetStart, r.zOffsetEnd, fm), Math.max(0.05, lerp(r.heightStart, r.heightEnd, fm)), C.barrier, ref);
          }
        }
      }
      return;
    }
    const q = at(o.s, o.t);
    this.single(o, q.x, q.y, q.hdg + o.hdg, q.z + o.zOffset, o.height, o.width, o.length, ref);
  }

  /** one object at (x, y): trees, poles / lamps, and sized cylinders or boxes for everything else */
  private single(o: RoadObject, x: number, y: number, hdg: number, z: number, height: number, width: number, length: number, ref: FeatureRef) {
    const type = o.type.toLowerCase(), sub = o.subtype.toLowerCase();
    if (type === "tree" || type === "vegetation") {
      const h = height > 0 ? height : 6, r = o.radius > 0 ? o.radius : 1.5;
      this.column(x, y, z, Math.max(0.12, r * 0.1), h * 0.45, C.trunk, ref);
      this.column(x, y, z + h * 0.35, r, h * 0.65, C.crown, ref);
    } else if (type === "pole" || type === "streetlamp" || sub === "streetlamp") {
      const h = height > 0 ? height : 6;
      this.column(x, y, z, o.radius > 0 ? Math.min(o.radius, 0.2) : 0.1, h, C.pole, ref);
      if (type === "streetlamp" || sub === "streetlamp") this.column(x, y, z + h - 0.25, 0.28, 0.25, C.lamp, ref);
    } else if (o.radius > 0) {
      this.column(x, y, z, o.radius, height > 0 ? height : 1, C.object, ref);
    } else if (width > 0 || length > 0) {
      this.rect(x, y, hdg, Math.max(0.05, length) / 2, Math.max(0.05, width) / 2, z, height > 0 ? height : 0.1,
        type === "barrier" ? C.barrier : C.object, ref);
    } else {
      this.column(x, y, z, 0.25, height > 0 ? height : 1, C.object, ref); // no size given: a marker post
    }
  }

  /** the road's full cross section over [s0, s0 + length]: a bridge deck or a tunnel */
  private structure(road: Road, ri: number, s0: number, length: number, tunnel: boolean, index: number) {
    const s1 = Math.min(road.length, s0 + length);
    const S = [s0, ...sampleS(road).filter((s) => s > s0 + 1e-6 && s < s1 - 1e-6), s1];
    const left: number[][] = [], right: number[][] = [];
    for (const s of S) {
      const sec = road.sections[sectionIndex(road, s)];
      let lo = laneOffsetAt(road, s), hi = lo;
      if (sec) for (const b of laneBorders(road, sec, s).values()) { lo = Math.min(lo, b.inner, b.outer); hi = Math.max(hi, b.inner, b.outer); }
      const p = evalRoad(road, s);
      for (const [t, list] of [[hi, left], [lo, right]] as const) {
        const [lon, lat] = this.geo(p.x - t * Math.sin(p.hdg), p.y + t * Math.cos(p.hdg));
        list.push([lon, lat, surfaceZ(road, s, t) + this.zOff + 0.04]);
      }
    }
    this.str.starts.push(this.str.pos.length / 3);
    for (const q of [...left, ...right.reverse()]) this.str.pos.push(...q);
    this.str.meta.push({ kind: "structure", road: ri, index, tunnel });
  }

  addCrossPaths(od: OpenDrive, roadIndex: Map<string, number>) {
    od.junctions.forEach((j) => j.crossPaths.forEach((cp, k) => {
      const ri = roadIndex.get(cp.crossingRoad);
      if (ri === undefined) return;
      const road = od.roads[ri];
      this.cp.starts.push(this.cp.pos.length / 3);
      for (const s of sampleS(road)) {
        const p = evalRoad(road, s), [lon, lat] = this.geo(p.x, p.y);
        this.cp.pos.push(lon, lat, surfaceZ(road, s, 0) + this.zOff + 0.06);
      }
      this.cp.meta.push({ kind: "crossPath", road: ri, index: k });
    }));
  }

  finish(): Features {
    const bin = (pos: number[], starts: number[]) => ({ positions: Float64Array.from(pos), starts: Uint32Array.from([...starts, pos.length / 3]) });
    return {
      columns: [...this.cols.entries()].map(([radius, c]) => ({
        radius, positions: Float64Array.from(c.pos), elevations: Float32Array.from(c.elev), colors: Uint8Array.from(c.col), meta: c.meta,
      })),
      boxes: { ...bin(this.box.pos, this.box.starts), elevations: Float32Array.from(this.box.elev), colors: Uint8Array.from(this.box.col), meta: this.box.meta },
      labels: { positions: Float64Array.from(this.lab.pos), texts: this.lab.texts },
      structures: { ...bin(this.str.pos, this.str.starts), meta: this.str.meta },
      crossPaths: { ...bin(this.cp.pos, this.cp.starts), meta: this.cp.meta },
    };
  }
}

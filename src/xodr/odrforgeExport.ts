// OdrForge's viewer export: the `const DATA={...};` JSON that osm2xodr --viz embeds in its .html pages (src/viz.cpp).
// Lanes are already sampled there (delta-coded page units, cm), with per-point heights since OdrForge 2fdb8d3.
import type { Projector } from "./geo";
import { medianZ, type LaneMeta, type MarkMeta, type RenderData } from "./build";
import { hull, type JunctionMeta } from "./junctions";
import type { Features } from "./features";

const emptyFeatures = (): Features => {
  const none = { positions: new Float64Array(0), starts: Uint32Array.from([0]) };
  return { footprints: { ...none, colors: new Uint8Array(0), top: new Float32Array(0), meta: [] }, columns: [], boxes: { ...none, elevations: new Float32Array(0), colors: new Uint8Array(0), meta: [] },
    labels: { positions: new Float64Array(0), texts: [] }, structures: { ...none, meta: [] }, crossPaths: { ...none, meta: [] }, barrierLines: { ...none, meta: [] } };
};

const LANE_TYPES = ["driving", "sidewalk", "biking", "parking", "shoulder", "border", "median", "bidirectional", "other", "none"];

export interface ExportRoad { id: string; name: string; junction: string; length: number; }
export interface OdrForgeExport { title: string; geo: string; roads: ExportRoad[]; raw: Record<string, unknown>; }

/** the DATA object from an OdrForge .html page (or a .json holding the same object) */
export function extractExport(text: string): Record<string, unknown> {
  const t = text.trimStart();
  if (t.startsWith("{")) return JSON.parse(t);
  const key = "const DATA=";
  const at = text.indexOf(key);
  if (at < 0) throw new Error("no OdrForge viewer data (const DATA=...) in this file");
  let i = at + key.length, depth = 0, inStr = false;
  const start = i;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) { i++; break; } }
  }
  return JSON.parse(text.slice(start, i));
}

function decode(arr: number[], unit: number, ox: number, oy: number): number[] {
  const out: number[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < arr.length; i += 2) {
    if (i === 0) { x = arr[0]; y = arr[1]; } else { x += arr[i]; y += arr[i + 1]; }
    out.push(ox + x / unit, oy + y / unit);
  }
  return out;
}

export function buildFromExport(data: Record<string, unknown>, proj: Projector): { render: RenderData; info: OdrForgeExport } {
  const d = data as {
    title: string; geo: string; units?: string; origin: [number, number];
    roads: [string, string, string, number][]; lanes: unknown[][]; marks: [number, number, number[]][];
    refs: [number, number[]][]; stats?: { junctions?: number };
  };
  const unit = d.units === "cm" ? 100 : 10;
  const [ox, oy] = d.origin;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity, zMin = Infinity, zMax = -Infinity;
  const put = (out: number[], x: number, y: number, z: number) => {
    const [lon, lat] = proj.forward(x, y);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
    out.push(lon, lat, z);
  };
  const lanePos: number[] = [], laneStarts: number[] = [], laneMeta: LaneMeta[] = [];
  for (const l of d.lanes) {
    const xy = decode(l[5] as number[], unit, ox, oy);
    const zc = (l[6] as number[] | undefined) ?? [];
    let z = 0;
    laneStarts.push(lanePos.length / 3);
    for (let i = 0; i < xy.length / 2; i++) {
      if (i < zc.length) z = i ? z + zc[i] / unit : zc[0] / unit;
      put(lanePos, xy[2 * i], xy[2 * i + 1], zc.length ? z : 0);
    }
    const road = l[0] as number;
    laneMeta.push({ road, section: l[3] as number, lane: l[1] as number, type: LANE_TYPES[l[2] as number] ?? "other", junction: d.roads[road][2] !== "-1" });
  }
  const markPos: number[] = [], markStarts: number[] = [], markMeta: MarkMeta[] = [];
  for (const [style, color, p] of d.marks) {
    const xy = decode(p, unit, ox, oy);
    markStarts.push(markPos.length / 3);
    for (let i = 0; i < xy.length / 2; i++) put(markPos, xy[2 * i], xy[2 * i + 1], 0.02);
    // viz.cpp codes: style 1 solid, 2 broken, 3 - 6 two-line types, 7 dots / other; colour 1 yellow, 2 blue, 3 red, 4 green
    const rgba: [number, number, number, number][] = [[245, 247, 250, 255], [245, 196, 66, 255], [70, 130, 230, 255], [220, 60, 60, 255], [60, 170, 90, 255]];
    markMeta.push({ road: -1, color: rgba[color] ?? rgba[0], width: 0.12, dash: style === 2 || style === 6 ? [3, 9] : style === 7 ? [0.12, 1.08] : null });
  }
  const refPos: number[] = [], refStarts: number[] = [], refMeta: number[] = [];
  for (const [ri, p] of d.refs) {
    const xy = decode(p, unit, ox, oy);
    refStarts.push(refPos.length / 3);
    for (let i = 0; i < xy.length / 2; i++) put(refPos, xy[2 * i], xy[2 * i + 1], 0);
    refMeta.push(ri);
  }
  // junction areas: hull of each junction's connecting-road lanes (the export carries no boundary outlines)
  const jPts = new Map<string, [number, number, number][]>();
  laneMeta.forEach((m, k) => {
    const jid = d.roads[m.road][2];
    if (jid === "-1") return;
    const list = jPts.get(jid) ?? jPts.set(jid, []).get(jid)!;
    const end = k + 1 < laneStarts.length ? laneStarts[k + 1] : lanePos.length / 3;
    for (let v = laneStarts[k]; v < end; v += 3) list.push([lanePos[3 * v], lanePos[3 * v + 1], lanePos[3 * v + 2]]);
  });
  const jPos: number[] = [], jStarts: number[] = [], jMeta: JunctionMeta[] = [];
  for (const [id, ps] of jPts) {
    const ring = hull(ps);
    if (ring.length < 3) continue;
    jStarts.push(jPos.length / 3);
    for (const [lon, lat, z] of ring) jPos.push(lon, lat, z - 0.03);
    jMeta.push({ id, exact: false, outline: "hull", connections: 0, type: "", tunnel: false });
  }
  const bin = (pos: number[], starts: number[]) => ({ positions: Float64Array.from(pos), starts: Uint32Array.from([...starts, pos.length / 3]) });
  const roads = d.roads.map((r) => ({ id: r[0], name: r[1], junction: r[2], length: r[3] }));
  return {
    render: {
      lanes: { ...bin(lanePos, laneStarts), meta: laneMeta },
      marks: { ...bin(markPos, markStarts), meta: markMeta },
      refs: { ...bin(refPos, refStarts), meta: refMeta },
      objects: { positions: new Float64Array(0), starts: Uint32Array.from([0]), meta: [] },
      junctions: { ...bin(jPos, jStarts), meta: jMeta },
      features: emptyFeatures(),
      roads: roads.map((rd) => ({ id: rd.id, name: rd.name })),
      objectLines: { ...bin([], []), meta: [] },
      arrows: { ...bin([], []), meta: [] },
      grids: { lines: { ...bin([], []), meta: [] }, points: { positions: new Float64Array(0), meta: [] }, refLines: { ...bin([], []), meta: [] } },
      points: { positions: new Float64Array(0), meta: [] },
      bounds: [minLon, minLat, maxLon, maxLat],
      zRange: [Number.isFinite(zMin) ? zMin : 0, Number.isFinite(zMax) ? zMax : 0],
      zGround: medianZ(Float64Array.from(lanePos)),
      stats: { roads: roads.length, junctions: d.stats?.junctions ?? 0, lanes: laneMeta.length, lengthKm: roads.reduce((a, r) => a + r.length, 0) / 1000, vertices: lanePos.length / 3 },
    },
    info: { title: d.title, geo: d.geo, roads, raw: data },
  };
}

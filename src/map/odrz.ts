// The converter's ground grid (OdrForge tools/make_terrain.py, read by osm2xodr --terrain): a regular grid in the
// network's projected frame, float32 heights, NaN = unknown. The viewer uses it as its terrain where the network has
// one, so roads built from it sit exactly on the drawn ground (the open Terrarium DEM can be metres off in cities and
// steep terrain).
// File format (odrforge include/odrforge/terrain.hpp), little endian:
//   v1: char magic[8] = "ODRZGRD1"; double originX, originY (centre of cell [0,0]); double cell; int32 nx, ny;
//       char datum[32]; float32 z[ny][nx] (row 0 = southmost)
//   v2: magic "ODRZGRD2", int32 nlevels after ny; z[nlevels][ny][nx], level 0 = the ground

export interface GroundGrid {
  originX: number; originY: number; cell: number; nx: number; ny: number; levels: number; datum: string;
  z: Float32Array; // level 0 (ground), ny * nx, row 0 southmost
}

export function parseOdrz(buf: ArrayBuffer): GroundGrid {
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 8));
  if (magic !== "ODRZGRD1" && magic !== "ODRZGRD2") throw new Error("not an .odrz ground grid");
  const v = new DataView(buf);
  const originX = v.getFloat64(8, true), originY = v.getFloat64(16, true), cell = v.getFloat64(24, true);
  const nx = v.getInt32(32, true), ny = v.getInt32(36, true);
  let off = 40, levels = 1;
  if (magic === "ODRZGRD2") { levels = v.getInt32(40, true); off = 44; }
  const raw = new Uint8Array(buf, off, 32), end = raw.indexOf(0);
  const datum = new TextDecoder().decode(raw.subarray(0, end < 0 ? 32 : end));
  off += 32;
  if (!(nx > 0 && ny > 0 && levels > 0 && levels <= 16 && cell > 0)) throw new Error("bad .odrz header");
  if (buf.byteLength < off + levels * nx * ny * 4) throw new Error("truncated .odrz grid");
  // level 0 only; copied when the offset is not 4-byte aligned
  const z = off % 4 === 0 ? new Float32Array(buf, off, nx * ny) : new Float32Array(buf.slice(off, off + nx * ny * 4));
  return { originX, originY, cell, nx, ny, levels, datum, z };
}

/**
 * ground height at file coordinates (x, y): bilinear, NaN cells left out and the weights renormalised, NaN where none
 * of the four is known - exactly odrforge TerrainGrid::sample (src/terrain.cpp)
 */
export function sampleGrid(g: GroundGrid, x: number, y: number): number {
  const fx = (x - g.originX) / g.cell, fy = (y - g.originY) / g.cell;
  const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
  let sum = 0, wsum = 0;
  for (let dj = 0; dj <= 1; dj++)
    for (let di = 0; di <= 1; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
      const h = g.z[j * g.nx + i];
      if (Number.isNaN(h)) continue;
      const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty);
      sum += w * h;
      wsum += w;
    }
  return wsum > 1e-9 ? sum / wsum : NaN;
}

/** distance (m) from (x, y) inward to the grid's outer edge; negative outside */
export function insideBy(g: GroundGrid, x: number, y: number): number {
  const x0 = g.originX, y0 = g.originY, x1 = g.originX + (g.nx - 1) * g.cell, y1 = g.originY + (g.ny - 1) * g.cell;
  return Math.min(x - x0, x1 - x, y - y0, y1 - y);
}

/**
 * The ground the viewer draws: the network's grid, blended into the open DEM over `blend` metres inside the grid edge
 * (no cliff where the grid ends) and replaced by it where the grid has no value. Heights in metres above the grid's datum.
 */
export function groundHeight(g: GroundGrid, x: number, y: number, fallback: () => number, blend = 30): number {
  const d = insideBy(g, x, y);
  if (d < 0) return fallback();
  const h = sampleGrid(g, x, y);
  if (Number.isNaN(h)) return fallback();
  if (d >= blend) return h;
  const f = fallback();
  if (!Number.isFinite(f)) return h;
  const w = d / blend, s = w * w * (3 - 2 * w); // smoothstep
  return f + (h - f) * s;
}

/** fetch with progress (bytes received / total when the server says) */
export async function fetchGrid(url: string, onProgress?: (got: number, total: number) => void, signal?: AbortSignal): Promise<GroundGrid | null> {
  const r = await fetch(url, { cache: "no-store", signal });
  if (!r.ok || !r.body) return null;
  const total = Number(r.headers.get("content-length")) || 0;
  const reader = r.body.getReader(), parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress?.(got, total);
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return parseOdrz(all.buffer);
}

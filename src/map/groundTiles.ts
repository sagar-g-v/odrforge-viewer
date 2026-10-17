// MapLibre terrain from the network's own ground grid: a custom tile protocol that renders Terrarium-encoded DEM tiles
// on request. Each pixel holds the ground height at its centre (MapLibre DEMData samples DEM pixels at cell centres):
// the grid where it has a value, blended into the open Terrarium DEM near its edge, and Terrarium outside it. Tiles
// that do not touch the grid are Terrarium's own bytes. Under the roads the ground is pressed down to the road floor
// (map/roadFloor.ts): the road wins.
import * as maplibregl from "maplibre-gl";
import { DEM_MAXZOOM, TERRARIUM_TILES, decodeTerrarium } from "./dem";
import { groundHeight, type GroundGrid } from "./odrz";
import { floorAt, floorRadius, type RoadFloor } from "./roadFloor";
import type { Projector } from "../xodr/geo";

export const GROUND_PROTOCOL = "odrv-ground";
const DIM = 256;

// grid: the network's ground grid (null: Terrarium only); floor: the road floor (null: the ground as it is)
export interface Active { grid: GroundGrid | null; floor: RoadFloor | null; proj: Projector; bbox: [number, number, number, number]; }
let active: Active | null = null;

/** lon / lat box of a file-coordinate box (its corners and edge midpoints projected) */
function lonLatBox(proj: Projector, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]
    .map(([x, y]) => proj.forward(x, y));
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

/** the box tiles must be rendered in: the grid padded by a cell, and the floor's lattice */
export function activeGrid(grid: GroundGrid | null, proj: Projector, floor: RoadFloor | null = null): Active {
  const boxes: [number, number, number, number][] = [];
  if (grid) boxes.push(lonLatBox(proj, grid.originX - grid.cell, grid.originY - grid.cell, grid.originX + grid.nx * grid.cell, grid.originY + grid.ny * grid.cell));
  if (floor) boxes.push(lonLatBox(proj, ...floor.box));
  const bbox: [number, number, number, number] = boxes.length
    ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
    : [Infinity, Infinity, -Infinity, -Infinity];
  return { grid, floor, proj, bbox };
}

/** what tiles are drawn from (neither: Terrarium only); a new grid or floor needs a new source url (tiles are cached by url) */
export function setGroundGrid(grid: GroundGrid | null, proj: Projector | null, floor: RoadFloor | null = null) {
  active = proj && (grid || floor) ? activeGrid(grid, proj, floor) : null;
}

/** finest tile zoom worth rendering for a grid: pixels about the grid cell, at most z17 */
export function groundMaxZoom(g: { cell: number }, lat: number): number {
  const z = Math.log2((40075016.686 * Math.cos((lat * Math.PI) / 180)) / (DIM * g.cell));
  return Math.max(DEM_MAXZOOM, Math.min(17, Math.ceil(z)));
}

const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

// Terrarium tiles (decoded heights), a small cache
const cache = new Map<string, Promise<Float32Array | null>>();
async function terrariumBytes(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  const r = await fetch(TERRARIUM_TILES.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)), { signal });
  return r.ok ? r.arrayBuffer() : null;
}
function terrarium(z: number, x: number, y: number): Promise<Float32Array | null> {
  const k = `${z}/${x}/${y}`;
  let p = cache.get(k);
  if (!p) {
    p = (async () => {
      const b = await terrariumBytes(z, x, y);
      if (!b) return null;
      const bmp = await createImageBitmap(new Blob([b]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const cv = new OffscreenCanvas(DIM, DIM), ctx = cv.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      return decodeTerrarium(ctx.getImageData(0, 0, DIM, DIM).data);
    })().catch(() => null);
    cache.set(k, p);
    if (cache.size > 256) cache.delete(cache.keys().next().value!);
  }
  return p;
}

/**
 * Terrarium heights at the pixel centres of tile z/x/y: the tile itself up to Terrarium's finest level, below it the
 * finest-level tile resampled (bilinear between its pixel centres, as MapLibre would)
 */
async function terrariumAt(z: number, x: number, y: number): Promise<Float32Array> {
  const out = new Float32Array(DIM * DIM).fill(NaN);
  if (z <= DEM_MAXZOOM) {
    const t = await terrarium(z, x, y);
    if (t) out.set(t);
    return out;
  }
  const dz = z - DEM_MAXZOOM, k = 2 ** dz, px = Math.floor(x / k), py = Math.floor(y / k);
  const t = await terrarium(DEM_MAXZOOM, px, py);
  if (!t) return out;
  const at = (i: number, j: number) => t[Math.min(DIM - 1, Math.max(0, j)) * DIM + Math.min(DIM - 1, Math.max(0, i))];
  for (let j = 0; j < DIM; j++)
    for (let i = 0; i < DIM; i++) {
      // pixel centre of the child in the parent's pixel space, parent pixels centred at +0.5
      const u = ((x - px * k) * DIM + i + 0.5) / k - 0.5, v = ((y - py * k) * DIM + j + 0.5) / k - 0.5;
      const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
      out[j * DIM + i] = at(i0, j0) * (1 - fu) * (1 - fv) + at(i0 + 1, j0) * fu * (1 - fv) + at(i0, j0 + 1) * (1 - fu) * fv + at(i0 + 1, j0 + 1) * fu * fv;
    }
  return out;
}

/** Terrarium encoding of heights (m): R * 256 + G + B / 256 - 32768, 1/256 m steps */
export function encodeTerrarium(h: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(h.length * 4);
  for (let p = 0; p < h.length; p++) {
    // (h + 32768) * 256 = R * 65536 + G * 256 + B in whole steps
    const q = Math.min(0xffffff, Math.max(0, Math.round(((Number.isFinite(h[p]) ? h[p] : 0) + 32768) * 256)));
    out[4 * p] = q >> 16; out[4 * p + 1] = (q >> 8) & 255; out[4 * p + 2] = q & 255; out[4 * p + 3] = 255;
  }
  return out;
}

/** heights at the pixel centres of tile z/x/y: grid (blended at its edge) over Terrarium, pressed under the road floor */
export async function groundTileHeights(z: number, x: number, y: number, a: Active): Promise<Float32Array> {
  return groundTileFromBase(z, x, y, a, await terrariumAt(z, x, y));
}

/**
 * The pure part: grid heights (blended into `base` at the grid edge) at the pixel centres of tile z/x/y, each at most the
 * road floor's lowest cap within floorRadius of the pixel along each axis (map/roadFloor.ts)
 */
export function groundTileFromBase(z: number, x: number, y: number, a: Active, base: Float32Array): Float32Array {
  // the projection is locally affine at tile scale: project a 17 x 17 lattice and interpolate between its points
  const L = 16, gx = new Float64Array((L + 1) ** 2), gy = new Float64Array((L + 1) ** 2);
  for (let b = 0; b <= L; b++)
    for (let c = 0; c <= L; c++) {
      const [fx, fy] = a.proj.inverse(tileLon(x + c / L, z), tileLat(y + b / L, z));
      gx[b * (L + 1) + c] = fx; gy[b * (L + 1) + c] = fy;
    }
  const out = new Float32Array(DIM * DIM), F = a.floor;
  // the DEM pixel in file units (the lattice spans L / DIM of a tile per step)
  const radius = F ? floorRadius(Math.hypot(gx[1] - gx[0], gy[1] - gy[0]) * (L / DIM)) : 0;
  for (let j = 0; j < DIM; j++)
    for (let i = 0; i < DIM; i++) {
      const u = ((i + 0.5) / DIM) * L, v = ((j + 0.5) / DIM) * L, c0 = Math.min(L - 1, Math.floor(u)), b0 = Math.min(L - 1, Math.floor(v));
      const fu = u - c0, fv = v - b0, k00 = b0 * (L + 1) + c0, k01 = k00 + 1, k10 = k00 + L + 1, k11 = k10 + 1;
      const px = gx[k00] * (1 - fu) * (1 - fv) + gx[k01] * fu * (1 - fv) + gx[k10] * (1 - fu) * fv + gx[k11] * fu * fv;
      const py = gy[k00] * (1 - fu) * (1 - fv) + gy[k01] * fu * (1 - fv) + gy[k10] * (1 - fu) * fv + gy[k11] * fu * fv;
      const f = base[j * DIM + i];
      const h = a.grid ? groundHeight(a.grid, px, py, () => f) : f;
      out[j * DIM + i] = F ? Math.min(h, floorAt(F, px, py, radius)) : h;
    }
  return out;
}

let registered = false;
/** the tile protocol: odrv-ground://{z}/{x}/{y}?g=<grid and floor key> */
export function registerGroundProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol(GROUND_PROTOCOL, async (params, abort) => {
    const m = params.url.match(/:\/\/(\d+)\/(\d+)\/(\d+)/);
    if (!m) throw new Error(`bad ground tile url ${params.url}`);
    const z = +m[1], x = +m[2], y = +m[3], a = active;
    const w = tileLon(x, z), e = tileLon(x + 1, z), n = tileLat(y, z), s = tileLat(y + 1, z);
    if (!a || e < a.bbox[0] || w > a.bbox[2] || n < a.bbox[1] || s > a.bbox[3]) {
      // away from the grid: Terrarium's own tile (finest level below its maxzoom is resampled)
      if (z <= DEM_MAXZOOM) {
        const b = await terrariumBytes(z, x, y, abort.signal);
        if (b) return { data: b };
      }
    }
    const h = a ? await groundTileHeights(z, x, y, a) : await terrariumAt(z, x, y);
    const cv = new OffscreenCanvas(DIM, DIM), ctx = cv.getContext("2d")!;
    ctx.putImageData(new ImageData(encodeTerrarium(h) as Uint8ClampedArray<ArrayBuffer>, DIM, DIM), 0, 0);
    return { data: await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer() };
  });
}

// Ground heights from the same Terrarium DEM tiles MapLibre's terrain draws, sampled the way MapLibre samples them
// (maplibre-gl 6 DEMData.sampleBilinear: Web Mercator pixels at cell centres, bilinear between the four nearest), so the
// roads of a file without absolute heights can be laid on the drawn terrain (see drape.ts).

export const TERRARIUM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const DEM_MAXZOOM = 15; // the Terrarium pyramid's finest level, also the terrain source's maxzoom
const DIM = 256; // Terrarium tiles are 256 px
const MAX_TILES = 400; // a larger area is sampled one level coarser (each level quarters the count)

const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/** Terrarium encoding: height = R * 256 + G + B / 256 - 32768 (metres) */
export function decodeTerrarium(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = rgba[4 * i] * 256 + rgba[4 * i + 1] + rgba[4 * i + 2] / 256 - 32768;
  return out;
}

export class Dem {
  readonly z: number;
  private readonly tiles: Map<number, Float32Array>;
  private readonly n: number;

  constructor(z: number, tiles: Map<number, Float32Array>) {
    this.z = z;
    this.tiles = tiles;
    this.n = 2 ** z;
  }

  private px(gx: number, gy: number): number {
    const n = this.n * DIM;
    gx = Math.min(Math.max(gx, 0), n - 1); // clamped at the world's edge, as MapLibre's border backfill
    gy = Math.min(Math.max(gy, 0), n - 1);
    const tx = Math.floor(gx / DIM), ty = Math.floor(gy / DIM);
    const t = this.tiles.get(ty * this.n + tx);
    return t ? t[(gy - ty * DIM) * DIM + (gx - tx * DIM)] : NaN;
  }

  /** ground height (m above the DEM's datum) at lon / lat; NaN where no tile was loaded */
  sample(lon: number, lat: number): number {
    const x = mercX(lon) * this.n * DIM - 0.5, y = mercY(lat) * this.n * DIM - 0.5; // DEM pixels at cell centres
    const cx = Math.floor(x), cy = Math.floor(y), tx = x - cx, ty = y - cy;
    return this.px(cx, cy) * (1 - tx) * (1 - ty) + this.px(cx + 1, cy) * tx * (1 - ty)
      + this.px(cx, cy + 1) * (1 - tx) * ty + this.px(cx + 1, cy + 1) * tx * ty;
  }

  /** the tiles covering a lon / lat box at zoom z (one pixel of margin for the bilinear neighbours) */
  static tileRange(box: [number, number, number, number], z: number) {
    const n = 2 ** z, pad = 1 / (n * DIM);
    const x0 = Math.floor((mercX(box[0]) - pad) * n), x1 = Math.floor((mercX(box[2]) + pad) * n);
    const y0 = Math.floor((mercY(box[3]) - pad) * n), y1 = Math.floor((mercY(box[1]) + pad) * n);
    return { x0: Math.max(0, x0), x1: Math.min(n - 1, x1), y0: Math.max(0, y0), y1: Math.min(n - 1, y1) };
  }

  /** load the finest level whose tiles over box number at most MAX_TILES */
  static async load(box: [number, number, number, number], signal?: AbortSignal, url = TERRARIUM_TILES): Promise<Dem> {
    let z = DEM_MAXZOOM, r = Dem.tileRange(box, z);
    while (z > 0 && (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > MAX_TILES) r = Dem.tileRange(box, --z);
    const jobs: [number, number][] = [];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) jobs.push([x, y]);
    const tiles = new Map<number, Float32Array>(), n = 2 ** z;
    const one = async ([x, y]: [number, number]) => {
      const res = await fetch(url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)), { signal });
      if (!res.ok) return; // a missing tile leaves its area NaN
      // no colour management or premultiplication: the bytes are the encoded heights
      const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const cv = new OffscreenCanvas(bmp.width, bmp.height), ctx = cv.getContext("2d", { willReadFrequently: true })!;
      const ok = bmp.width === DIM && bmp.height === DIM;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      if (ok) tiles.set(y * n + x, decodeTerrarium(ctx.getImageData(0, 0, DIM, DIM).data));
    };
    for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map(one));
    return new Dem(z, tiles);
  }
}

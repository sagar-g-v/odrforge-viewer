// The road wins over the terrain (docs/ACCURACY.md §4): where the drawn ground would rise through a lane, the ground is
// pressed down under it. The road keeps the file's heights; only the drawn ground changes.
//
// A "floor" is a cap on the ground height, on a lattice in file coordinates (metres):
// - under every lane (all lane types, junctions included; not inside a tunnel's footprint) the cap is the lowest road
//   height over the cell minus EPSILON;
// - away from the lanes it rises at FLOOR.slope (a steep cut), so the ground meets its own heights again a short way off.
// The tile renderer takes min(ground, cap) at each DEM pixel, with the cap's minimum over a square that covers how
// MapLibre draws terrain (MapLibre 5+: render tiles of 512 px with a 128-cell mesh over DEM tiles one zoom down, so a mesh
// cell is one DEM pixel P, or a fraction of it when overscaled): a point on the mesh is interpolated from the vertices of
// its cell, each sampled bilinearly from the DEM pixel centres around it, so every pixel it depends on is within 1.5 P
// of it along each axis. Every pixel within 1.5 P (each axis) of a lane point is capped under it, so no drawn ground point
// under a lane can be above the lane.
// Guarded by tests/roadFloor.test.ts and the real-data check in tests/realdata.test.ts.

export type P2 = [number, number];
export const FLOOR = {
  epsilon: 0.05, // m the ground stays under the road surface
  slope: 2, // rise of the cap per metre away from the lanes (2: a 1:0.5 cut, 63 degrees; 1 left 2.4 x the floating lanes on Stelvio)
  cell: 1, // m, the lattice cell
  pad: 40, // m of lattice around the lanes (the cap is 40 m above the road there: no ground is pressed further out)
};

export interface RoadFloor {
  originX: number; originY: number; cell: number;
  nx: number; ny: number;
  levels: Float32Array[]; // levels[0]: the cap per cell; levels[L]: the minimum over 2^L x 2^L cells
  box: [number, number, number, number]; // file x0, y0, x1, y1 of the lattice
}

export interface LaneRings { positions: Float64Array; starts: Uint32Array | number[]; meta: { road: number }[] }

/** a point inside a polygon (even-odd) */
function inside(poly: P2[], x: number, y: number): boolean {
  let In = false;
  for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
    const [xa, ya] = poly[k], [xb, yb] = poly[i];
    if ((ya > y) !== (yb > y) && x < xa + ((y - ya) / (yb - ya)) * (xb - xa)) In = !In;
  }
  return In;
}

/** z as a float32 no higher than z (the cap is stored in float32: at 2766 m it would round up by as much as 0.12 mm) */
const down = (z: number) => (Math.fround(z) <= z ? z : z - Math.abs(z) * 2 ** -23);

/**
 * Lower the cap of every cell the triangle touches (a conservative raster: square / triangle overlap by separating axes)
 * to a lower bound of the triangle's height over that cell, minus eps
 */
function rasterTriangle(cap: Float32Array, nx: number, ny: number, c: number, t: number[], eps: number) {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(area) < 1e-9) return;
  // the plane z = az + gx (x - ax) + gy (y - ay)
  const gx = ((bz - az) * (cy - ay) - (cz - az) * (by - ay)) / area, gy = ((cz - az) * (bx - ax) - (bz - az) * (cx - ax)) / area;
  const zmin = Math.min(az, bz, cz), slack = (Math.abs(gx) + Math.abs(gy)) * c / 2;
  const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) / c)), i1 = Math.min(nx - 1, Math.floor(Math.max(ax, bx, cx) / c));
  const j0 = Math.max(0, Math.floor(Math.min(ay, by, cy) / c)), j1 = Math.min(ny - 1, Math.floor(Math.max(ay, by, cy) / c));
  const P = [[ax, ay], [bx, by], [cx, cy]], h = c / 2;
  // the edge normals: a square of centre m overlaps the triangle unless one of them separates them
  const axes = [0, 1, 2].map((e) => { const [px, py] = P[e], [qx, qy] = P[(e + 1) % 3]; return [qy - py, px - qx]; });
  const ranges = axes.map(([nx_, ny_]) => {
    const d = P.map(([px, py]) => px * nx_ + py * ny_);
    return [Math.min(...d), Math.max(...d), (Math.abs(nx_) + Math.abs(ny_)) * h];
  });
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const mx = (i + 0.5) * c, my = (j + 0.5) * c;
      let apart = false;
      for (let e = 0; e < 3 && !apart; e++) {
        const m = mx * axes[e][0] + my * axes[e][1], [lo, hi, r] = ranges[e];
        apart = m + r < lo || m - r > hi;
      }
      if (apart) continue;
      const z = down(Math.max(zmin, az + gx * (mx - ax) + gy * (my - ay) - slack) - eps);
      const k = j * nx + i;
      if (z < cap[k]) cap[k] = z;
    }
}

/** the cap rising at `slope` per metre away from where it is set (a two-pass chamfer: never under the true cone) */
function cone(cap: Float32Array, nx: number, ny: number, c: number, slope: number) {
  const a = slope * c, d = slope * c * Math.SQRT2;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let v = cap[k];
      if (i > 0) v = Math.min(v, cap[k - 1] + a);
      if (j > 0) {
        v = Math.min(v, cap[k - nx] + a);
        if (i > 0) v = Math.min(v, cap[k - nx - 1] + d);
        if (i < nx - 1) v = Math.min(v, cap[k - nx + 1] + d);
      }
      cap[k] = v;
    }
  for (let j = ny - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      let v = cap[k];
      if (i < nx - 1) v = Math.min(v, cap[k + 1] + a);
      if (j < ny - 1) {
        v = Math.min(v, cap[k + nx] + a);
        if (i < nx - 1) v = Math.min(v, cap[k + nx + 1] + d);
        if (i > 0) v = Math.min(v, cap[k + nx - 1] + d);
      }
      cap[k] = v;
    }
}

/** levels[L + 1] cell = the minimum of its 2 x 2 cells on levels[L] */
function pyramid(base: Float32Array, nx: number, ny: number): Float32Array[] {
  const levels = [base];
  let w = nx, h = ny;
  while (w > 1 || h > 1) {
    const src = levels[levels.length - 1], W = Math.ceil(w / 2), H = Math.ceil(h / 2), dst = new Float32Array(W * H).fill(Infinity);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = (j >> 1) * W + (i >> 1); if (src[j * w + i] < dst[k]) dst[k] = src[j * w + i]; }
    levels.push(dst);
    w = W; h = H;
  }
  return levels;
}

/**
 * The floor under a network's lanes. `lanes`: the lane rings (lon, lat, z; inner border forward, outer border back, as
 * xodr/build.ts writes them), `toXY`: lon / lat to file x / y, `exclude`: per road (index), footprints (file x / y) where
 * its lanes do not press the ground down (its tunnels: they run under the ground on purpose; a road over the tunnel still
 * does). Null when there are no lanes.
 */
export function buildRoadFloor(lanes: LaneRings, toXY: (lon: number, lat: number) => P2, exclude = new Map<number, P2[][]>(), o = FLOOR): RoadFloor | null {
  const L = lanes.positions, nv = L.length / 3;
  if (!nv) return null;
  const xy = new Float64Array(2 * nv);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let v = 0; v < nv; v++) {
    const [x, y] = toXY(L[3 * v], L[3 * v + 1]);
    xy[2 * v] = x; xy[2 * v + 1] = y;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const c = o.cell, ox = Math.floor((x0 - o.pad) / c) * c, oy = Math.floor((y0 - o.pad) / c) * c;
  const nx = Math.ceil((x1 + o.pad - ox) / c), ny = Math.ceil((y1 + o.pad - oy) / c);
  const cap = new Float32Array(nx * ny).fill(Infinity);
  const t = new Array<number>(9);
  const put = (q: number, a: number) => { t[3 * q] = xy[2 * a] - ox; t[3 * q + 1] = xy[2 * a + 1] - oy; t[3 * q + 2] = L[3 * a + 2]; };
  let polys: P2[][] | undefined;
  const masked = () => !!polys && polys.some((p) => inside(p, ox + (t[0] + t[3] + t[6]) / 3, oy + (t[1] + t[4] + t[7]) / 3));
  for (let k = 0; k < lanes.meta.length; k++) {
    polys = exclude.get(lanes.meta[k].road);
    const s = lanes.starts[k], n = lanes.starts[k + 1] - s, m = n >> 1;
    for (let i = 0; i + 1 < m; i++) {
      // quad: inner i, inner i + 1, outer i + 1, outer i (outer j is ring vertex n - 1 - j)
      const a = s + i, b = s + i + 1, cc = s + n - 2 - i, d = s + n - 1 - i;
      put(0, a); put(1, b); put(2, cc);
      if (!masked()) rasterTriangle(cap, nx, ny, c, t, o.epsilon);
      put(0, a); put(1, cc); put(2, d);
      if (!masked()) rasterTriangle(cap, nx, ny, c, t, o.epsilon);
    }
  }
  cone(cap, nx, ny, c, o.slope);
  return { originX: ox, originY: oy, cell: c, nx, ny, levels: pyramid(cap, nx, ny), box: [ox, oy, ox + nx * c, oy + ny * c] };
}

/** the lowest cap within `radius` of (x, y) along each axis (every cell that can hold such a point); Infinity off the lattice */
export function floorAt(f: RoadFloor, x: number, y: number, radius: number): number {
  const top = f.levels.length - 1, L = Math.max(0, Math.min(top, Math.floor(Math.log2(Math.max(radius, f.cell) / (2 * f.cell)))));
  const cl = f.cell * 2 ** L, w = Math.ceil(f.nx / 2 ** L), h = Math.ceil(f.ny / 2 ** L), lv = f.levels[L];
  // a point within radius of (x, y) along an axis lies at most ceil(radius / cell) cells away along it
  const k = Math.ceil(radius / cl), i = Math.floor((x - f.originX) / cl), j = Math.floor((y - f.originY) / cl);
  let v = Infinity;
  for (let b = Math.max(0, j - k); b <= Math.min(h - 1, j + k); b++)
    for (let a = Math.max(0, i - k); a <= Math.min(w - 1, i + k); a++) if (lv[b * w + a] < v) v = lv[b * w + a];
  return v;
}

/** how far (along each axis) around a DEM pixel of size `pixel` the floor must reach: a mesh cell and half a pixel */
export const floorRadius = (pixel: number) => 1.5 * pixel;

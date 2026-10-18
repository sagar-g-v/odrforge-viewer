// The junction elevation grid (ASAM OpenDRIVE 1.8.0 §12.11): z-values on a square grid along the junction reference line
// (§12.9) that "provide and overwrite elevation definitions for every point inside the junction boundary". Heights inside
// a grid square are interpolated bicubically (§12.11.1): the tangents at its corners come from the cubic polynomial
// through the points along each edge (two more beyond its ends), with c = d = 0 (a straight line through the edge's two
// points) where those points are missing; the mixed tangent is the same rule applied along s to the t-tangents. Guarded by
// tests/elevationGrid.test.ts (exact on planes and on polynomials up to bicubic).
import type { ElevationGrid, Geom } from "./model";
import { refLinePose } from "./build";

/** the grid value at row k (along s) and lateral index i (0 on the line, +i left, -i right); NaN where not given */
export function gridValue(g: ElevationGrid, k: number, i: number): number {
  const row = g.rows[k];
  if (!row) return NaN;
  const v = i === 0 ? row.center[0] : i > 0 ? row.left[i - 1] : row.right[-i - 1];
  return v === undefined ? NaN : v;
}

/**
 * Tangents (per grid step) at the two ends of the edge from y0 to y1, of the cubic through ym, y0, y1, y2 at -1, 0, 1, 2
 * (Lagrange); without both outer points, the straight line through y0 and y1 (§12.11.1: c = d = 0)
 */
function edgeTangents(ym: number, y0: number, y1: number, y2: number): [number, number] {
  if (!Number.isFinite(ym) || !Number.isFinite(y2)) return [y1 - y0, y1 - y0];
  return [(-2 * ym - 3 * y0 + 6 * y1 - y2) / 6, (ym - 6 * y0 + 3 * y1 + 2 * y2) / 6];
}

const A = [[1, 0, 0, 0], [0, 0, 1, 0], [-3, 3, -2, -1], [2, -2, 1, 1]];

/** z at (s, t) on the junction reference line: bicubic in the grid square holding it; NaN outside the grid */
export function gridZ(g: ElevationGrid, s: number, t: number): number {
  if (!(g.gridSpacing > 0) || g.rows.length < 2) return NaN;
  const u = (s - g.sStart) / g.gridSpacing, w = t / g.gridSpacing;
  if (u < -1e-9 || u > g.rows.length - 1 + 1e-9) return NaN;
  const k0 = Math.min(Math.max(Math.floor(u), 0), g.rows.length - 2), V = (k: number, i: number) => gridValue(g, k, i);
  let i0 = Math.floor(w);
  // a point on the grid's outermost lateral line belongs to the square inside it
  if (w - i0 < 1e-9 && !Number.isFinite(V(k0, i0 + 1)) && Number.isFinite(V(k0, i0 - 1))) i0 -= 1;
  const x = u - k0, y = w - i0;
  const f = (a: number, b: number) => V(k0 + a, i0 + b);
  if (![f(0, 0), f(1, 0), f(0, 1), f(1, 1)].every(Number.isFinite)) return NaN;
  // s-tangents along the square's two s-edges (lateral i0, i0 + 1)
  const fs = [0, 1].map((b) => edgeTangents(V(k0 - 1, i0 + b), V(k0, i0 + b), V(k0 + 1, i0 + b), V(k0 + 2, i0 + b)));
  // t-tangents of the t-edge (i0 .. i0 + 1) at rows k0 - 1 .. k0 + 2, then their s-tangents (the mixed tangent)
  const tAt = (k: number) => edgeTangents(V(k, i0 - 1), V(k, i0), V(k, i0 + 1), V(k, i0 + 2));
  const ft = [tAt(k0 - 1), tAt(k0), tAt(k0 + 1), tAt(k0 + 2)];
  const okRow = (k: number) => Number.isFinite(V(k, i0)) && Number.isFinite(V(k, i0 + 1));
  const tOr = (k: number, b: number) => (okRow(k0 + k - 1) ? ft[k][b] : NaN);
  const fst = [0, 1].map((b) => edgeTangents(tOr(0, b), ft[1][b], ft[2][b], tOr(3, b)));
  // F = [[f, f_t], [f_s, f_st]] at the corners (s index a: rows, t index b: columns)
  const F = [
    [f(0, 0), f(0, 1), ft[1][0], ft[1][1]],
    [f(1, 0), f(1, 1), ft[2][0], ft[2][1]],
    [fs[0][0], fs[1][0], fst[0][0], fst[1][0]],
    [fs[0][1], fs[1][1], fst[0][1], fst[1][1]],
  ];
  // alpha = A F A^T; z = [1 x x^2 x^3] alpha [1 y y^2 y^3]^T
  const AF = A.map((r) => [0, 1, 2, 3].map((c) => r.reduce((acc, a, q) => acc + a * F[q][c], 0)));
  const al = AF.map((r) => [0, 1, 2, 3].map((c) => r.reduce((acc, a, q) => acc + a * A[c][q], 0)));
  const X = [1, x, x * x, x * x * x], Y = [1, y, y * y, y * y * y];
  let z = 0;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) z += X[a] * al[a][b] * Y[b];
  return z;
}

/**
 * (x, y) -> (s, t) on a junction reference line (§12.9; t left positive): the nearest point of the line, sampled every
 * 0.25 m from `s0` to `s1` (before its start and past its end the line continues straight). Exact for a <line>
 */
export function refLineST(geoms: Geom[], s0: number, s1: number): (x: number, y: number) => [number, number] {
  const n = Math.max(1, Math.ceil((s1 - s0) / 0.25)), S: number[] = [], P: { x: number; y: number }[] = [];
  const first = geoms[0], start = refLinePose(geoms, first.s);
  const pose = (s: number) => (s >= first.s ? refLinePose(geoms, s)
    : { x: start.x + (s - first.s) * Math.cos(start.hdg), y: start.y + (s - first.s) * Math.sin(start.hdg) });
  for (let q = 0; q <= n; q++) { const s = s0 + ((s1 - s0) * q) / n; S.push(s); P.push(pose(s)); }
  return (x, y) => {
    let best = Infinity, bs = s0, bt = 0;
    for (let q = 0; q < n; q++) {
      const a = P[q], b = P[q + 1], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
      const f = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2)) : 0;
      const px = a.x + f * ex, py = a.y + f * ey, d = Math.hypot(x - px, y - py);
      if (d < best) {
        best = d; bs = S[q] + f * (S[q + 1] - S[q]);
        const l = Math.sqrt(l2) || 1;
        bt = (ex * (y - a.y) - ey * (x - a.x)) / l; // signed distance: + left of the direction of travel
      }
    }
    return [bs, bt];
  };
}

/** z of a junction's elevation grid at file (x, y); null when the junction has no usable grid or reference line */
export function junctionGridZ(j: { refLine: Geom[]; elevationGrid: ElevationGrid | null }): ((x: number, y: number) => number) | null {
  const g = j.elevationGrid;
  if (!g || !(g.gridSpacing > 0) || g.rows.length < 2 || !j.refLine.length) return null;
  const st = refLineST(j.refLine, g.sStart - g.gridSpacing, g.sStart + g.rows.length * g.gridSpacing);
  return (x, y) => { const [s, t] = st(x, y); return gridZ(g, s, t); };
}

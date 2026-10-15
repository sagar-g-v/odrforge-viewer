// Reference line evaluation (ASAM OpenDRIVE 1.8.0 §9: line §9.4, spiral §9.5, arc §9.6, poly3 / paramPoly3 §9.7).
import type { Geom, Road } from "./model";

export interface Pose { x: number; y: number; hdg: number; }

/** Simpson integration of (cos, sin)(theta(u)) over [0, ds] for a heading quadratic in u (spiral, arc, line) */
function clothoid(hdg: number, k0: number, c: number, ds: number): [number, number] {
  if (ds <= 0) return [0, 0];
  const n = Math.max(4, 2 * Math.ceil(ds / 0.5)); // even; heading changes smoothly: error < 1e-7 m over 100 m
  const h = ds / n;
  let sx = 0, sy = 0;
  for (let i = 0; i <= n; i++) {
    const u = i * h;
    const th = hdg + k0 * u + 0.5 * c * u * u;
    const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    sx += w * Math.cos(th);
    sy += w * Math.sin(th);
  }
  return [(sx * h) / 3, (sy * h) / 3];
}

// poly3: v(u) in the local frame with u along the start heading; s is arc length, so u(s) comes from a table
const poly3Tables = new WeakMap<Geom, { s: Float64Array; u: Float64Array }>();
function poly3U(g: Geom, ds: number): number {
  let t = poly3Tables.get(g);
  if (!t) {
    const du = 0.05, ss: number[] = [0], us: number[] = [0];
    let s = 0, u = 0;
    while (s < g.length && ss.length < 1e6) {
      const d1 = g.bV + 2 * g.cV * (u + du / 2) + 3 * g.dV * (u + du / 2) ** 2;
      s += du * Math.sqrt(1 + d1 * d1);
      u += du;
      ss.push(s);
      us.push(u);
    }
    t = { s: Float64Array.from(ss), u: Float64Array.from(us) };
    poly3Tables.set(g, t);
  }
  let lo = 0, hi = t.s.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t.s[m] <= ds) lo = m; else hi = m; }
  const f = t.s[hi] > t.s[lo] ? (ds - t.s[lo]) / (t.s[hi] - t.s[lo]) : 0;
  return t.u[lo] + f * (t.u[hi] - t.u[lo]);
}

/** pose at local distance ds in [0, length] of one geometry element */
export function evalGeom(g: Geom, ds: number): Pose {
  const cs = Math.cos(g.hdg), sn = Math.sin(g.hdg);
  switch (g.kind) {
    case "line":
      return { x: g.x + ds * cs, y: g.y + ds * sn, hdg: g.hdg };
    case "arc": {
      const k = g.k0;
      if (Math.abs(k) < 1e-12) return { x: g.x + ds * cs, y: g.y + ds * sn, hdg: g.hdg };
      const th = g.hdg + k * ds;
      return { x: g.x + (Math.sin(th) - sn) / k, y: g.y - (Math.cos(th) - cs) / k, hdg: th };
    }
    case "spiral": {
      const c = g.length > 0 ? (g.k1 - g.k0) / g.length : 0;
      const [dx, dy] = clothoid(g.hdg, g.k0, c, ds);
      return { x: g.x + dx, y: g.y + dy, hdg: g.hdg + g.k0 * ds + 0.5 * c * ds * ds };
    }
    case "poly3": {
      const u = poly3U(g, ds);
      const v = g.aV + g.bV * u + g.cV * u * u + g.dV * u * u * u;
      const dv = g.bV + 2 * g.cV * u + 3 * g.dV * u * u;
      return { x: g.x + u * cs - v * sn, y: g.y + u * sn + v * cs, hdg: g.hdg + Math.atan(dv) };
    }
    case "paramPoly3": {
      const p = g.normalized ? (g.length > 0 ? ds / g.length : 0) : ds;
      const u = g.aU + g.bU * p + g.cU * p * p + g.dU * p * p * p;
      const v = g.aV + g.bV * p + g.cV * p * p + g.dV * p * p * p;
      const du = g.bU + 2 * g.cU * p + 3 * g.dU * p * p, dv = g.bV + 2 * g.cV * p + 3 * g.dV * p * p;
      return { x: g.x + u * cs - v * sn, y: g.y + u * sn + v * cs, hdg: g.hdg + Math.atan2(dv, du) };
    }
  }
}

/** curvature of an element at ds (for adaptive sampling; poly3 / paramPoly3 estimated numerically) */
export function curvatureAt(g: Geom, ds: number): number {
  if (g.kind === "line") return 0;
  if (g.kind === "arc") return g.k0;
  if (g.kind === "spiral") return g.k0 + (g.length > 0 ? ((g.k1 - g.k0) * ds) / g.length : 0);
  const h = Math.min(0.1, g.length / 4 || 0.1);
  const a = evalGeom(g, Math.max(0, ds - h)).hdg, b = evalGeom(g, Math.min(g.length, ds + h)).hdg;
  return (b - a) / (2 * h);
}

/** index of the element containing s (the last whose start <= s) */
export function geomIndex(road: Road, s: number): number {
  const gs = road.geoms;
  let lo = 0, hi = gs.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (gs[m].s <= s + 1e-9) lo = m; else hi = m - 1; }
  return lo;
}

export function evalRoad(road: Road, s: number): Pose {
  const g = road.geoms[geomIndex(road, s)];
  return evalGeom(g, Math.min(Math.max(s - g.s, 0), g.length));
}

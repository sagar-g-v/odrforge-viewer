// Heights for review markers (flags, findings): a marker sits on the lane it was placed on, at that lane's drawn height.
// Drawn at z = 0 instead, a flag on a road 510 m (Munich) or 2.6 km (Stelvio) above sea level appeared far from its road
// in a tilted 3D view. Guarded by tests/markerZ.test.ts.

/** nearest lane vertex lookup on a ~10 m grid over a lon / lat / z buffer */
export class LaneZIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly positions: Float64Array;
  private readonly mx: number; private readonly my: number; private readonly cell: number;
  constructor(positions: Float64Array, lat0: number, cell = 10) {
    this.positions = positions;
    const f = (lat0 * Math.PI) / 180;
    this.mx = 111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f); // m per degree (WGS84 series, as xodr/compare.ts)
    this.my = 111132.92 - 559.82 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f);
    this.cell = cell;
    for (let v = 0; v < positions.length / 3; v++) {
      const k = this.key(positions[3 * v], positions[3 * v + 1]);
      const list = this.cells.get(k) ?? this.cells.set(k, []).get(k)!;
      list.push(v);
    }
  }
  private ix = (lon: number) => Math.floor((lon * this.mx) / this.cell);
  private iy = (lat: number) => Math.floor((lat * this.my) / this.cell);
  private key(lon: number, lat: number) { return `${this.ix(lon)},${this.iy(lat)}`; }

  /** z of the nearest lane vertex within maxDist metres of (lon, lat), or null */
  nearestZ(lon: number, lat: number, maxDist = 30): number | null {
    const r = Math.ceil(maxDist / this.cell), cx = this.ix(lon), cy = this.iy(lat), P = this.positions;
    let best = maxDist * maxDist, z: number | null = null;
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (const v of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const ex = (P[3 * v] - lon) * this.mx, ey = (P[3 * v + 1] - lat) * this.my, d = ex * ex + ey * ey;
          if (d <= best) { best = d; z = P[3 * v + 2]; }
        }
    return z;
  }
}

// How a junction area is drawn (docs/design-system.md §3 "Junctions: real and virtual"; values in design/scene.ts JUNCTION):
// hue and fill form give the type (amber solid = real, iris 45° hatch = virtual, OpenDRIVE 1.8.0 §12.5), the line style gives
// the outline's source (solid = the file's <boundary>, dashed = the approximate hull). Guarded by tests/junctionStyle.test.ts.
import { JUNCTION, OVERLAY, withAlpha, type Rgba } from "../design/scene";
import type { Binary } from "../xodr/build";
import type { JunctionMeta } from "../xodr/junctions";

type Meta = Pick<JunctionMeta, "type" | "exact">;

/** FillStyleExtension procedural patterns; a junction whose pattern name is not here is filled solid */
export const JUNCTION_PATTERNS = {
  virtual: { type: "hatch", angle: JUNCTION.hatch.angle, strokeWidth: JUNCTION.hatch.line, gap: JUNCTION.hatch.gap },
} as const;

export const isVirtual = (m: Meta) => JUNCTION.kind(m.type) === "virtual";

/** "virtual" (hatched) or "solid"; selection keeps the fill form */
export const junctionPattern = (m: Meta): "virtual" | "solid" => (isVirtual(m) ? "virtual" : "solid");

export function junctionFill(m: Meta, selected: boolean): Rgba {
  if (selected) return withAlpha(OVERLAY.selected, 110);
  if (isVirtual(m)) return m.exact ? OVERLAY.virtualFill : OVERLAY.virtualFillApprox;
  return m.exact ? OVERLAY.junctionFill : OVERLAY.junctionFillApprox;
}

export const junctionEdge = (m: Meta, selected: boolean): Rgba =>
  selected ? OVERLAY.selected : isVirtual(m) ? OVERLAY.virtualEdge : OVERLAY.junctionEdge;

export const junctionEdgeWidth = (selected: boolean) => (selected ? JUNCTION.edgeWidthSelected : JUNCTION.edgeWidth);

/**
 * The virtual junctions on their own: a virtual junction lies on its through road, so a fill under the (opaque) lanes would
 * never show. Its hatch is drawn over the lanes instead (the stripes leave them visible); real junction fills stay under
 * the lanes. `index` maps a subset item back to its junction. Cached per buffer.
 */
export interface JunctionSubset extends Binary { index: number[]; }
const subsets = new WeakMap<object, JunctionSubset>();
export function virtualJunctions(J: Binary & { meta: Meta[] }): JunctionSubset {
  const hit = subsets.get(J);
  if (hit) return hit;
  const index: number[] = [], starts: number[] = [], pos: number[] = [];
  J.meta.forEach((m, i) => {
    if (!isVirtual(m)) return;
    index.push(i); starts.push(pos.length / 3);
    for (let k = 3 * J.starts[i]; k < 3 * J.starts[i + 1]; k++) pos.push(J.positions[k]);
  });
  const out = { positions: Float64Array.from(pos), starts: Uint32Array.from([...starts, pos.length / 3]), index };
  subsets.set(J, out);
  return out;
}

/** solid for the file's <boundary>, dashed for the approximate hull (PathStyleExtension: [0, 0] = solid) */
export const junctionDash = (m: Meta): [number, number] => (m.exact ? [0, 0] : JUNCTION.approxDash);

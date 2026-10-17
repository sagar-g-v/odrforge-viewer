// The OSM reference overlay: the source .osm's edge geometry (barrier=kerb lines, footway=sidewalk ways, street-side
// parking, traffic islands and pedestrian areas, area:highway polygons) drawn over the network, so a reviewer sees where
// the drawn roads miss the OSM edges. Read-only: it never changes the network and is never a flag or a finding.
// The kinds and the kerb gap come from review/osmEdges.ts, the definitions the kerb measure shares with the converter:
// OSM lon / lat goes into the file's metres through the open network's projector (proj.inverse, the xodr geoReference),
// is measured there, and comes back through proj.forward, as the network itself is drawn. Guarded by tests/osmOverlay.test.ts.
import { OSM_REF, type Rgba } from "../design/scene";
import type { Projector } from "../xodr/geo";
import type { OpenDrive } from "../xodr/model";
import {
  densify, isKerb, isPedestrianArea, isSidewalk, isStreetParking, isTrafficIsland, kerbOfArea, midSamples, osmWays, ParallelEdges,
  plainRoadEdges, PolygonDistance, sampleGaps, type P2,
} from "./osmEdges";

export type OsmKind = "kerb" | "sidewalk" | "parking" | "island" | "area";
export const OSM_KINDS: OsmKind[] = ["kerb", "sidewalk", "parking", "island", "area"];
export const OSM_KIND_LABEL: Record<OsmKind, string> = {
  kerb: "kerb (barrier=kerb)", sidewalk: "sidewalk (footway=sidewalk)", parking: "street-side parking",
  island: "traffic island / pedestrian area", area: "road area (area:highway)",
};
const isLine = (k: OsmKind) => k === "kerb" || k === "sidewalk";

/** one OSM way the overlay draws, in lon / lat; complete: the file has all its nodes */
export interface OsmElement { id: string; kind: OsmKind; tags: [string, string][]; line: P2[]; closed: boolean; complete: boolean }

/**
 * The ways of an .osm the overlay draws, one kind each. A complete closed way is an area first (island or pedestrian area,
 * street-side parking, any other area:highway), as osmKerbData reads them; otherwise a kerb or sidewalk line. Areas need
 * every node; lines are drawn from the nodes the file has (osmEdgeLines), at least two.
 */
export function osmElements(osmText: string): OsmElement[] {
  const out: OsmElement[] = [];
  for (const w of osmWays(osmText)) {
    const t = w.tags, complete = w.line.length === w.refs.length;
    const kind: OsmKind | null = w.closed && complete
      ? (isTrafficIsland(t) || isPedestrianArea(t) ? "island" : isStreetParking(t) ? "parking" : t.has("area:highway") ? "area" : null)
      : null;
    const k = kind ?? (isKerb(t) ? "kerb" : isSidewalk(t) ? "sidewalk" : null);
    if (!k || w.line.length < 2) continue;
    out.push({ id: w.id, kind: k, tags: [...t], line: w.line, closed: w.closed, complete });
  }
  return out;
}

/** flat paths for a deck.gl PathLayer: lon, lat, 0 per vertex; starts holds each path's first vertex plus the total */
export interface OsmPaths { positions: Float64Array; starts: Uint32Array; meta: number[] } // meta: element index per path

/** why a kerb has no gap dots: closed (a ring), a node missing, shorter than 1 m, or bounding an island / pedestrian area */
export type KerbNote = "closed" | "incomplete" | "short" | "area" | "no-network";

export interface OsmGaps {
  positions: Float64Array; // lon, lat, 0 per measured sample (those with a parallel edge within 10 m)
  gap: Float64Array; // signed metres: + outside the drawn carriageway edge (road too narrow), - inside it
  meta: number[]; // element index per sample
  samples: number; // every sample of every measured kerb, matched or not
}

export interface OsmOverlay {
  elements: OsmElement[];
  lines: OsmPaths; // kerbs and sidewalks (dashed)
  areas: OsmPaths; // parking, islands, road areas (outlines)
  gaps: OsmGaps | null; // null without the network's OpenDRIVE (an OdrForge page export)
  notes: Map<number, KerbNote>; // kerbs left out of the gap measure, by element index
  counts: Record<OsmKind, number>;
}

/** vertices of the drawn paths, at most this far apart, so their heights can follow the lanes in 3D */
export const PATH_STEP_M = 5;

/**
 * Builds the overlay for one network. Null when the network has no geoReference: it is then placed at 0° / 0° and
 * OSM's coordinates do not correspond to the file's.
 */
export function buildOsmOverlay(elements: OsmElement[], proj: Projector, od: OpenDrive | null): OsmOverlay | null {
  if (!proj.georeferenced) return null;
  const toXY = (line: P2[]) => line.map(([lon, lat]) => proj.inverse(lon, lat) as P2);
  const xy = elements.map((e) => toXY(e.line));
  const paths = (keep: (e: OsmElement) => boolean): OsmPaths => {
    const pos: number[] = [], starts: number[] = [], meta: number[] = [];
    elements.forEach((e, i) => {
      if (!keep(e)) return;
      starts.push(pos.length / 3); meta.push(i);
      for (const p of densify(xy[i], PATH_STEP_M)) { const [lon, lat] = proj.forward(p[0], p[1]); pos.push(lon, lat, 0); }
    });
    return { positions: Float64Array.from(pos), starts: Uint32Array.from([...starts, pos.length / 3]), meta };
  };
  const counts = Object.fromEntries(OSM_KINDS.map((k) => [k, 0])) as Record<OsmKind, number>;
  for (const e of elements) counts[e.kind]++;
  const notes = new Map<number, KerbNote>();
  let gaps: OsmGaps | null = null;
  if (od) {
    // the shared kerb measure (osmEdges.ts sharedKerbStats), sample by sample: open complete kerbs, 1 m mid-samples,
    // the signed distance to the nearest roughly parallel plain-road carriageway edge, island / pedestrian kerbs dropped
    const edges = new ParallelEdges(plainRoadEdges(od));
    const areas = new PolygonDistance(elements.flatMap((e, i) => (e.kind === "island" ? [xy[i]] : [])));
    const pos: number[] = [], gap: number[] = [], meta: number[] = [];
    let samples = 0;
    elements.forEach((e, i) => {
      if (e.kind !== "kerb") return;
      if (e.closed) { notes.set(i, "closed"); return; }
      if (!e.complete) { notes.set(i, "incomplete"); return; }
      const s = midSamples(xy[i]);
      if (!s.length) { notes.set(i, "short"); return; }
      if (kerbOfArea(xy[i], areas)) { notes.set(i, "area"); return; }
      sampleGaps(xy[i], s, edges).forEach((g, k) => {
        samples++;
        if (!Number.isFinite(g)) return;
        const [lon, lat] = proj.forward(s[k][0], s[k][1]);
        pos.push(lon, lat, 0); gap.push(g); meta.push(i);
      });
    });
    gaps = { positions: Float64Array.from(pos), gap: Float64Array.from(gap), meta, samples };
  } else elements.forEach((e, i) => { if (e.kind === "kerb") notes.set(i, "no-network"); });
  return { elements, lines: paths((e) => isLine(e.kind)), areas: paths((e) => !isLine(e.kind)), gaps, notes, counts };
}

/** the summary the Layers panel shows: matched share, median signed gap, share within OSM_REF.fitM */
export function gapSummary(g: OsmGaps): { samples: number; matched: number; medianSigned: number; fit: number } {
  const s = [...g.gap].sort((a, b) => a - b);
  return { samples: g.samples, matched: s.length, medianSigned: s.length ? s[s.length >> 1] : NaN, fit: s.filter((v) => Math.abs(v) <= OSM_REF.fitM).length };
}

/** a kerb sample's dot colour: the kerb hue where it fits the drawn edge, else the side it misses it on */
export const gapColor = (gap: number): Rgba => (Math.abs(gap) <= OSM_REF.fitM ? OSM_REF.kerb : gap > 0 ? OSM_REF.gapOutside : OSM_REF.gapInside);
/** a kerb sample's dot radius in px: larger where it misses the edge by more than OSM_REF.farM */
export const gapRadius = (gap: number) => (Math.abs(gap) > OSM_REF.farM ? 3.5 : 2.5);

/** the path positions with the height of `zAt` at each vertex (the lanes' drawn height in 3D) */
export function withHeights(positions: Float64Array, zAt: (lon: number, lat: number) => number): Float64Array {
  const out = Float64Array.from(positions);
  for (let v = 0; v < out.length / 3; v++) out[3 * v + 2] = zAt(out[3 * v], out[3 * v + 1]);
  return out;
}

const NOTE: Record<KerbNote, string> = {
  closed: "closed ring: not measured", incomplete: "nodes missing in the file: not measured", short: "shorter than 1 m: not measured",
  area: "bounds an island or pedestrian area: not measured", "no-network": "no OpenDRIVE to measure against",
};

/** the hover tooltip for an OSM reference layer: the way's id and tags, or a kerb sample's gap */
export function osmHoverText(o: OsmOverlay, layer: string, index: number): string | null {
  const way = (i: number) => {
    const e = o.elements[i];
    if (!e) return null;
    const tags = e.tags.map(([k, v]) => `${k}=${v}`).join(" · "), note = o.notes.get(i);
    const text = `OSM way ${e.id}${tags ? ` · ${tags}` : ""}`;
    return (text.length > 220 ? text.slice(0, 219) + "…" : text) + (note ? ` (${NOTE[note]})` : "");
  };
  if (layer === "osm-lines") return way(o.lines.meta[index]);
  if (layer === "osm-areas") return way(o.areas.meta[index]);
  if (layer === "osm-kerb-gap" && o.gaps) {
    const g = o.gaps.gap[index], e = o.elements[o.gaps.meta[index]];
    if (g === undefined || !e) return null;
    const side = Math.abs(g) <= OSM_REF.fitM ? "fits the drawn carriageway edge" : g > 0 ? "outside the drawn carriageway edge (road too narrow)" : "inside the drawn carriageway edge (road too wide)";
    return `kerb gap ${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(2)} m: ${side} · OSM way ${e.id}`;
  }
  return null;
}

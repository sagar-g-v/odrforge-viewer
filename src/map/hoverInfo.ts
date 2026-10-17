// What the map's hover tooltip says about the thing under the pointer (docs/design-system.md §6: "the inspector and the
// hover tooltip always name the lane type"; §8 markers: findings carry no label, "the list and the tooltip name it").
// Pure: a layer id and an index into that layer's data, against the render buffers. Guarded by tests/hoverInfo.test.ts.
import { JUNCTION } from "../design/scene";
import { osmHoverText, type OsmOverlay } from "../review/osmOverlay";
import type { RenderData } from "../xodr/build";
import { virtualJunctions } from "./junctionStyle";

export interface HoverMarker { label?: string; tip?: string; }

const KIND: Record<string, string> = { signal: "signal", object: "object", structure: "structure", crossPath: "cross path" };

export function hoverText(layer: string, index: number, r: RenderData, extra: { flags?: HoverMarker[]; findings?: HoverMarker[]; review?: HoverMarker[]; osm?: OsmOverlay | null } = {}): string | null {
  if (index < 0) return null;
  // the OSM reference overlay: the OSM way (id and tags) or a kerb sample's gap, never a road of the network
  if (layer.startsWith("osm-")) return extra.osm ? osmHoverText(extra.osm, layer, index) : null;
  const road = (i: number) => {
    const rd = r.roads?.[i];
    return rd ? `road ${rd.id}${rd.name ? ` · ${rd.name}` : ""}` : `road #${i}`;
  };
  const F = r.features;
  switch (layer) {
    case "lanes": {
      const m = r.lanes.meta[index];
      return m ? `${m.type} · lane ${m.lane} · ${road(m.road)}${m.junction ? " (in a junction)" : ""}` : null;
    }
    case "junctions": case "junctions-virtual": {
      const i = layer === "junctions" ? index : virtualJunctions(r.junctions).index[index];
      const m = i !== undefined ? r.junctions.meta[i] : undefined;
      if (!m) return null;
      const kind = JUNCTION.label[JUNCTION.kind(m.type)];
      return `${kind} ${m.id}${m.type && JUNCTION.kind(m.type) === "real" ? ` · ${m.type}` : ""}`;
    }
    case "refs": return r.refs.meta[index] !== undefined ? `reference line · ${road(r.refs.meta[index])}` : null;
    case "objects": case "object-lines": {
      const m = (layer === "objects" ? r.objects : r.objectLines).meta[index];
      return m ? `${m.label || m.kind} · ${road(m.road)}` : null;
    }
    case "footprints": case "boxes": case "structures": case "cross-paths": {
      if (!F) return null;
      const set = layer === "footprints" ? F.footprints.meta : layer === "boxes" ? F.boxes.meta : layer === "structures" ? F.structures.meta : F.crossPaths.meta;
      const m = set[index];
      if (!m) return null;
      const name = layer === "structures" ? ((m as { tunnel?: boolean }).tunnel ? "tunnel" : "bridge") : KIND[m.kind] ?? m.kind;
      return `${name} · ${road(m.road)}`;
    }
    case "barrier-lines": {
      const m = F?.barrierLines.meta[index];
      return m ? `${m.label} · ${road(m.road)}` : null;
    }
    case "review": return extra.review?.[index]?.tip ?? null;
    case "flags": case "findings": {
      const m = (layer === "flags" ? extra.flags : extra.findings)?.[index];
      return m ? m.tip ?? (m.label ? `flag #${m.label}` : null) : null;
    }
    case "junction-ref-lines": return "junction reference line";
    case "junction-grid": case "junction-grid-points": return "junction elevation grid";
  }
  if (layer.startsWith("col-") && F) {
    const c = F.columns.find((s) => `col-${s.radius}` === layer)?.meta[index];
    return c ? `${KIND[c.kind] ?? c.kind} · ${road(c.road)}` : null;
  }
  return null;
}

// Map legends: what the OpenDRIVE layers draw (colours and shapes from map/palette.ts, xodr/features.ts, xodr/build.ts)
// and what the base map shows (OpenStreetMap Carto's key colours; satellite imagery has no legend).
import type { Basemap } from "../map/MapView";
import { LEGEND, legendColor } from "../map/palette";
import { ASSET, EDGE, MARK, MARKER, OVERLAY, SIGNAL, STRUCTURE } from "../design/scene";

const css = (c: readonly number[]) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})`;

type Swatch =
  | { kind: "fill"; color: string; border?: string }
  | { kind: "line"; color: string; dash?: boolean; double?: boolean; width?: number }
  | { kind: "dot"; color: string; ring?: string }
  | { kind: "light" } | { kind: "arrow" };

function Sw({ s }: { s: Swatch }) {
  if (s.kind === "fill") return <i className="sw" style={{ background: s.color, borderColor: s.border ?? "var(--line-2)" }} />;
  if (s.kind === "dot") return <i className="sw dot" style={{ background: s.color, borderColor: s.ring ?? css(EDGE.ring) }} />;
  if (s.kind === "arrow")
    return <i className="sw arrow"><svg viewBox="0 0 16 10" width="16" height="10"><path d="M1 3.6h9V1l5 4-5 4V6.4H1z" fill="#f5f7fa" stroke="#45607b" strokeWidth=".6" /></svg></i>;
  if (s.kind === "light")
    return <i className="sw light"><b style={{ background: "#eb3434" }} /><b style={{ background: "#f5aa28" }} /><b style={{ background: "#2ecc62" }} /></i>;
  const w = s.width ?? 3;
  const line = { borderTop: `${w}px ${s.dash ? "dashed" : "solid"} ${s.color}` };
  return <i className="sw line">{s.double ? <><em style={line} /><em style={line} /></> : <em style={line} />}</i>;
}

function Group({ title, items }: { title: string; items: [string, Swatch][] }) {
  return (
    <div className="legend-group">
      <div className="legend-title">{title}</div>
      <div className="legend">{items.map(([label, s]) => <span key={label}><Sw s={s} />{label}</span>)}</div>
    </div>
  );
}

export function OdrLegend({ theme }: { theme: "dark" | "light" }) {
  return (
    <>
      <Group title="Lane types" items={LEGEND.map((t) => [t, { kind: "fill", color: css(legendColor(t, theme)) }])} />
      <Group title="Junctions" items={[
        ["junction area (<boundary>)", { kind: "fill", color: css(OVERLAY.junctionFill), border: css(OVERLAY.junctionEdge) }],
        ["approximate area", { kind: "line", color: css(OVERLAY.junctionEdge), dash: true, width: 2 }],
        ["cross path", { kind: "line", color: css(OVERLAY.crossPath), dash: true, width: 2 }],
        ["junction reference line", { kind: "line", color: css(OVERLAY.junctionRef), dash: true, width: 2 }],
        ["elevation grid point / line", { kind: "dot", color: css(OVERLAY.elevation) }],
      ]} />
      <Group title="Road marks" items={[
        ["solid", { kind: "line", color: css(MARK.white) }], ["broken", { kind: "line", color: css(MARK.white), dash: true }],
        ["double (yellow)", { kind: "line", color: css(MARK.yellow), double: true, width: 2 }], ["curb", { kind: "line", color: css(MARK.curb), width: 4 }],
        ["driving direction (arrow)", { kind: "arrow" }],
      ]} />
      <Group title="Signals" items={[
        ["traffic light", { kind: "light" }], ["speed / yield sign", { kind: "fill", color: css(SIGNAL.signWhite) }],
        ["stop sign", { kind: "fill", color: css(SIGNAL.signStop) }], ["other sign", { kind: "fill", color: css(SIGNAL.signInfo) }],
        ["stop / waiting line", { kind: "line", color: css(SIGNAL.stopLine), width: 4 }], ["post / pole", { kind: "fill", color: css(ASSET.pole) }],
      ]} />
      <Group title="Objects & structures" items={[
        ["tree", { kind: "fill", color: css(ASSET.crown), border: css(ASSET.trunk) }], ["street lamp", { kind: "fill", color: css(ASSET.lamp) }],
        ["barrier / guard rail", { kind: "fill", color: css(ASSET.barrier) }], ["crosswalk", { kind: "fill", color: css(ASSET.crosswalk) }],
        ["other object", { kind: "fill", color: css(ASSET.object) }],
        ["bridge", { kind: "fill", color: css(STRUCTURE.bridgeFill), border: css(STRUCTURE.bridgeEdge) }],
        ["tunnel", { kind: "fill", color: css(STRUCTURE.tunnelFill), border: css(STRUCTURE.tunnelEdge) }],
      ]} />
      <p className="muted small">Signals and objects are symbols (boards, lamps, columns, boxes) at the file's position, height and size;
        where the file gives no size a typical one is drawn (inspector says so). Other tools draw their own models there.</p>
      <Group title="Review" items={[
        ["flag: open", { kind: "dot", color: css(MARKER.flag.open) }], ["flag: fixed", { kind: "dot", color: css(MARKER.flag.fixed) }],
        ["flag: question", { kind: "dot", color: css(MARKER.flag.question) }], ["finding: error", { kind: "dot", color: css(MARKER.finding.error) }],
        ["finding: warning", { kind: "dot", color: css(MARKER.finding.warning) }],
        ["selected", { kind: "fill", color: css(OVERLAY.selected) }], ["compare B (outlines)", { kind: "line", color: css(OVERLAY.compare), width: 2 }],
      ]} />
    </>
  );
}

/** OpenStreetMap Carto (the standard map at openstreetmap.org): its key colours */
export function OsmLegend({ basemap }: { basemap: Basemap }) {
  if (basemap.startsWith("satellite")) return <p className="muted small">Satellite imagery: no map legend. Switch to Map for the OpenStreetMap key.</p>;
  if (basemap === "none") return <p className="muted small">No base map.</p>;
  return (
    <>
      {basemap !== "osm" && <p className="muted small">OpenStreetMap Carto key (the standard map); the vector styles use similar classes in their own palette.</p>}
      <Group title="Roads" items={[
        ["motorway", { kind: "line", color: "#e892a2", width: 5 }], ["trunk", { kind: "line", color: "#f9b29c", width: 5 }],
        ["primary", { kind: "line", color: "#fcd6a4", width: 5 }], ["secondary", { kind: "line", color: "#f7fabf", width: 5 }],
        ["tertiary / residential", { kind: "fill", color: "#ffffff", border: "#bbb" }], ["pedestrian street", { kind: "fill", color: "#dddde8" }],
      ]} />
      <Group title="Paths & rail" items={[
        ["footway", { kind: "line", color: "#fa8072", dash: true, width: 2 }], ["cycleway", { kind: "line", color: "#0000ff", dash: true, width: 2 }],
        ["track / path", { kind: "line", color: "#996600", dash: true, width: 2 }], ["railway", { kind: "line", color: "#707070", dash: true, width: 3 }],
        ["tram", { kind: "line", color: "#444444", width: 2 }],
      ]} />
      <Group title="Areas" items={[
        ["building", { kind: "fill", color: "#d9d0c9", border: "#c4b6ab" }], ["residential area", { kind: "fill", color: "#e0dfdf" }],
        ["park / grass", { kind: "fill", color: "#cdebb0" }], ["forest", { kind: "fill", color: "#add19e" }],
        ["water", { kind: "fill", color: "#aad3df" }], ["parking", { kind: "fill", color: "#eeeeee", border: "#bbb" }],
        ["commercial / retail", { kind: "fill", color: "#f2dad9" }],
      ]} />
    </>
  );
}

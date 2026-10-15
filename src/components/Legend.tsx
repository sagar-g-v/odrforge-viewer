// Map legends: what the OpenDRIVE layers draw (colours and shapes from map/palette.ts, xodr/features.ts, xodr/build.ts)
// and what the base map shows (OpenStreetMap Carto's key colours; satellite imagery has no legend).
import type { Basemap } from "../map/MapView";
import { LEGEND, legendColor } from "../map/palette";

const css = (c: number[]) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})`;

type Swatch =
  | { kind: "fill"; color: string; border?: string }
  | { kind: "line"; color: string; dash?: boolean; double?: boolean; width?: number }
  | { kind: "dot"; color: string; ring?: string }
  | { kind: "light" };

function Sw({ s }: { s: Swatch }) {
  if (s.kind === "fill") return <i className="sw" style={{ background: s.color, borderColor: s.border ?? "var(--line-2)" }} />;
  if (s.kind === "dot") return <i className="sw dot" style={{ background: s.color, borderColor: s.ring ?? "#0b0e12" }} />;
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
        ["junction area (<boundary>)", { kind: "fill", color: "rgba(245,184,74,.3)", border: "#f5b84a" }],
        ["approximate area", { kind: "line", color: "#f5b84a", dash: true, width: 2 }],
        ["cross path", { kind: "line", color: "#00cdff", dash: true, width: 2 }],
      ]} />
      <Group title="Road marks" items={[
        ["solid", { kind: "line", color: "#f5f7fa" }], ["broken", { kind: "line", color: "#f5f7fa", dash: true }],
        ["double (yellow)", { kind: "line", color: "#f5c442", double: true, width: 2 }], ["curb", { kind: "line", color: "#96989c", width: 4 }],
      ]} />
      <Group title="Signals" items={[
        ["traffic light", { kind: "light" }], ["speed / yield sign", { kind: "fill", color: "#f6f6f6" }],
        ["stop sign", { kind: "fill", color: "#cc2028" }], ["other sign", { kind: "fill", color: "#2c62ce" }],
        ["stop / waiting line", { kind: "line", color: "#fafafa", width: 4 }], ["post / pole", { kind: "fill", color: "#969ba2" }],
      ]} />
      <Group title="Objects & structures" items={[
        ["tree", { kind: "fill", color: "#3e8a42" }], ["street lamp", { kind: "fill", color: "#ffd678" }],
        ["barrier / guard rail", { kind: "fill", color: "#b6bcc4" }], ["crosswalk", { kind: "fill", color: "rgba(255,255,255,.6)" }],
        ["other object", { kind: "fill", color: "#c4a05a" }], ["bridge", { kind: "fill", color: "rgba(70,130,230,.35)", border: "#4682e6" }],
        ["tunnel", { kind: "fill", color: "rgba(110,112,122,.35)", border: "#5a5c64" }],
      ]} />
      <Group title="Review" items={[
        ["flag: open", { kind: "dot", color: "#f5b84a" }], ["flag: fixed", { kind: "dot", color: "#3ecf8e" }],
        ["flag: question", { kind: "dot", color: "#5aa9ff" }], ["finding: error", { kind: "dot", color: "#ff5c5c" }],
        ["finding: warning", { kind: "dot", color: "#ffaa3c" }],
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

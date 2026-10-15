// Left panel: layers & display, review flags, checker findings.
import { useMemo, useState } from "react";
import type { Basemap, HeightMode, MapLayers } from "../map/MapView";
import { LEGEND, legendColor } from "../map/palette";
import type { Flag } from "../review/flags";
import type { Finding } from "../review/findings";
import type { Network } from "../data/useNetwork";
import type { LocalImagery } from "../map/localImagery";

export type Tab = "layers" | "flags" | "findings";

const rgba = (c: number[]) => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;

export interface SidePanelProps {
  tab: Tab; setTab: (t: Tab) => void; net: Network | null; imagery: LocalImagery | null; theme: "dark" | "light";
  layers: MapLayers; setLayers: (l: MapLayers) => void;
  basemap: Basemap; setBasemap: (b: Basemap) => void;
  heightMode: HeightMode; setHeightMode: (h: HeightMode) => void;
  exaggeration: number; setExaggeration: (n: number) => void;
  buildingOpacity: number; setBuildingOpacity: (n: number) => void;
  roadOpacity: number; setRoadOpacity: (n: number) => void;
  flags: Flag[]; flagStoreKind: string; selectedFlag: number | null; onFlag: (f: Flag) => void; onEditFlag: (f: Flag) => void;
  showDeleted: boolean; setShowDeleted: (b: boolean) => void; onExportFlags: () => void;
  findings: Finding[]; ruleOff: Set<string>; toggleRule: (r: string) => void; onFinding: (f: Finding) => void;
  onLoadFindings: (files: FileList) => void;
}

function Toggle({ label, on, set, hint }: { label: string; on: boolean; set: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function LayersTab(p: SidePanelProps) {
  const L = p.layers, set = (k: keyof MapLayers) => (v: boolean) => p.setLayers({ ...L, [k]: v });
  const s = p.net?.render.stats;
  return (
    <>
      {p.net && s && (
        <section className="card stats">
          <div><b>{s.roads.toLocaleString()}</b><span>roads</span></div>
          <div title={`${p.net.render.junctions.meta.filter((j) => j.exact).length} with a <boundary>`}><b>{s.junctions.toLocaleString()}</b><span>junctions</span></div>
          <div><b>{s.lanes.toLocaleString()}</b><span>lanes</span></div>
          <div><b>{s.lengthKm.toFixed(1)}</b><span>km</span></div>
        </section>
      )}
      <section>
        <h3>OpenDRIVE</h3>
        <Toggle label="Lanes" on={L.lanes} set={set("lanes")} />
        <Toggle label="Junction areas" on={L.junctions} set={set("junctions")} hint="Solid: the file's <boundary> (OpenDRIVE 1.8 §12.10); dashed: approximate outline of the connecting roads" />
        <Toggle label="Road marks" on={L.marks} set={set("marks")} />
        <Toggle label="Lane borders" on={L.borders} set={set("borders")} />
        <Toggle label="Reference lines" on={L.refs} set={set("refs")} />
        <Toggle label="Signals" on={L.signals} set={set("signals")} />
        <Toggle label="Objects (crosswalks …)" on={L.objects} set={set("objects")} />
        <label className="field row" title="Lane surfaces, junction areas and objects; road marks and outlines stay opaque">
          <span>Road opacity {Math.round(p.roadOpacity * 100)}%</span>
          <input type="range" min={0.1} max={1} step={0.05} value={p.roadOpacity} onChange={(e) => p.setRoadOpacity(+e.target.value)} />
        </label>
      </section>
      <section>
        <h3>Map</h3>
        <label className="field row">
          <span>Basemap</span>
          <select value={p.basemap} onChange={(e) => p.setBasemap(e.target.value as Basemap)}>
            <option value="osm">OpenStreetMap (standard)</option>
            <option value="satellite-live">Satellite (live, Esri World Imagery)</option>
            {p.imagery?.satellite && <option value="satellite">{`HD satellite (offline ${p.imagery.satellite.res} m)`}</option>}
            <option value="liberty">OSM Liberty (vector)</option>
            <option value="positron">OSM Positron (light)</option>
            <option value="dark">OSM Dark</option>
            <option value="none">None</option>
          </select>
        </label>
        {p.basemap === "satellite-live" && (
          <p className="muted small">Live satellite imagery streamed from Esri World Imagery (online, all areas; age and resolution vary by place).</p>
        )}
        {p.basemap === "satellite" && (
          <p className="muted small">
            {p.imagery?.satellite
              ? `${p.imagery.satellite.name.replace(/\s*\(offline,?\s*/i, " (")} over this network; Esri World Imagery elsewhere.`
              : "Esri World Imagery (online). Networks from the review server with an OdrForge basemap folder add their offline HD orthophoto."}
          </p>
        )}
        <Toggle label="3D buildings (in 3D view)" on={L.buildings} set={set("buildings")} />
        <label className="field row">
          <span>Building opacity {Math.round(p.buildingOpacity * 100)}%</span>
          <input type="range" min={0.1} max={1} step={0.05} value={p.buildingOpacity} onChange={(e) => p.setBuildingOpacity(+e.target.value)} disabled={!L.buildings} />
        </label>
        <Toggle label="Terrain" on={L.terrain} set={set("terrain")} hint="Mapzen Terrarium elevation tiles (AWS Open Data)" />
      </section>
      <section>
        <h3>Road heights</h3>
        <div className="seg">
          {(["flat", "relative", "absolute"] as HeightMode[]).map((h) => (
            <button key={h} className={p.heightMode === h ? "on" : ""} onClick={() => p.setHeightMode(h)}>{h}</button>
          ))}
        </div>
        <p className="muted small">
          {p.heightMode === "flat" ? "Roads drawn on the ground (z ignored)." : p.heightMode === "relative"
            ? `Typical road height on the ground${p.net ? ` (median z ${p.net.render.zGround.toFixed(1)} m; range ${p.net.render.zRange[0].toFixed(1)} … ${p.net.render.zRange[1].toFixed(1)} m)` : ""}.`
            : "File heights as metres above the map datum — use with Terrain."}
        </p>
        <label className="field row">
          <span>Height × {p.exaggeration}</span>
          <input type="range" min={1} max={10} step={1} value={p.exaggeration} onChange={(e) => p.setExaggeration(+e.target.value)} />
        </label>
      </section>
      <section>
        <h3>Lane types</h3>
        <div className="legend">
          {LEGEND.map((t) => <span key={t}><i style={{ background: rgba(legendColor(t, p.theme)) }} />{t}</span>)}
        </div>
      </section>
    </>
  );
}

function FlagsTab(p: SidePanelProps) {
  const list = p.flags.filter((f) => p.showDeleted || !f.deleted);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of p.flags) if (!f.deleted) c[f.status ?? "open"] = (c[f.status ?? "open"] ?? 0) + 1;
    return c;
  }, [p.flags]);
  return (
    <>
      <section className="row-between">
        <div className="chips">
          {Object.entries(counts).map(([k, n]) => <span key={k} className={`chip status-${k}`}>{n} {k}</span>)}
          {!p.flags.length && <span className="muted small">No flags yet.</span>}
        </div>
      </section>
      <p className="muted small">
        Saved {p.flagStoreKind === "server" ? "to the review server" : "in this browser"}. Press <kbd>F</kbd> or ⚑, then click the map.
      </p>
      <div className="list">
        {list.map((f) => (
          <div key={f.id} className={`item ${p.selectedFlag === f.id ? "sel" : ""} ${f.deleted ? "deleted" : ""}`} onClick={() => p.onFlag(f)}>
            <div className="item-head">
              <b>#{f.id}</b> <span className={`chip status-${f.status ?? "open"}`}>{f.deleted ? "deleted" : f.status ?? "open"}</span>
              <span className="muted small">{f.category}</span>
              <span className="grow" />
              <button className="link" onClick={(e) => { e.stopPropagation(); p.onEditFlag(f); }}>Edit</button>
            </div>
            <div>{f.note}</div>
            <div className="muted small">{f.road ? `road ${f.road}${f.lane !== null ? ` lane ${f.lane}` : ""}${f.junction && f.junction !== "-1" ? ` · junction ${f.junction}` : ""}` : "no road"}</div>
            {f.reply && <div className="reply-text">↳ {f.reply}</div>}
          </div>
        ))}
      </div>
      <section className="row-between">
        <Toggle label="Show deleted" on={p.showDeleted} set={p.setShowDeleted} />
        <button className="btn small" onClick={p.onExportFlags} disabled={!p.flags.length}>Export JSON</button>
      </section>
    </>
  );
}

function FindingsTab(p: SidePanelProps) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const g = new Map<string, Finding[]>();
    for (const f of p.findings) { const k = `${f.source} · ${f.rule}`; if (!g.has(k)) g.set(k, []); g.get(k)!.push(f); }
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [p.findings]);
  return (
    <>
      <label className="btn block file-btn">
        Load checker results (.xqar, invariants.json)
        <input type="file" multiple accept=".xqar,.json" onChange={(e) => e.target.files && p.onLoadFindings(e.target.files)} />
      </label>
      {!groups.length && <p className="muted small">ASAM Quality Checker reports and OdrForge exact-invariant results show as markers on the map.</p>}
      <div className="list">
        {groups.map(([k, fs]) => {
          const rule = k;
          const off = p.ruleOff.has(rule);
          return (
            <div key={k} className="group">
              <div className="item-head">
                <input type="checkbox" checked={!off} onChange={() => p.toggleRule(rule)} title="Show on map" />
                <button className="link grow left" onClick={() => setOpen(open === k ? null : k)}>{k}</button>
                <span className={`chip level-${fs[0].level}`}>{fs.length}</span>
              </div>
              {open === k && (
                <div className="sublist">
                  {fs.slice(0, 500).map((f, i) => (
                    <div key={i} className="item small" onClick={() => p.onFinding(f)}>
                      {f.road ? `road ${f.road} · ` : ""}{f.message || f.rule}
                    </div>
                  ))}
                  {fs.length > 500 && <p className="muted small">… {fs.length - 500} more (all shown on the map)</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function SidePanel(p: SidePanelProps) {
  const nFlags = p.flags.filter((f) => !f.deleted).length;
  return (
    <aside className="panel">
      <nav className="tabs" role="tablist">
        {(["layers", "flags", "findings"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={p.tab === t} className={p.tab === t ? "on" : ""} onClick={() => p.setTab(t)}>
            {t === "layers" ? "Layers" : t === "flags" ? `Flags${nFlags ? ` · ${nFlags}` : ""}` : `Findings${p.findings.length ? ` · ${p.findings.length}` : ""}`}
          </button>
        ))}
      </nav>
      <div className="panel-body">
        {p.tab === "layers" ? <LayersTab {...p} /> : p.tab === "flags" ? <FlagsTab {...p} /> : <FindingsTab {...p} />}
      </div>
    </aside>
  );
}

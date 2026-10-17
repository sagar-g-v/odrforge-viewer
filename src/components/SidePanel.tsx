// Left panel: layers & display, review flags, checker findings.
import { useMemo, useState } from "react";
import ReviewTab from "./ReviewTab";
import type { ReviewFilter, ReviewItem, ReviewLoad } from "../review/llmReview";
import { CARTO_AVAILABLE, type Basemap, type HeightMode, type MapLayers } from "../map/MapView";
import { OdrLegend, OsmLegend } from "./Legend";
import { concreteBasemap } from "../map/basemap";
import type { Flag } from "../review/flags";
import type { Finding } from "../review/findings";
import type { Network } from "../data/useNetwork";
import { metres, shortTime, type Provenance } from "../data/provenance";
import type { OpenDrive } from "../xodr/model";
import type { CompareResult, DiffItem, DiffKind } from "../xodr/compare";
import type { LocalImagery } from "../map/localImagery";

export type Tab = "layers" | "flags" | "findings" | "compare";

export interface SidePanelProps {
  tab: Tab; setTab: (t: Tab) => void; net: Network | null; provenance: Provenance | null; imagery: LocalImagery | null; theme: "dark" | "light";
  layers: MapLayers; setLayers: (l: MapLayers) => void;
  basemap: Basemap; setBasemap: (b: Basemap) => void;
  heightMode: HeightMode; setHeightMode: (h: HeightMode) => void;
  exaggeration: number; setExaggeration: (n: number) => void;
  buildingOpacity: number; setBuildingOpacity: (n: number) => void;
  roadOpacity: number; setRoadOpacity: (n: number) => void;
  dim: number; setDim: (n: number) => void;
  terrainSource: string | null; // the network's ground grid when the terrain uses it
  flags: Flag[]; flagStoreKind: string; selectedFlag: number | null; onFlag: (f: Flag) => void; onEditFlag: (f: Flag) => void;
  showDeleted: boolean; setShowDeleted: (b: boolean) => void; onExportFlags: () => void;
  findings: Finding[]; ruleOff: Set<string>; toggleRule: (r: string) => void; onFinding: (f: Finding) => void;
  onLoadFindings: (files: FileList) => void;
  compare: CompareProps;
  review: ReviewProps;
}

/** the LLM review of the open page (read-only) */
export interface ReviewProps {
  load: ReviewLoad | null; filter: ReviewFilter; setFilter: (f: ReviewFilter) => void; shown: ReviewItem[]; selected: string | null;
  onItem: (i: ReviewItem) => void; count: number; // items with a defect / uncertain verdict
  view: "checks" | "review"; setView: (v: "checks" | "review") => void; // the Findings tab: checker results or the LLM review
}

/** comparing the network under review (A) with another build (B) */
export interface CompareProps {
  net: Network | null; loading: string | null; error: string | null; result: CompareResult | null; files: string[];
  openServer: (f: string) => void; openLocal: (f: File) => void; clear: () => void;
  overlay: boolean; setOverlay: (b: boolean) => void; onItem: (d: DiffItem) => void;
}

/** props that make a clickable list row reachable and usable from the keyboard */
const rowButton = (onClick: () => void) => ({
  role: "button", tabIndex: 0, onClick,
  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } },
});

function Toggle({ label, on, set, hint }: { label: string; on: boolean; set: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** a collapsible group of controls; its open / closed state is remembered per browser */
function Section({ id, title, children, defaultOpen = true, hint }: { id: string; title: string; children: React.ReactNode; defaultOpen?: boolean; hint?: string }) {
  const key = `odrv.section.${id}`;
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === "1"; } catch { return defaultOpen; }
  });
  return (
    <details className="group" open={open} onToggle={(e) => {
      const o = (e.currentTarget as HTMLDetailsElement).open;
      setOpen(o);
      try { localStorage.setItem(key, o ? "1" : "0"); } catch { /* storage blocked */ }
    }}>
      <summary title={hint}><span>{title}</span></summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

function Slider({ label, value, min, max, step, onChange, disabled, format }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; disabled?: boolean; format?: (v: number) => string;
}) {
  return (
    <label className="field row">
      <span>{label} <b className="val">{format ? format(value) : `${Math.round(value * 100)}%`}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)}
        style={{ "--pct": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties} />
    </label>
  );
}

/** the converter build that wrote the page (data/provenance.ts): shown only when its record is tied to these bytes */
function BuildRows({ p, kv }: { p: Provenance; kv: (k: string, v: React.ReactNode) => React.ReactNode }) {
  const m = metres;
  if (p.status === "match") {
    const f = p.facts;
    return (
      <>
        <div className="sub-title">Build</div>
        {kv("commit", <span className="mono">{f.commit}{f.dirty && <span className="warn-text"> + uncommitted changes</span>}</span>)}
        {kv("gate run", shortTime(f.runTime))}
        {f.binaryBuilt && kv("converter built", shortTime(f.binaryBuilt))}
        {kv("terrain fit: centre p95", m(f.centreP95))}
        {kv("conformed p95 / p99", `${m(f.conformedP95)} / ${m(f.conformedP99)}`)}
        {f.decksWithin05 !== null && kv("decks within 0.5 m", `${(f.decksWithin05 <= 1 ? f.decksWithin05 * 100 : f.decksWithin05).toFixed(1)} %`)}
        {kv("tied to this file by", f.by === "sha256" ? "content hash (sha256)" : "size and modification time")}
      </>
    );
  }
  return (
    <>
      <div className="sub-title">Build</div>
      <p className={`small ${p.status === "none" ? "muted" : "warn-text"}`}>
        {p.status === "none" ? "No metrics for this build."
          : p.status === "mismatch" ? `The metrics next to this page are for another build${p.snapshotTime ? ` (run ${shortTime(p.snapshotTime)})` : ""}: ${p.reasons.join("; ")}. Not shown.`
          : p.status === "unverified" ? `Metrics not shown: ${p.reason}.` : p.status === "invalid" ? `Metrics unreadable: ${p.reason}.` : ""}
      </p>
    </>
  );
}

/** the file's <header> (1.8.0 §6.3): what it says about itself, its georeference, offset, license and user data */
function FileSection({ od, provenance }: { od: OpenDrive; provenance: Provenance | null }) {
  const h = od.header, o = h.offset;
  const kv = (k: string, v: React.ReactNode) => <div className="kv" key={k}><span>{k}</span><span>{v}</span></div>;
  return (
    <Section id="file" title="File" defaultOpen={false}>
      {kv("name", h.name || "–")}
      {kv("OpenDRIVE", `${h.revMajor}.${h.revMinor}`)}
      {h.version && kv("version", h.version)}
      {kv("vendor", h.vendor || "–")}
      {h.date && kv("date", h.date)}
      {h.bounds && kv("extent (N S E W)", `${h.bounds.north.toFixed(1)} ${h.bounds.south.toFixed(1)} ${h.bounds.east.toFixed(1)} ${h.bounds.west.toFixed(1)} m`)}
      {(o.x || o.y || o.z || o.hdg) ? kv("offset (x y z hdg)", `${o.x} ${o.y} ${o.z} ${o.hdg}`) : null}
      {kv("georeference", <code className="small wrap">{h.geoReference || "none"}</code>)}
      {h.license && kv("license", h.license.resource
        ? <a href={h.license.resource} target="_blank" rel="noreferrer">{h.license.name || h.license.spdxid || h.license.resource}</a>
        : h.license.name || h.license.spdxid || h.license.text)}
      {h.userData.map((u, i) => <div className="kv" key={`u${i}`}><span>{`userData ${u.code}`}</span><span>{u.value}</span></div>)}
      {kv("junction groups", od.junctionGroups.length ? od.junctionGroups.map((g) => `${g.type || "group"} ${g.id} (${g.junctions.length})`).join(", ") : "none")}
      {provenance && provenance.status !== "local" && <BuildRows p={provenance} kv={kv} />}
    </Section>
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
      {p.net?.od && <FileSection od={p.net.od} provenance={p.provenance} />}
      <Section id="odr" title="OpenDRIVE layers">
        <div className="sub-title">Road</div>
        <Toggle label="Lanes" on={L.lanes} set={set("lanes")} />
        <Toggle label="Road marks" on={L.marks} set={set("marks")} />
        <Toggle label="Driving direction" on={L.directions} set={set("directions")} hint="An arrow on every traffic lane (OpenDRIVE 1.8 §11.2.1: the road's RHT / LHT rule, the lane's side and @direction; double-headed for both directions)" />
        <Toggle label="Lane borders" on={L.borders} set={set("borders")} />
        <Toggle label="Reference lines" on={L.refs} set={set("refs")} />
        <div className="sub-title">Junctions</div>
        <Toggle label="Junction areas" on={L.junctions} set={set("junctions")} hint="Solid: the file's <boundary> (OpenDRIVE 1.8 §12.10); dashed: approximate outline of the connecting roads" />
        <Toggle label="Cross paths" on={L.crossPaths} set={set("crossPaths")} hint="Pedestrian crossings in junctions (OpenDRIVE 1.8 crossPath)" />
        <Toggle label="Reference lines & elevation grids" on={L.grids} set={set("grids")} hint="Junction reference line (OpenDRIVE 1.8 §12.9, dashed red) and elevation grid (§12.11): grid points at their z-values, lines between neighbouring points" />
        <div className="sub-title">Furniture & structures</div>
        <Toggle label="Signals (signs, lights, stop lines)" on={L.signals} set={set("signals")} />
        <Toggle label="Objects (trees, poles, barriers, crosswalks)" on={L.objects} set={set("objects")} />
        <Toggle label="Bridges & tunnels" on={L.structures} set={set("structures")} />
        <Toggle label="Tunnel roads through terrain (3D)" on={L.tunnels} set={set("tunnels")}
          hint="With terrain on, a road in a tunnel lies under the ground and the surface hides it: its lanes under the ground are drawn dashed on top, at their own positions (nothing is moved)" />
        <div className="sub-title">Review</div>
        <Toggle label="Flags" on={L.flags} set={set("flags")} />
        <Toggle label="Findings" on={L.findings} set={set("findings")} />
        <Toggle label="LLM review" on={L.review} set={set("review")} hint="The LLM review's items (<page>.review.json), rings by severity; see the Review tab" />
      </Section>
      <Section id="road-display" title="Road display">
        <Slider label="Road opacity" value={p.roadOpacity} min={0.1} max={1} step={0.05} onChange={p.setRoadOpacity} />
        <div className="sub-title">Heights (3D view)</div>
        <div className="seg">
          {(["flat", "relative", "absolute"] as HeightMode[]).map((h) => (
            <button key={h} className={p.heightMode === h ? "on" : ""} onClick={() => p.setHeightMode(h)}>{h}</button>
          ))}
        </div>
        <p className="muted small">
          {p.heightMode === "flat" ? `Roads drawn on the ground (z ignored)${p.layers.terrain ? ", laid on the terrain" : ""}.` : p.heightMode === "relative"
            ? `Typical road height on the ground${p.net ? ` (median z ${p.net.render.zGround.toFixed(1)} m; range ${p.net.render.zRange[0].toFixed(1)} … ${p.net.render.zRange[1].toFixed(1)} m)` : ""}${p.layers.terrain ? "; with Terrain the roads are laid on it, bridges and tunnels keep their height above / below the road level" : ""}.`
            : "File heights as metres above sea level, for files built with real elevation — use with Terrain."}
        </p>
        <Slider label="Height exaggeration" value={p.exaggeration} min={1} max={10} step={1} onChange={p.setExaggeration} format={(v) => `× ${v}`} />
      </Section>
      <Section id="basemap" title="Base map">
        <label className="field row">
          <span>Map</span>
          <select value={p.basemap === "satellite" && !p.imagery?.satellite ? "satellite-live" : p.basemap} onChange={(e) => p.setBasemap(e.target.value as Basemap)}>
            <option value="map">Map (follows the theme: OpenStreetMap / dark)</option>
            <option value="osm">OpenStreetMap (standard)</option>
            <option value="satellite-live">Satellite (live, Esri World Imagery)</option>
            {p.imagery?.satellite && <option value="satellite">{`HD satellite (offline ${p.imagery.satellite.res} m)`}</option>}
            <option value="liberty">OSM Liberty (vector)</option>
            <option value="positron">OSM Positron (light)</option>
            <option value="dark">OSM Dark</option>
            <option value="carto" disabled={!CARTO_AVAILABLE}>{CARTO_AVAILABLE ? "CARTO Voyager (vector)" : "CARTO Voyager (vector): set CARTO_MAP_API"}</option>
            <option value="carto-dark" disabled={!CARTO_AVAILABLE}>{CARTO_AVAILABLE ? "CARTO Dark Matter (vector)" : "CARTO Dark Matter (vector): set CARTO_MAP_API"}</option>
            <option value="carto-raster" disabled={!CARTO_AVAILABLE}>{CARTO_AVAILABLE ? "CARTO Voyager (raster)" : "CARTO Voyager (raster): set CARTO_MAP_API"}</option>
            <option value="none">None</option>
          </select>
        </label>
        {p.basemap === "satellite-live" && (
          <p className="muted small">Live satellite imagery streamed from Esri World Imagery (online, all areas; age and resolution vary by place).</p>
        )}
        {p.basemap === "satellite" && p.imagery?.satellite && (
          <p className="muted small">{`${p.imagery.satellite.name.replace(/\s*\(offline,?\s*/i, " (")} over this network; Esri World Imagery elsewhere.`}</p>
        )}
        <Slider label="Background dim" value={p.dim} min={0} max={0.9} step={0.05} onChange={p.setDim} />
        <div className="sub-title">3D</div>
        <Toggle label="3D buildings (in 3D view)" on={L.buildings} set={set("buildings")} />
        <Slider label="Building opacity" value={p.buildingOpacity} min={0.1} max={1} step={0.05} onChange={p.setBuildingOpacity} disabled={!L.buildings} />
        <Toggle label="Terrain (in 3D view)" on={L.terrain} set={set("terrain")} hint="The network's own ground grid (the converter's <area>_ground.odrz on the review server) where there is one, Mapzen Terrarium elevation tiles (AWS Open Data) around it. Files without absolute heights are laid on it in flat and relative mode; Height exaggeration scales terrain and roads alike" />
        {L.terrain && <p className="muted small">{`Terrain: ${p.terrainSource ?? "Mapzen Terrarium (open DEM; can be metres off in cities and steep terrain)"}`}</p>}
      </Section>
      <Section id="legend-odr" title="Legend · OpenDRIVE" defaultOpen={false}>
        <OdrLegend theme={p.theme} />
      </Section>
      <Section id="legend-osm" title="Legend · OpenStreetMap" defaultOpen={false}>
        <OsmLegend basemap={concreteBasemap(p.basemap, p.theme)} />
      </Section>
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
        Saved {p.flagStoreKind === "server" ? "to the review server" : "in this browser"}. Press <kbd>F</kbd> or the Flag button, then click the map.
      </p>
      <div className="list">
        {list.map((f) => (
          <div key={f.id} className={`item ${p.selectedFlag === f.id ? "sel" : ""} ${f.deleted ? "deleted" : ""}`} {...rowButton(() => p.onFlag(f))}>
            <div className="item-head">
              <b>#{f.id}</b> <span className={`chip status-${f.status ?? "open"}`}>{f.deleted ? "deleted" : f.status ?? "open"}</span>
              <span className="muted small">{f.category}</span>
              <span className="grow" />
              <button className="link" onClick={(e) => { e.stopPropagation(); p.onEditFlag(f); }}>Edit</button>
            </div>
            <div>{f.note}</div>
            <div className="muted small">{f.road ? `road ${f.road}${f.lane != null ? ` lane ${f.lane}` : ""}${f.junction && f.junction !== "-1" ? ` · junction ${f.junction}` : ""}` : "no road"}</div>
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

/** the Findings tab: checker results (loaded by you) or the LLM review of the page (from the review server) */
function FindingsPanel(p: SidePanelProps) {
  const v = p.review.view;
  return (
    <>
      <div className="seg" role="group" aria-label="Findings source" style={{ alignSelf: "flex-start" }}>
        <button className={v === "checks" ? "on" : ""} onClick={() => p.review.setView("checks")}>Checkers{p.findings.length ? ` ${p.findings.length.toLocaleString()}` : ""}</button>
        <button className={v === "review" ? "on" : ""} onClick={() => p.review.setView("review")}>LLM review{p.review.count ? ` ${p.review.count}` : ""}</button>
      </div>
      {v === "checks" ? <FindingsTab {...p} /> : <ReviewTab {...p.review} roads={p.net?.od?.roads ?? []} />}
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
        <input type="file" multiple accept=".xqar,.json" onChange={(e) => { if (e.target.files) p.onLoadFindings(e.target.files); e.target.value = ""; }} />
      </label>
      {!groups.length && <p className="muted small">ASAM Quality Checker reports and OdrForge exact-invariant results show as markers on the map.</p>}
      <div className="list">
        {groups.map(([k, fs]) => {
          const rule = k;
          const off = p.ruleOff.has(rule);
          return (
            <div key={k} className="group">
              <div className="item-head">
                <input type="checkbox" checked={!off} onChange={() => p.toggleRule(rule)} title="Show on map" aria-label={`Show ${rule} on the map`} />
                <button className="link grow left" onClick={() => setOpen(open === k ? null : k)}>{k}</button>
                <span className={`chip level-${fs[0].level}`}>{fs.length}</span>
              </div>
              {open === k && (
                <div className="sublist">
                  {fs.slice(0, 500).map((f, i) => (
                    <div key={i} className="item small" {...rowButton(() => p.onFinding(f))}>
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

function CompareTab(p: SidePanelProps) {
  const c = p.compare, R = c.result;
  const [show, setShow] = useState<Record<DiffKind, boolean>>({ added: true, removed: true, changed: true });
  const order: Record<DiffKind, number> = { changed: 0, added: 1, removed: 2 };
  const items = R ? R.items.filter((d) => show[d.kind]).sort((x, y) => order[x.kind] - order[y.kind]) : [];
  const count = (k: DiffKind) => R?.items.filter((d) => d.kind === k).length ?? 0;
  const rows: [string, keyof CompareResult["a"], number][] = [["roads", "roads", 0], ["junctions", "junctions", 0], ["lanes", "lanes", 0], ["km", "km", 2], ["signals", "signals", 0], ["objects", "objects", 0]];
  return (
    <>
      <p className="muted small">Compare <b>A</b>, the network under review{p.net ? ` (${p.net.name})` : ""}, with <b>B</b>, another build of the same area: roads and junctions matched by id, B drawn over A on the map.</p>
      <label className="field">
        <span>B from the review server</span>
        <select value={c.net?.fromServer ? c.net.name : ""} onChange={(e) => e.target.value && c.openServer(e.target.value)}>
          <option value="">{c.files.length ? "Choose a file…" : "No files on server"}</option>
          {c.files.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <label className="btn block file-btn">
        Open B from a file…
        <input type="file" accept=".xodr" onChange={(e) => { if (e.target.files?.[0]) c.openLocal(e.target.files[0]); e.target.value = ""; }} />
      </label>
      {c.loading && <p className="muted small">{c.loading}</p>}
      {c.error && <p className="small" style={{ color: "var(--err)" }}>{c.error}</p>}
      {c.net && !c.net.od && <p className="small">B is an OdrForge page export: comparing needs the .xodr.</p>}
      {c.net && !p.net && <p className="small">Open the network to compare against (A) first.</p>}
      {c.net && p.net && !p.net.od && <p className="small">A is an OdrForge page export: comparing needs its .xodr.</p>}
      {c.net && (
        <>
          <Toggle label={`Show B on the map (${c.net.name})`} on={c.overlay} set={c.setOverlay} hint="B's lane outlines (magenta) and reference lines (dashed) over A" />
          <button className="btn block" onClick={c.clear}>Remove B</button>
        </>
      )}
      {R && (
        <>
          <section className="card">
            <div className="kv"><span /><span><b>A</b> → <b>B</b></span></div>
            {rows.map(([label, k, d]) => (
              <div className="kv" key={k}><span>{label}</span><span>{R.a[k].toFixed(d)} → {R.b[k].toFixed(d)}{R.a[k].toFixed(d) !== R.b[k].toFixed(d) ? ` (${R.b[k] > R.a[k] ? "+" : ""}${(R.b[k] - R.a[k]).toFixed(d)})` : ""}</span></div>
            ))}
            <div className="kv"><span>roads matched by id</span><span>{R.matchedRoads} of {R.a.roads}</span></div>
            {R.matchedRoads < 0.5 * Math.min(R.a.roads, R.b.roads) && (
              <p className="small" style={{ color: "var(--warn)" }}>Few road ids match: B seems renumbered, so the list says little; compare on the map.</p>
            )}
            <p className="muted small">{`Reported above ${R.tolerance.position * 100} cm in position, ${R.tolerance.height * 100} cm in height, ${R.tolerance.length * 100} cm in length.`}</p>
          </section>
          <div className="chips">
            {(["changed", "added", "removed"] as DiffKind[]).map((k) => (
              <button key={k} className={`chip ${show[k] ? (k === "removed" ? "err" : k === "added" ? "ok" : "warn") : ""}`} aria-pressed={show[k]} onClick={() => setShow({ ...show, [k]: !show[k] })}>{k} {count(k)}</button>
            ))}
          </div>
          {!R.items.length && <p className="muted small">No differences.</p>}
          <div className="list">
            {items.slice(0, 500).map((d, i) => (
              <div key={i} className="item small" {...rowButton(() => c.onItem(d))} title={Number.isFinite(d.lon) ? "Fly there" : "Not on the map"}>
                <div className="item-head"><span className={`chip ${d.kind === "removed" ? "err" : d.kind === "added" ? "ok" : "warn"}`}>{d.kind}</span><b>{d.what} {d.id}</b></div>
                <span className="muted">{d.detail}</span>
              </div>
            ))}
            {items.length > 500 && <p className="muted small">… {items.length - 500} more</p>}
          </div>
        </>
      )}
    </>
  );
}

export default function SidePanel(p: SidePanelProps) {
  const nFlags = p.flags.filter((f) => !f.deleted).length;
  return (
    <aside className="panel">
      <nav className="tabs" role="tablist">
        {(["layers", "flags", "findings", "compare"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={p.tab === t} tabIndex={p.tab === t ? 0 : -1} className={p.tab === t ? "on" : ""} onClick={() => p.setTab(t)}
            onKeyDown={(e) => { // arrow keys move between the tabs (WAI-ARIA tabs pattern)
              const all: Tab[] = ["layers", "flags", "findings", "compare"], k = all.indexOf(t);
              const next = e.key === "ArrowRight" ? all[(k + 1) % all.length] : e.key === "ArrowLeft" ? all[(k + all.length - 1) % all.length] : null;
              if (!next) return;
              e.preventDefault(); p.setTab(next);
              (e.currentTarget.parentElement?.children[all.indexOf(next)] as HTMLElement | undefined)?.focus();
            }}>
            {t === "layers" ? "Layers" : t === "flags" ? "Flags" : t === "findings" ? "Findings" : "Compare"}
            {(() => {
              const n = t === "flags" ? nFlags : t === "findings" ? p.findings.length + p.review.count : t === "compare" ? p.compare.result?.items.length ?? 0 : 0;
              return n ? <span className="chip">{n.toLocaleString()}</span> : null;
            })()}
          </button>
        ))}
      </nav>
      <div className="panel-body">
        {p.tab === "layers" ? <LayersTab {...p} /> : p.tab === "flags" ? <FlagsTab {...p} /> : p.tab === "findings" ? <FindingsPanel {...p} /> : <CompareTab {...p} />}
      </div>
    </aside>
  );
}

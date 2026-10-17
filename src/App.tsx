import type { PickingInfo } from "@deck.gl/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FlagDialog, { type FlagDraft } from "./components/FlagDialog";
import Inspector, { FeatureInspector, JunctionInspector, type Selection } from "./components/Inspector";
import SidePanel, { type Tab } from "./components/SidePanel";
import { Icon, Logo } from "./components/Icon";
import { MARKER } from "./design/scene";
import { listServerFiles, useNetwork, type Network } from "./data/useNetwork";
import { compareNetworks } from "./xodr/compare";
import MapView, { type Basemap, type HeightMode, type MapLayers, type MarkerPoint } from "./map/MapView";
import { storedBasemap } from "./map/basemap";
import { fetchPageMetrics, matchProvenance, shortTime, type Provenance } from "./data/provenance";
import { datumMismatch } from "./map/odrz";
import { virtualJunctions } from "./map/junctionStyle";
import { browserStore, nextFlagId, serverStore, type Flag, type FlagStore } from "./review/flags";
import { parseFindings, type Finding } from "./review/findings";
import { probe } from "./xodr/query";
import { findLocalImagery, type LocalImagery } from "./map/localImagery";
import { fetchGrid, groundGridFiles, type GroundGrid } from "./map/odrz";

// review marker colours (design/scene.ts MARKER, design system --data-flag-*, --data-finding-*)
const STATUS_COLOR = MARKER.flag;
const LEVEL_COLOR = MARKER.finding;

const store = (k: string, v?: string) => {
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* storage blocked */ }
  return null;
};

const TOAST_ICON = { ok: "check", info: "info", warn: "alert", err: "alert" } as const;

/** the status bar's build line: commit, dirty, run time and the conformed fit, or why there is none */
function BuildStatus({ p }: { p: Provenance }) {
  if (p.status === "local") return null;
  if (p.status === "none") return <span className="muted">no metrics for this build</span>;
  if (p.status === "match") {
    const f = p.facts;
    return (
      <span title={`${f.label} · run ${f.runTime}${f.binaryBuilt ? ` · converter built ${f.binaryBuilt}` : ""} · tied by ${f.by}`}>
        build <b className="mono">{f.commit}</b>{f.dirty && <span className="warn-text"> dirty</span>} · {shortTime(f.runTime)}
        {f.conformedP95 !== null && <> · conformed p95 <b>{f.conformedP95.toFixed(2)} m</b></>}
      </span>
    );
  }
  const why = p.status === "mismatch" ? `metrics are for another build of this page: ${p.reasons.join("; ")}`
    : p.status === "unverified" ? `metrics not shown: ${p.reason}` : `metrics unreadable: ${p.reason}`;
  return <span className="warn-text" title={why}>{p.status === "mismatch" ? "metrics are for another build" : "metrics not shown"}</span>;
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [theme, setTheme] = useState<"dark" | "light">((store("odrv.theme") as "dark" | "light") || "dark");
  const [basemap, setBasemap] = useState<Basemap>(() => storedBasemap(store("odrv.basemap2"), store("odrv.basemap")));
  useEffect(() => { store("odrv.basemap2", basemap); }, [basemap]);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [layers, setLayers] = useState<MapLayers>({
    lanes: true, junctions: true, marks: true, borders: false, refs: false, signals: true, objects: true, structures: true, crossPaths: true, grids: false, directions: true, buildings: true, terrain: false, flags: true, findings: true,
  });
  const [heightMode, setHeightMode] = useState<HeightMode>("relative");
  const [exaggeration, setExaggeration] = useState(1);
  const [buildingOpacity, setBuildingOpacity] = useState(0.5);
  const [roadOpacity, setRoadOpacity] = useState(() => Number(store("odrv.roadOpacity")) || 1); // design §3: lanes opaque (alpha ~.92) by default
  useEffect(() => { store("odrv.roadOpacity", String(roadOpacity)); }, [roadOpacity]);
  const [dim, setDim] = useState(() => Number(store("odrv.dim")) || 0);
  useEffect(() => { store("odrv.dim", String(dim)); }, [dim]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("layers");
  const [server, setServer] = useState(params.get("server") || store("odrv.server") || "http://127.0.0.1:8766");
  const [files, setFiles] = useState<string[]>([]);
  const [serverState, setServerState] = useState<"idle" | "ok" | "error">("idle");
  const { network: net, loading, error, openServerFile, openLocalFile, clearError } = useNetwork();
  // B: another build of the same area, compared with the network under review (xodr/compare.ts)
  const cmp = useNetwork();
  const [cmpOverlay, setCmpOverlay] = useState(true);
  const cmpResult = useMemo(() => (net?.od && cmp.network?.od ? compareNetworks(net.od, net.render, cmp.network.od, cmp.network.render) : null),
    [net, cmp.network]);
  const [sel, setSel] = useState<Selection | null>(null);
  const [imagery, setImagery] = useState<LocalImagery | null>(null); // offline HD orthophoto on the server
  const [selF, setSelF] = useState<{ kind: string; road: number; index: number } | null>(null); // a signal, object, structure, cross path
  const [selJ, setSelJ] = useState<{ index: number; x: number; y: number } | null>(null); // a junction area
  const [flags, setFlags] = useState<Flag[]>([]);
  const flagStore = useRef<FlagStore | null>(null);
  const [flagStoreKind, setFlagStoreKind] = useState<FlagStore["kind"]>("browser");
  const [flagMode, setFlagMode] = useState(false);
  const [draft, setDraft] = useState<FlagDraft | null>(null);
  const [selectedFlag, setSelectedFlag] = useState<number | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [ruleOff, setRuleOff] = useState<Set<string>>(new Set());
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number; zoom?: number; key: number } | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [toast, setToastState] = useState<{ text: string; tone: "ok" | "info" | "warn" | "err" } | null>(null);
  const setToast = useCallback((text: string, tone: "ok" | "info" | "warn" | "err" = "warn") => setToastState({ text, tone }), []);
  const [search, setSearch] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { document.documentElement.dataset.theme = theme; store("odrv.theme", theme); }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToastState(null), 4000); // design §5: auto-hides after 4 s
    return () => clearTimeout(t);
  }, [toast]);

  // review server: its .xodr files
  const connect = useCallback(async (url: string) => {
    try {
      const fs = await listServerFiles(url);
      setFiles(fs); setServerState("ok"); store("odrv.server", url);
      return fs;
    } catch {
      setFiles([]); setServerState("error");
      return [];
    }
  }, []);
  useEffect(() => {
    connect(server).then((fs) => {
      const f = params.get("file");
      if (f && fs.includes(f)) { setFindings([]); openServerFile(server, f); }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // selections, flags and imagery belong to one network: cleared in the render the new network arrives in (an effect
  // runs only after that render, which would index the new network with the old selection and throw)
  const [shownNet, setShownNet] = useState(net);
  if (shownNet !== net) {
    setShownNet(net);
    setSel(null); setSelJ(null); setSelF(null); setSelectedFlag(null); setFlags([]); setImagery(null);
  }

  // a new network: fit, load its flags and imagery (results of an earlier network are dropped)
  useEffect(() => {
    if (!net) return;
    let live = true;
    setFitKey((k) => k + 1);
    const store0 = net.fromServer ? serverStore(server, net.page) : browserStore(net.page);
    flagStore.current = store0;
    setFlagStoreKind(store0.kind);
    store0.load().then((fl) => { if (live) setFlags(fl); }).catch(() => {
      if (!live) return;
      const local = browserStore(net.page);
      flagStore.current = local;
      setFlagStoreKind("browser");
      local.load().then((fl) => { if (live) setFlags(fl); });
      setToast("Review server unreachable: flags are kept in this browser.");
    });
    if (!net.fromServer) setBasemap((b) => (b === "satellite" ? "satellite-live" : b));
    if (net.fromServer)
      findLocalImagery(server, net.page).then((img) => {
        if (!live) return;
        setImagery(img);
        // the offline option exists only with local imagery: live satellite for a network without it
        if (!img?.satellite) setBasemap((b) => (b === "satellite" ? "satellite-live" : b));
        if (img?.satellite) setToast(`HD imagery available: ${img.satellite.name} - choose "HD satellite" under Layers`, "info");
      });
    if (net.fromServer) {
      const u = new URL(location.href);
      u.searchParams.set("server", server); u.searchParams.set("file", net.name);
      history.replaceState(null, "", u);
    }
    return () => { live = false; };
  }, [net]); // eslint-disable-line react-hooks/exhaustive-deps

  // the network's own ground grid (converter <area>_ground.odrz next to the file): the terrain, fetched when Terrain is on
  const [ground, setGround] = useState<{ net: typeof net; grid: GroundGrid; file: string } | null>(null);
  const [groundLoading, setGroundLoading] = useState<string | null>(null);
  const groundTried = useRef<typeof net>(null); // the network a grid was looked for (once per network)
  useEffect(() => {
    if (!layers.terrain || mode !== "3d" || !net?.fromServer || groundTried.current === net) return; // terrain is 3D only
    const ac = new AbortController();
    groundTried.current = net;
    let done = false;
    (async () => {
      for (const file of groundGridFiles(net.page)) {
        try {
          const grid = await fetchGrid(`${server.replace(/\/$/, "")}/${encodeURIComponent(file)}`, (got, total) =>
            setGroundLoading(`Loading the ground grid ${file}: ${(got / 1e6).toFixed(0)}${total ? ` / ${(total / 1e6).toFixed(0)}` : ""} MB`), ac.signal);
          if (grid) { setGround({ net, grid, file }); break; }
        } catch (e) {
          if (ac.signal.aborted) return;
          setToast(`Ground grid ${file}: ${e instanceof Error ? e.message : e}`, "err");
        }
      }
      done = true;
      setGroundLoading(null);
    })();
    return () => {
      ac.abort();
      if (!done) { groundTried.current = null; setGroundLoading(null); } // interrupted: look again next time
    };
  }, [net, layers.terrain, mode, server, setToast]);
  const groundNow = ground && ground.net === net ? ground : null;
  // which converter build produced the open page (<page>.metrics.json from the gate, tied to the page by its sha256)
  const [prov, setProv] = useState<{ net: Network; p: Provenance } | null>(null);
  useEffect(() => {
    const src = net?.source;
    if (!net || !net.fromServer || !src) return; // a local file has no build record
    let live = true;
    fetchPageMetrics(server, net.page)
      .then((raw) => { if (live) setProv({ net, p: matchProvenance(raw, src) }); })
      .catch((e) => { if (live) setProv({ net, p: { status: "invalid", reason: e instanceof Error ? e.message : String(e) } }); });
    return () => { live = false; };
  }, [net, server]);
  const provNow: Provenance | null = !net ? null : !net.fromServer || !net.source ? { status: "local" } : prov && prov.net === net ? prov.p : null;
  // the file's vertical datum against its ground grid's (they must be the same reference, docs/ACCURACY.md)
  const datumNote = groundNow ? datumMismatch(net?.od?.header.userData.find((u) => u.code === "verticalDatum")?.value, groundNow.grid.datum) : null;

  // opening a network: findings belong to the previous one (findings dropped together with the file are loaded after)
  const openServer = useCallback((f: string) => { setFindings([]); openServerFile(server, f); }, [server, openServerFile]);
  const openLocal = useCallback((f: File) => { setFindings([]); openLocalFile(f); }, [openLocalFile]);

  const saveSeq = useRef(0);
  const saveFlags = useCallback(async (next: Flag[]) => {
    setFlags(next);
    const st = flagStore.current, n = ++saveSeq.current;
    if (!st) return;
    try {
      const saved = await st.save(next);
      if (n === saveSeq.current && st === flagStore.current) setFlags(saved); // an older answer must not undo a newer save
    } catch (e) { setToast(`Could not save flags: ${e instanceof Error ? e.message : e}`, "err"); }
  }, [setToast]);

  const toLonLat = useCallback((x: number, y: number) => net!.proj.forward(x, y), [net]);
  const visibleFlags = useMemo(() => flags.filter((f) => showDeleted || !f.deleted), [flags, showDeleted]);

  const flagMarkers = useMemo<MarkerPoint[]>(() => {
    if (!net) return [];
    return visibleFlags.map((f) => {
      const [lon, lat] = toLonLat(f.x, f.y);
      return {
        id: `flag-${f.id}`, lon, lat, label: String(f.id), selected: f.id === selectedFlag,
        color: f.deleted ? [120, 120, 120, 200] : STATUS_COLOR[f.status ?? "open"] ?? STATUS_COLOR.open,
      };
    });
  }, [visibleFlags, net, selectedFlag, toLonLat]);

  const findingMarkers = useMemo<MarkerPoint[]>(() => {
    if (!net) return [];
    return findings.filter((f) => !ruleOff.has(`${f.source} · ${f.rule}`) && Number.isFinite(f.x) && Number.isFinite(f.y)).map((f, i) => {
      const [lon, lat] = toLonLat(f.x, f.y);
      return { id: `finding-${i}`, lon, lat, color: LEVEL_COLOR[f.level] ?? LEVEL_COLOR.warning };
    });
  }, [findings, ruleOff, net, toLonLat]);

  const where = (f: Flag) =>
    f.road
      ? `Road ${f.road}${f.lane != null ? ` · lane ${f.lane}${f.laneType ? ` (${f.laneType})` : ""}` : ""}${f.s != null ? ` · s ${f.s.toFixed(1)} m` : ""}${f.junction && f.junction !== "-1" ? ` · junction ${f.junction}` : ""}`
      : `x ${f.x.toFixed(2)}, y ${f.y.toFixed(2)}`;

  const newFlagAt = useCallback((x: number, y: number, s: Selection | null) => {
    if (!net) return;
    const laneType = s?.probe?.lane?.type ?? (s && s.laneIndex !== null ? net.render.lanes.meta[s.laneIndex]?.type : null) ?? null;
    const f: Flag = {
      id: nextFlagId(flags), x, y, road: s ? net.roads[s.road].id : null, lane: s?.laneId ?? null, laneType,
      junction: s ? net.roads[s.road].junction : null, s: s?.probe ? Math.round(s.probe.s * 10) / 10 : null,
      category: "geometry", note: "", created: new Date().toISOString(), status: "open",
    };
    setDraft({ flag: f, isNew: true, where: where(f) });
  }, [flags, net]);

  const onPick = useCallback((info: PickingInfo, shift: boolean) => {
    if (!net || !info.coordinate) return;
    const layer = info.layer?.id ?? "";
    if (layer === "flags") {
      const f = visibleFlags[info.index];
      if (f) { setSelectedFlag(f.id); setDraft({ flag: f, isNew: false, where: where(f) }); }
      return;
    }
    const [x, y] = net.proj.inverse(info.coordinate[0], info.coordinate[1]);
    // road furniture, bridges / tunnels, cross paths: the feature inspector
    const F = net.render.features;
    const fm = layer === "boxes" ? F.boxes.meta[info.index] : layer === "footprints" ? F.footprints.meta[info.index]
      : layer.startsWith("col-") ? F.columns.find((c) => `col-${c.radius}` === layer)?.meta[info.index]
      : layer === "structures" ? F.structures.meta[info.index] : layer === "cross-paths" ? F.crossPaths.meta[info.index]
      : layer === "objects" ? net.render.objects.meta[info.index] : layer === "object-lines" ? net.render.objectLines.meta[info.index] : undefined;
    if (fm && !flagMode) { setSelF({ kind: fm.kind, road: fm.road, index: fm.index }); setSel(null); setSelJ(null); return; }
    let s: Selection | null = null;
    if (layer === "lanes" && info.index >= 0) {
      // a lane; Shift+click selects its whole road
      const m = net.render.lanes.meta[info.index];
      const road = net.od?.roads[m.road];
      s = { road: m.road, laneId: m.lane, laneIndex: info.index, x, y, probe: road ? probe(road, m.lane, x, y) : null, whole: shift };
    } else if (layer === "refs" && info.index >= 0) {
      // a reference line: its road
      const ri = net.render.refs.meta[info.index], road = net.od?.roads[ri];
      const li = net.render.lanes.meta.findIndex((q) => q.road === ri);
      s = { road: ri, laneId: li >= 0 ? net.render.lanes.meta[li].lane : null, laneIndex: li >= 0 ? li : null, x, y,
        probe: road && li >= 0 ? probe(road, net.render.lanes.meta[li].lane, x, y) : null, whole: true };
    }
    if (flagMode) { newFlagAt(x, y, s); return; }
    setSel(s);
    setSelF(null);
    // a junction area, or its reference line / elevation grid
    const G = net.render.grids;
    const ji = layer === "junctions" ? info.index : layer === "junctions-virtual" ? virtualJunctions(net.render.junctions).index[info.index] ?? -1
      : layer === "junction-ref-lines" ? G.refLines.meta[info.index]
      : layer === "junction-grid" ? G.lines.meta[info.index] : layer === "junction-grid-points" ? G.points.meta[info.index] : -1;
    setSelJ(!s && ji !== undefined && ji >= 0 ? { index: ji, x, y } : null);
  }, [net, visibleFlags, flagMode, newFlagAt]);

  const goRoad = useCallback((q: string) => {
    if (!net) return;
    const k = q.trim().toLowerCase();
    if (!k) return;
    // "j 103" / "junction 103": a junction area
    const jm = k.match(/^j(?:unction)?\s*(\S+)$/);
    if (jm) {
      const ji = net.render.junctions.meta.findIndex((j) => j.id.toLowerCase() === jm[1]);
      if (ji < 0) { setToast(`No junction area "${jm[1]}"`); return; }
      const J = net.render.junctions, a = J.starts[ji], b = J.starts[ji + 1];
      let lon = 0, lat = 0;
      for (let v = a; v < b; v++) { lon += J.positions[3 * v]; lat += J.positions[3 * v + 1]; }
      lon /= b - a;
      lat /= b - a;
      setFlyTo({ lon, lat, zoom: 19, key: Date.now() });
      const [x, y] = net.proj.inverse(lon, lat);
      setSel(null); setSelF(null);
      setSelJ({ index: ji, x, y });
      return;
    }
    const exact = net.roads.findIndex((r) => r.id.toLowerCase() === k);
    const idx = exact >= 0 ? exact : net.roads.findIndex((r) => r.name.toLowerCase().includes(k));
    if (idx < 0) { setToast(`No road "${q}"`); return; }
    const R = net.render.refs, at = R.meta.indexOf(idx);
    if (at < 0) return;
    const mid = Math.floor((R.starts[at] + R.starts[at + 1]) / 2);
    const lon = R.positions[3 * mid], lat = R.positions[3 * mid + 1];
    setFlyTo({ lon, lat, zoom: 18.5, key: Date.now() });
    const li = net.render.lanes.meta.findIndex((m) => m.road === idx);
    const laneId = li >= 0 ? net.render.lanes.meta[li].lane : null;
    const [x, y] = net.proj.inverse(lon, lat);
    const road = net.od?.roads[idx];
    setSelF(null); setSelJ(null);
    setSel({ road: idx, laneId, laneIndex: li >= 0 ? li : null, x, y, probe: road ? probe(road, laneId, x, y) : null, whole: true }); // a searched road: all of it
  }, [net, setToast]);

  // keyboard: F flag mode, V 2D / 3D, Esc leaves flag mode or closes the inspector, / search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, dialog")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "f" || e.key === "F" || e.key === "m" || e.key === "M") { if (net) setFlagMode((v) => !v); }
      else if (e.key === "v" || e.key === "V") setMode((m) => (m === "2d" ? "3d" : "2d"));
      else if (e.key === "Escape") { if (flagMode) setFlagMode(false); else { setSel(null); setSelJ(null); setSelF(null); } }
      else if (e.key === "/") { e.preventDefault(); document.getElementById("search")?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flagMode, net]);

  const loadFindings = useCallback(async (fs: File[]) => {
    const all: Finding[] = [];
    for (const f of fs) {
      try { all.push(...parseFindings(f.name, await f.text())); } catch (e) { setToast(`${f.name}: ${e instanceof Error ? e.message : e}`, "err"); }
    }
    setFindings((old) => [...old, ...all]);
    setTab("findings"); setPanelOpen(true);
    setToast(`${all.length.toLocaleString()} findings loaded`, "ok");
  }, [setToast]);

  // drop files anywhere: a network (.xodr / OdrForge page) and / or checker results
  useEffect(() => {
    let depth = 0; // dragenter / dragleave fire for every child element
    const files = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const enter = (e: DragEvent) => { if (files(e)) { depth++; setDragging(true); } };
    const leave = (e: DragEvent) => { if (files(e) && --depth <= 0) { depth = 0; setDragging(false); } };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0; setDragging(false);
      const fs = [...(e.dataTransfer?.files ?? [])];
      const network = fs.find((f) => /\.(xodr|html)$/i.test(f.name));
      const rest = fs.filter((f) => f !== network);
      if (network) openLocal(network);
      if (rest.length) loadFindings(rest);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter); window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over); window.removeEventListener("drop", drop);
    };
  }, [openLocal, loadFindings]);

  const cursorXY = cursor && net ? net.proj.inverse(cursor[0], cursor[1]) : null;

  return (
    <div className={`app ${panelOpen ? "" : "panel-closed"}`}>
      <header className="topbar">
        <button className="icon-btn" aria-label={panelOpen ? "Hide panel" : "Show panel"} title="Panel" onClick={() => setPanelOpen((v) => !v)}><Icon name="menu" /></button>
        <div className="brand"><Logo /><span><b>OdrForge</b> <span className="muted">Viewer</span></span></div>
        <div className="source">
          <span className="server-field">
            <span className={`dot ${serverState}`} title={serverState === "ok" ? "Review server connected" : "Review server not reachable"} />
            <input className="server" value={server} onChange={(e) => setServer(e.target.value)} onBlur={() => connect(server)}
              onKeyDown={(e) => e.key === "Enter" && connect(server)} spellCheck={false} aria-label="Review server URL" />
          </span>
          <select value={net?.fromServer ? net.name : ""} onChange={(e) => e.target.value && openServer(e.target.value)} aria-label="File on the server">
            <option value="">{files.length ? "Choose a file…" : "No files on server"}</option>
            {files.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button className="btn" onClick={() => fileInput.current?.click()}>Open file…</button>
          <input ref={fileInput} type="file" hidden accept=".xodr,.html,.json" onChange={(e) => { if (e.target.files?.[0]) openLocal(e.target.files[0]); e.target.value = ""; }} />
        </div>
        <div className="search-box">
          <Icon name="search" />
          <input id="search" className="search" placeholder="Road id, name or j 103" aria-label="Search a road or junction" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && goRoad(search)} disabled={!net} />
          <kbd>/</kbd>
        </div>
        <span className="grow" />
        <div className="seg" role="group" aria-label="Basemap">
          <button className={basemap === "map" ? "on" : ""} onClick={() => setBasemap("map")} title="The theme's map: OpenStreetMap (light), dark vector map (dark)">Map</button>
          <button className={basemap.startsWith("satellite") ? "on" : ""} title="Live satellite (Esri World Imagery); offline HD imagery under Layers"
            onClick={() => setBasemap("satellite-live")}>Satellite</button>
        </div>
        <div className="seg" role="group" aria-label="View">
          <button className={mode === "2d" ? "on" : ""} onClick={() => setMode("2d")}>2D</button>
          <button className={mode === "3d" ? "on" : ""} onClick={() => setMode("3d")}>3D</button>
        </div>
        <button className={`btn ${flagMode ? "warn" : ""}`} onClick={() => setFlagMode((v) => !v)} disabled={!net} title="Flag mode (F)">
          <Icon name="flag" />{flagMode ? "Click the map…" : "Flag"}
        </button>
        <button className="icon-btn" aria-label="Fit network" title="Fit network" onClick={() => setFitKey((k) => k + 1)} disabled={!net}><Icon name="fit" /></button>
        <button className="icon-btn" aria-label="Toggle theme" title="Theme" onClick={() => {
          const t = theme === "dark" ? "light" : "dark";
          setTheme(t);
        }}><Icon name="theme" /></button>
      </header>

      {panelOpen && (
        <SidePanel
          tab={tab} setTab={setTab} net={net} provenance={provNow} imagery={imagery} theme={theme} layers={layers} setLayers={setLayers}
          basemap={basemap} setBasemap={setBasemap} heightMode={heightMode} setHeightMode={setHeightMode}
          exaggeration={exaggeration} setExaggeration={setExaggeration}
          buildingOpacity={buildingOpacity} setBuildingOpacity={setBuildingOpacity}
          roadOpacity={roadOpacity} setRoadOpacity={setRoadOpacity} dim={dim} setDim={setDim}
          terrainSource={groundNow ? `${groundNow.file} (${groundNow.grid.datum || "datum not given"}, ${groundNow.grid.cell} m cells), Terrarium around it` : null}
          flags={flags} flagStoreKind={flagStoreKind} selectedFlag={selectedFlag}
          onFlag={(f) => { setSelectedFlag(f.id); const [lon, lat] = toLonLat(f.x, f.y); setFlyTo({ lon, lat, zoom: 19.5, key: Date.now() }); }}
          onEditFlag={(f) => setDraft({ flag: f, isNew: false, where: where(f) })}
          showDeleted={showDeleted} setShowDeleted={setShowDeleted}
          onExportFlags={() => {
            const blob = new Blob([JSON.stringify({ page: net?.page, flags }, null, 1)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob); a.download = `${net?.page ?? "flags"}.flags.json`; a.click();
          }}
          findings={findings} ruleOff={ruleOff}
          toggleRule={(r) => setRuleOff((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; })}
          onFinding={(f) => {
            const [lon, lat] = Number.isFinite(f.x) && Number.isFinite(f.y) ? toLonLat(f.x, f.y) : [NaN, NaN];
            if (Number.isFinite(lon) && Number.isFinite(lat)) setFlyTo({ lon, lat, zoom: 19.5, key: Date.now() });
            else setToast("This finding has no position");
          }}
          onLoadFindings={(fl) => loadFindings([...fl])}
          compare={{
            net: cmp.network, loading: cmp.loading, error: cmp.error, result: cmpResult, files,
            openServer: (f) => cmp.openServerFile(server, f), openLocal: cmp.openLocalFile, clear: cmp.clear,
            overlay: cmpOverlay, setOverlay: setCmpOverlay,
            onItem: (d) => { if (Number.isFinite(d.lon)) setFlyTo({ lon: d.lon, lat: d.lat, zoom: 19, key: Date.now() }); },
          }}
        />
      )}

      <main className="stage">
        <MapView
          render={net?.render ?? null} proj={net?.proj ?? null} imagery={imagery} theme={theme} basemap={basemap} mode={mode} layers={layers} heightMode={heightMode}
          exaggeration={exaggeration} buildingOpacity={buildingOpacity} roadOpacity={roadOpacity} dim={dim} compare={cmpOverlay ? cmp.network?.render ?? null : null} ground={groundNow?.grid ?? null} selectedLane={sel && !sel.whole ? sel.laneIndex : null} selectedRoad={sel?.whole ? sel.road : null} selectedJunction={selJ?.index ?? null} selectedFeature={selF} flags={flagMarkers} findings={findingMarkers}
          flyTo={flyTo} fitKey={fitKey} onPick={onPick} onCursor={setCursor} cursorCrosshair={flagMode}
        />
        {!net && !loading && (
          <div className="empty">
            <Logo />
            <h1>Review an OpenDRIVE network</h1>
            <p>Choose a file from the review server above, click <b>Open file…</b>, or drop a <code>.xodr</code> (or an OdrForge viewer page) anywhere.</p>
            {serverState === "error" && (
              <>
                <p className="muted small">Review server not reachable at {server}. Start it with <code>python tools/inspect/viz_server.py --dir …</code></p>
                <button className="btn" onClick={() => connect(server)}>Retry</button>
              </>
            )}
          </div>
        )}
        <div className="overlays">
          {loading && <div className="loading"><span className="spinner" />{loading}</div>}
          {groundLoading && <div className="loading"><span className="spinner" />{groundLoading}</div>}
          {error && <div className="banner error" role="alert"><Icon name="alert" />{error}<button className="link" onClick={clearError}>Dismiss</button></div>}
          {datumNote && layers.terrain && mode === "3d" && <div className="banner info" role="status"><Icon name="alert" />{datumNote}</div>}
          {flagMode && <div className="banner info"><Icon name="flag" />Click where something is wrong. <kbd>Esc</kbd> to stop</div>}
        </div>
        {toast && <div className={`toast ${toast.tone}`} role="status"><Icon name={TOAST_ICON[toast.tone]} />{toast.text}</div>}
        {dragging && (
          <div className="dropzone"><div><Icon name="upload" size={32} /><span>Drop a .xodr, an OdrForge page, or checker results</span></div></div>
        )}
        {net && selF && (
          <FeatureInspector net={net} sel={selF} onClose={() => setSelF(null)} onGoRoad={goRoad} />
        )}
        {net && selJ && !sel && !selF && (
          <JunctionInspector net={net} index={selJ.index} onClose={() => setSelJ(null)} onGoRoad={goRoad}
            onFlag={() => {
              const m = net.render.junctions.meta[selJ.index];
              const f: Flag = {
                id: nextFlagId(flags), x: selJ.x, y: selJ.y, road: null, lane: null, laneType: null, junction: m.id, s: null,
                category: "junction", note: "", created: new Date().toISOString(), status: "open",
              };
              setDraft({ flag: f, isNew: true, where: `Junction ${m.id}` });
            }} />
        )}
        {net && sel && (
          <Inspector net={net} sel={sel} onClose={() => setSel(null)} onGoRoad={goRoad} onFlag={() => newFlagAt(sel.x, sel.y, sel)}
            onWhole={(whole) => setSel({ ...sel, whole })} />
        )}
      </main>

      <footer className="statusbar">
        {net ? (
          <>
            <span><b>{net.name}</b> · {net.kind === "xodr" ? `OpenDRIVE ${net.od!.header.revMajor}.${net.od!.header.revMinor}` : "OdrForge export"}</span>
            <span>{net.render.stats.vertices.toLocaleString()} vertices · built in {(net.ms / 1000).toFixed(1)} s</span>
            {!net.proj.georeferenced && <span className="warn-text">no geoReference: placed at 0°, 0°</span>}
            {provNow && <BuildStatus p={provNow} />}
          </>
        ) : <span className="muted">No network loaded</span>}
        <span className="grow" />
        {cursor && <span className="mono">{cursor[1].toFixed(6)}, {cursor[0].toFixed(6)}</span>}
        {cursorXY && <span className="mono">x {cursorXY[0].toFixed(2)} · y {cursorXY[1].toFixed(2)}</span>}
      </footer>

      <FlagDialog
        draft={draft}
        onClose={() => setDraft(null)}
        onSave={(f) => {
          const exists = flags.some((q) => q.id === f.id);
          saveFlags(exists ? flags.map((q) => (q.id === f.id ? f : q)) : [...flags, f]);
          setSelectedFlag(f.id); setDraft(null); setFlagMode(false); setTab("flags");
        }}
        onDelete={(f) => { saveFlags(flags.map((q) => (q.id === f.id ? { ...q, deleted: true } : q))); setDraft(null); }}
      />
    </div>
  );
}

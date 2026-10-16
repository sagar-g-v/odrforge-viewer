// The map: MapLibre GL (OpenFreeMap vector tiles, OSM 3D buildings, terrain) with the OpenDRIVE layers drawn by
// deck.gl interleaved into the same WebGL context, so buildings and roads share one depth buffer.
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ColumnLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import type { Layer, PickingInfo } from "@deck.gl/core";
import * as maplibregl from "maplibre-gl";
import type { Map as MlMap, MapMouseEvent, StyleSpecification } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { Matrix4 } from "@math.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RenderData } from "../xodr/build";
import { laneColor, type Rgba } from "./palette";
import { visibleTiles, type ImageTile, type LocalImagery } from "./localImagery";
import { DEM_MAXZOOM, Dem, TERRARIUM_TILES } from "./dem";
import { groundHeight, type GroundGrid } from "./odrz";
import { GROUND_PROTOCOL, groundMaxZoom, registerGroundProtocol, setGroundGrid } from "./groundTiles";
import { drapeRender, terrainLift, type GroundProbe } from "./drape";
import type { Projector } from "../xodr/geo";

// satellite: the offline HD orthophoto over live imagery; satellite-live: live (online) imagery only
export type Basemap = "osm" | "liberty" | "positron" | "dark" | "satellite" | "satellite-live" | "none";
export type HeightMode = "flat" | "relative" | "absolute";

export interface MapLayers {
  lanes: boolean; junctions: boolean; marks: boolean; borders: boolean; refs: boolean; signals: boolean; objects: boolean;
  structures: boolean; crossPaths: boolean; grids: boolean; // grids: junction reference lines + elevation grids
  buildings: boolean; terrain: boolean; flags: boolean; findings: boolean;
}

export interface MarkerPoint { id: string; lon: number; lat: number; color: Rgba; label?: string; selected?: boolean; }

export interface MapViewProps {
  render: RenderData | null;
  proj: Projector | null; // file coordinates <-> lon / lat (local imagery tiles)
  imagery: LocalImagery | null; // the network's offline HD orthophoto, if the review server has one
  theme: "dark" | "light";
  basemap: Basemap;
  mode: "2d" | "3d";
  layers: MapLayers;
  heightMode: HeightMode;
  exaggeration: number;
  buildingOpacity: number; // 0..1: see-through buildings keep the roads behind them reviewable
  roadOpacity: number; // 0..1: lane surfaces, junction areas and objects (marks and outlines stay opaque)
  dim: number; // 0..0.9: darkens the base map (not the OpenDRIVE layers)
  ground: GroundGrid | null; // the network's own ground grid (converter .odrz): the terrain where present
  compare: RenderData | null; // B of a comparison: its lane outlines and reference lines over A
  selectedLane: number | null;
  selectedJunction: number | null;
  selectedFeature: { kind: string; road: number; index: number } | null;
  flags: MarkerPoint[];
  findings: MarkerPoint[];
  flyTo: { lon: number; lat: number; zoom?: number; key: number } | null;
  fitKey: number;
  onPick: (info: PickingInfo) => void;
  onCursor: (lonLat: [number, number] | null) => void;
  cursorCrosshair: boolean;
}

const STYLE_URL: Record<Exclude<Basemap, "osm" | "none" | "satellite" | "satellite-live">, string> = {
  liberty: "https://tiles.openfreemap.org/styles/liberty",
  positron: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
// satellite: Esri World Imagery under everything (online, any area), with the OpenFreeMap vector source kept so the
// 3D buildings still extrude; the network's offline HD orthophoto (if any) is drawn over it as image sources
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: "raster", tileSize: 256, maxzoom: 19,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
    openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
  },
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0d10" } }, { id: "esri", type: "raster", source: "esri" }],
};
// the standard OpenStreetMap map (openstreetmap.org raster tiles, tile usage policy: attribution, light use), with the
// OpenFreeMap vector source kept for the 3D buildings
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster", tileSize: 256, maxzoom: 19, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    },
    openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
  },
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#f2efe9" } }, { id: "osm", type: "raster", source: "osm" }],
};
const EMPTY_STYLE = (bg: string): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": bg } }] });
const TERRAIN_SOURCE = "odrv-terrain";
const BUILDINGS = "odrv-buildings-3d";
const FOOTPRINT = "odrv-buildings-footprint", FOOTPRINT_EDGE = "odrv-buildings-edge"; // bottom face and border
const BOUNDS_MARGIN = 200; // m beyond the network the camera may move

/** OSM buildings extruded from the OpenMapTiles `building` layer (render_height / render_min_height) */
function ensureBuildings(map: MlMap, on: boolean, opacity: number): string | undefined {
  const own = map.getLayer("building-3d") ? "building-3d" : null;
  if (!own && !map.getLayer(BUILDINGS) && map.getSource("openmaptiles")) {
    map.addLayer({
      id: BUILDINGS, type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
      paint: {
        "fill-extrusion-color": "#a9adb5",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.75,
      },
    });
  }
  const extrusion = own ?? (map.getLayer(BUILDINGS) ? BUILDINGS : undefined);
  // the bottom face and border of every building on the ground, under the extrusion (and the roads, which deck.gl
  // inserts right before the extrusion): where a building stands stays readable through a translucent block
  if (extrusion && map.getSource("openmaptiles") && !map.getLayer(FOOTPRINT)) {
    const src = { source: "openmaptiles", "source-layer": "building", minzoom: 13 } as const;
    map.addLayer({ id: FOOTPRINT, type: "fill", ...src, paint: { "fill-color": "#ffb347", "fill-opacity": 0.28 } }, extrusion);
    map.addLayer({
      id: FOOTPRINT_EDGE, type: "line", ...src,
      paint: { "line-color": "#ff9f1c", "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.8, 19, 2.2], "line-opacity": 0.95 },
    }, extrusion);
  }
  for (const id of [own, BUILDINGS])
    if (id && map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      map.setPaintProperty(id, "fill-extrusion-opacity", opacity);
    }
  for (const id of [FOOTPRINT, FOOTPRINT_EDGE]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  return extrusion;
}

const DIM = "odrv-dim";
/**
 * Background dim: a black world-covering fill over the base map, kept just under the first deck.gl (custom) layer and
 * our building layers, so the OpenDRIVE layers stay at full strength.
 */
function ensureDim(map: MlMap, dim: number) {
  if (!map.getSource(DIM))
    map.addSource(DIM, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon",
      coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } } });
  const order = map.getStyle()?.layers ?? [];
  const firstOwn = order.find((l) => (l.type as string) === "custom" || l.id === FOOTPRINT || l.id === BUILDINGS || l.id === "building-3d");
  if (!map.getLayer(DIM)) map.addLayer({ id: DIM, type: "fill", source: DIM, paint: { "fill-color": "#000000", "fill-opacity": dim } }, firstOwn?.id);
  else {
    if (firstOwn && order.findIndex((l) => l.id === DIM) > order.findIndex((l) => l.id === firstOwn.id)) map.moveLayer(DIM, firstOwn.id);
    map.setPaintProperty(DIM, "fill-opacity", dim);
  }
}

/** the terrain source: the network's ground grid (rendered by groundTiles.ts, Terrarium around it) or Terrarium alone */
interface TerrainSrc { id: string; tiles: string; maxzoom: number; attribution: string; }
const TERRARIUM_SRC: TerrainSrc = { id: TERRAIN_SOURCE, tiles: TERRARIUM_TILES, maxzoom: DEM_MAXZOOM, attribution: "Terrain: Mapzen / AWS Open Data (Terrarium)" };

function ensureTerrain(map: MlMap, on: boolean, exaggeration: number, src: TerrainSrc) {
  if (on && !map.getSource(src.id))
    map.addSource(src.id, {
      type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: src.maxzoom, tiles: [src.tiles], attribution: src.attribution,
    });
  map.setTerrain(on ? { source: src.id, exaggeration } : null);
  // sources of an earlier grid (or Terrarium when a grid took over) go once the terrain no longer uses them
  for (const id of Object.keys(map.getStyle()?.sources ?? {}))
    if ((id === TERRAIN_SOURCE || id.startsWith(GROUND_SOURCE)) && id !== src.id && map.getSource(id)) map.removeSource(id);
}
const GROUND_SOURCE = "odrv-ground-";
let groundSeq = 0;
registerGroundProtocol();

const sub = (a: Uint32Array, n: number) => a.subarray(0, n);

const IMG = "odrv-img-";
/**
 * The offline HD orthophoto tiles in view as MapLibre image sources (corners TL, TR, BR, BL), under the dim layer: MapLibre
 * drapes them on the terrain like any raster, and the background dim darkens them with the rest of the base map.
 */
function syncImageTiles(map: MlMap, tiles: ImageTile[]) {
  const want = new Set(tiles.map((t) => IMG + t.id));
  for (const l of map.getStyle()?.layers ?? [])
    if (l.id.startsWith(IMG) && !want.has(l.id)) { map.removeLayer(l.id); map.removeSource(l.id); }
  for (const t of tiles) {
    const id = IMG + t.id;
    if (map.getSource(id)) continue;
    const [bl, tl, tr, br] = t.bounds;
    map.addSource(id, { type: "image", url: t.url, coordinates: [tl, tr, br, bl] });
    map.addLayer({ id, type: "raster", source: id, paint: { "raster-fade-duration": 0, "raster-resampling": "linear" } },
      map.getLayer(DIM) ? DIM : undefined);
  }
}

// MapLibre 6 ships its tile worker as a separate ES module: the bundler serves it, MapLibre is told where
maplibregl.setWorkerUrl(maplibreWorkerUrl);

/**
 * deck.gl 9.4's interleaved MapboxOverlay reads map.transform.{height, elevation, _nearZ, _farZ}, internals MapLibre 6
 * no longer exposes (MapLibre 5 did, but carries GHSA-jrc7-96c5-q579). Supplied from public API: the canvas CSS height
 * and getCameraTargetElevation(); near / far planes come from MapLibre's custom-layer render parameters instead.
 * Remove when @deck.gl/mapbox supports MapLibre 6.
 */
function deckTransformCompat(map: MlMap) {
  if ((map as unknown as { transform?: unknown }).transform) return;
  Object.defineProperty(map, "transform", {
    configurable: true,
    get: () => ({ height: map.getCanvas().clientHeight, elevation: map.getCameraTargetElevation(), _nearZ: undefined, _farZ: undefined }),
  });
}

export default function MapView(p: MapViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const overlay = useRef<MapboxOverlay | null>(null);
  const propsRef = useRef(p);
  // the OpenDRIVE layers draw before the buildings: translucent buildings then blend over the roads behind them
  const [beforeId, setBeforeId] = useState<string | undefined>(undefined);
  // the view (file-coordinate box, metres per screen pixel) the imagery tiles are chosen for; updated when the camera rests
  const [view, setView] = useState<{ box: [number, number, number, number]; mpp: number } | null>(null);
  // terrain: the DEM under the network (the same tiles MapLibre's terrain draws) and the lift that keeps the draped
  // roads above the surface as drawn (re-measured whenever the map comes to rest)
  const [dem, setDem] = useState<{ render: RenderData; dem: Dem } | null>(null);
  const [lift, setLift] = useState(0.2);
  const probeRef = useRef<GroundProbe | null>(null);
  const imgRef = useRef<ImageTile[]>([]);
  const layersRef = useRef<Layer[]>([]); // the overlay's current layers (style swaps re-set them without beforeId)
  // the style can take layers and sources: from its style.load until the next setStyle (map.isStyleLoaded() also waits
  // for every tile, so changes made while tiles stream in would be dropped)
  const styleReady = useRef(false);
  // terrain source for the current grid: a new grid gets a new source (MapLibre caches tiles per url)
  const terrainSrc = useMemo<TerrainSrc>(() => {
    if (!p.ground || !p.proj) return TERRARIUM_SRC;
    const n = ++groundSeq, c = p.proj.forward(p.ground.originX + (p.ground.nx * p.ground.cell) / 2, p.ground.originY + (p.ground.ny * p.ground.cell) / 2);
    return {
      id: GROUND_SOURCE + n, tiles: `${GROUND_PROTOCOL}://{z}/{x}/{y}?g=${n}`, maxzoom: groundMaxZoom(p.ground, c[1]),
      attribution: `Terrain: network ground grid (${p.ground.datum || "datum not given"}, ${p.ground.cell} m), Mapzen Terrarium around it`,
    };
  }, [p.ground, p.proj]);
  const terrainSrcRef = useRef(terrainSrc);
  // layout effect: the tile protocol knows the grid before the (passive) effect that adds the source runs
  useLayoutEffect(() => { setGroundGrid(p.ground, p.proj); terrainSrcRef.current = terrainSrc; }, [terrainSrc, p.ground, p.proj]);
  const [styleEpoch, setStyleEpoch] = useState(0); // bumped on every style.load: the overlay's layers are set again
  useLayoutEffect(() => { propsRef.current = p; }); // map event handlers read the latest props

  // map + overlay, once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: host.current!, style: STYLE_URL.dark, center: [0, 20], zoom: 1.5, maxPitch: 85,
      attributionControl: { compact: true }, canvasContextAttributes: { antialias: true },
    });
    deckTransformCompat(map);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    const ov = new MapboxOverlay({ interleaved: true, layers: [], onClick: (info) => propsRef.current.onPick(info) });
    map.addControl(ov);
    map.on("mousemove", (e: MapMouseEvent) => propsRef.current.onCursor([e.lngLat.lng, e.lngLat.lat]));
    map.on("mouseout", () => propsRef.current.onCursor(null));
    const updateView = () => {
      const pr = propsRef.current.proj;
      if (!pr) return;
      const b = map.getBounds(), c = map.getCenter();
      const pts = [b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()].map((q) => pr.inverse(q.lng, q.lat));
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      // MapLibre's 512 px tiles: metres per pixel = circumference * cos(lat) / (512 * 2^zoom)
      const mpp = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
      setView({ box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], mpp });
    };
    map.on("moveend", updateView);
    map.on("load", updateView);
    map.on("style.load", () => {
      styleReady.current = true;
      if (import.meta.env.DEV && mapRef.current === map) (window as unknown as { odrvMap?: MlMap }).odrvMap = map;
      setBeforeId(ensureBuildings(map, propsRef.current.layers.buildings && propsRef.current.mode === "3d", propsRef.current.buildingOpacity));
      ensureTerrain(map, propsRef.current.layers.terrain, propsRef.current.exaggeration, terrainSrcRef.current);
      ensureDim(map, propsRef.current.dim);
      syncImageTiles(map, imgRef.current);
      setStyleEpoch((e) => e + 1);
    });
    map.on("idle", () => {
      const probe = probeRef.current, pr = propsRef.current;
      if (!probe || !pr.layers.terrain) return;
      const mpp = (40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
      const next = terrainLift(probe, (lon, lat) => map.queryTerrainElevation([lon, lat]), pr.exaggeration, Math.max(0.2, 0.5 * mpp));
      setLift((cur) => (Math.abs(cur - next) > Math.max(0.05, 0.02 * cur) ? next : cur));
    });
    mapRef.current = map;
    overlay.current = ov;
    if (import.meta.env.DEV) (window as unknown as { odrvMap?: MlMap }).odrvMap = map; // debugging aid in dev builds
    return () => { map.remove(); mapRef.current = null; overlay.current = null; };
  }, []);

  // basemap style
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const bg = p.theme === "dark" ? "#14171c" : "#eef0f3";
    styleReady.current = false;
    // until the new style has loaded our layers, the OpenDRIVE layers go without beforeId (same layers, so deck.gl
    // keeps them): it inserts its layer groups on every styledata event and fails while the building layer they are
    // placed before does not exist yet
    overlay.current?.setProps({ layers: layersRef.current.map((l) => l.clone({ beforeId: undefined } as never)) });
    map.setStyle(p.basemap === "none" ? EMPTY_STYLE(bg) : p.basemap === "osm" ? OSM_STYLE
      : p.basemap.startsWith("satellite") ? SATELLITE_STYLE : STYLE_URL[p.basemap as keyof typeof STYLE_URL],
    { diff: false }); // a full reload, so style.load always fires and our sources and layers are added again
  }, [p.basemap, p.theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleReady.current) setBeforeId(ensureBuildings(map, p.layers.buildings && p.mode === "3d", p.buildingOpacity));
  }, [p.layers.buildings, p.buildingOpacity, p.mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleReady.current) ensureDim(map, p.dim);
  }, [p.dim]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleReady.current) ensureTerrain(map, p.layers.terrain, p.exaggeration, terrainSrc);
  }, [p.layers.terrain, p.exaggeration, terrainSrc]);

  // camera: 2D looks straight down, 3D tilts
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: p.mode === "3d" ? 60 : 0, bearing: p.mode === "3d" ? map.getBearing() : 0, duration: 600 });
    if (p.mode === "2d") { map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); }
    else { map.dragRotate.enable(); map.touchZoomRotate.enableRotation(); }
  }, [p.mode]);

  // the camera stays over the network: its extent plus BOUNDS_MARGIN on every side (no map tiles or imagery are
  // fetched for areas far from the roads under review)
  useEffect(() => {
    const map = mapRef.current, r = p.render;
    if (!map) return;
    if (!r || !Number.isFinite(r.bounds[0])) { map.setMaxBounds(null); return; }
    const [w, s, e, n] = r.bounds, lat = (s + n) / 2;
    const dLat = BOUNDS_MARGIN / 111320, dLon = BOUNDS_MARGIN / (111320 * Math.cos((lat * Math.PI) / 180));
    map.setMaxBounds([[w - dLon, s - dLat], [e + dLon, n + dLat]]);
  }, [p.render]);

  useEffect(() => {
    const map = mapRef.current, r = p.render;
    if (!map || !r || !Number.isFinite(r.bounds[0])) return;
    map.fitBounds([[r.bounds[0], r.bounds[1]], [r.bounds[2], r.bounds[3]]], { padding: 48, duration: 0, pitch: p.mode === "3d" ? 60 : 0 });
  }, [p.fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (map && p.flyTo) map.flyTo({ center: [p.flyTo.lon, p.flyTo.lat], zoom: Math.max(map.getZoom(), p.flyTo.zoom ?? 19), duration: 700 });
  }, [p.flyTo?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = mapRef.current?.getCanvas();
    if (c) c.style.cursor = p.cursorCrosshair ? "crosshair" : "";
  }, [p.cursorCrosshair]);

  // terrain on: load the DEM under the network (its extent plus the camera margin), once per network
  useEffect(() => {
    const r = p.render;
    if (!p.layers.terrain || !r || !Number.isFinite(r.bounds[0]) || dem?.render === r) return;
    const ac = new AbortController();
    const [w, s, e, n] = r.bounds, lat = (s + n) / 2, m = BOUNDS_MARGIN + 50;
    const dLat = m / 111320, dLon = m / (111320 * Math.cos((lat * Math.PI) / 180));
    Dem.load([w - dLon, s - dLat, e + dLon, n + dLat], ac.signal)
      .then((d) => setDem({ render: r, dem: d }))
      .catch((err) => { if (!ac.signal.aborted) console.warn("terrain DEM not loaded", err); });
    return () => ac.abort();
  }, [p.render, p.layers.terrain, dem]);
  const demNow = dem && dem.render === p.render ? dem.dem : null;
  // the ground under the roads, as the terrain draws it: the network's grid (blended into Terrarium at its edge) or Terrarium
  const groundAt = useMemo(() => {
    if (!demNow) return null;
    const g = p.ground, pr = p.proj;
    if (!g || !pr) return (lon: number, lat: number) => demNow.sample(lon, lat);
    return (lon: number, lat: number) => { const [x, y] = pr.inverse(lon, lat); return groundHeight(g, x, y, () => demNow.sample(lon, lat)); };
  }, [demNow, p.ground, p.proj]);

  // a file whose heights are relative to its surroundings (not above sea level) is laid on the terrain in flat and
  // relative mode (drape.ts); absolute mode keeps the file's heights
  const draped = useMemo(() => (p.layers.terrain && p.render && groundAt && p.heightMode !== "absolute"
    ? drapeRender(p.render, groundAt, p.heightMode) : null),
  [p.render, p.layers.terrain, groundAt, p.heightMode]);
  const cmpDraped = useMemo(() => (p.compare && p.layers.terrain && groundAt && p.heightMode !== "absolute"
    ? drapeRender(p.compare, groundAt, p.heightMode).render : p.compare),
  [p.compare, p.layers.terrain, groundAt, p.heightMode]);
  // absolute mode over terrain: the file's road surfaces lie on the very ground the terrain draws (the network's grid),
  // so they would fight it for the same depth and show in patches; they get the same small lift as draped roads, measured
  // on the lane points at grade (|z - ground| < 1.5 m: bridges and tunnels do not count)
  const absoluteProbe = useMemo<GroundProbe | null>(() => {
    const r = p.render;
    if (!p.layers.terrain || !r || !groundAt || p.heightMode !== "absolute") return null;
    const L = r.lanes.positions, nv = L.length / 3, step = Math.max(1, Math.floor(nv / 4000));
    const lon: number[] = [], lat: number[] = [], z: number[] = [];
    for (let v = 0; v < nv; v += step) {
      const g = groundAt(L[3 * v], L[3 * v + 1]);
      if (Number.isFinite(g) && Math.abs(L[3 * v + 2] - g) < 1.5) { lon.push(L[3 * v]); lat.push(L[3 * v + 1]); z.push(L[3 * v + 2]); }
    }
    return lon.length ? { lon: Float64Array.from(lon), lat: Float64Array.from(lat), ground: Float64Array.from(z) } : null;
  }, [p.render, p.layers.terrain, groundAt, p.heightMode]);
  useEffect(() => {
    probeRef.current = draped?.probe ?? absoluteProbe;
    mapRef.current?.triggerRepaint(); // the idle handler measures the lift for the new surface
  }, [draped, absoluteProbe]);
  // absolute mode over terrain with a file whose heights are far from the ground: say so (the roads are buried or float)
  const absoluteOff = useMemo(() => {
    const r = p.render;
    if (!p.layers.terrain || !r || !groundAt || p.heightMode !== "absolute") return null;
    const L = r.lanes.positions, nv = L.length / 3, step = Math.max(1, Math.floor(nv / 1000)), g: number[] = [];
    for (let v = 0; v < nv; v += step) { const h = groundAt(L[3 * v], L[3 * v + 1]); if (Number.isFinite(h)) g.push(h); }
    if (!g.length) return null;
    g.sort((a, b) => a - b);
    const ground = g[g.length >> 1];
    return Math.abs(ground - r.zGround) > 25 ? { ground, road: r.zGround } : null;
  }, [p.render, p.layers.terrain, groundAt, p.heightMode]);

  // height: z' = (z - base) * exaggeration, applied as a model matrix (positions keep the file's heights); draped
  // positions already hold heights above sea level: scaled with the terrain's exaggeration and lifted above it
  const modelMatrix = useMemo(() => {
    if (draped) return new Matrix4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, p.exaggeration, 0, 0, 0, lift, 1]);
    const r = p.render;
    const ex = p.heightMode === "flat" ? 0 : p.exaggeration;
    const base = p.heightMode === "relative" && r ? r.zGround : 0;
    const up = p.heightMode === "flat" ? 0.05 : absoluteProbe ? lift : 0; // a display offset only: heights stay the file's
    return new Matrix4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, ex, 0, 0, 0, -base * ex + up, 1]);
  }, [p.render, p.heightMode, p.exaggeration, draped, lift, absoluteProbe]);
  // junction outlines float 0.3 m above the surface: the joints across the arms stay visible over the lanes and curbs
  const outlineMatrix = useMemo(() => new Matrix4(modelMatrix).translate([0, 0, 0.3]), [modelMatrix]);

  const layers = useMemo(() => {
    const r = draped?.render ?? p.render;
    const out = [];
    if (r) {
      const J = r.junctions, nj = J.meta.length;
      if (p.layers.junctions && nj) {
        // junction areas under the lanes: exact boundaries solid, approximate hulls dashed and fainter
        const jData = { length: nj, startIndices: sub(J.starts, nj), attributes: { getPolygon: { value: J.positions, size: 3 } } };
        out.push(new SolidPolygonLayer({
          id: "junctions", data: jData, _full3d: true, pickable: true, modelMatrix, opacity: p.roadOpacity,
          getFillColor: (_: unknown, { index }: { index: number }) =>
            index === p.selectedJunction ? [90, 169, 255, 110] : J.meta[index].exact ? [245, 184, 74, 70] : [245, 184, 74, 38],
          updateTriggers: { getFillColor: [p.selectedJunction] },
        }));
      }
      const L = r.lanes, n = L.meta.length;
      if (p.layers.lanes)
        out.push(new SolidPolygonLayer({
          id: "lanes",
          data: { length: n, startIndices: sub(L.starts, n), attributes: { getPolygon: { value: L.positions, size: 3 } } },
          _normalize: false, _full3d: true, extruded: false, pickable: true, autoHighlight: true,
          highlightColor: [255, 255, 255, 60], modelMatrix, opacity: p.roadOpacity,
          getFillColor: (_: unknown, { index }: { index: number }) => laneColor(L.meta[index], p.theme, index === p.selectedLane),
          updateTriggers: { getFillColor: [p.theme, p.selectedLane] },
        }));
      if (p.layers.borders)
        out.push(new PathLayer({
          id: "lane-borders",
          data: { length: n, startIndices: sub(L.starts, n), attributes: { getPath: { value: L.positions, size: 3 } } },
          _pathType: "loop", getColor: p.theme === "dark" ? [0, 0, 0, 90] : [40, 44, 52, 70], getWidth: 1, widthUnits: "pixels", modelMatrix,
        }));
      const M = r.marks, nm = M.meta.length;
      if (p.layers.marks && nm)
        out.push(new PathLayer({
          id: "marks",
          data: { length: nm, startIndices: sub(M.starts, nm), attributes: { getPath: { value: M.positions, size: 3 } } },
          _pathType: "open", widthUnits: "meters", widthMinPixels: 1, modelMatrix,
          getWidth: (_: unknown, { index }: { index: number }) => M.meta[index].width,
          getColor: (_: unknown, { index }: { index: number }) => M.meta[index].color,
          // dash pattern in metres -> multiples of the line width (PathStyleExtension units)
          getDashArray: (_: unknown, { index }: { index: number }) => {
            const m = M.meta[index];
            return m.dash ? [m.dash[0] / m.width, m.dash[1] / m.width] : [0, 0];
          },
          dashJustified: true, extensions: [new PathStyleExtension({ dash: true })],
        }));
      // junction outlines above lanes and marks: the area reads at a glance (fill stays under the lanes)
      if (p.layers.junctions && nj)
        out.push(new PathLayer({
          id: "junction-outlines",
          data: { length: nj, startIndices: sub(J.starts, nj), attributes: { getPath: { value: J.positions, size: 3 } } },
          _pathType: "loop", widthUnits: "pixels", modelMatrix: outlineMatrix,
          getWidth: (_: unknown, { index }: { index: number }) => (index === p.selectedJunction ? 3.5 : 2.2),
          getColor: (_: unknown, { index }: { index: number }) => (index === p.selectedJunction ? [90, 169, 255, 255] : [245, 184, 74, 230]),
          getDashArray: (_: unknown, { index }: { index: number }) => (J.meta[index].exact ? [0, 0] : [4, 3]),
          dashJustified: true, extensions: [new PathStyleExtension({ dash: true })],
          updateTriggers: { getWidth: [p.selectedJunction], getColor: [p.selectedJunction] },
        }));
      // junction reference lines (§12.9, dashed) and elevation grids (§12.11): grid lines between neighbouring points
      // and the points themselves, at the grid's z-values
      const G = r.grids;
      if (p.layers.grids && G.refLines.meta.length) {
        const n2 = G.refLines.meta.length, nl = G.lines.meta.length, np = G.points.meta.length;
        if (nl) out.push(new PathLayer({
          id: "junction-grid", data: { length: nl, startIndices: sub(G.lines.starts, nl), attributes: { getPath: { value: G.lines.positions, size: 3 } } },
          _pathType: "open", widthUnits: "pixels", getWidth: 1, getColor: [80, 220, 200, 200], pickable: true, modelMatrix: outlineMatrix,
        }));
        if (np) out.push(new ScatterplotLayer({
          id: "junction-grid-points", data: { length: np, attributes: { getPosition: { value: G.points.positions, size: 3 } } },
          getRadius: 2.5, radiusUnits: "pixels", getFillColor: [80, 220, 200, 255], stroked: true, getLineColor: [10, 12, 16, 255],
          lineWidthUnits: "pixels", getLineWidth: 1, pickable: true, modelMatrix: outlineMatrix,
        }));
        // the reference line last: the grid's centre points lie on it
        out.push(new PathLayer({
          id: "junction-ref-lines", data: { length: n2, startIndices: sub(G.refLines.starts, n2), attributes: { getPath: { value: G.refLines.positions, size: 3 } } },
          _pathType: "open", widthUnits: "pixels", getWidth: 3, getColor: [235, 64, 52, 255], pickable: true, modelMatrix: outlineMatrix,
          getDashArray: [6, 3], dashJustified: true, extensions: [new PathStyleExtension({ dash: true })],
        }));
      }
      const R = r.refs, nr = R.meta.length;
      if (p.layers.refs && nr)
        out.push(new PathLayer({
          id: "refs",
          data: { length: nr, startIndices: sub(R.starts, nr), attributes: { getPath: { value: R.positions, size: 3 } } },
          _pathType: "open", getColor: [232, 76, 255, 220], getWidth: 1.5, widthUnits: "pixels", modelMatrix,
        }));
      const O = r.objects, no = O.meta.length;
      if (p.layers.objects && no)
        out.push(new SolidPolygonLayer({
          id: "objects",
          data: { length: no, startIndices: sub(O.starts, no), attributes: { getPolygon: { value: O.positions, size: 3 } } },
          _full3d: true, getFillColor: [255, 255, 255, 150], modelMatrix, opacity: p.roadOpacity,
        }));
      const OL = r.objectLines, nol = OL.meta.length;
      if (p.layers.objects && nol)
        out.push(new PathLayer({
          id: "object-lines", data: { length: nol, startIndices: sub(OL.starts, nol), attributes: { getPath: { value: OL.positions, size: 3 } } },
          _pathType: "open", widthUnits: "pixels", getWidth: 2, getColor: [196, 160, 90, 255], pickable: true, modelMatrix,
        }));
      // road furniture in 3D (signals, objects), bridges / tunnels and cross paths (xodr/features.ts)
      const F = r.features, selF = p.selectedFeature;
      const isSel = (m: { kind: string; road: number; index: number }) => !!selF && m.kind === selF.kind && m.road === selF.road && m.index === selF.index;
      const showFeature = (m: { kind: string }) => (m.kind === "signal" ? p.layers.signals : p.layers.objects);
      if (p.layers.structures && F.structures.meta.length) {
        const S = F.structures, ns = S.meta.length;
        out.push(new SolidPolygonLayer({
          id: "structures", data: { length: ns, startIndices: sub(S.starts, ns), attributes: { getPolygon: { value: S.positions, size: 3 } } },
          _normalize: false, extruded: true, pickable: true, modelMatrix, wireframe: true,
          getElevation: (_: unknown, { index }: { index: number }) => (S.meta[index].tunnel ? 4.5 : 0.05),
          getFillColor: (_: unknown, { index }: { index: number }) => (isSel(S.meta[index]) ? [90, 169, 255, 120] : S.meta[index].tunnel ? [110, 112, 122, 70] : [70, 130, 230, 70]),
          getLineColor: (_: unknown, { index }: { index: number }) => (S.meta[index].tunnel ? [90, 92, 100, 220] : [70, 130, 230, 230]),
          updateTriggers: { getFillColor: [selF] },
        }));
      }
      if (p.layers.crossPaths && F.crossPaths.meta.length) {
        const X = F.crossPaths, nx = X.meta.length;
        out.push(new PathLayer({
          id: "cross-paths", data: { length: nx, startIndices: sub(X.starts, nx), attributes: { getPath: { value: X.positions, size: 3 } } },
          _pathType: "open", widthUnits: "pixels", getWidth: 2.5, getColor: [0, 205, 255, 235], pickable: true, modelMatrix,
          getDashArray: [3, 2], dashJustified: true, extensions: [new PathStyleExtension({ dash: true })],
        }));
      }
      F.columns.forEach((c) => {
        const keep = c.meta.map((m) => showFeature(m));
        if (!keep.some(Boolean)) return;
        out.push(new ColumnLayer({
          id: `col-${c.radius}`, data: { length: c.meta.length, attributes: {
            getPosition: { value: c.positions, size: 3 }, getElevation: { value: c.elevations, size: 1 } } },
          radius: c.radius, diskResolution: c.radius >= 0.5 ? 14 : 8, extruded: true, pickable: true, modelMatrix,
          getFillColor: (_: unknown, { index }: { index: number }) =>
            !keep[index] ? [0, 0, 0, 0] : isSel(c.meta[index]) ? [90, 169, 255, 255]
              : [c.colors[4 * index], c.colors[4 * index + 1], c.colors[4 * index + 2], c.colors[4 * index + 3]],
          updateTriggers: { getFillColor: [selF, p.layers.signals, p.layers.objects] },
        }));
      });
      if (F.boxes.meta.length) {
        const B = F.boxes, nb = B.meta.length;
        out.push(new SolidPolygonLayer({
          id: "boxes", data: { length: nb, startIndices: sub(B.starts, nb), attributes: { getPolygon: { value: B.positions, size: 3 } } },
          _normalize: false, extruded: true, pickable: true, modelMatrix,
          getElevation: (_: unknown, { index }: { index: number }) => (showFeature(B.meta[index]) ? B.elevations[index] : 0),
          getFillColor: (_: unknown, { index }: { index: number }) =>
            !showFeature(B.meta[index]) ? [0, 0, 0, 0] : isSel(B.meta[index]) ? [90, 169, 255, 255]
              : [B.colors[4 * index], B.colors[4 * index + 1], B.colors[4 * index + 2], B.colors[4 * index + 3]],
          updateTriggers: { getFillColor: [selF, p.layers.signals, p.layers.objects], getElevation: [p.layers.signals, p.layers.objects] },
        }));
      }
      if (p.layers.signals && F.labels.texts.length) {
        const Lb = F.labels;
        out.push(new TextLayer({
          id: "sign-labels", data: { length: Lb.texts.length, attributes: { getPosition: { value: Lb.positions, size: 3 } } },
          getText: (_: unknown, { index }: { index: number }) => Lb.texts[index], getSize: 12, sizeMaxPixels: 16, sizeMinPixels: 0,
          getColor: [20, 22, 26, 255], background: true, getBackgroundColor: [255, 255, 255, 230], backgroundPadding: [3, 1],
          fontWeight: 700, billboard: true, modelMatrix, characterSet: "auto",
        }));
      }
      const P = r.points;
      // signal dots for the top-down view; in 3D the boards and lights themselves show (xodr/features.ts)
      if (p.layers.signals && P.meta.length && p.mode === "2d")
        out.push(new ScatterplotLayer({
          id: "signals",
          data: { length: P.meta.length, attributes: { getPosition: { value: P.positions, size: 3 } } },
          getRadius: 0.7, radiusUnits: "meters", radiusMinPixels: 0.5, radiusMaxPixels: 7, stroked: true, getLineColor: [10, 12, 16, 255],
          lineWidthUnits: "pixels", getLineWidth: 1, lineWidthMaxPixels: 1,
          getFillColor: (_: unknown, { index }: { index: number }) =>
            P.meta[index].kind === "object" ? [180, 140, 255, 230] : P.meta[index].dynamic ? [37, 194, 110, 255] : [255, 107, 107, 255],
          pickable: true, modelMatrix, parameters: { depthCompare: "always" },
        }));
    }
    // B of a comparison over A: lane outlines and dashed reference lines in magenta, above A's surfaces
    const C = cmpDraped;
    if (C) {
      const nl = C.lanes.meta.length, nr = C.refs.meta.length;
      out.push(new PathLayer({
        id: "cmp-lanes", data: { length: nl, startIndices: sub(C.lanes.starts, nl), attributes: { getPath: { value: C.lanes.positions, size: 3 } } },
        _pathType: "loop", widthUnits: "pixels", getWidth: 1.5, getColor: [255, 64, 200, 230], modelMatrix: outlineMatrix,
      }));
      if (nr) out.push(new PathLayer({
        id: "cmp-refs", data: { length: nr, startIndices: sub(C.refs.starts, nr), attributes: { getPath: { value: C.refs.positions, size: 3 } } },
        _pathType: "open", widthUnits: "pixels", getWidth: 1.5, getColor: [255, 64, 200, 255], modelMatrix: outlineMatrix,
        getDashArray: [4, 3], dashJustified: true, extensions: [new PathStyleExtension({ dash: true })],
      }));
    }
    const markers = (id: string, pts: MarkerPoint[], radius: number) => [
      new ScatterplotLayer<MarkerPoint>({
        id, data: pts, getPosition: (d) => [d.lon, d.lat], getRadius: (d) => (d.selected ? radius + 3 : radius), radiusUnits: "pixels",
        getFillColor: (d) => d.color, stroked: true, getLineColor: (d) => (d.selected ? [255, 255, 255, 255] : [10, 12, 16, 255]),
        lineWidthUnits: "pixels", getLineWidth: (d) => (d.selected ? 2.5 : 1.5), pickable: true, billboard: true,
        parameters: { depthCompare: "always" }, updateTriggers: { getRadius: pts, getLineColor: pts },
      }),
      new TextLayer<MarkerPoint>({
        id: id + "-label", data: pts.filter((d) => d.label), getPosition: (d) => [d.lon, d.lat], getText: (d) => d.label!,
        getSize: 11, getColor: [12, 14, 18, 255], fontWeight: 700, billboard: true, parameters: { depthCompare: "always" },
      }),
    ];
    // beforeId is a MapboxOverlay (interleaved) layer prop, not part of the layers' own prop types
    for (let i = 0; i < out.length; i++) out[i] = out[i].clone({ beforeId } as never);
    if (p.layers.findings && p.findings.length) out.push(...markers("findings", p.findings, 6));
    if (p.layers.flags && p.flags.length) out.push(...markers("flags", p.flags, 10));
    return out;
  }, [p.render, draped, p.layers, p.theme, p.selectedLane, p.selectedJunction, p.selectedFeature, p.flags, p.findings, modelMatrix,
      outlineMatrix, beforeId, p.mode, p.roadOpacity, cmpDraped]);

  useEffect(() => {
    layersRef.current = layers;
    if (styleReady.current) overlay.current?.setProps({ layers });
  }, [layers, styleEpoch]);

  // offline HD orthophoto tiles in view (MapLibre image sources, see syncImageTiles)
  const imgTiles = useMemo(() => {
    const pyr = p.imagery?.satellite;
    return p.basemap === "satellite" && p.imagery && pyr && p.proj && view ? visibleTiles(p.imagery, pyr, p.proj, view.box, view.mpp) : [];
  }, [p.basemap, p.imagery, p.proj, view]);
  useEffect(() => {
    imgRef.current = imgTiles;
    const map = mapRef.current;
    if (map && styleReady.current) syncImageTiles(map, imgTiles);
  }, [imgTiles]);

  // a new network: compute the view once the map has fitted it
  useEffect(() => {
    const map = mapRef.current;
    if (map && p.proj) map.fire("moveend");
  }, [p.proj]);

  const credit = p.basemap === "satellite" && p.imagery?.satellite ? p.imagery.satellite.attribution ?? p.imagery.satellite.name : null;
  return (
    <>
      <div ref={host} className="map" />
      {absoluteOff && (
        <div className="map-note">
          {`Heights in this file are not above sea level (road level ${absoluteOff.road.toFixed(1)} m, terrain here ${absoluteOff.ground.toFixed(0)} m): choose "relative" heights to lay the roads on the terrain.`}
        </div>
      )}
      {credit && <div className="imagery-credit" title={p.imagery!.satellite!.name}>{p.imagery!.satellite!.name.replace(/\s*\(offline,?\s*/i, " (")} · {credit}</div>}
    </>
  );
}

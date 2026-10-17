// The map: MapLibre GL (OpenFreeMap vector tiles, OSM 3D buildings, terrain) with the OpenDRIVE layers drawn by
// deck.gl interleaved into the same WebGL context, so buildings and roads share one depth buffer.
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ColumnLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from "@deck.gl/layers";
import { diskResolution } from "../xodr/features";
import { FillStyleExtension, PathStyleExtension } from "@deck.gl/extensions";
import { hoverText } from "./hoverInfo";
import { undergroundRuns, XRAY_TOLERANCE, type XrayPath } from "./tunnelXray";
import { placeTip } from "../components/tooltipPlace";
import { JUNCTION_PATTERNS, junctionDash, junctionEdge, junctionEdgeWidth, junctionFill, junctionPattern, isVirtual, virtualJunctions } from "./junctionStyle";
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
import { buildRoadFloor } from "./roadFloor";
import { drapeRender, groundProbe, terrainLift } from "./drape";
import { depthBias } from "./drawOrder";
import { LaneZIndex } from "./markerZ";
import { ASSET, BUILDING, EDGE, LABEL, MARK, MARKER, MATERIAL, OSM_REF, OVERLAY, STRUCTURE, withAlpha } from "../design/scene";
import { gapColor, gapRadius, withHeights, type OsmKind, type OsmOverlay } from "../review/osmOverlay";
import { drawnZ, hasRealHeights, heightPlan, medianGround, NO_GROUND_LEVEL, viewHeights, type HeightMode } from "./heights";
import type { Projector } from "../xodr/geo";

// satellite: the offline HD orthophoto over live imagery; satellite-live: live (online) imagery only
import { concreteBasemap, type Basemap } from "./basemap";
export type { Basemap } from "./basemap";

// CARTO basemaps (Voyager), with the key from the environment variable CARTO_MAP_API (vite.config.ts envPrefix)
const CARTO_KEY = import.meta.env.CARTO_MAP_API ?? "";
export const CARTO_AVAILABLE = CARTO_KEY.length > 0;
const CARTO_HOST = /(^|\.)basemaps\.cartocdn\.com$/;
/** CARTO requests carry the key (the GL style's tile, sprite and glyph urls do not always) */
function withCartoKey(url: string): { url: string } | undefined {
  try {
    const u = new URL(url);
    if (!CARTO_KEY || !CARTO_HOST.test(u.hostname) || u.searchParams.has("key")) return undefined;
    u.searchParams.set("key", CARTO_KEY);
    return { url: u.toString() };
  } catch { return undefined; }
}
export type { HeightMode } from "./heights";

export interface MapLayers {
  lanes: boolean; junctions: boolean; marks: boolean; borders: boolean; refs: boolean; signals: boolean; objects: boolean;
  structures: boolean; crossPaths: boolean; grids: boolean; // grids: junction reference lines + elevation grids
  directions: boolean; // driving-direction arrows on the traffic lanes
  tunnels: boolean; // 3D with terrain: tunnel roads under the ground drawn through it (map/tunnelXray.ts)
  review: boolean; // the LLM review's items (<page>.review.json)
  buildings: boolean; terrain: boolean; flags: boolean; findings: boolean;
  osm: boolean; osmGap: boolean; // the OSM reference overlay (review/osmOverlay.ts) and its kerb-gap dots
}

export interface MarkerPoint { id: string; lon: number; lat: number; color: Rgba; label?: string; selected?: boolean; tip?: string; radius?: number } // tip: the hover tooltip

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
  selectedRoad: number | null; // a whole road selected (all its lanes highlighted)
  selectedJunction: number | null;
  selectedFeature: { kind: string; road: number; index: number } | null;
  flags: MarkerPoint[];
  findings: MarkerPoint[];
  review: MarkerPoint[]; // LLM review items (read-only), drawn as rings
  osm: OsmOverlay | null; // the OSM reference (read-only): never picked for a selection or a flag
  flyTo: { lon: number; lat: number; zoom?: number; key: number } | null;
  fitKey: number;
  onPick: (info: PickingInfo, shift: boolean) => void; // shift: Shift held (select the whole road)
  onCursor: (lonLat: [number, number] | null) => void;
  cursorCrosshair: boolean;
}

const STYLE_URL: Record<"liberty" | "positron" | "dark", string> = {
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
// CARTO Voyager raster tiles, with the OpenFreeMap vector source kept for the 3D buildings
const CARTO_RASTER_STYLE = (): StyleSpecification => ({
  version: 8,
  sources: {
    carto: {
      // CARTO's raster tiles end at z18 (z19 / z20 requests fail, checked 2026-10-17); MapLibre overzooms z18 beyond
      type: "raster", tileSize: 256, maxzoom: 18, tiles: [`https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(CARTO_KEY)}`],
      attribution: '© <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    },
    openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
  },
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#f8f4f0" } }, { id: "carto", type: "raster", source: "carto" }],
});
const EMPTY_STYLE = (bg: string): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": bg } }] });
/** the MapLibre style of a basemap (the theme only matters for "none": the empty map takes the page background) */
function styleFor(chosen: Basemap, theme: "dark" | "light"): StyleSpecification | string {
  const basemap = concreteBasemap(chosen, theme); // "map" follows the theme
  if (basemap === "carto-dark") {
    if (!CARTO_AVAILABLE) return STYLE_URL.dark;
    return `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json?key=${encodeURIComponent(CARTO_KEY)}`;
  }
  if (basemap === "none") return EMPTY_STYLE(theme === "dark" ? "#06112a" : "#e8f2fb"); // --bg (haze-950 / haze-50)
  if (basemap === "osm") return OSM_STYLE;
  if (basemap === "carto" || basemap === "carto-raster") {
    if (!CARTO_AVAILABLE) return OSM_STYLE; // no key here: the standard map
    return basemap === "carto" ? `https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json?key=${encodeURIComponent(CARTO_KEY)}` : CARTO_RASTER_STYLE();
  }
  if (basemap === "satellite" || basemap === "satellite-live") return SATELLITE_STYLE;
  return STYLE_URL[basemap];
}
const styleKey = (chosen: Basemap, theme: "dark" | "light") => {
  const basemap = concreteBasemap(chosen, theme);
  return basemap === "none" ? `none-${theme}` : basemap.startsWith("satellite") ? "satellite" : basemap;
};
const TERRAIN_SOURCE = "odrv-terrain";
const BUILDINGS = "odrv-buildings-3d";
const FOOTPRINT = "odrv-buildings-footprint", FOOTPRINT_EDGE = "odrv-buildings-edge"; // bottom face and border
const BOUNDS_MARGIN = 200; // m beyond the network the camera may move

/** OSM buildings extruded from the OpenMapTiles `building` layer (render_height / render_min_height) */
function ensureBuildings(map: MlMap, on: boolean, opacity: number, theme: "dark" | "light"): string | undefined {
  const own = map.getLayer("building-3d") ? "building-3d" : null;
  // styles without the OpenFreeMap source (CARTO's) get it for the building extrusions
  if (!own && !map.getSource("openmaptiles")) map.addSource("openmaptiles", { type: "vector", url: "https://tiles.openfreemap.org/planet" });
  if (!own && !map.getLayer(BUILDINGS) && map.getSource("openmaptiles")) {
    map.addLayer({
      id: BUILDINGS, type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
      paint: {
        "fill-extrusion-color": theme === "dark" ? BUILDING.dark : BUILDING.light, // context: recedes into the theme's ground
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
    map.addLayer({ id: FOOTPRINT, type: "fill", ...src, paint: { "fill-color": OVERLAY.buildingFill, "fill-opacity": 0.28 } }, extrusion);
    map.addLayer({
      id: FOOTPRINT_EDGE, type: "line", ...src,
      paint: { "line-color": OVERLAY.buildingEdge, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.8, 19, 2.2], "line-opacity": 0.95 },
    }, extrusion);
  }
  for (const id of [own, BUILDINGS])
    if (id && map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
      map.setPaintProperty(id, "fill-extrusion-opacity", opacity);
      if (id === BUILDINGS) map.setPaintProperty(id, "fill-extrusion-color", theme === "dark" ? BUILDING.dark : BUILDING.light);
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

/** a pick on the tunnel x-ray is a pick of the lane it shows (the inspector, the hover tooltip and flags work on it) */
function asLanePick<T extends { layer?: { id: string } | null; index: number; object?: unknown }>(info: T): T {
  const o = info.object as XrayPath | undefined;
  return info.layer?.id === "tunnel-xray" && o ? { ...info, layer: { ...info.layer, id: "lanes" }, index: o.lane } : info;
}

const TIP_DELAY = 400; // ms, design §5
/**
 * The OSM reference is only looked at: a click on it goes to what lies under it (a lane, a junction, the ground), so it
 * never becomes a selection or a flag's place
 */
function throughOsm(ov: MapboxOverlay, info: PickingInfo, layers: Layer[]): PickingInfo {
  if (!info.layer?.id.startsWith("osm-")) return info;
  const under = ov.pickObject({ x: info.x, y: info.y, radius: 2, layerIds: layers.map((l) => l.id).filter((id) => !id.startsWith("osm-")) });
  return under ?? { ...info, layer: null, index: -1, object: null };
}

export const SIGN_LABEL_MAX_MPP = 0.6; // m per screen pixel: sign labels from about a 1:2000 view in (design §8 Labels)
export const BARRIER_LINE_MAX_MPP = 0.3; // m per screen pixel: the barriers' top-edge line from about zoom 17.5 in (design §8)

/** the map's tooltip: the design's .tooltip, 6px below the pointer, kept in the viewport */
function MapTip({ x, y, text }: { x: number; y: number; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const t = ref.current?.getBoundingClientRect();
    if (t) setPos(placeTip({ left: x, top: y, width: 0, height: 12 }, t, { width: window.innerWidth, height: window.innerHeight }));
  }, [x, y, text]);
  return <div ref={ref} className="tooltip" role="tooltip" style={pos ?? { left: 0, top: 0, visibility: "hidden" }}>{text}</div>;
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
  const signLabelsOn = !view || view.mpp <= SIGN_LABEL_MAX_MPP;
  const barrierLinesOn = !view || view.mpp <= BARRIER_LINE_MAX_MPP;
  // terrain: the DEM under the network (the same tiles MapLibre's terrain draws) and the lift that keeps the draped
  // roads above the surface as drawn (re-measured whenever the map comes to rest)
  const [dem, setDem] = useState<{ render: RenderData; dem: Dem } | null>(null);
  const [lift, setLift] = useState(0); // measured on idle (terrain only); nothing is lifted before that
  const probeRef = useRef<ReturnType<typeof groundProbe> | null>(null);
  const imgRef = useRef<ImageTile[]>([]);
  const layersRef = useRef<Layer[]>([]); // the overlay's current layers (style swaps re-set them without beforeId)
  // the style can take layers and sources: from its style.load until the next setStyle (map.isStyleLoaded() also waits
  // for every tile, so changes made while tiles stream in would be dropped)
  const styleReady = useRef(false);
  const [hoverAt, setHoverAt] = useState<{ layer: string; index: number; x: number; y: number } | null>(null); // the hover tooltip's target (client px)
  const terrainSrcRef = useRef<TerrainSrc>(TERRARIUM_SRC); // the terrain source (set below, once the road floor is known)
  // 2D is a plan view: drawn flat, no terrain (map/heights.ts viewHeights); 3D uses the chosen mode and terrain
  const vh = viewHeights(p.mode, p.heightMode, p.layers.terrain), terrainOn = vh.terrain;
  const shownStyle = useRef(styleKey(p.basemap, p.theme)); // the style the map has (or is loading)
  const [styleEpoch, setStyleEpoch] = useState(0); // bumped on every style.load: the overlay's layers are set again
  useLayoutEffect(() => { propsRef.current = p; }); // map event handlers read the latest props

  // map + overlay, once
  useEffect(() => {
    const map = new maplibregl.Map({
      // the basemap the app starts with (a placeholder style replaced at once would abort its first requests)
      container: host.current!, style: styleFor(propsRef.current.basemap, propsRef.current.theme), center: [0, 20], zoom: 1.5, maxPitch: 85,
      attributionControl: false, canvasContextAttributes: { antialias: true },
      transformRequest: (url) => withCartoKey(url),
    });
    deckTransformCompat(map);
    // controls as the design's screens place them: zoom / compass top-left (clear of the inspector drawer), the scale bar
    // and the attribution bottom-left
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left");
    const ov = new MapboxOverlay({
      interleaved: true, layers: [], onClick: (info, event) => propsRef.current.onPick(asLanePick(throughOsm(ov, info, layersRef.current)), !!(event?.srcEvent as MouseEvent | undefined)?.shiftKey),
      onHover: (raw) => {
        const info = asLanePick(raw), rect = host.current?.getBoundingClientRect();
        setHoverAt(info.index >= 0 && info.layer && rect ? { layer: info.layer.id, index: info.index, x: rect.left + info.x, y: rect.top + info.y } : null);
      },
    });
    if (import.meta.env.DEV) (window as unknown as { odrvDeck?: MapboxOverlay }).odrvDeck = ov; // dev: inspect the deck layers
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
    map.on("movestart", () => setHoverAt(null)); // the thing under the pointer changes as the map moves
    map.on("load", updateView);
    map.on("style.load", () => {
      styleReady.current = true;
      if (import.meta.env.DEV && mapRef.current === map) (window as unknown as { odrvMap?: MlMap }).odrvMap = map;
      setBeforeId(ensureBuildings(map, propsRef.current.layers.buildings && propsRef.current.mode === "3d", propsRef.current.buildingOpacity, propsRef.current.theme));
      ensureTerrain(map, propsRef.current.layers.terrain && propsRef.current.mode === "3d", propsRef.current.exaggeration, terrainSrcRef.current);
      ensureDim(map, propsRef.current.dim);
      syncImageTiles(map, imgRef.current);
      setStyleEpoch((e) => e + 1);
    });
    map.on("idle", () => {
      const probe = probeRef.current, pr = propsRef.current;
      if (!probe || !pr.layers.terrain || pr.mode !== "3d") { setLift(0); return; } // no probe (or no terrain): no lift
      const b = map.getBounds(), w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
      const next = terrainLift(probe, (lon, lat) => map.queryTerrainElevation([lon, lat]), pr.exaggeration, 0,
        (lon, lat) => lon >= w && lon <= e && lat >= s && lat <= n);
      setLift((cur) => (Math.abs(cur - next) > Math.max(0.05, 0.02 * cur) ? next : cur));
    });
    mapRef.current = map;
    overlay.current = ov;
    if (import.meta.env.DEV) (window as unknown as { odrvMap?: MlMap }).odrvMap = map; // debugging aid in dev builds
    return () => { map.remove(); mapRef.current = null; overlay.current = null; };
  }, []);

  // basemap style
  useEffect(() => {
    const map = mapRef.current, key = styleKey(p.basemap, p.theme);
    if (!map || shownStyle.current === key) return; // e.g. the theme changed but the style does not depend on it
    shownStyle.current = key;
    styleReady.current = false;
    // until the new style has loaded our layers, the OpenDRIVE layers go without beforeId (same layers, so deck.gl
    // keeps them): it inserts its layer groups on every styledata event and fails while the building layer they are
    // placed before does not exist yet
    overlay.current?.setProps({ layers: layersRef.current.map((l) => l.clone({ beforeId: undefined } as never)) });
    map.setStyle(styleFor(p.basemap, p.theme), { diff: false }); // a full reload: style.load fires, our sources and layers are added again
  }, [p.basemap, p.theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleReady.current) setBeforeId(ensureBuildings(map, p.layers.buildings && p.mode === "3d", p.buildingOpacity, p.theme));
  }, [p.layers.buildings, p.buildingOpacity, p.mode, p.theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleReady.current) ensureDim(map, p.dim);
  }, [p.dim]);

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
    if (!terrainOn || !r || !Number.isFinite(r.bounds[0]) || dem?.render === r) return;
    const ac = new AbortController();
    const [w, s, e, n] = r.bounds, lat = (s + n) / 2, m = BOUNDS_MARGIN + 50;
    const dLat = m / 111320, dLon = m / (111320 * Math.cos((lat * Math.PI) / 180));
    Dem.load([w - dLon, s - dLat, e + dLon, n + dLat], ac.signal)
      .then((d) => setDem({ render: r, dem: d }))
      .catch((err) => { if (!ac.signal.aborted) console.warn("terrain DEM not loaded", err); });
    return () => ac.abort();
  }, [p.render, terrainOn, dem]);
  const demNow = dem && dem.render === p.render ? dem.dem : null;
  // the ground under the roads, as the terrain draws it: the network's grid (blended into Terrarium at its edge) or Terrarium
  const groundAt = useMemo(() => {
    if (!demNow) return null;
    const g = p.ground, pr = p.proj;
    if (!g || !pr) return (lon: number, lat: number) => demNow.sample(lon, lat);
    return (lon: number, lat: number) => { const [x, y] = pr.inverse(lon, lat); return groundHeight(g, x, y, () => demNow.sample(lon, lat)); };
  }, [demNow, p.ground, p.proj]);

  // how the file's heights are drawn: one pure decision (map/heights.ts, docs/ACCURACY.md), for A and for compare B
  const realHeights = useMemo(() => !!p.render && !!groundAt && hasRealHeights(p.render.lanes.positions, groundAt), [p.render, groundAt]);
  const plan = useMemo(() => heightPlan({
    mode: vh.mode, terrain: terrainOn, groundReady: !!groundAt, zGround: p.render?.zGround ?? 0, realHeights, exaggeration: p.exaggeration,
  }), [vh.mode, terrainOn, groundAt, p.render, realHeights, p.exaggeration]);
  const draped = useMemo(() => (plan.drape && p.render && groundAt ? drapeRender(p.render, groundAt, plan.drape) : null),
  [plan.drape, p.render, groundAt]);
  // the road wins (map/roadFloor.ts, docs/ACCURACY.md §4): over terrain, wherever the drawn lanes keep heights above the
  // same datum as the ground (base 0: absolute, real heights, or laid on the ground), the ground is pressed under them.
  // Not under tunnels: their roads run under the ground on purpose (and are shown through it)
  const floorOn = terrainOn && plan.scale > 0 && plan.base === 0;
  const floorRender = draped?.render ?? p.render;
  const floor = useMemo(() => {
    const pr = p.proj, r = floorRender;
    if (!floorOn || !pr || !r) return null;
    const toXY = (lon: number, lat: number) => pr.inverse(lon, lat) as [number, number], S = r.features.structures, tunnels = new Map<number, [number, number][][]>();
    S.meta.forEach((m, k) => {
      if (!m.tunnel) return;
      const ring: [number, number][] = [];
      for (let v = S.starts[k]; v < S.starts[k + 1]; v++) ring.push(toXY(S.positions[3 * v], S.positions[3 * v + 1]));
      tunnels.set(m.road, [...(tunnels.get(m.road) ?? []), ring]);
    });
    return buildRoadFloor(r.lanes, toXY, { exclude: tunnels, areas: r.junctions });
  }, [floorOn, floorRender, p.proj]);
  // terrain source for the current grid and floor: a new one gets a new source (MapLibre caches tiles per url)
  const terrainSrc = useMemo<TerrainSrc>(() => {
    const g = p.ground, pr = p.proj;
    if (!pr || (!g && !floor)) return TERRARIUM_SRC;
    const n = ++groundSeq, box = g ? [g.originX, g.originY, g.originX + g.nx * g.cell, g.originY + g.ny * g.cell] : floor!.box;
    const lat = pr.forward((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)[1];
    const what = g ? `network ground grid (${g.datum || "datum not given"}, ${g.cell} m)` : "Mapzen Terrarium";
    return {
      id: GROUND_SOURCE + n, tiles: `${GROUND_PROTOCOL}://{z}/{x}/{y}?g=${n}`,
      maxzoom: Math.max(g ? groundMaxZoom(g, lat) : DEM_MAXZOOM, floor ? groundMaxZoom(floor, lat) : DEM_MAXZOOM),
      attribution: `Terrain: ${what}${g ? ", Mapzen Terrarium around it" : ""}${floor ? "; pressed under the roads" : ""}`,
    };
  }, [p.ground, p.proj, floor]);
  // layout effect: the tile protocol knows the grid and floor before the (passive) effect that adds the source runs
  useLayoutEffect(() => { setGroundGrid(p.ground, p.proj, floor); terrainSrcRef.current = terrainSrc; }, [terrainSrc, p.ground, p.proj, floor]);
  useEffect(() => {
    const map = mapRef.current;
    if (map && styleReady.current) ensureTerrain(map, terrainOn, p.exaggeration, terrainSrc);
  }, [terrainOn, p.exaggeration, terrainSrc]);
  const cmpDraped = useMemo(() => {
    const c = p.compare;
    if (!c || !groundAt) return c;
    const cp = heightPlan({ mode: vh.mode, terrain: terrainOn, groundReady: true, zGround: c.zGround,
      realHeights: hasRealHeights(c.lanes.positions, groundAt), exaggeration: p.exaggeration });
    return cp.drape ? drapeRender(c, groundAt, cp.drape).render : c;
  }, [p.compare, terrainOn, groundAt, vh.mode, p.exaggeration]);
  // the lift's probe: ground heights (never road heights) under the lanes, wherever the lift applies
  const probe = useMemo(() => (draped ? draped.probe : plan.liftFromGround && p.render && groundAt ? groundProbe(p.render.lanes.positions, groundAt) : null),
  [draped, plan.liftFromGround, p.render, groundAt]);
  useEffect(() => {
    probeRef.current = probe;
    mapRef.current?.triggerRepaint(); // the idle handler measures the lift for the new surface
  }, [probe]);
  // tunnel roads seen through the terrain (map/tunnelXray.ts): lane vertices of roads with a <tunnel> whose drawn height is
  // under the drawn ground (terrain heights times the exaggeration); never when the network is laid on the ground
  const xray = useMemo(() => {
    const r = p.render;
    if (!p.layers.tunnels || !p.layers.lanes || !terrainOn || !groundAt || plan.drape || !r) return null;
    const roads = new Set(r.features.structures.meta.filter((m) => m.tunnel).map((m) => m.road));
    if (!roads.size) return null;
    const ex = p.exaggeration;
    return undergroundRuns(r.lanes, roads, (lon, lat, z) => drawnZ(plan, z, lift) < groundAt(lon, lat) * ex - XRAY_TOLERANCE * ex);
  }, [p.layers.tunnels, p.layers.lanes, terrainOn, groundAt, plan, p.render, p.exaggeration, lift]);
  // absolute mode over terrain with a file whose heights are far from the ground: say so (the roads are buried or float)
  const absoluteOff = useMemo(() => {
    const r = p.render;
    if (!terrainOn || !r || !groundAt || vh.mode !== "absolute") return null;
    const ground = medianGround(r.lanes.positions, groundAt);
    return ground !== null && Math.abs(ground - r.zGround) > NO_GROUND_LEVEL ? { ground, road: r.zGround } : null;
  }, [p.render, terrainOn, groundAt, vh.mode]);
  const noGroundForAbsolute = plan.noGround;
  // z' = (z - base) * scale + lift as a model matrix: positions keep the file's heights (draped ones hold heights above
  // sea level); the lift is the measured terrain detail difference, applied over terrain only
  // dev builds: window.odrvAudit() measures the drawn lanes against the drawn terrain in the current view (docs/ACCURACY.md §5)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { odrvAudit?: () => unknown }).odrvAudit = () => {
      const map = mapRef.current, r = draped?.render ?? p.render;
      if (!map || !r || !map.getTerrain()) return { error: "open a network and turn Terrain on" };
      const b = map.getBounds(), L = r.lanes.positions, d: number[] = [];
      for (let v = 0; v < L.length / 3; v++) {
        const lon = L[3 * v], lat = L[3 * v + 1];
        if (lon < b.getWest() || lon > b.getEast() || lat < b.getSouth() || lat > b.getNorth()) continue;
        const t = map.queryTerrainElevation([lon, lat]);
        if (t !== null) d.push(drawnZ(plan, L[3 * v + 2], lift) - t);
      }
      if (!d.length) return { error: "no lane in view" };
      const s = [...d].sort((x, y) => x - y), a = d.map(Math.abs).sort((x, y) => x - y), q = (arr: number[], f: number) => +arr[Math.floor(f * (arr.length - 1))].toFixed(3);
      return { lanePoints: d.length, zoom: +map.getZoom().toFixed(2), lift: +lift.toFixed(3), plan, median: q(s, 0.5), p5: q(s, 0.05), p95: q(s, 0.95), p95abs: q(a, 0.95) };
    };
  }, [draped, p.render, plan, lift]);
  // lane heights as drawn (draped positions where the network is laid on the ground), for the review markers
  const laneZ = useMemo(() => {
    const r = draped?.render ?? p.render;
    return r && Number.isFinite(r.bounds[1]) ? new LaneZIndex(r.lanes.positions, (r.bounds[1] + r.bounds[3]) / 2) : null;
  }, [draped, p.render]);
  // the OSM reference's vertices at the height of the nearest drawn lane (raw file / draped heights, so the same model
  // matrix applies); away from the lanes, on the drawn ground (draped) or at the road level
  const osmPositions = useMemo(() => {
    const o = p.osm, r = draped?.render ?? p.render;
    if (!o || !r || !p.layers.osm) return null;
    const zAt = (lon: number, lat: number) => laneZ?.nearestZ(lon, lat, 60) ?? (draped && groundAt ? groundAt(lon, lat) : r.zGround);
    return { lines: withHeights(o.lines.positions, zAt), areas: withHeights(o.areas.positions, zAt), gaps: o.gaps ? withHeights(o.gaps.positions, zAt) : null };
  }, [p.osm, p.render, draped, laneZ, groundAt, p.layers.osm]);
  const modelMatrix = useMemo(() => new Matrix4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, plan.scale, 0, 0, 0,
    -plan.base * plan.scale + (plan.liftFromGround ? lift : 0), 1]), [plan, lift]);

  const layers = useMemo(() => {
    const r = draped?.render ?? p.render;
    const out = [];
    if (r) {
      const J = r.junctions, nj = J.meta.length;
      if (p.layers.junctions && nj) {
        // junction areas (map/junctionStyle.ts): a real junction is an amber solid tint under the lanes; a virtual one (on its
        // through road) is not filled there but hatched in iris over the lanes (junctions-virtual, after the lanes)
        const jData = { length: nj, startIndices: sub(J.starts, nj), attributes: { getPolygon: { value: J.positions, size: 3 } } };
        out.push(new SolidPolygonLayer({
          id: "junctions", data: jData, _full3d: true, pickable: true, modelMatrix, parameters: depthBias("junctions"), opacity: p.roadOpacity,
          getFillColor: (_: unknown, { index }: { index: number }) =>
            isVirtual(J.meta[index]) ? [0, 0, 0, 0] : junctionFill(J.meta[index], index === p.selectedJunction),
          updateTriggers: { getFillColor: [p.selectedJunction] },
        }));
      }
      const L = r.lanes, n = L.meta.length;
      if (p.layers.lanes)
        out.push(new SolidPolygonLayer({
          id: "lanes",
          data: { length: n, startIndices: sub(L.starts, n), attributes: { getPolygon: { value: L.positions, size: 3 } } },
          _normalize: false, _full3d: true, extruded: false, pickable: true, autoHighlight: true,
          highlightColor: OVERLAY.hover, modelMatrix, parameters: depthBias("lanes"), opacity: p.roadOpacity,
          getFillColor: (_: unknown, { index }: { index: number }) =>
            laneColor(L.meta[index], p.theme, index === p.selectedLane || L.meta[index].road === p.selectedRoad),
          updateTriggers: { getFillColor: [p.theme, p.selectedLane, p.selectedRoad] },
        }));
      if (p.layers.borders)
        out.push(new PathLayer({
          id: "lane-borders",
          data: { length: n, startIndices: sub(L.starts, n), attributes: { getPath: { value: L.positions, size: 3 } } },
          _pathType: "loop", getColor: p.theme === "dark" ? EDGE.laneDark : EDGE.laneLight, getWidth: 1, widthUnits: "pixels", modelMatrix, parameters: depthBias("lane-borders"),
        }));
      // driving direction (1.8.0 §11.2.1): flat arrows on the traffic lanes, over the lanes and under the marks' outlines
      const A = r.arrows, na = A.meta.length;
      if (p.layers.directions && p.layers.lanes && na)
        out.push(new SolidPolygonLayer({
          id: "lane-directions", data: { length: na, startIndices: sub(A.starts, na), attributes: { getPolygon: { value: A.positions, size: 3 } } },
          _full3d: true, modelMatrix, parameters: depthBias("lane-directions"), getFillColor: withAlpha(MARK.white, 200),
        }));
      // virtual junctions: the iris 45° hatch (fixed on screen: 3px stripes, 5px gap) over their through road's lanes
      const V = p.layers.junctions && nj ? virtualJunctions(J) : null, nv = V?.index.length ?? 0;
      if (V && nv)
        out.push(new SolidPolygonLayer({
          id: "junctions-virtual", data: { length: nv, startIndices: sub(V.starts, nv), attributes: { getPolygon: { value: V.positions, size: 3 } } },
          _full3d: true, pickable: true, modelMatrix, parameters: depthBias("junctions-virtual"),
          getFillColor: (_: unknown, { index }: { index: number }) => junctionFill(J.meta[V.index[index]], V.index[index] === p.selectedJunction),
          getFillPattern: (_: unknown, { index }: { index: number }) => junctionPattern(J.meta[V.index[index]]),
          fillPatternMapping: JUNCTION_PATTERNS, fillPatternSizeUnits: "pixels",
          extensions: [new FillStyleExtension({ pattern: true, proceduralPattern: true })],
          updateTriggers: { getFillColor: [p.selectedJunction] },
        }));
      const M = r.marks, nm = M.meta.length;
      if (p.layers.marks && nm)
        out.push(new PathLayer({
          id: "marks",
          data: { length: nm, startIndices: sub(M.starts, nm), attributes: { getPath: { value: M.positions, size: 3 } } },
          _pathType: "open", widthUnits: "meters", widthMinPixels: 1, modelMatrix, parameters: depthBias("marks"),
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
          _pathType: "loop", widthUnits: "pixels", modelMatrix, parameters: depthBias("junction-outlines"),
          getWidth: (_: unknown, { index }: { index: number }) => junctionEdgeWidth(index === p.selectedJunction),
          getColor: (_: unknown, { index }: { index: number }) => junctionEdge(J.meta[index], index === p.selectedJunction),
          getDashArray: (_: unknown, { index }: { index: number }) => junctionDash(J.meta[index]),
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
          _pathType: "open", widthUnits: "pixels", getWidth: 1, getColor: OVERLAY.elevationLine, pickable: true, modelMatrix, parameters: depthBias("junction-grid"),
        }));
        if (np) out.push(new ScatterplotLayer({
          id: "junction-grid-points", data: { length: np, attributes: { getPosition: { value: G.points.positions, size: 3 } } },
          getRadius: 2.5, radiusUnits: "pixels", getFillColor: OVERLAY.elevation, stroked: true, getLineColor: EDGE.ring,
          lineWidthUnits: "pixels", getLineWidth: 1, pickable: true, modelMatrix, parameters: depthBias("junction-grid-points"),
        }));
        // the reference line last: the grid's centre points lie on it
        out.push(new PathLayer({
          id: "junction-ref-lines", data: { length: n2, startIndices: sub(G.refLines.starts, n2), attributes: { getPath: { value: G.refLines.positions, size: 3 } } },
          _pathType: "open", widthUnits: "pixels", getWidth: 3, getColor: OVERLAY.junctionRef, pickable: true, modelMatrix, parameters: depthBias("junction-ref-lines"),
          getDashArray: [6, 3], dashJustified: true, extensions: [new PathStyleExtension({ dash: true })],
        }));
      }
      const R = r.refs, nr = R.meta.length;
      if (p.layers.refs && nr)
        out.push(new PathLayer({
          id: "refs",
          data: { length: nr, startIndices: sub(R.starts, nr), attributes: { getPath: { value: R.positions, size: 3 } } },
          _pathType: "open", getColor: OVERLAY.refLine, getWidth: 1.5, widthUnits: "pixels", pickable: true, modelMatrix, parameters: depthBias("refs"),
        }));
      const O = r.objects, no = O.meta.length;
      if (p.layers.objects && no)
        out.push(new SolidPolygonLayer({
          id: "objects",
          data: { length: no, startIndices: sub(O.starts, no), attributes: { getPolygon: { value: O.positions, size: 3 } } },
          _full3d: true, getFillColor: ASSET.crosswalk, modelMatrix, parameters: depthBias("objects"), opacity: p.roadOpacity,
        }));
      const OL = r.objectLines, nol = OL.meta.length;
      if (p.layers.objects && nol)
        out.push(new PathLayer({
          id: "object-lines", data: { length: nol, startIndices: sub(OL.starts, nol), attributes: { getPath: { value: OL.positions, size: 3 } } },
          _pathType: "open", widthUnits: "pixels", getWidth: 2, getColor: ASSET.objectEdge, pickable: true, modelMatrix, parameters: depthBias("object-lines"),
        }));
      // road furniture in 3D (signals, objects), bridges / tunnels and cross paths (xodr/features.ts)
      const F = r.features, selF = p.selectedFeature;
      const isSel = (m: { kind: string; road: number; index: number }) => !!selF && m.kind === selF.kind && m.road === selF.road && m.index === selF.index;
      const showFeature = (m: { kind: string }) => (m.kind === "signal" ? p.layers.signals : p.layers.objects);
      if (p.layers.structures && F.structures.meta.length) {
        const S = F.structures, ns = S.meta.length;
        out.push(new SolidPolygonLayer({
          id: "structures", data: { length: ns, startIndices: sub(S.starts, ns), attributes: { getPolygon: { value: S.positions, size: 3 } } },
          _normalize: false, extruded: p.mode === "3d", pickable: true, modelMatrix, parameters: depthBias("structures"), wireframe: true,
          getElevation: (_: unknown, { index }: { index: number }) => (S.meta[index].tunnel ? 4.5 : 0.05),
          getFillColor: (_: unknown, { index }: { index: number }) => (isSel(S.meta[index]) ? STRUCTURE.selectedFill : S.meta[index].tunnel ? STRUCTURE.tunnelFill : STRUCTURE.bridgeFill),
          getLineColor: (_: unknown, { index }: { index: number }) => (S.meta[index].tunnel ? STRUCTURE.tunnelEdge : STRUCTURE.bridgeEdge), material: MATERIAL,
          updateTriggers: { getFillColor: [selF] },
        }));
      }
      // guard rails, jersey barriers, walls, fences: a thin light line with a soft dark casing on their top edge, in both
      // views, so a 10 cm rail reads over light and dark ground once zoomed in; it never outweighs the lanes (at most
      // 2 px, metre-based) and is not drawn zoomed out (the bodies keep their real size)
      if (p.layers.objects && F.barrierLines.meta.length && barrierLinesOn) {
        const BL = F.barrierLines, nb = BL.meta.length;
        const bData = { length: nb, startIndices: sub(BL.starts, nb), attributes: { getPath: { value: BL.positions, size: 3 } } };
        out.push(new PathLayer({
          id: "barrier-casing", data: bData, _pathType: "open", widthUnits: "meters", getWidth: 0.45, widthMinPixels: 2, widthMaxPixels: 3.5,
          getColor: withAlpha(EDGE.ring, 140),
          capRounded: true, jointRounded: true, modelMatrix, parameters: depthBias("barrier-casing"),
        }));
        out.push(new PathLayer({
          id: "barrier-lines", data: bData, _pathType: "open", widthUnits: "meters", getWidth: 0.25, widthMinPixels: 1, widthMaxPixels: 2,
          capRounded: true, jointRounded: true,
          getColor: (_: unknown, { index }: { index: number }) => (isSel(BL.meta[index]) ? OVERLAY.selected : ASSET.barrierLine),
          pickable: true, modelMatrix, parameters: depthBias("barrier-lines"), updateTriggers: { getColor: [selF] },
        }));
      }
      if (p.layers.crossPaths && F.crossPaths.meta.length) {
        const X = F.crossPaths, nx = X.meta.length;
        out.push(new PathLayer({
          id: "cross-paths", data: { length: nx, startIndices: sub(X.starts, nx), attributes: { getPath: { value: X.positions, size: 3 } } },
          _pathType: "open", widthUnits: "pixels", getWidth: 2.5, getColor: OVERLAY.crossPath, pickable: true, modelMatrix, parameters: depthBias("cross-paths"),
          getDashArray: [3, 2], dashJustified: true, extensions: [new PathStyleExtension({ dash: true })],
        }));
      }
      // 2D: the flat footprints of the 3D shapes (same positions and sizes, lowest top first); 3D: the shapes themselves
      if (p.mode === "2d" && F.footprints.meta.length) {
        const FP = F.footprints, nf = FP.meta.length;
        out.push(new SolidPolygonLayer({
          id: "footprints", data: { length: nf, startIndices: sub(FP.starts, nf), attributes: { getPolygon: { value: FP.positions, size: 3 } } },
          _full3d: true, pickable: true, modelMatrix, parameters: depthBias("footprints"),
          getFillColor: (_: unknown, { index }: { index: number }) =>
            !showFeature(FP.meta[index]) ? [0, 0, 0, 0] : isSel(FP.meta[index]) ? OVERLAY.selected
              : [FP.colors[4 * index], FP.colors[4 * index + 1], FP.colors[4 * index + 2], FP.colors[4 * index + 3]],
          updateTriggers: { getFillColor: [selF, p.layers.signals, p.layers.objects] },
        }));
      }
      if (p.mode === "3d") F.columns.forEach((c) => {
        const keep = c.meta.map((m) => showFeature(m));
        if (!keep.some(Boolean)) return;
        out.push(new ColumnLayer({
          id: `col-${c.radius}`, data: { length: c.meta.length, attributes: {
            getPosition: { value: c.positions, size: 3 }, getElevation: { value: c.elevations, size: 1 } } },
          radius: c.radius, diskResolution: diskResolution(c.radius), extruded: true, pickable: true, modelMatrix, material: MATERIAL,
          getFillColor: (_: unknown, { index }: { index: number }) =>
            !keep[index] ? [0, 0, 0, 0] : isSel(c.meta[index]) ? OVERLAY.selected
              : [c.colors[4 * index], c.colors[4 * index + 1], c.colors[4 * index + 2], c.colors[4 * index + 3]],
          updateTriggers: { getFillColor: [selF, p.layers.signals, p.layers.objects] },
        }));
      });
      if (p.mode === "3d" && F.boxes.meta.length) {
        const B = F.boxes, nb = B.meta.length;
        out.push(new SolidPolygonLayer({
          id: "boxes", data: { length: nb, startIndices: sub(B.starts, nb), attributes: { getPolygon: { value: B.positions, size: 3 } } },
          _normalize: false, extruded: true, pickable: true, modelMatrix, material: MATERIAL,
          getElevation: (_: unknown, { index }: { index: number }) => (showFeature(B.meta[index]) ? B.elevations[index] : 0),
          getFillColor: (_: unknown, { index }: { index: number }) =>
            !showFeature(B.meta[index]) ? [0, 0, 0, 0] : isSel(B.meta[index]) ? OVERLAY.selected
              : [B.colors[4 * index], B.colors[4 * index + 1], B.colors[4 * index + 2], B.colors[4 * index + 3]],
          updateTriggers: { getFillColor: [selF, p.layers.signals, p.layers.objects], getElevation: [p.layers.signals, p.layers.objects] },
        }));
      }
      // sign value labels once they can be read apart (design §8 Labels): zoomed out, a city drew hundreds of pills piled
      // over the roads (a collision filter dropped single characters of a label instead)
      if (p.layers.signals && F.labels.texts.length && signLabelsOn) {
        const Lb = F.labels;
        out.push(new TextLayer({
          id: "sign-labels", data: { length: Lb.texts.length, attributes: { getPosition: { value: Lb.positions, size: 3 } } },
          getText: (_: unknown, { index }: { index: number }) => Lb.texts[index], getSize: LABEL.size, sizeMaxPixels: LABEL.sizeMaxPixels, sizeMinPixels: 0,
          getColor: LABEL.ink, background: true, getBackgroundColor: LABEL.background, backgroundPadding: LABEL.padding,
          backgroundBorderRadius: LABEL.borderRadius, fontFamily: LABEL.fontFamily, fontWeight: LABEL.fontWeight, billboard: true, modelMatrix, characterSet: "auto",
        }));
      }
    }
    // B of a comparison over A: lane outlines and dashed reference lines in magenta, above A's surfaces
    const C = cmpDraped;
    if (C) {
      const nl = C.lanes.meta.length, nr = C.refs.meta.length;
      out.push(new PathLayer({
        id: "cmp-lanes", data: { length: nl, startIndices: sub(C.lanes.starts, nl), attributes: { getPath: { value: C.lanes.positions, size: 3 } } },
        _pathType: "loop", widthUnits: "pixels", getWidth: 1.5, getColor: OVERLAY.compare, modelMatrix, parameters: depthBias("cmp-lanes"),
      }));
      if (nr) out.push(new PathLayer({
        id: "cmp-refs", data: { length: nr, startIndices: sub(C.refs.starts, nr), attributes: { getPath: { value: C.refs.positions, size: 3 } } },
        _pathType: "open", widthUnits: "pixels", getWidth: 1.5, getColor: withAlpha(OVERLAY.compare, 255), modelMatrix, parameters: depthBias("cmp-refs"),
        getDashArray: [4, 3], dashJustified: true, extensions: [new PathStyleExtension({ dash: true })],
      }));
    }
    // the OSM reference over everything it is compared with: areas as outlines, kerbs and sidewalks thin and dashed, and
    // with the gap colouring a dot per measured 1 m kerb sample; at the drawn lanes' height (osmPositions)
    const O2 = osmPositions;
    if (p.layers.osm && p.osm && O2) {
      const o = p.osm, kindOf = (paths: OsmOverlay["lines"], i: number): OsmKind => o.elements[paths.meta[i]].kind;
      const na = o.areas.meta.length, nl = o.lines.meta.length;
      if (na) out.push(new PathLayer({
        id: "osm-areas", data: { length: na, startIndices: sub(o.areas.starts, na), attributes: { getPath: { value: O2.areas, size: 3 } } },
        _pathType: "open", widthUnits: "pixels", getWidth: OSM_REF.areaWidth, getColor: (_: unknown, { index }: { index: number }) => OSM_REF[kindOf(o.areas, index)],
        pickable: true, autoHighlight: true, highlightColor: OVERLAY.hover, modelMatrix, parameters: depthBias("osm-areas"),
      }));
      if (nl) out.push(new PathLayer({
        id: "osm-lines", data: { length: nl, startIndices: sub(o.lines.starts, nl), attributes: { getPath: { value: O2.lines, size: 3 } } },
        _pathType: "open", widthUnits: "pixels", getWidth: OSM_REF.lineWidth, getColor: (_: unknown, { index }: { index: number }) => OSM_REF[kindOf(o.lines, index)],
        getDashArray: OSM_REF.dash, dashJustified: true, extensions: [new PathStyleExtension({ dash: true })],
        pickable: true, autoHighlight: true, highlightColor: OVERLAY.hover, modelMatrix, parameters: depthBias("osm-lines"),
      }));
      const G2 = o.gaps;
      if (p.layers.osmGap && G2 && O2.gaps && G2.meta.length) out.push(new ScatterplotLayer({
        id: "osm-kerb-gap", data: { length: G2.meta.length, attributes: { getPosition: { value: O2.gaps, size: 3 } } },
        radiusUnits: "pixels", getRadius: (_: unknown, { index }: { index: number }) => gapRadius(G2.gap[index]),
        getFillColor: (_: unknown, { index }: { index: number }) => gapColor(G2.gap[index]),
        pickable: true, modelMatrix, parameters: depthBias("osm-kerb-gap"),
      }));
    }
    // review markers on the lane under them, at its drawn height (at z = 0 a flag on a road 500 m above sea level showed
    // far from it in a tilted view); where no lane is near, on the drawn ground
    const markerZ = (d: MarkerPoint) => {
      const z = laneZ?.nearestZ(d.lon, d.lat) ?? (terrainOn && groundAt ? groundAt(d.lon, d.lat) : NaN);
      return Number.isFinite(z) ? drawnZ(plan, z, lift) : 0;
    };
    const markers = (id: string, pts: MarkerPoint[], radius: number) => [
      new ScatterplotLayer<MarkerPoint>({
        id, data: pts, getPosition: (d) => [d.lon, d.lat, markerZ(d)], getRadius: (d) => (d.selected ? radius + MARKER.selectedGrow : radius), radiusUnits: "pixels",
        getFillColor: (d) => d.color, stroked: true, getLineColor: (d) => (d.selected ? EDGE.ringSelected : EDGE.ring),
        lineWidthUnits: "pixels", getLineWidth: (d) => (d.selected ? MARKER.ringWidthSelected : MARKER.ringWidth), pickable: true, billboard: true,
        parameters: { depthCompare: "always" }, updateTriggers: { getRadius: pts, getLineColor: pts },
      }),
      new TextLayer<MarkerPoint>({
        id: id + "-label", data: pts.filter((d) => d.label), getPosition: (d) => [d.lon, d.lat, markerZ(d)], getText: (d) => d.label!,
        getSize: LABEL.flagSize, getColor: LABEL.ink, fontFamily: LABEL.fontFamily, fontWeight: 700, billboard: true, parameters: { depthCompare: "always" },
        background: true, getBackgroundColor: LABEL.background, backgroundPadding: LABEL.padding, backgroundBorderRadius: LABEL.borderRadius,
        getPixelOffset: LABEL.flagOffset,
      }),
    ];
    // beforeId is a MapboxOverlay (interleaved) layer prop, not part of the layers' own prop types
    for (let i = 0; i < out.length; i++) out[i] = out[i].clone({ beforeId } as never);
    // tunnel roads under the drawn ground, dashed through the terrain (and the buildings): drawn after the map like the
    // markers, at the lanes' own positions and height transform
    if (xray?.length)
      out.push(new PathLayer({
        id: "tunnel-xray", data: xray, getPath: (d: XrayPath) => d.path, widthUnits: "pixels", getWidth: 2, getColor: STRUCTURE.tunnelEdge,
        pickable: true, modelMatrix, parameters: { ...depthBias("tunnel-xray"), depthCompare: "always" },
        getDashArray: [3, 2], dashJustified: true, extensions: [new PathStyleExtension({ dash: true })],
      }));
    // LLM review items: hollow rings in the severity hue on a dark centre, under the checker findings and the flags
    if (p.layers.review && p.review.length)
      out.push(new ScatterplotLayer<MarkerPoint>({
        id: "review", data: p.review, getPosition: (d) => [d.lon, d.lat, markerZ(d)], radiusUnits: "pixels",
        getRadius: (d) => (d.radius ?? 6) + (d.selected ? MARKER.selectedGrow : 0), getFillColor: withAlpha(EDGE.ring, 150),
        stroked: true, getLineColor: (d) => (d.selected ? EDGE.ringSelected : d.color), lineWidthUnits: "pixels",
        getLineWidth: (d) => (d.selected ? 3 : 2.5), pickable: true, billboard: true, parameters: { depthCompare: "always" },
        updateTriggers: { getRadius: p.review, getLineColor: p.review, getLineWidth: p.review },
      }));
    if (p.layers.findings && p.findings.length) out.push(...markers("findings", p.findings, MARKER.findingRadius));
    if (p.layers.flags && p.flags.length) out.push(...markers("flags", p.flags, MARKER.flagRadius));
    return out;
  }, [p.render, draped, p.layers, p.theme, p.selectedLane, p.selectedRoad, p.selectedJunction, p.selectedFeature, p.flags, p.findings, p.review, modelMatrix,
      beforeId, p.mode, p.roadOpacity, cmpDraped, laneZ, plan, lift, terrainOn, groundAt, signLabelsOn, barrierLinesOn, xray, p.osm, osmPositions]);

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

  // the hover tooltip (design §5 Tooltip, §6: names the lane type, the finding): shown after 400 ms on one thing, follows
  // the pointer while it stays on it, gone when it leaves
  const tipText = useMemo(() => {
    const r = draped?.render ?? p.render;
    return hoverAt && r ? hoverText(hoverAt.layer, hoverAt.index, r, { flags: p.flags, findings: p.findings, review: p.review, osm: p.osm }) : null;
  }, [hoverAt?.layer, hoverAt?.index, draped, p.render, p.flags, p.findings, p.review, p.osm]); // eslint-disable-line react-hooks/exhaustive-deps
  const tipKey = tipText && hoverAt ? `${hoverAt.layer}:${hoverAt.index}` : "";
  const [tipShown, setTipShown] = useState("");
  useEffect(() => {
    if (!tipKey) return;
    const t = window.setTimeout(() => setTipShown(tipKey), TIP_DELAY);
    return () => window.clearTimeout(t);
  }, [tipKey]);
  const credit = p.basemap === "satellite" && p.imagery?.satellite ? p.imagery.satellite.attribution ?? p.imagery.satellite.name : null;
  return (
    <>
      <div ref={host} className="map" />
      {tipKey && tipShown === tipKey && hoverAt && <MapTip x={hoverAt.x} y={hoverAt.y} text={tipText!} />}
      {noGroundForAbsolute && (
        <div className="map-note">
          {`Terrain is off, so there is no ground for heights above sea level: drawn from the road level (${p.render!.zGround.toFixed(0)} m), height differences kept. Turn Terrain on to see them at their real height.`}
        </div>
      )}
      {absoluteOff && (
        <div className="map-note">
          {`Heights in this file are not above sea level (road level ${absoluteOff.road.toFixed(1)} m, terrain here ${absoluteOff.ground.toFixed(0)} m): choose "relative" heights to lay the roads on the terrain.`}
        </div>
      )}
      {credit && <div className="imagery-credit" title={p.imagery!.satellite!.name}>{p.imagery!.satellite!.name.replace(/\s*\(offline,?\s*/i, " (")} · {credit}</div>}
    </>
  );
}

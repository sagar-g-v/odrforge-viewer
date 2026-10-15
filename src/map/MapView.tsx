// The map: MapLibre GL (OpenFreeMap vector tiles, OSM 3D buildings, terrain) with the OpenDRIVE layers drawn by
// deck.gl interleaved into the same WebGL context, so buildings and roads share one depth buffer.
import { MapboxOverlay } from "@deck.gl/mapbox";
import { BitmapLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import type { PickingInfo } from "@deck.gl/core";
import * as maplibregl from "maplibre-gl";
import type { Map as MlMap, MapMouseEvent, StyleSpecification } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { Matrix4 } from "@math.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RenderData } from "../xodr/build";
import { laneColor, type Rgba } from "./palette";
import { visibleTiles, type LocalImagery } from "./localImagery";
import type { Projector } from "../xodr/geo";

// satellite: the offline HD orthophoto over live imagery; satellite-live: live (online) imagery only
export type Basemap = "osm" | "liberty" | "positron" | "dark" | "satellite" | "satellite-live" | "none";
export type HeightMode = "flat" | "relative" | "absolute";

export interface MapLayers {
  lanes: boolean; junctions: boolean; marks: boolean; borders: boolean; refs: boolean; signals: boolean; objects: boolean;
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
  selectedLane: number | null;
  selectedJunction: number | null;
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
// 3D buildings still extrude; the network's offline HD orthophoto (if any) is drawn over it by deck.gl
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

function ensureTerrain(map: MlMap, on: boolean, exaggeration: number) {
  if (on && !map.getSource(TERRAIN_SOURCE))
    map.addSource(TERRAIN_SOURCE, {
      type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 15,
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      attribution: "Terrain: Mapzen / AWS Open Data (Terrarium)",
    });
  map.setTerrain(on ? { source: TERRAIN_SOURCE, exaggeration } : null);
}

const sub = (a: Uint32Array, n: number) => a.subarray(0, n);

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
      if (import.meta.env.DEV && mapRef.current === map) (window as unknown as { odrvMap?: MlMap }).odrvMap = map;
      setBeforeId(ensureBuildings(map, propsRef.current.layers.buildings && propsRef.current.mode === "3d", propsRef.current.buildingOpacity));
      ensureTerrain(map, propsRef.current.layers.terrain, propsRef.current.exaggeration);
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
    map.setStyle(p.basemap === "none" ? EMPTY_STYLE(bg) : p.basemap === "osm" ? OSM_STYLE
      : p.basemap.startsWith("satellite") ? SATELLITE_STYLE : STYLE_URL[p.basemap as keyof typeof STYLE_URL]);
  }, [p.basemap, p.theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) setBeforeId(ensureBuildings(map, p.layers.buildings && p.mode === "3d", p.buildingOpacity));
  }, [p.layers.buildings, p.buildingOpacity, p.mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) ensureTerrain(map, p.layers.terrain, p.exaggeration);
  }, [p.layers.terrain, p.exaggeration]);

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

  // height: z' = (z - base) * exaggeration, applied as a model matrix (positions keep the file's heights)
  const modelMatrix = useMemo(() => {
    const r = p.render;
    const ex = p.heightMode === "flat" ? 0 : p.exaggeration;
    const base = p.heightMode === "relative" && r ? r.zGround : 0;
    return new Matrix4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, ex, 0, 0, 0, -base * ex + (p.heightMode === "flat" ? 0.05 : 0), 1]);
  }, [p.render, p.heightMode, p.exaggeration]);
  // junction outlines float 0.3 m above the surface: the joints across the arms stay visible over the lanes and curbs
  const outlineMatrix = useMemo(() => new Matrix4(modelMatrix).translate([0, 0, 0.3]), [modelMatrix]);

  const layers = useMemo(() => {
    const r = p.render;
    const out = [];
    // offline HD orthophoto tiles under everything (no depth writes: the roads at ground level draw over them)
    const pyr = p.imagery?.satellite;
    const tiles = p.basemap === "satellite" && p.imagery && pyr && p.proj && view ? visibleTiles(p.imagery, pyr, p.proj, view.box, view.mpp) : [];
    for (const t of tiles)
        out.push(new BitmapLayer({
          id: `img-${t.id}`, image: t.url, bounds: t.bounds as never, textureParameters: { minFilter: "linear", magFilter: "linear" },
          parameters: { depthWriteEnabled: false, depthCompare: "always" },
        }));
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
          getColor: (_: unknown, { index }: { index: number }) => (M.meta[index].color === "yellow" ? [245, 196, 66, 255] : [245, 247, 250, 255]),
          getDashArray: (_: unknown, { index }: { index: number }) => (M.meta[index].broken ? [25, 75] : [0, 0]),
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
      const P = r.points;
      if (p.layers.signals && P.meta.length)
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
  }, [p.render, p.layers, p.theme, p.selectedLane, p.selectedJunction, p.flags, p.findings, modelMatrix, outlineMatrix, beforeId,
      p.roadOpacity,
      p.basemap, p.imagery, p.proj, view]);

  useEffect(() => { overlay.current?.setProps({ layers }); }, [layers]);

  // a new network: compute the view once the map has fitted it
  useEffect(() => {
    const map = mapRef.current;
    if (map && p.proj) map.fire("moveend");
  }, [p.proj]);

  const credit = p.basemap === "satellite" && p.imagery?.satellite ? p.imagery.satellite.attribution ?? p.imagery.satellite.name : null;
  return (
    <>
      <div ref={host} className="map" />
      {credit && <div className="imagery-credit" title={p.imagery!.satellite!.name}>{p.imagery!.satellite!.name.replace(/\s*\(offline,?\s*/i, " (")} · {credit}</div>}
    </>
  );
}

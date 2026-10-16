# OdrForge Viewer

Review tool for ASAM OpenDRIVE networks: 2D and 3D views of any `.xodr` on a MapLibre vector-tile map with OSM 3D
buildings and terrain, a lane / road inspector, review flags shared with the OdrForge review server, and checker
findings (ASAM Quality Checker, OdrForge exact invariants) as map markers.

Companion to [OdrForge](https://github.com/sagar-g-v/odrforge) (OSM → OpenDRIVE), but reads OpenDRIVE files from any
tool (OpenDRIVE 1.4 – 1.8).

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build: `npm run build`, then `npm run preview` (or serve `dist/` statically).

Open a network in one of three ways:

- **Review server** (flags are saved next to the network): start OdrForge's server on the folder with the `.xodr`
  files, enter its URL in the top bar and pick a file.
  ```bash
  python tools/inspect/viz_server.py --dir path/to/outputs --port 8766
  ```
  Deep link: `http://localhost:5173/?server=http://127.0.0.1:8766&file=munich_standard.xodr`
- **Open file…** or drag and drop a `.xodr` (flags then stay in this browser; export them as JSON).
- An OdrForge viewer page (`.html` from `osm2xodr --viz`): its embedded, pre-sampled data loads faster.

## Using it

| | |
|---|---|
| **Map / Satellite** | top bar: the standard OpenStreetMap map (default) or live satellite (Esri World Imagery); more styles and the offline HD orthophoto under Layers |
| **CARTO basemaps** | CARTO Voyager as a vector style or raster tiles (Base map group), when the environment variable `CARTO_MAP_API` holds a CARTO key at dev / build time (Vite exposes only that variable; the key ends up in tile requests and in a production bundle, as for any browser map key). Without it the options show as unavailable |
| **2D / 3D** (`V`) | top-down review or tilted 3D with OSM buildings (opacity slider keeps roads behind them visible) |
| **Road heights** | *flat* (ignore z), *relative* (median road height on the ground), *absolute* (file heights above sea level). Every surface is drawn at the file's height: nothing is lifted or lowered for display; surfaces lying on each other (terrain, junction area, lanes, marks, outlines) are ordered by depth bias only. A file with real heights keeps them in relative mode too. With **Terrain**, a file without absolute heights is laid on the ground in flat / relative mode (bridges and tunnels keep their height difference); the only adjustment is for the viewer's own terrain detail: when MapLibre draws a coarser ground than the grid (zoomed out), roads rise by that measured difference, never by a difference between the file's roads and the ground. Signals and objects are symbols at the file's position and size (a typical size where the file gives none, said in the inspector) |
| **Terrain** | the network's own ground grid where the review server has one (the converter's `<area>_ground.odrz`, the DEM the roads were built from), rendered as MapLibre terrain tiles on the fly and blended into Mapzen Terrarium over 30 m at its edge; Terrarium alone elsewhere. Measured lane height minus drawn terrain at zoom 17.5: Munich median +0.006 m (|p95| 0.21 m), London +0.005 m (p5 −0.14, p95 +0.26 m), Stelvio +0.02 m (±2.7 m: the file's road profile vs its own grid on the hairpins); on Terrarium alone Munich was −5.7 m |
| **Junction areas** | the file's `<boundary>` (OpenDRIVE 1.8 §12.10: lane segments along a lane's outer border, joints across the arm ends) solid; files without one get an approximate dashed outline (hull of the connecting roads). Click one, or search `j 103` |
| **Junction grids** | the junction reference line (OpenDRIVE 1.8 §12.9, dashed red) and the `<elevationGrid>` (§12.11): every grid point at its z-value (row k at sStart + k · gridSpacing, left / right points every gridSpacing along the perpendicular), lines between neighbouring points; rows past the line's end continue it straight. The grid is drawn as given, not interpolated (§12.11.1 bicubic) |
| **Road furniture** | signals as boards on posts (value labels), traffic lights with red / amber / green lamps, stop and waiting lines across their lanes; trees, poles, street lamps, guard rails stretched by `<repeat>`, sized boxes / cylinders; bridges and tunnels over their s range; junction cross paths. Click any of them for every attribute (validity, dependencies, references, semantics, controllers) |
| **Object outlines** | every `<outline>` of an object (1.8.0 §13.3, and the 1.4 form without `<outlines>`): areas flat on the road, areas with height as solid blocks up to their highest corner, `closed="false"` outlines as lines; `<cornerLocal>` about the object's insertion point, `<cornerRoad>` at its s / t with z = reference line elevation + dz |
| **Road marks** | every line of every `<roadMark>`: double lines in spec order (1.9.0 Annex A: inside to outside, centre lane left to right), explicit `<type><line>` patterns, all colours |
| **Inspector** | click a lane: s / t, width, border offsets, surface z, superelevation, lane links, and the lane records in force at that point (height, material, speed, access, rule), road marks, road type, every `<userData>` entry (OSM source ways linked); click a junction area, its reference line or grid: boundary, reference line (§12.9), elevation grid (§12.11: spacing, rows, z range), connections, rules |
| **Flags** (`F`) | click where something is wrong, pick a category, describe it; replies from `flags.py` show in the list |
| **Findings** | load `.xqar` (ASAM qc-opendrive) and `invariants.json` (OdrForge); grouped by rule, toggle per rule, click to fly |
| **Compare** | open a second build of the same area (B) from the review server or a file: B's lane outlines and reference lines in magenta over A; a list of roads and junctions only in A / only in B, and per road matched by id the changes in length, reference line position and height (nearest-segment distance, WGS84 metres; reported above 5 cm / 5 cm / 1 cm), lane layout per section, links, junction membership, signal / object counts; click to fly there |
| **Search** (`/`) | road id or name |
| **File** | the `<header>`: name, OpenDRIVE version, file version, vendor, date, extent, offset, georeference, license, user data; junction groups (§12.13, e.g. roundabouts) in the file and the junction inspector |

## How it works

- `src/xodr/` reads OpenDRIVE without the DOM (a small XML reader), evaluates the reference line (line, arc,
  spiral, poly3, paramPoly3; ASAM OpenDRIVE 1.8.0 §9), lane borders (lane offset, width / border records; §11),
  lane heights (§11.10) and the road surface (elevation, superelevation; §10.5), and samples every lane into
  polygons: at every element / record boundary, at most 2 m apart, closer on curves (chord error ≤ 1 cm).
- Positions are projected to WGS84 with the file's `<geoReference>` (proj4) in a Web Worker and drawn by deck.gl
  binary layers interleaved into MapLibre GL, so buildings and roads share one depth buffer.
- MapLibre GL 6 with deck.gl 9.4: deck.gl's interleaved overlay still reads `map.transform`, which MapLibre 6 no
  longer exposes; `src/map/MapView.tsx` supplies the four values it needs from public API (remove when deck.gl
  supports MapLibre 6). MapLibre 5 is avoided: it carries GHSA-jrc7-96c5-q579.
- HD satellite: the network's offline orthophoto made by OdrForge's `tools/make_basemap.py` (official 0.2 – 0.6 m
  imagery, e.g. Bavaria DOP40, Hessen DOP20, USGS NAIP), found next to the network on the review server and drawn as
  georeferenced tiles at the zoom-appropriate pyramid level; Esri World Imagery (online) everywhere else.
- Basemaps: [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema, © OpenStreetMap
  contributors); terrain: Mapzen Terrarium tiles (AWS Open Data). No API keys.

Accuracy (tests/xodr.test.ts, Stelvio): every geometry element ends where the file starts the next one within 1 mm;
lane borders agree with OdrForge's reference sampler (tools/inspect/odrgeom.py) within 5 mm, p99 1.4 mm — the
largest difference is odrgeom's own (4.6 mm off the file's exact start point). Load time for the 35 MB Los Angeles
network (698 k vertices): 1.3 s in Node, 1.4 s in the production build.

## Develop

```bash
npm test             # vitest: geometry, lanes, parsers, flags
npx tsc -b           # types
npx oxlint src tests # lint
```

Test fixtures contain OdrForge output derived from OpenStreetMap data (© OpenStreetMap contributors, ODbL 1.0).

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
| **2D / 3D** (`V`) | top-down review or tilted 3D with OSM buildings (opacity slider keeps roads behind them visible) |
| **Road heights** | *flat* (ignore z), *relative* (median road height on the ground), *absolute* (with **Terrain**) |
| **Junction areas** | the file's `<boundary>` (OpenDRIVE 1.8 §12.10: lane segments along a lane's outer border, joints across the arm ends) solid; files without one get an approximate dashed outline (hull of the connecting roads). Click one, or search `j 103` |
| **Inspector** | click a lane: s / t, width, border offsets, surface z, superelevation, lane links, heights, road marks, road links, junction arms, OSM source ways |
| **Flags** (`F`) | click where something is wrong, pick a category, describe it; replies from `flags.py` show in the list |
| **Findings** | load `.xqar` (ASAM qc-opendrive) and `invariants.json` (OdrForge); grouped by rule, toggle per rule, click to fly |
| **Search** (`/`) | road id or name |

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

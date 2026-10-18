# Accuracy contract

The viewer exists to review OpenDRIVE files. What it shows must be reproducible in any other tool that reads the same files
and grid (CARLA, Blender, esmini). Every rule below was proven on real data, and each one names the test that guards it.

**Do not loosen a rule or a limit to make a change pass.** A change that breaks one of them needs:

- new evidence (measurements on the real test areas),
- an update to this file,
- and the test changed in the same commit.

Run everything with `npm test` (unit and real-data checks), `npx tsc -b`, `npx oxlint src` and `npm run build`. CI
(`.github/workflows/ci.yml`) runs the same on every push. The real-data checks are skipped there, because the data is not in the
repository.

## 1. Heights

These rules live in `src/map/heights.ts` and are guarded by `tests/heights.test.ts`.

- **The file's heights are drawn as they are.** The only transformations are the ones a mode states: *flat* ignores z,
  *relative* draws from the road level, and the height exaggeration scales z.
- **A file with real heights keeps them in relative mode over terrain.** A file has real heights when its lanes lie on the
  ground (median |z − ground| < 2 m). It is never re-based or draped.
- **A file without real heights is laid on the ground in flat / relative mode** (`src/map/drape.ts`). Bridges and tunnels
  keep their height difference. Guarded by `tests/terrain.test.ts`.
- **Absolute heights need a ground.** Without terrain, a network whose road level is more than 25 m from 0 is drawn from its
  road level, and the map says so.
- **Nothing is drawn at a height other than the file's.** There are no display offsets for marks, outlines, junction areas,
  arrows, cross paths or structures. Guarded by `tests/exact.test.ts` and `tests/drawOrder.test.ts`.

## 2. The lift

The lift is a display offset. It is applied only over terrain and measured only against the ground.

- It makes up for one thing only: MapLibre drawing a coarser ground than the grid (when zoomed out, or on distant tiles). It
  is the 95th percentile rise of the drawn surface over the ground under the lanes, measured when the map comes to rest
  (`terrainLift`, `groundProbe`).
- **It is never measured against the roads.** A road the file puts below the ground (a cutting) stays below it.
- **Only lane points in view count.** Elsewhere MapLibre answers from coarse (or no) DEM tiles. Measured over the whole
  network, this lifted central London's roads 9.2 m in a street-level view (found with `odrvAudit()` on 2026-10-17).
  In view the lift is 0 there: Adam Street median +0.001 m, Lancaster Place +0.003 m. Guarded by
  `tests/heights.test.ts` ("only points in view count", "MapView measures the lift in view", mutation-checked).
- It starts at 0 and is reset to 0 wherever it does not apply.
- **With the road floor (§4) it measures 0.** The ground is pressed under the lanes, so the drawn surface never rises over
  the ground under them. The roads then keep the file's heights exactly. Measured in the browser on 2026-10-18 (3D, terrain,
  `odrvAudit()`): before the floor the lift was 0.05 m (Munich, z16.5 to z18.5) to 0.12 m (Stelvio hairpins, z18), and at
  z16.5 in Munich 5 % of lane points were still under the drawn ground (p5 −0.02 m). With the floor the lift is 0 in every
  view, and no lane point is under the drawn ground (p5 +0.08 to +0.11 m in Munich, +0.33 m on Stelvio).

Guarded by `tests/heights.test.ts` ("the lift is measured against the ground") and `tests/terrain.test.ts`.

## 3. Surfaces on the same level

Terrain, junction area, lanes, flat objects, direction arrows, marks and overlays keep their file heights. Which one shows
is decided by depth bias (polygon offset), a rendering setting that moves no vertex. The order is in `src/map/drawOrder.ts`.

`tests/drawOrder.test.ts` checks:

- the order;
- that every coplanar layer in `MapView.tsx` takes its own place;
- that no layer is translated.

A mutation check proved the guard: swapping one layer's place fails two of its tests.

## 4. The ground

- **Terrain source order.** The network's road-conformed grid (`<area>_ground_conformed.odrz`) comes first, then its DEM grid
  (`<area>_ground.odrz`), with Mapzen Terrarium around and outside them (`groundGridFiles`, `tests/groundTiles.test.ts`).
- **Grid sampling** is exactly the converter's `TerrainGrid::sample`: cell centres, bilinear, NaN cells left out and the
  weights renormalised (`tests/odrz.test.ts`).
- **Terrain tiles** carry the grid's height at every pixel centre, within 1 cm (`tests/groundTiles.test.ts`). They are
  Terrarium-encoded to 1/256 m (`tests/odrz.test.ts`).
- **The road wins** (`src/map/roadFloor.ts`). Where the ground and a road compete, the road keeps its heights and the
  drawn ground is pressed under it. The road floor is a cap on a 1 m lattice over the network. Under every lane (all
  types, junctions included) and every junction surface the file defines, the cap is the lowest surface height over the
  cell, minus 0.05 m. It comes from a conservative raster: every cell a triangle touches, with a lower bound of the
  triangle's plane over the cell. Away from the lanes the
  cap rises at 2 m per metre, a 63° cut, so the ground meets its own heights a short way off; it does not change the
  ground there.
  - **The radius.** Each terrain tile pixel takes min(ground, the lowest cap within 1.5 pixels along each axis). MapLibre
    5 draws a mesh with one cell per DEM pixel (a 128-cell mesh on 512 px render tiles, DEM tiles one zoom down), its
    vertices sampled bilinearly from pixel centres. Every pixel a drawn point depends on is therefore within 1.5 pixels
    of it along each axis, so no drawn ground point under a lane can be above the lane, at any zoom.
  - **Junctions.** A junction surface the file defines is its `<boundary>` (1.8.0 §12.10) or a virtual junction's
    main-road span (§12.5). It presses the ground as drawn, triangulated with deck.gl's own earcut. A hull (a junction
    without either, outlined by the viewer from its connecting roads) is an approximation, not a surface the file
    defines, so only its connecting-road lanes press the ground. In the test areas 1–2 % of hull samples have ground
    above them (worst 0.6 m, London).
  - **Tunnels are left alone.** A tunnel road's lanes inside its own tunnel footprint do not press the ground; a road
    over the tunnel still does.
  - **Applies** wherever the drawn heights share the ground's datum: base 0, over terrain (absolute mode, real heights,
    or laid on the ground).
  - **Guards.** `tests/roadFloor.test.ts` checks the cap under a lane, the cut, tunnels, overlapping lanes and lanes
    thinner than a cell, and junction surfaces (exact pressed, hulls not). `tests/groundTiles.test.ts` checks that the drawn mesh is under every lane point at z17 and z15,
    with the lane at six offsets within a pixel, and that ground 30 m off is unchanged. `tests/realdata.test.ts` checks
    that no lane point outside tunnels, and no point of an exact junction surface, has ground above it in the four test
    areas. Before junction surfaces were added, 3.5 % of Munich's junction-surface samples had ground above them (worst
    0.35 m); in Frankfurt the worst was 1.95 m. Mutation-checked: no min with the
    floor, a centre-only raster, no plane slack, a window one cell short, a radius ignoring the mesh (1.0 pixel), float32
    rounding up and leaving out junction surfaces each fail a test.
  - **The cost**, reported by `ROAD_FLOOR=1 npx vitest run tests/realdata.test.ts`. Where two roads at different heights
    lie within the radius, the higher one floats over pressed ground. Lane points more than 1 m over the drawn ground,
    off bridges and tunnels, without → with the floor (2026-10-18, converter build 8344403): Munich 7 → 164, London
    32 → 426, Stelvio 658 → 3,763 (hairpins stacked on the slope), Frankfurt 87 → 943. The floor takes 0.1–0.7 s to
    build.
  - **Reproducibility.** The floor is a viewer rendering of the file's own roads over the converter's grid. CARLA and
    Blender show the same only when the published grid carries the same cap (asked of the converter on 2026-10-18).
- **Terrarium is sampled as MapLibre samples it** (`DEMData.sampleBilinear`: cell centres, bilinear across tile edges), so
  the drape agrees with the drawn surface. Measured in the browser: |difference| < 1e-9 m at review zoom
  (`tests/terrain.test.ts` guards the convention).

## 5. Real data

`tests/realdata.test.ts` runs when the converter's test areas are present (`ODRF_TESTAREAS`, default
`C:/mywork/osm2carla/build/testareas`). For Munich, London and Stelvio it checks:

| Check | Limit | Proven on 2026-10-17 |
|---|---|---|
| A road-conformed grid is found, and every lane lies on it: \|p95\| (lane z − grid) | ≤ 0.30 m | Munich 0.15, London 0.15, Stelvio 0.13 (0.24 before the 2.5 m DTM; 3.1 on the raw 30 m DEM) |
| Same, median | ≤ 0.20 m | 0.00 – 0.13 (the rest is raised sidewalks and curbs) |
| The file is in the grid's frame and datum: median (lane z − DEM grid) | ≤ 0.10 m | 0.005 – 0.03 |
| Real heights detected, so absolute and relative modes draw them as they are | – | – |

**In the browser** (dev build): open a network, turn Terrain on, and run `odrvAudit()` in the console. It returns drawn
lanes minus drawn terrain for the lanes in view, with the lift and the height plan in use. On 2026-10-17 at zoom 17.5,
Stelvio gave:

- the village: median +0.11 m, |p95| 0.26 m;
- the hairpins: median +0.25 m, |p95| 0.49 m.

Both include a 0.10 m lift, from MapLibre's terrain mesh on 40 % slopes. Munich (before the conformed grids) gave median
+0.006 m and |p95| 0.21 m.

## 6. Driving direction, lanes, objects

- **Driving direction** follows 1.8.0 §11.2.1:
  - RHT and LHT by the lane's side;
  - `@direction` "reversed" flips it;
  - `@direction` "both" (and the deprecated type bidirectional) draws a double-headed arrow.
  Guarded by `tests/direction.test.ts`. Checked against OSM `oneway` ways in Munich.
- **The superelevation sign** follows 1.8.0 §10.5: positive means falling to the right, so z = elevation + t · tan(se).
  Guarded by `tests/exact.test.ts` ("superelevation sign").
- **Object outlines** (`cornerLocal` / `cornerRoad`), **elevation grids** and the **junction reference line** are drawn
  as given. Guarded by `tests/outlines.test.ts` and `tests/grid.test.ts`.

## 7. Design contract (colour)

These rules live in `docs/design-system.md` §9 and are guarded by `tests/design.test.ts`. The test reads
`src/design/tokens.css`, `src/map/palette.ts` and `src/design/scene.ts` and checks:

- WCAG AA contrast in both themes: text ≥ 4.5:1, control boundaries and focus ≥ 3:1;
- the lane sets, the colour-blind ΔE minimums, and that `palette.ts` equals the `--lane-*` tokens;
- one meaning per overlay hue: compare magenta and cross-path cyan are used for nothing else, selection stands out from
  every lane, and sign and object dots never look like findings.

The numbers were measured on the proven palette (2026-10-17). The same rule applies as everywhere above: change the
colour, not the limit.
- **The 2D map is a flat plan view.** Everything is drawn flat and the terrain is off (`viewHeights`). The 3D signals and
  objects are drawn as their footprints: each column as the polygon ColumnLayer draws (same radius, same disk
  resolution, same centre), and each box as its own outline. They are ordered lowest top first, as a look straight down
  at the 3D scene shows them. No 3D shape is drawn in 2D. Guarded by `tests/footprints.test.ts`.
- **Review markers sit on the lane under them**, at its drawn height (`LaneZIndex`, through the height plan). Drawn at
  z = 0 instead, a flag on a road 500 m above sea level showed far from it in a tilted view. Guarded by
  `tests/markerZ.test.ts`.
- **The file and its ground grid share one vertical datum.** The file's header `verticalDatum` must equal the datum label
  of the grid the viewer draws; otherwise the viewer says so over the map in 3D with terrain (`map/odrz.ts datumMismatch`).
  Guarded by `tests/odrz.test.ts` and, on the converter's test areas, `tests/realdata.test.ts`.
- **Build provenance is shown only for the exact bytes it describes.** The gate writes `<file>.metrics.json` (e.g. `munich_standard.xodr.metrics.json`)
  next to each page: commit, run and build time, sha256, size and modification time of the `.xodr`, and its metrics. The viewer hashes
  the bytes it fetched. It shows the build line (status bar) and the build rows (File section) only when the sha256 matches,
  or, for a record without a hash, when both the size and the modification time match (to 2 s). A record for any other
  build is reported as such and its numbers are never shown (`data/provenance.ts`, guarded by `tests/provenance.test.ts`).
  The served folder is not visible to the viewer, so the content hash also stands in for the folder check.
- **Tunnel roads stay visible under the terrain, at their own positions.** With terrain on in 3D, the lanes of a road
  carrying a `<tunnel>` that lie more than 0.5 m under the drawn ground are drawn again as dashed outlines through the
  surface (`map/tunnelXray.ts`). This is a rendering choice: the overlay uses the lane's own vertices and the lanes' height
  transform, and it moves nothing. Clicks and hovers act on the lane. Guarded by `tests/tunnelXray.test.ts`, mutation-checked.
  Frankfurt, 2026-10-17: 3,929 of the 3,942 lane points more than 2 m under the ground are on tunnel roads.
- **Objects and signals stand where the spec puts them.** Their base is the reference line's elevation at s plus `zOffset`
  (1.8.1 XSD: "z-offset of object's origin relative to the elevation of the road reference line"; the same for signals and
  `<repeat>` zOffsetStart / End). The banked road surface at t is not used: it put them up to 0.3 m off on a 5 % bank
  6 m out. Guarded by `tests/exact.test.ts` (mutation-checked).
- **Driving lanes sit on the road-conformed grid; curbs and sidewalks stand their curb height above it.** The conformed
  grid holds the road surface without lane heights. Measured 2026-10-17: driving-lane median +0.002 m (Stelvio) and 0.000
  (Munich, London); curb and walking lanes +0.150. Stelvio's overall median of +0.133 is its lane mix (56 % curb and
  walking). `tests/realdata.test.ts` checks the driving lanes at |median| <= 0.05 m.
- **Point objects stand on the ground.** With terrain, the converter seats trees and street lamps on its conformed ground
  (zOffset = ground - elevation(s); OdrForge 02a8d5c). Measured 2026-10-17: |base - ground| at most 0.0001 m in Munich (679
  objects), London (598), Frankfurt (276) and Stelvio (2). Before the fix, Munich had 141 more than 0.3 m off, the worst 8.2 m
  under the ground. `tests/realdata.test.ts` checks every point object off bridges at 0.3 m (mutation-checked).
- **No lane is buried off bridges and tunnels.** No lane point on a road without a bridge or tunnel lies more than 2 m under
  the road-conformed ground. Proven 2026-10-17 after OdrForge 145cd82 + ef47f9b (underpasses, tunnel ends, car-park junction
  roads): none in Munich, London and Frankfurt. Stelvio road 22 is the one known open case (hairpin work). It is listed in
  `KNOWN_BURIED`, and the test fails if that list changes either way. `tests/realdata.test.ts`, mutation-checked.
- **Frankfurt joins the real-data checks; the lane fit is measured off bridges and tunnels.** Bridges and tunnels lie off the
  ground on purpose. Counting them made Frankfurt's |p95| 5.9 m; off them it is 0.151 m (Munich 0.151, London 0.150,
  Stelvio 0.192). From OdrForge 6537d93 (deck grid filtered) Frankfurt passes every check: the fit, driving lanes,
  datum, objects on the ground, nothing buried. `tests/realdata.test.ts` now covers four areas.
- **No cliffs.** No road is steeper than 50 % between 0.25 m samples, the converter's contract "cliffs" check, mirrored
  here. Measured 2026-10-17: none in Munich and Frankfurt. London road 250 (61 %) and Stelvio road 31 (54 %) are its known
  open cases, listed in `KNOWN_CLIFFS`, and the test fails if that list changes. Fit and driving-lane checks leave bridges
  and tunnels out (the Frankfurt car park P15 depth is still provisional).
- **Junction outlines** (`tests/junctionBoundary.test.ts`). The user asked on 2026-10-18 for a `<boundary>` (1.8.0
  §12.10) on every junction. On the 07:12 outputs the boundaries the converter writes enclose their connecting-road lanes
  (worst 0.10 m outside, Frankfurt; limit 0.15 m). The junctions still without one are counted exactly, and the test fails
  when a count changes; the counts are lowered as the converter fixes them, down to 0.

  | Area | Hulls (viewer's outline) | No outline (direct junctions) |
  |---|---|---|
  | Munich | 65 | 2 |
  | London | 57 | 1 |
  | Stelvio | 5 | 0 |
  | Frankfurt | 58 | 31 |

  Direct junctions have no connecting roads, so they have no hull either. Mutation-checked: a 0.05 m limit fails in all
  four areas.
- **OSM edges against the drawn network: baseline for the OSM-geometry mode (2026-10-18, build bfd950e).** This is an
  independent measurement: `barrier=kerb` lines and `footway=sidewalk` ways are read from the .osm, sampled every 1 m, and
  compared with the lanes the viewer draws. No converter code is used. Run it with
  `OSM_EDGES=1 npx vitest run tests/osmEdges.test.ts --silent=false`.
  - London kerb lines (93 % near the network) against the carriageway edge: median +1.16 m (the drawn road is narrower than
    the kerbs), |p95| 6.0 m, 18.5 % within 0.5 m, and the road overruns the kerb by more than 0.5 m on 19 %. Some kerb
    lines bound islands or pedestrian areas, not the carriageway.
  - Sidewalk ways with a drawn sidewalk lane within 10 m: London 13 %, Munich 23 %, Tokyo 83 %, Frankfurt 76 % (83 samples).
  - **Definitions shared with the converter** (2026-10-18; `src/review/osmEdges.ts`):
    - Parking: closed `parking=street_side|lane|layby` polygons wholly inside the converter's `--clip` box, with the share of
      area under drawn parking lanes on a 0.25 m grid, counted at 80 % or more. Baseline (01:42 outputs): Munich 0/30,
      London 0/17, Frankfurt 5/12, Stelvio 0/8. This equals the converter's exact-area tool. **Proven and guarded** on
      the converter's parking build (8344403 + 92f58db, 07:12 outputs), where both tools agree exactly:

      | Area | Areas covered | Mean share |
      |---|---|---|
      | Munich | 20/30 | 0.71 |
      | London | 12/17 | 0.83 |
      | Frankfurt | 11/12 | 0.90 |
      | Stelvio | 1/8 | 0.54 |

      `PARKING_MIN` in `tests/osmEdges.test.ts` fails on fewer covered areas, a lower mean share, or a different count of
      areas in the clip. It is never lowered and is raised as the converter improves. Mutation-checked: not counting
      parking lanes fails it in all four areas. With `OSM_EDGES=1` the report lists each uncovered OSM way and its share.
    - Kerb gap (P2's proof): samples at 0.5, 1.5 ... m along each open `barrier=kerb` way of 1 m or more. Each sample
      takes the signed distance to the nearest roughly parallel (< 25°) plain-road carriageway edge within 10 m. The sign
      comes from the edge's own outward normal (+ outside the road). A side with no carriageway lanes (one carriageway of
      a dual road) has its edge at the lane-0 line. Without that, median kerbs met the far edge and got the wrong sign:
      77 % sign agreement with "inside a drawn carriageway lane", against 97.5 % with it. Kerbs bounding islands or
      pedestrian areas are dropped. London (01:42): 17,876 samples, median +0.88 m, |p95| 6.0 m, 12.8 % within 0.3 m,
      21.8 % within 0.5 m. Overall, 66 % of samples lie > 0.3 m outside the drawn road and 21 % overrun it.
  - The kerb measures have no limits yet. They follow once the converter's P2 kerb work is proven.

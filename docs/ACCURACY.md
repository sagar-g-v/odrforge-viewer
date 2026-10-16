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
- It starts at 0 and is reset to 0 wherever it does not apply.

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

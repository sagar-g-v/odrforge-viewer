// Draw order of the layers that lie on the same surface (docs/ACCURACY.md §3). They keep the file's heights; which one
// shows is decided by depth bias (polygon offset), a rendering setting that moves no vertex. Larger = drawn over.
// Guarded by tests/drawOrder.test.ts.
export const DRAW_ORDER: Record<string, number> = {
  "junctions": 1, // junction area fill, under everything on the road
  "lanes": 2,
  "objects": 3, // flat object outlines (crosswalks, islands) on the lanes
  "lane-directions": 3, // driving-direction arrows on the lanes
  "lane-borders": 4, "marks": 4, // painted lines on the surface
  "junctions-virtual": 4, // virtual junction hatch (design §3): on its through road's lanes, which show between the stripes
  "refs": 5, "object-lines": 5, "structures": 5, "cross-paths": 5,
  "barrier-casing": 5, "barrier-lines": 5, // guard rails / barriers: a cased line on their top edge (design §8)
  "footprints": 5, // 2D: flat footprints of the 3D signals and objects, over the road paint
  "tunnel-xray": 6, // tunnel lanes under the ground, drawn through it (depthCompare always)
  "junction-outlines": 6, "junction-grid": 6, "junction-grid-points": 6, "junction-ref-lines": 6, "cmp-lanes": 6, "cmp-refs": 6,
  "osm-areas": 7, "osm-lines": 7, "osm-kerb-gap": 7, // the OSM reference (review/osmOverlay.ts): over everything it is compared with
};

/** deck.gl parameters for a layer's place in DRAW_ORDER (negative polygon offset pulls it towards the camera) */
export const depthBias = (layerId: string) => {
  const k = DRAW_ORDER[layerId];
  if (k === undefined) throw new Error(`layer ${layerId} has no place in DRAW_ORDER`);
  return { depthBias: -k, depthBiasSlopeScale: -k };
};

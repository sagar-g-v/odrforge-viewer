// What the viewer draws itself in the map scene: 3D assets (xodr/features.ts), road marks (xodr/build.ts), overlays,
// labels and review markers (map/MapView.tsx), as deck.gl RGBA. One source for the layers and the legend, following
// docs/design-system.md §8 ("3D assets and markers") and the Figma page "Map data & Patterns". Not wired in yet.

export type Rgba = [number, number, number, number];

/** a palette colour with another alpha (fills of a hue whose line is in the palette) */
export const withAlpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a];

/** matte "clay" material for every extruded asset: no gloss, so colour reads the same from every view angle */
export const MATERIAL = { ambient: 0.55, diffuse: 0.55, shininess: 8, specularColor: [40, 40, 40] as [number, number, number] };

/** 3D road furniture and objects (same in both themes: they stand on the map, not on the UI) */
export const ASSET = {
  trunk: [107, 79, 51, 255] as Rgba, //          bark #6b4f33
  crown: [88, 135, 33, 235] as Rgba, //          meadow-600 #588721, the reference tree's lit side
  pole: [138, 155, 176, 255] as Rgba, //         sky-tinted steel #8a9bb0 (posts, poles, lamp masts)
  lamp: [242, 181, 68, 255] as Rgba, //          sun-400 #f2b544 (street lamp head)
  barrier: [183, 195, 207, 255] as Rgba, //      galvanised #b7c3cf (guard rails, walls, fences)
  barrierLine: [214, 222, 230, 255] as Rgba, //  #d6dee6: the barrier's top-edge line (3px), on a 1px dark casing (EDGE.ring)
  object: [214, 180, 122, 240] as Rgba, //       sandstone #d6b47a (any other object, boxes / cylinders / marker posts)
  objectEdge: [214, 180, 122, 255] as Rgba, //   object outlines drawn as lines
  housing: [20, 26, 36, 255] as Rgba, //         night ink #141a24 (signal housing)
  crosswalk: [255, 255, 255, 150] as Rgba, //    white 60%
};

/**
 * The tree is the logo's tree (docs/brand/logo-mark.svg): a big top lobe over smaller side lobes on a thin trunk.
 * Fractions of the crown half-width r (default 1.5 m) and the height h (default 6 m), taken from the glyph:
 * top lobe radius .64r centred at h − .64r; three side lobes radius .53r, .47r out at 120° (so every side shows the
 * logo silhouette), centres .55r below the top lobe's; trunk radius .14r from the ground to the top lobe's centre.
 * Each lobe is a stepped low-poly sphere of three columns (ColumnLayer, no extra packages): a middle slice of radius ρ
 * over ±.35ρ and caps of radius .75ρ from .35ρ to .85ρ above and below. 2D (top-down): the four lobe discs, a trefoil.
 */
export const TREE = {
  top: { radius: 0.64, below: 0.64 }, side: { radius: 0.53, out: 0.47, drop: 0.55, count: 3 },
  trunk: { radius: 0.14 }, slices: [{ from: -0.85, to: -0.35, radius: 0.75 }, { from: -0.35, to: 0.35, radius: 1 }, { from: 0.35, to: 0.85, radius: 0.75 }],
  defaults: { height: 6, crown: 1.5 },
};

/** regulatory colours keep their real-world meaning; tuned values only */
export const SIGNAL = {
  red: [235, 52, 52, 255] as Rgba, amber: [245, 170, 40, 255] as Rgba, green: [46, 204, 98, 255] as Rgba,
  signWhite: [246, 246, 246, 255] as Rgba, signStop: [204, 32, 40, 255] as Rgba, signInfo: [44, 98, 206, 255] as Rgba,
  stopLine: [250, 250, 250, 255] as Rgba,
};

/** road mark paint by OpenDRIVE colour; curb and grass marks use the asset / meadow family */
export const MARK: Record<string, Rgba> = {
  standard: [245, 247, 250, 255], white: [245, 247, 250, 255], yellow: [245, 196, 66, 255], blue: [70, 130, 230, 255],
  green: [60, 170, 90, 255], red: [220, 60, 60, 255], orange: [240, 150, 40, 255], violet: [150, 90, 210, 255], black: [25, 25, 25, 255],
  curb: [150, 152, 156, 255], grass: [88, 135, 33, 255],
};

/** bridges and tunnels: the road's cross section as a translucent volume with a solid edge */
export const STRUCTURE = {
  bridgeFill: [16, 124, 234, 72] as Rgba, bridgeEdge: [16, 124, 234, 230] as Rgba, //   sky-500 #107cea
  tunnelFill: [88, 120, 166, 72] as Rgba, tunnelEdge: [88, 120, 166, 220] as Rgba, //   haze-600 #5878a6
  selectedFill: [30, 155, 255, 120] as Rgba,
};

/** overlays: saturated mid-light hues that occur in no basemap; one meaning each */
export const OVERLAY = {
  selected: [30, 155, 255, 255] as Rgba, //          #1e9bff
  hover: [255, 255, 255, 60] as Rgba, //             deck autoHighlight
  junctionFill: [245, 184, 74, 70] as Rgba, junctionFillApprox: [245, 184, 74, 38] as Rgba, junctionEdge: [245, 184, 74, 230] as Rgba,
  // virtual junctions (1.8.0 §12.5: a logical junction on a through road, no physical intersection): iris, hatched
  virtualFill: [124, 92, 255, 140] as Rgba, virtualFillApprox: [124, 92, 255, 90] as Rgba, virtualEdge: [124, 92, 255, 235] as Rgba, // #7c5cff
  crossPath: [0, 229, 255, 235] as Rgba, //   #00e5ff
  junctionRef: [255, 77, 0, 255] as Rgba, // vermilion #ff4d00
  elevation: [80, 220, 200, 255] as Rgba, elevationLine: [80, 220, 200, 200] as Rgba,
  compare: [255, 64, 200, 235] as Rgba, //           magenta: comparison B only
  refLine: [208, 255, 20, 230] as Rgba, //      chartreuse #d0ff14: road reference lines (drawn on the lanes: 3.1:1 on light, 6.5:1 on dark driving)
  buildingFill: "#ffb347", buildingEdge: "#ff9f1c",
};

/**
 * How a junction area is drawn. Hue says what it is: amber = a real junction (default, direct, crossing), iris = virtual.
 * Fill form says it too: real = solid tint, virtual = 45° hatch (so it reads on any lane or ground and in every vision mode).
 * Line style says where the outline comes from: solid = the file's <boundary>, dashed = the approximate hull.
 * Selected: 3px edge in OVERLAY.selected, fill tinted selected; the type keeps its fill form.
 */
export const JUNCTION = {
  kind: (type: string): "real" | "virtual" => (type.toLowerCase() === "virtual" ? "virtual" : "real"),
  edgeWidth: 2, edgeWidthSelected: 3, approxDash: [4, 3] as [number, number],
  hatch: { angle: 45, line: 3, gap: 5 }, // px: stripes of the iris fill colour (FillStyleExtension pattern, or a stripe texture)
  label: { real: "junction", virtual: "virtual junction" },
};

/** thin edges and halos, per theme */
export const EDGE = {
  laneDark: [6, 17, 42, 90] as Rgba, laneLight: [15, 34, 54, 70] as Rgba, // lane outlines: night / ink at ~30%
  ring: [10, 16, 23, 255] as Rgba, //                                          marker halo (1.5px), every marker
  ringSelected: [255, 255, 255, 255] as Rgba, //                               selected marker halo (2.5px)
};

/** OSM 3D buildings: context, so they recede into each theme's ground */
export const BUILDING = { light: "#d5dde6", dark: "#24324a", opacity: 0.85 };

/** review markers (flags, findings) and the 2D signal / object dots */
export const MARKER = {
  flag: { open: [242, 181, 68, 255], fixed: [124, 201, 90, 255], question: [92, 182, 242, 255], wontfix: [140, 146, 158, 255] } as Record<string, Rgba>,
  finding: { error: [255, 106, 92, 240], warning: [255, 170, 60, 230], info: [92, 182, 242, 220] } as Record<string, Rgba>,
  dot: { light: SIGNAL.green, sign: SIGNAL.signWhite, stop: SIGNAL.signStop, object: ASSET.object },
  /** radii in px: flags 7 (+3 when selected), findings 5 (+3); dots 0.7 m clamped to 0.5–7 px */
  flagRadius: 7, findingRadius: 5, selectedGrow: 3, ringWidth: 1.5, ringWidthSelected: 2.5,
};

/** billboard labels (sign text, flag numbers): ink on a white pill, never bare text on the map */
export const LABEL = {
  ink: [15, 34, 54, 255] as Rgba, //        haze-ink #0f2236
  background: [255, 255, 255, 235] as Rgba,
  padding: [4, 2] as [number, number], borderRadius: 4, size: 12, sizeMaxPixels: 16, flagSize: 11,
  fontFamily: "Inter, system-ui, sans-serif", fontWeight: 600, flagOffset: [10, -10] as [number, number],
};

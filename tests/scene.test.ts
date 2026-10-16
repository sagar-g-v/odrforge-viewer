// Guards the design system's map palette (docs/design-system.md §8): every colour the map layers, the legend and the 3D
// features draw comes from src/design/scene.ts (or the lane palette), so the map and its legend cannot drift apart.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASSET, MARK, MARKER, OVERLAY, SIGNAL, TREE } from "../src/design/scene";

const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
// allowed literals: fully transparent (hidden feature), basemap backgrounds (the tiles' land colour) and the dim layer
const OK_RGBA = new Set(["[0, 0, 0, 0]"]);
const OK_HEX = new Set(["#0b0d10", "#f2efe9", "#f8f4f0", "#06112a", "#e8f2fb", "#000000", "#f5f7fa", "#45607b", "#1a1c20", "#eb3434", "#f5aa28", "#2ecc62"]);

describe("map colours come from the scene palette", () => {
  for (const f of ["map/MapView.tsx", "components/Legend.tsx", "xodr/features.ts", "xodr/build.ts"]) {
    it(`${f}: no literal RGBA or hex colours outside the palette`, () => {
      // the OpenStreetMap legend shows the basemap's own key (OSM Carto colours), not the viewer's palette
      const src = f === "components/Legend.tsx" ? read(f).split("/** OpenStreetMap Carto")[0] : read(f);
      const rgba = [...src.matchAll(/\[\d{1,3}, \d{1,3}, \d{1,3}, \d{1,3}\]/g)].map((m) => m[0]).filter((m) => !OK_RGBA.has(m));
      const hex = [...src.matchAll(/["']#[0-9a-fA-F]{6}["']/g)].map((m) => m[0].slice(1, -1).toLowerCase()).filter((h) => !OK_HEX.has(h));
      expect({ rgba, hex }).toEqual({ rgba: [], hex: [] });
    });
  }
  it("the palette keeps the design's meanings: regulatory colours, the logo tree, one hue per overlay", () => {
    expect(SIGNAL.signStop).toEqual([204, 32, 40, 255]);
    expect(MARK.yellow.slice(0, 3)).toEqual([245, 196, 66]);
    expect(ASSET.crown.slice(0, 3)).toEqual([88, 135, 33]); // meadow-600
    expect(TREE.top.radius).toBeGreaterThan(TREE.side.radius);
    expect(OVERLAY.selected).toEqual([30, 155, 255, 255]);
    expect(MARKER.flag.open).not.toEqual(MARKER.finding.error);
    const hues = [OVERLAY.selected, OVERLAY.junctionEdge, OVERLAY.crossPath, OVERLAY.junctionRef, OVERLAY.elevation, OVERLAY.compare].map((c) => c.slice(0, 3).join());
    expect(new Set(hues).size).toBe(hues.length);
  });
});

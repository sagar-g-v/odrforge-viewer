// "Map" is the theme's map (docs/design-system.md §3): dark theme = the near-black vector map, light = OpenStreetMap.
// Guards the dark theme being dark: the Map button once showed the light OSM raster under the dark UI and lane palette.
import { describe, expect, it } from "vitest";
import { concreteBasemap, storedBasemap } from "../src/map/basemap";

describe("basemap", () => {
  it("Map follows the theme", () => {
    expect(concreteBasemap("map", "dark")).toBe("dark");
    expect(concreteBasemap("map", "light")).toBe("osm");
  });
  it("explicit choices stay as chosen in both themes", () => {
    for (const b of ["osm", "dark", "positron", "satellite-live", "carto-dark", "none"] as const)
      for (const t of ["dark", "light"] as const) expect(concreteBasemap(b, t)).toBe(b);
  });
  it("the old stored Map button choice (osm) becomes the theme's map", () => {
    expect(storedBasemap(null, "osm")).toBe("map");
    expect(storedBasemap(null, null)).toBe("map");
    expect(storedBasemap(null, "satellite-live")).toBe("satellite-live");
    expect(storedBasemap("osm", "osm")).toBe("osm");
  });
});

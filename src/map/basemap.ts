// Basemaps. "map" is the theme's own map (docs/design-system.md §3: lanes are tuned for "the OSM Carto raster" in the
// light theme and "the dark vector map: near black" in the dark one): the light theme draws OpenStreetMap, the dark theme
// a near-black vector map. The others are explicit choices and do not change with the theme.
export type Basemap = "map" | "osm" | "liberty" | "positron" | "dark" | "carto" | "carto-raster" | "carto-dark" | "satellite" | "satellite-live" | "none";
export type ConcreteBasemap = Exclude<Basemap, "map">;

export function concreteBasemap(b: Basemap, theme: "dark" | "light"): ConcreteBasemap {
  return b === "map" ? (theme === "dark" ? "dark" : "osm") : b;
}

/** the stored choice; before "map" existed the top bar's Map button stored "osm" (key odrv.basemap) */
export function storedBasemap(v2: string | null, v1: string | null): Basemap {
  if (v2) return v2 as Basemap;
  return !v1 || v1 === "osm" ? "map" : (v1 as Basemap);
}

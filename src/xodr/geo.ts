// File coordinates <-> WGS84 through the file's <geoReference> (a PROJ string, 1.8.0 §6.4; e.g. +proj=tmerc ...).
// Without one the network is placed at 0°/0° on a local tangent plane (no map underneath is meaningful then).
import proj4 from "proj4";

export interface Projector {
  georeferenced: boolean;
  forward: (x: number, y: number) => [number, number];
  inverse: (lon: number, lat: number) => [number, number];
}

const R = 6378137;

/** the problem to report when a file's geoReference is given but cannot be used (drawn on the local plane); else null */
export function geoReferenceIssue(geoReference: string, proj: Projector): string | null {
  const g = geoReference.trim();
  if (!g || proj.georeferenced) return null;
  return `geoReference not usable ("${g.length > 60 ? g.slice(0, 60) + "…" : g}"): drawn on a local plane at 0° N 0° E, not at its real location`;
}

export function makeProjector(geoReference: string): Projector {
  const def = geoReference.trim();
  if (def.startsWith("+proj") || def.startsWith("EPSG:")) {
    try {
      const conv = proj4(def, "EPSG:4326");
      conv.forward([0, 0]); // throws on an unusable definition
      return {
        georeferenced: true,
        forward: (x, y) => conv.forward([x, y]) as [number, number],
        inverse: (lon, lat) => conv.inverse([lon, lat]) as [number, number],
      };
    } catch {
      /* fall through to the local plane */
    }
  }
  return {
    georeferenced: false,
    forward: (x, y) => [(x / R) * (180 / Math.PI), (y / R) * (180 / Math.PI)],
    inverse: (lon, lat) => [(lon * Math.PI * R) / 180, (lat * Math.PI * R) / 180],
  };
}

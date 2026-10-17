/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** CARTO basemaps key (environment variable CARTO_MAP_API); the CARTO basemaps are offered only when it is set */
  readonly CARTO_MAP_API?: string;
}

// earcut 2.2.4 (the triangulator deck.gl's SolidPolygonLayer uses) ships no types
declare module "earcut" {
  export default function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number> | null, dim?: number): number[];
}

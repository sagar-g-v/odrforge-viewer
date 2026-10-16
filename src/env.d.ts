/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** CARTO basemaps key (environment variable CARTO_MAP_API); the CARTO basemaps are offered only when it is set */
  readonly CARTO_MAP_API?: string;
}

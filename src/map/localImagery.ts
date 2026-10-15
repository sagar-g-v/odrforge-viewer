// Offline HD orthophotos made by OdrForge's tools/make_basemap.py, served next to the network by the review server:
// <dir>/basemap.json lists image pyramids in the network's own metric frame (file x / y): top-left corner (x0, y1),
// metres per pixel `res` at level 0, square tiles of `tile` px, tile k/i_j.ext = level k, column i, row j from the top.
import type { Projector } from "../xodr/geo";

export interface PyramidLevel { nx: number; ny: number; w: number; h: number; }
export interface Pyramid {
  id: string; name: string; dir: string; ext: string; x0: number; y1: number; res: number; tile: number;
  levels: PyramidLevel[]; attribution?: string;
}
export interface LocalImagery { base: string; satellite: Pyramid | null; map: Pyramid | null; }

export interface ImageTile { id: string; url: string; bounds: [number, number][]; } // corners: BL, TL, TR, BR (lon, lat)

async function tryJson(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** the basemap folder of a network on the review server: <page>_basemap, the page without "_standard", or the folder
 *  the network's OdrForge viewer page names (DATA.basemap.dir) */
export async function findLocalImagery(server: string, page: string): Promise<LocalImagery | null> {
  const root = server.replace(/\/$/, "");
  const candidates = [`${page}_basemap`, `${page.replace(/_standard$/, "")}_basemap`];
  try {
    const r = await fetch(`${root}/${encodeURIComponent(page)}.html`, { cache: "no-store" });
    if (r.ok) {
      const m = (await r.text()).match(/"basemap":\{"dir":"([^"]+)"/);
      if (m) candidates.push(m[1].replace(/^\.\//, ""));
    }
  } catch { /* no viewer page */ }
  for (const dir of [...new Set(candidates)]) {
    const meta = (await tryJson(`${root}/${dir}/basemap.json`)) as { layers?: Pyramid[] } | null;
    if (!meta?.layers?.length) continue;
    return {
      base: `${root}/${dir}`,
      satellite: meta.layers.find((l) => l.id !== "map") ?? null,
      map: meta.layers.find((l) => l.id === "map") ?? null,
    };
  }
  return null;
}

/**
 * The tiles to draw for a view: the coarsest level that still has at least one image pixel per screen pixel
 * (metresPerPixel), only tiles inside the view (file-coordinate box), each placed by its four projected corners.
 */
export function visibleTiles(img: LocalImagery, p: Pyramid, proj: Projector, view: [number, number, number, number],
  metresPerPixel: number, maxTiles = 160): ImageTile[] {
  let lv = 0;
  while (lv + 1 < p.levels.length && p.res * 2 ** (lv + 1) <= metresPerPixel) lv++;
  for (; lv < p.levels.length; lv++) {
    const L = p.levels[lv], r = p.res * 2 ** lv, T = p.tile * r;
    const i0 = Math.max(0, Math.floor((view[0] - p.x0) / T)), i1 = Math.min(L.nx - 1, Math.floor((view[2] - p.x0) / T));
    const j0 = Math.max(0, Math.floor((p.y1 - view[3]) / T)), j1 = Math.min(L.ny - 1, Math.floor((p.y1 - view[1]) / T));
    if (i1 < i0 || j1 < j0) return [];
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > maxTiles && lv + 1 < p.levels.length) continue; // too many: a coarser level
    const out: ImageTile[] = [];
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const wPx = Math.min(p.tile, L.w - i * p.tile), hPx = Math.min(p.tile, L.h - j * p.tile); // edge tiles are smaller
        const x0 = p.x0 + i * T, x1 = x0 + wPx * r, yTop = p.y1 - j * T, yBot = yTop - hPx * r;
        out.push({
          id: `${p.id}/${lv}/${i}_${j}`,
          url: `${img.base}/${p.dir}/${lv}/${i}_${j}.${p.ext}`,
          bounds: [proj.forward(x0, yBot), proj.forward(x0, yTop), proj.forward(x1, yTop), proj.forward(x1, yBot)],
        });
      }
    return out;
  }
  return [];
}

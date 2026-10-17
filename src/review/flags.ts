// Review flags, compatible with OdrForge's review server (tools/inspect/viz_server.py) and tools/inspect/flags.py:
// GET / POST <server>/<page>.flags.json. The viewer owns the fields below; status, reply and resolved belong to
// flags.py and are never sent (the server keeps them on merge). Flags are never removed, only marked deleted.

export const VIEWER_FIELDS = ["id", "x", "y", "road", "lane", "laneType", "junction", "s", "category", "note", "created", "deleted"] as const;

export type FlagStatus = "open" | "fixed" | "question" | "wontfix";

export interface Flag {
  id: number;
  x: number; y: number; // file (inertial) coordinates, m
  road: string | null; lane: number | null; laneType: string | null; junction: string | null; s: number | null;
  category: string; note: string; created: string; deleted?: boolean;
  status?: FlagStatus; reply?: string; resolved?: string;
  source?: string; // "llm-review": appended by OdrForge llm_review.py merge --as-flags (ids from 1001); absent: made by you
}

/** a flag the LLM review appended to the flags file (not one you made) */
export const isReviewFlag = (f: Flag) => f.source === "llm-review";
export interface FlagSources { mine: boolean; review: boolean }

export const CATEGORIES: [string, string][] = [
  ["geometry", "Wrong geometry / shape"],
  ["lanes", "Wrong lanes (count, type, width)"],
  ["connection", "Wrong or missing connection / turn"],
  ["junction", "Junction area / boundary"],
  ["missing", "Something missing"],
  ["signal", "Signal, sign or marking"],
  ["elevation", "Elevation / slope"],
  ["other", "Other"],
];

export interface FlagStore {
  kind: "server" | "browser";
  load(): Promise<Flag[]>;
  save(flags: Flag[]): Promise<Flag[]>;
}

const viewerPart = (f: Flag) => Object.fromEntries(VIEWER_FIELDS.filter((k) => k in f).map((k) => [k, f[k]]));

export function serverStore(server: string, page: string): FlagStore {
  const url = `${server.replace(/\/$/, "")}/${encodeURIComponent(page)}.flags.json`;
  return {
    kind: "server",
    async load() {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`flags: HTTP ${r.status}`);
      return ((await r.json()).flags ?? []) as Flag[];
    },
    async save(flags) {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flags: flags.map(viewerPart) }),
      });
      if (!r.ok) throw new Error(`flags: HTTP ${r.status}`);
      return ((await r.json()).flags ?? []) as Flag[];
    },
  };
}

export function browserStore(page: string): FlagStore {
  const key = `odrforge-viewer.flags.${page}`;
  return {
    kind: "browser",
    async load() {
      try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
    },
    async save(flags) {
      try { localStorage.setItem(key, JSON.stringify(flags)); } catch { /* private window: kept in memory */ }
      return flags;
    },
  };
}

export const nextFlagId = (flags: Flag[]) => flags.reduce((m, f) => Math.max(m, f.id), 0) + 1;

// Build provenance: which converter build produced the open page, from the <file>.metrics.json (e.g. munich_standard.xodr.metrics.json) the OdrForge gate writes
// next to it (tools/inspect/gate.py, metrics.py). The snapshot's numbers are shown only when it provably describes the
// bytes the viewer loaded: its sha256 equals theirs (or, for a snapshot without a hash, the same size and modification
// time). Anything else is another build's snapshot: it is reported as a mismatch and its numbers are never shown.
// Guarded by tests/provenance.test.ts.

/** the file the viewer loaded from the review server */
export interface PageSource {
  file: string; // file name, e.g. munich_standard.xodr
  sha256: string; // hex, of the exact bytes fetched
  bytes: number;
  lastModified: string | null; // HTTP Last-Modified of the fetch
}

/** <file>.metrics.json (schema 1) */
export interface PageMetrics {
  schema: number; label: string; time: string; commit: string; osm2xodr_built: string | null; folder: string | null;
  file: string; sha256?: string; bytes?: number; mtime?: string;
  metrics: Record<string, number | string | null>;
}

export interface BuildFacts {
  commit: string; // without "+dirty"
  dirty: boolean; // built from a working tree with uncommitted changes
  runTime: string; // the gate run that wrote the page
  binaryBuilt: string | null; // when the converter binary was built
  folder: string | null;
  label: string;
  by: "sha256" | "size+mtime"; // how the snapshot was tied to the page
  centreP95: number | null; conformedP95: number | null; conformedP99: number | null; decksWithin05: number | null;
}

export type Provenance =
  | { status: "local" } // opened from disk: no build record
  | { status: "none" } // no metrics for this build
  | { status: "invalid"; reason: string }
  // pageNewer: the page was written after the run that wrote the record (a build still converting, its record not yet
  // written): "metrics pending", not "another build"; the numbers stay hidden either way
  | { status: "mismatch"; reasons: string[]; snapshotTime: string | null; pageNewer: boolean }
  | { status: "unverified"; reason: string }
  | { status: "match"; facts: BuildFacts };

const MTIME_TOLERANCE_S = 2; // HTTP dates have whole seconds; file systems round differently

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** seconds since the epoch of an ISO time (local time when it has no zone, as Python's isoformat writes) or an HTTP date */
function epoch(t: string | null | undefined): number | null {
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

/** ties a parsed <file>.metrics.json to the loaded page; see the file comment for the rule */
export function matchProvenance(raw: unknown, src: PageSource): Provenance {
  if (raw === null || raw === undefined) return { status: "none" };
  if (typeof raw !== "object") return { status: "invalid", reason: "not a JSON object" };
  const m = raw as Partial<PageMetrics>;
  if (m.schema !== 1) return { status: "invalid", reason: `unknown schema ${String(m.schema)}` };
  if (typeof m.commit !== "string" || typeof m.time !== "string" || typeof m.file !== "string" || !m.metrics || typeof m.metrics !== "object")
    return { status: "invalid", reason: "commit, time, file or metrics missing" };

  const reasons: string[] = [];
  if (m.file !== src.file) reasons.push(`it describes ${m.file}, not ${src.file}`);
  let by: BuildFacts["by"] | null = null;
  if (typeof m.sha256 === "string" && m.sha256) {
    if (m.sha256.toLowerCase() === src.sha256.toLowerCase()) by = "sha256";
    else reasons.push("the file's content differs (sha256)");
  } else if (typeof m.bytes === "number" && m.mtime && src.lastModified) {
    const a = epoch(m.mtime), b = epoch(src.lastModified);
    if (m.bytes !== src.bytes) reasons.push(`the file's size differs (${m.bytes.toLocaleString()} vs ${src.bytes.toLocaleString()} bytes)`);
    else if (a === null || b === null) return { status: "unverified", reason: "the modification times cannot be read" };
    else if (Math.abs(a - b) > MTIME_TOLERANCE_S) reasons.push("the file was written at another time than the run recorded");
    else by = "size+mtime";
  } else if (!reasons.length) {
    return { status: "unverified", reason: "the snapshot has no sha256 (or size and time) to tie it to this file" };
  }
  if (reasons.length || !by) {
    const page = epoch(src.lastModified), run = epoch(m.time);
    return { status: "mismatch", reasons, snapshotTime: m.time, pageNewer: page !== null && run !== null && page > run + MTIME_TOLERANCE_S };
  }

  const x = m.metrics;
  return {
    status: "match",
    facts: {
      commit: m.commit.replace(/\+dirty$/, ""), dirty: /\+dirty$/.test(m.commit), runTime: m.time, binaryBuilt: m.osm2xodr_built ?? null,
      folder: m.folder ?? null, label: m.label ?? "", by,
      centreP95: num(x["terrain:centre_p95"]), conformedP95: num(x["terrain:conformed_p95"]), conformedP99: num(x["terrain:conformed_p99"]),
      decksWithin05: num(x["terrain:decks_within_0.5m"]),
    },
  };
}

/** hex sha256 of bytes (Web Crypto) */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** <file>.metrics.json from the review server (file = the page's .xodr name): null when there is none (404), an Error for anything else */
export async function fetchPageMetrics(server: string, file: string): Promise<unknown | null> {
  const r = await fetch(`${server.replace(/\/$/, "")}/${encodeURIComponent(file)}.metrics.json`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${file}.metrics.json`);
  return r.json();
}

/** a fit in metres: millimetres below 0.1 m (a 2 mm fit must not read as "0.00 m"), centimetres above */
export const metres = (v: number | null) => (v === null ? "–" : `${v.toFixed(Math.abs(v) < 0.1 ? 3 : 2)} m`);

/** "2026-10-17T05:13:27" -> "2026-10-17 05:13" */
export const shortTime = (t: string | null) => (t ? t.replace("T", " ").slice(0, 16) : "–");

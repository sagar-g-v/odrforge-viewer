// LLM review of a generated network: <page>.review.json beside the page (OdrForge tools/inspect/llm_review.py merge,
// schema 1, docs/LLM_REVIEW.md in the OdrForge repo). Read-only: the reviewer's findings are shown next to the hand-made
// flags, never mixed into them. Whether the review describes the open page is decided here, by the sha256 of the bytes
// the viewer loaded (the record's own matches_current_output describes the folder when it was written, not this page).
// Guarded by tests/llmReview.test.ts.
import type { Flag } from "./flags";

export type Severity = "critical" | "major" | "minor" | "info";
export type Verdict = "defect" | "uncertain" | "legitimate";
export const SEVERITIES: Severity[] = ["critical", "major", "minor", "info"];
export const PERSPECTIVES = ["car", "pedestrian", "wheelchair", "cyclist", "simulator", "visual", "logical"] as const;

export interface ReviewItem {
  key: string; // "f12" (flags) or "l3" (legitimate): ids are numbered separately in the two lists
  id: number; x: number; y: number; road: string | null; lane: number | null; junction: string | null; s: number | null;
  category: string; note: string; verdict: Verdict; kind: string; severity: Severity; perspective: string[];
  osmWays: string[]; evidence: string[]; reasoning: string; spec: string; confidence: number | null;
}

export interface ReviewFile {
  file: string; sha256: string; reviewed: string; promptVersion: string; odrforgeVersion: string;
  reviewers: number; chunksReviewed: number; chunksTotal: number;
  items: ReviewItem[]; // flags first, then legitimate
}

export type ReviewLoad =
  | { status: "none" } // no review for this page
  | { status: "invalid"; reason: string }
  | { status: "ok"; review: ReviewFile; sameBuild: boolean };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown) => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null);
const strList = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
const count = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === "number" ? v : 0);

function item(raw: Record<string, unknown>, list: "f" | "l"): ReviewItem | null {
  const x = numOrNull(raw.x), y = numOrNull(raw.y), id = numOrNull(raw.id);
  if (x === null || y === null || id === null) return null; // a finding the map cannot place is not shown
  const sev = SEVERITIES.includes(raw.severity as Severity) ? (raw.severity as Severity) : "info";
  const verdict: Verdict = raw.verdict === "defect" || raw.verdict === "uncertain" ? raw.verdict : list === "l" ? "legitimate" : "uncertain";
  return {
    key: `${list}${id}`, id, x, y, road: strOrNull(raw.road), lane: numOrNull(raw.lane), junction: strOrNull(raw.junction), s: numOrNull(raw.s),
    category: str(raw.category) || "other", note: str(raw.note), verdict, kind: str(raw.kind), severity: sev,
    perspective: strList(raw.perspective), osmWays: strList(raw.osm_ways), evidence: strList(raw.evidence),
    reasoning: str(raw.reasoning), spec: str(raw.spec), confidence: numOrNull(raw.confidence),
  };
}

/** a parsed review tied to the loaded page; `pageSha256` null for a page without a known hash (then not the same build) */
export function readReview(raw: unknown, pageSha256: string | null): ReviewLoad {
  if (raw === null || raw === undefined) return { status: "none" };
  if (typeof raw !== "object") return { status: "invalid", reason: "not a JSON object" };
  const r = raw as Record<string, unknown>;
  if (r.schema !== 1 || r.source !== "llm-review") return { status: "invalid", reason: `not an LLM review record (schema ${String(r.schema)}, source ${String(r.source)})` };
  if (!Array.isArray(r.flags) || !Array.isArray(r.legitimate)) return { status: "invalid", reason: "flags or legitimate missing" };
  const items = [
    ...(r.flags as Record<string, unknown>[]).map((f) => item(f, "f")),
    ...(r.legitimate as Record<string, unknown>[]).map((f) => item(f, "l")),
  ].filter((i): i is ReviewItem => i !== null);
  const review: ReviewFile = {
    file: str(r.file), sha256: str(r.sha256).toLowerCase(), reviewed: str(r.reviewed), promptVersion: str(r.prompt_version),
    odrforgeVersion: str(r.odrforge_version), reviewers: count(r.reviewers), chunksReviewed: count(r.chunks_reviewed), chunksTotal: count(r.chunks_total),
    items,
  };
  return { status: "ok", review, sameBuild: !!pageSha256 && review.sha256 === pageSha256.toLowerCase() };
}

/** <page>.review.json on the review server; null when there is none */
export async function fetchReview(server: string, page: string): Promise<unknown | null> {
  const r = await fetch(`${server.replace(/\/$/, "")}/${encodeURIComponent(page)}.review.json`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${page}.review.json`);
  return r.json();
}

export interface ReviewFilter { severities: Set<Severity>; perspectives: Set<string>; legitimate: boolean }
export const DEFAULT_FILTER = (): ReviewFilter => ({ severities: new Set(SEVERITIES), perspectives: new Set(PERSPECTIVES), legitimate: false });

/** the items shown: legitimate only on request; severity in the set; at least one perspective in the set (or none given) */
export function filterReview(items: ReviewItem[], f: ReviewFilter): ReviewItem[] {
  return items.filter((i) => (i.verdict !== "legitimate" || f.legitimate) && f.severities.has(i.severity)
    && (!i.perspective.length || i.perspective.some((p) => f.perspectives.has(p))));
}

/**
 * Roads of the open build that carry one of the item's OSM ways (road userData osmWays): road ids change between builds,
 * OSM ways do not, so a review of an older build is located by them.
 */
export function roadsByOsm(osmWays: string[], roads: { id: string; userData: { code: string; value: string }[] }[]): string[] {
  if (!osmWays.length) return [];
  const want = new Set(osmWays);
  return roads.filter((r) => r.userData.some((u) => u.code === "osmWays" && u.value.split(",").some((w) => want.has(w.trim())))).map((r) => r.id);
}

/**
 * Review items already in the flags file (llm_review.py merge --as-flags appends them as flags from id 1001): the item's key ->
 * the flag's id. Matched by position (to the millimetre) and the reviewer's note inside the flag's note.
 */
export function reviewItemsAsFlags(items: ReviewItem[], flags: Flag[]): Map<string, number> {
  const at = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
  const byPos = new Map<string, Flag[]>();
  for (const f of flags) if (f.source === "llm-review" && !f.deleted) (byPos.get(at(f.x, f.y)) ?? byPos.set(at(f.x, f.y), []).get(at(f.x, f.y))!).push(f);
  const out = new Map<string, number>();
  for (const i of items) {
    const f = byPos.get(at(i.x, i.y))?.find((q) => !i.note || q.note.includes(i.note));
    if (f) out.set(i.key, f.id);
  }
  return out;
}

/**
 * A hand-made flag drafted from a review item ("Flag this"): the reviewer's note plus where it came from, at the item's
 * position (file metres, valid across builds). On another build the road comes from the item's OSM ways and the lane,
 * junction and s are left out (they belong to the reviewed build). The user edits and saves it like any flag.
 */
export function flagFromReview(i: ReviewItem, id: number, sameBuild: boolean, roads: Parameters<typeof roadsByOsm>[1], categories: string[]): Flag {
  const road = sameBuild ? i.road : roadsByOsm(i.osmWays, roads)[0] ?? null;
  const tag = `[LLM review #${i.id} · ${i.verdict === "legitimate" ? "legitimate" : i.severity}${i.verdict === "uncertain" ? ", uncertain" : ""} · ${i.kind || i.category}`
    + `${i.osmWays.length ? ` · OSM ${i.osmWays.join(", ")}` : ""}${sameBuild ? "" : " · reviewed on another build"}]`;
  return {
    id, x: i.x, y: i.y, road, lane: sameBuild ? i.lane : null, laneType: null, junction: sameBuild ? i.junction : null, s: sameBuild ? i.s : null,
    category: categories.includes(i.category) ? i.category : "other", note: `${i.note}\n${tag}`, created: new Date().toISOString(), status: "open",
  };
}

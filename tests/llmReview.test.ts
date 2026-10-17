// The LLM review record (<page>.review.json, schema 1): read-only items, tied to the loaded page by sha256, located in a
// newer build by OSM ways, filtered by severity and perspective, legitimate items hidden by default.
import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER, filterReview, readReview, roadsByOsm } from "../src/review/llmReview";

const flag = (o: Record<string, unknown>) => ({ x: 1, y: 2, road: "635", lane: -1, laneType: null, junction: null, s: 0, category: "connection",
  note: "n", created: "t", source: "llm-review", verdict: "defect", kind: "missing_turn", severity: "major", perspective: ["car"], osm_ways: ["350848866"],
  evidence: ["e1"], reasoning: "r", spec: "1.8.0 12", confidence: 0.85, id: 1, status: "open", ...o });
const RAW = {
  schema: 1, source: "llm-review", file: "munich_standard.xodr", sha256: "ABC", matches_current_output: true, prompt_version: "1.0.0",
  odrforge_version: "0.6.0", reviewed: "2026-10-17T06:11:15+00:00", reviewers: 1, chunks_reviewed: 6, chunks_total: 6,
  flags: [flag({}), flag({ id: 2, severity: "minor", perspective: ["pedestrian"], verdict: "uncertain" }), flag({ id: 3, x: null })],
  legitimate: [flag({ id: 1, verdict: "legitimate", severity: "info" })], rejected: [],
};

describe("LLM review record", () => {
  it("reads flags and legitimate items with separate keys; an item without a position is dropped", () => {
    const r = readReview(RAW, "abc");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.review.items.map((i) => i.key)).toEqual(["f1", "f2", "l1"]);
    expect(r.review.items[0]).toMatchObject({ road: "635", osmWays: ["350848866"], evidence: ["e1"], confidence: 0.85, verdict: "defect" });
    expect(r.review.chunksTotal).toBe(6);
  });
  it("is the same build only when the sha256 matches the loaded bytes, whatever matches_current_output says", () => {
    expect(readReview(RAW, "abc")).toMatchObject({ sameBuild: true });
    expect(readReview(RAW, "def")).toMatchObject({ sameBuild: false });
    expect(readReview({ ...RAW, matches_current_output: false }, "abc")).toMatchObject({ sameBuild: true });
    expect(readReview(RAW, null)).toMatchObject({ sameBuild: false });
  });
  it("none, or invalid for another kind of record", () => {
    expect(readReview(null, "abc")).toEqual({ status: "none" });
    expect(readReview({ ...RAW, schema: 2 }, "abc").status).toBe("invalid");
    expect(readReview({ schema: 1, source: "llm-review" }, "abc").status).toBe("invalid");
  });
  it("filters: legitimate hidden by default; severity and perspective narrow the list", () => {
    const r = readReview(RAW, "abc");
    if (r.status !== "ok") throw new Error();
    const items = r.review.items;
    expect(filterReview(items, DEFAULT_FILTER()).map((i) => i.key)).toEqual(["f1", "f2"]);
    expect(filterReview(items, { ...DEFAULT_FILTER(), legitimate: true }).map((i) => i.key)).toEqual(["f1", "f2", "l1"]);
    expect(filterReview(items, { ...DEFAULT_FILTER(), severities: new Set(["major"] as const) }).map((i) => i.key)).toEqual(["f1"]);
    expect(filterReview(items, { ...DEFAULT_FILTER(), perspectives: new Set(["pedestrian"]) }).map((i) => i.key)).toEqual(["f2"]);
  });
  it("locates an item in the open build by its OSM ways", () => {
    const roads = [{ id: "700", userData: [{ code: "osmWays", value: "1,350848866" }] }, { id: "701", userData: [{ code: "osmWays", value: "35084886" }] }];
    expect(roadsByOsm(["350848866"], roads)).toEqual(["700"]);
    expect(roadsByOsm([], roads)).toEqual([]);
  });
});

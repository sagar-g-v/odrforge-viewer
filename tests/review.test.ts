import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFindings } from "../src/review/findings";
import { nextFlagId, VIEWER_FIELDS, type Flag } from "../src/review/flags";
import { extractExport } from "../src/xodr/odrforgeExport";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

describe("checker findings", () => {
  it("ASAM qc-opendrive .xqar: one finding per issue with an inertial location", () => {
    const fs = parseFindings("munich.xqar", fixture("munich_sample.xqar"));
    expect(fs).toHaveLength(40);
    expect(fs[0].rule).toBe("road.geometry.contact_point");
    expect(fs[0].source).toBe("ASAM qc");
    expect(Number.isFinite(fs[0].x) && Number.isFinite(fs[0].y)).toBe(true);
  });
  it("OdrForge invariants.json: every instance with x / y, MUST rules as errors", () => {
    const fs = parseFindings("invariants.json", fixture("munich_invariants_sample.json"));
    expect(fs.length).toBe(76);
    expect(new Set(fs.map((f) => f.rule)).has("G2_lane")).toBe(true);
    expect(fs.every((f) => f.source === "invariants")).toBe(true);
  });
});

describe("review flags", () => {
  it("ids continue after the highest, deleted flags included", () => {
    const f = (id: number, deleted = false) => ({ id, deleted }) as Flag;
    expect(nextFlagId([])).toBe(1);
    expect(nextFlagId([f(2), f(7, true), f(3)])).toBe(8);
  });
  it("the viewer owns exactly the fields viz_server.py merges (VIEWER_FIELDS)", () => {
    expect([...VIEWER_FIELDS]).toEqual(["id", "x", "y", "road", "lane", "laneType", "junction", "s", "category", "note", "created", "deleted"]);
  });
});

describe("OdrForge export", () => {
  it("finds the DATA object in a page and ignores braces inside strings", () => {
    const page = `<script>const DATA={"title":"a } b","roads":[["1","x { y","-1",10]],"n":[1,[2]]};\nconst X=1;</script>`;
    const d = extractExport(page) as { title: string; n: unknown[] };
    expect(d.title).toBe("a } b");
    expect(d.n).toEqual([1, [2]]);
  });
});

// Guards docs/ACCURACY.md §3: coplanar layers keep the file's heights and are ordered only by depth bias.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DRAW_ORDER, depthBias } from "../src/map/drawOrder";

describe("draw order of coplanar layers (depth bias, nothing moved)", () => {
  const o = DRAW_ORDER;
  it("junction area under the lanes, objects and arrows on the lanes, paint over them, overlays on top", () => {
    expect(o["junctions"]).toBeLessThan(o["lanes"]);
    expect(o["lanes"]).toBeLessThan(o["objects"]);
    expect(o["lanes"]).toBeLessThan(o["lane-directions"]);
    expect(o["lane-directions"]).toBeLessThan(o["marks"]);
    expect(o["marks"]).toBeLessThan(o["junction-outlines"]);
    expect(o["refs"]).toBeLessThan(o["cmp-lanes"]);
  });
  it("a negative polygon offset pulls the layer towards the camera; an unknown layer is an error, not a silent default", () => {
    expect(depthBias("marks")).toEqual({ depthBias: -o["marks"], depthBiasSlopeScale: -o["marks"] });
    expect(() => depthBias("nope")).toThrow();
  });
  it("MapView gives every coplanar layer its place and no layer a lift: no modelMatrix translate, no z offsets", () => {
    const src = readFileSync(new URL("../src/map/MapView.tsx", import.meta.url), "utf8");
    for (const id of Object.keys(o)) expect(src).toContain(`depthBias("${id}")`);
    expect(src).not.toMatch(/\.translate\(\[0, 0,/); // the old +0.3 m outline matrix
    expect(src).not.toMatch(/bias\(\d/);
  });
  it("each layer takes its own place: the depthBias id inside a layer is that layer's id", () => {
    const src = readFileSync(new URL("../src/map/MapView.tsx", import.meta.url), "utf8");
    const pairs: [string, string][] = [];
    for (const m of src.matchAll(/new \w+Layer\(\{\s*id: "([a-z0-9-]+)"/g)) {
      const rest = src.slice(m.index! + m[0].length), next = rest.search(/new \w+Layer\(/);
      const b = (next >= 0 ? rest.slice(0, next) : rest).match(/depthBias\("([a-z0-9-]+)"\)/);
      if (b) pairs.push([m[1], b[1]]);
    }
    expect(pairs.length).toBe(Object.keys(o).length);
    for (const [id, biasId] of pairs) expect(biasId).toBe(id);
  });
});

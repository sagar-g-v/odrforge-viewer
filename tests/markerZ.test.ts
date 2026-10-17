// Guards review markers on their lane's drawn height (a flag drawn at z = 0 under a road 500 m above sea level showed far
// from it in a tilted view) and whole-road selection.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LaneZIndex } from "../src/map/markerZ";

// three lane vertices along a road at 48° N: 510.0, 512.5 and 515.0 m, 10 m apart (in longitude)
const dLon = 10 / 74625.3;
const lanes = Float64Array.from([11, 48, 510, 11 + dLon, 48, 512.5, 11 + 2 * dLon, 48, 515]);
const idx = new LaneZIndex(lanes, 48);

describe("review marker heights", () => {
  it("a marker takes the height of the nearest lane vertex", () => {
    expect(idx.nearestZ(11 + 1.1 * dLon, 48)).toBe(512.5);
    expect(idx.nearestZ(11 + 1.9 * dLon, 48 + 3 / 111190)).toBe(515);
  });
  it("no lane within 30 m: no lane height (the caller uses the drawn ground)", () => {
    expect(idx.nearestZ(11, 48 + 40 / 111190)).toBeNull();
    expect(idx.nearestZ(11, 48 + 25 / 111190)).toBe(510);
  });
  it("MapView places flags, findings (and their labels) and LLM review rings at markerZ, through the height plan", () => {
    const src = readFileSync(new URL("../src/map/MapView.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/getPosition: \(d\) => \[d\.lon, d\.lat, markerZ\(d\)\],/);
    expect(src.match(/markerZ\(d\)\]/g)?.length).toBe(3); // markers(), their labels, the review rings
    expect(src).toMatch(/drawnZ\(plan, z, lift\)/);
  });
});

describe("whole-road selection", () => {
  it("all lanes of the selected road are highlighted; Shift+click and the reference line select a road", () => {
    const map = readFileSync(new URL("../src/map/MapView.tsx", import.meta.url), "utf8");
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(map).toMatch(/index === p\.selectedLane \|\| L\.meta\[index\]\.road === p\.selectedRoad/);
    expect(app).toMatch(/whole: shift/);
    expect(app).toMatch(/layer === "refs"[\s\S]{0,700}whole: true/);
    expect(app).toMatch(/selectedRoad=\{sel\?\.whole \? sel\.road : null\}/);
  });
});

// Guards the height rules of docs/ACCURACY.md §1 (map/heights.ts, map/drape.ts). Each case was checked in the
// viewer against the files and the drawn terrain; change a case only together with that document.
import { describe, expect, it } from "vitest";
import { groundProbe, terrainLift } from "../src/map/drape";
import { drawnZ, hasRealHeights, heightPlan, medianGround, NO_GROUND_LEVEL, type HeightMode } from "../src/map/heights";

const plan = (mode: HeightMode, terrain: boolean, realHeights: boolean, zGround = 0, groundReady = true) =>
  heightPlan({ mode, terrain, groundReady, zGround, realHeights, exaggeration: 1 });

describe("height plan (docs/ACCURACY.md §1)", () => {
  it("a file with real heights is drawn at them over terrain, in absolute and in relative mode: never re-based or draped", () => {
    for (const mode of ["absolute", "relative"] as const) {
      const p = plan(mode, true, true, 2665);
      expect(p).toMatchObject({ drape: null, base: 0, scale: 1, liftFromGround: true, noGround: false });
      expect(drawnZ(p, 2700.25, 0)).toBe(2700.25); // exactly the file's height at review zoom (lift 0)
    }
  });
  it("a file without real heights is laid on the terrain in flat / relative mode; absolute keeps its z", () => {
    expect(plan("relative", true, false).drape).toBe("relative");
    expect(plan("flat", true, false).drape).toBe("flat");
    expect(plan("absolute", true, false)).toMatchObject({ drape: null, base: 0, scale: 1 });
  });
  it("absolute without terrain: drawn from the road level when that is far from 0 (the map says so), else as is", () => {
    expect(plan("absolute", false, true, 2665)).toMatchObject({ base: 2665, noGround: true, liftFromGround: false });
    expect(plan("absolute", false, false, NO_GROUND_LEVEL - 1)).toMatchObject({ base: 0, noGround: false });
    expect(drawnZ(plan("absolute", false, true, 2665), 2700, 99)).toBe(35); // height differences kept, never lifted
  });
  it("relative without terrain draws from the road level; flat ignores z; neither is ever lifted", () => {
    expect(plan("relative", false, true, 510)).toMatchObject({ base: 510, scale: 1, liftFromGround: false });
    const f = plan("flat", false, false, 510);
    expect(f).toMatchObject({ scale: 0, base: 0, liftFromGround: false });
    expect(drawnZ(f, 523, 5)).toBe(0);
  });
  it("while the ground is still loading nothing is draped or lifted", () => {
    expect(plan("relative", true, false, 0, false)).toMatchObject({ drape: null, liftFromGround: false });
    expect(plan("absolute", true, true, 510, false)).toMatchObject({ drape: null, base: 0, liftFromGround: false });
  });
  it("real heights: lanes on the ground (median |z - ground| < 2 m)", () => {
    const lanes = Float64Array.from([11, 48, 520.3, 11.001, 48, 519.8, 11.002, 48, 521.0]);
    expect(hasRealHeights(lanes, () => 520)).toBe(true);
    expect(hasRealHeights(lanes, () => 0)).toBe(false);
    expect(hasRealHeights(lanes, () => NaN)).toBe(false);
    expect(medianGround(lanes, (lon) => (lon - 11) * 1000)).toBeCloseTo(1, 9);
  });
});

describe("the lift is measured against the ground, never the roads (docs/ACCURACY.md §2)", () => {
  // a road 2.5 m below the ground (a cutting): its probe holds the ground, so the lift stays 0 where the drawn
  // terrain equals the ground, and the road stays below it as in any other tool
  const lanes = Float64Array.from([10.45, 46.53, 2497.5, 10.451, 46.53, 2497.5]);
  const ground = () => 2500;
  it("the probe records ground heights, not lane heights", () => {
    expect([...groundProbe(lanes, ground).ground]).toEqual([2500, 2500]);
  });
  it("drawn terrain equal to the ground: no lift, the cutting is not hidden", () => {
    expect(terrainLift(groundProbe(lanes, ground), () => 2500, 1, 0)).toBe(0);
  });
  it("drawn terrain coarser and higher than the ground (zoomed out): lifted by that difference only", () => {
    expect(terrainLift(groundProbe(lanes, ground), () => 2501.2, 1, 0)).toBeCloseTo(1.2, 9);
  });
});

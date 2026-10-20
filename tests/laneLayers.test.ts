// Lane layers (ASAM OpenDRIVE 1.9.0 §11.2, §11.4): every road has one permanent lane layer and may have one temporary layer
// (roadworks) with its own lane offset and lane sections; a temporary section may end at its own @length. The viewer draws
// the permanent layer as always and the temporary one over it, in its own buffers (render.temporary).
import { describe, expect, it } from "vitest";
import { drapeRender } from "../src/map/drape";
import { buildRender, sampleS } from "../src/xodr/build";
import { sectionEnd, temporaryRoad } from "../src/xodr/lanes";
import { parseOpenDrive } from "../src/xodr/parse";

const ident = (x: number, y: number): [number, number] => [x, y];
const section = (s: number, w: number, extra = "") => `<laneSection s="${s}"${extra}><center><lane id="0" type="none"/></center><right><lane id="-1" type="driving"><width sOffset="0" a="${w}" b="0" c="0" d="0"/><roadMark sOffset="0" type="solid" color="yellow" width="0.15"/></lane></right></laneSection>`;
const road = (lanes: string) => `<OpenDRIVE><header revMajor="1" revMinor="9"/><road id="1" length="100" junction="-1">
  <planView><geometry s="0" x="0" y="0" hdg="0" length="100"><line/></geometry></planView>${lanes}</road></OpenDRIVE>`;
// permanent: one 3.5 m lane all along; temporary: from s 20, a 3 m lane shifted 1 m right by its own lane offset, ending
// at s 20 + 50 (its @length), before the road's end
const permanent = `<lanes layer="permanent">${section(0, 3.5)}</lanes>`;
const temporary = `<lanes layer="temporary"><laneOffset s="20" a="-1" b="0" c="0" d="0"/>${section(20, 3, ' length="50"')}</lanes>`;

describe("lane layers (1.9.0 §11.2)", () => {
  it("each layer is read by its @layer, whatever the order", () => {
    for (const lanes of [permanent + temporary, temporary + permanent]) {
      const r = parseOpenDrive(road(lanes)).roads[0];
      expect(r.sections.map((s) => s.right[0].widths[0].a)).toEqual([3.5]);
      expect(r.temporary?.sections.map((s) => [s.s, s.length, s.right[0].widths[0].a])).toEqual([[20, 50, 3]]);
      expect(r.temporary?.laneOffset.map((o) => [o.s, o.a])).toEqual([[20, -1]]);
    }
    expect(parseOpenDrive(road(`<lanes>${section(0, 3.5)}</lanes>`)).roads[0].temporary).toBeNull(); // before 1.9
  });
  it("a temporary section ends at its @length (§11.4), and the samples include that end", () => {
    const tr = temporaryRoad(parseOpenDrive(road(permanent + temporary)).roads[0])!;
    expect(sectionEnd(tr, 0)).toBe(70);
    expect(sampleS(tr)).toContain(70);
    expect(tr.laneOffset[0].a).toBe(-1); // its own lane offset, not the permanent one's
  });
  it("the temporary layer is built into its own buffers, where it is: s 20 .. 70, its lane offset and width", () => {
    const r = buildRender(parseOpenDrive(road(permanent + temporary)), ident), T = r.temporary!;
    expect(r.lanes.meta.length).toBe(1); // the permanent lane is drawn as before
    expect(T.lanes.meta).toEqual([expect.objectContaining({ road: 0, section: 0, lane: -1, type: "driving" })]);
    const xs: number[] = [], ys: number[] = [];
    for (let v = T.lanes.starts[0]; v < T.lanes.starts[1]; v++) { xs.push(T.lanes.positions[3 * v]); ys.push(T.lanes.positions[3 * v + 1]); }
    // ident: positions stay in file metres
    expect(Math.min(...xs)).toBeCloseTo(20, 6);
    expect(Math.max(...xs)).toBeCloseTo(70, 6);
    expect(Math.max(...ys)).toBeCloseTo(-1, 6); // inner border: the temporary lane offset
    expect(Math.min(...ys)).toBeCloseTo(-4, 6); // outer border: offset - 3 m
    expect(T.marks.meta.map((x) => x.color)).toEqual([[245, 196, 66, 255]]); // its own (yellow) mark
    expect(T.arrows.meta.length).toBeGreaterThan(0);
    expect(r.issues).toEqual([]);
  });
  it("laid on the ground with the permanent lanes (a file without real heights over terrain, drape.ts)", () => {
    const r = buildRender(parseOpenDrive(road(permanent + temporary)), ident), d = drapeRender(r, () => 123, "flat").render;
    for (const b of [d.lanes, d.temporary!.lanes, d.temporary!.marks, d.temporary!.arrows])
      expect(b.positions.filter((_, i) => i % 3 === 2).every((z) => Math.abs(z - 123) < 1e-9)).toBe(true);
  });
  it("no temporary layer: render.temporary is null", () => {
    expect(buildRender(parseOpenDrive(road(permanent)), ident).temporary).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { buildRender, laneDirection } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

const road = (rule: string, rightDir = "", leftType = "driving") => `<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="8"><geoReference><![CDATA[+proj=tmerc +lat_0=48 +lon_0=11 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m]]></geoReference></header>
<road id="1" length="30" junction="-1" rule="${rule}"><planView><geometry s="0" x="0" y="0" hdg="0" length="30"><line/></geometry></planView>
<lanes><laneSection s="0"><left><lane id="1" type="${leftType}"><width sOffset="0" a="3.5" b="0" c="0" d="0"/></lane></left><center><lane id="0" type="none"/></center>
<right><lane id="-1" type="driving"${rightDir ? ` direction="${rightDir}"` : ""}><width sOffset="0" a="3.5" b="0" c="0" d="0"/></lane>
<lane id="-2" type="sidewalk"><width sOffset="0" a="2" b="0" c="0" d="0"/></lane></right></laneSection></lanes></road></OpenDRIVE>`;

/** for each arrow: its lane, and whether its tip (the vertex farthest along x from the arrow's middle) points to +x */
function arrows(xml: string) {
  const od = parseOpenDrive(xml), proj = makeProjector(od.header.geoReference), r = buildRender(od, proj.forward), A = r.arrows;
  return A.meta.map((m, k) => {
    const xs: number[] = [];
    for (let v = A.starts[k]; v < A.starts[k + 1]; v++) xs.push(proj.inverse(A.positions[3 * v], A.positions[3 * v + 1])[0]);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2, tip = xs[xs.length === 7 ? 3 : 5];
    return { lane: m.lane, both: m.both, vertices: xs.length, plusX: tip > mid };
  });
}

describe("driving direction (1.8.0 §11.2.1)", () => {
  it("RHT: right lanes along the reference line, left lanes against it; LHT the other way round; reversed flips", () => {
    expect(laneDirection("RHT", -1, "standard", "driving").forward).toBe(true);
    expect(laneDirection("RHT", 2, "standard", "driving").forward).toBe(false);
    expect(laneDirection("LHT", 1, "standard", "driving").forward).toBe(true);
    expect(laneDirection("LHT", -1, "standard", "driving").forward).toBe(false);
    expect(laneDirection("RHT", -1, "reversed", "driving").forward).toBe(false);
    expect(laneDirection("RHT", -1, "both", "driving").both).toBe(true);
    expect(laneDirection("RHT", 1, "standard", "bidirectional").both).toBe(true);
  });
  it("arrows point the driving way on the drawn road; sidewalks get none", () => {
    expect(arrows(road("RHT"))).toEqual([
      { lane: 1, both: false, vertices: 7, plusX: false }, { lane: -1, both: false, vertices: 7, plusX: true },
    ]);
    expect(arrows(road("LHT")).map((a) => [a.lane, a.plusX])).toEqual([[1, true], [-1, false]]);
    expect(arrows(road("RHT", "reversed")).find((a) => a.lane === -1)!.plusX).toBe(false);
  });
  it("a lane for both directions gets a double-headed arrow", () => {
    expect(arrows(road("RHT", "both")).find((a) => a.lane === -1)).toMatchObject({ both: true, vertices: 10 });
    expect(arrows(road("RHT", "", "bidirectional")).find((a) => a.lane === 1)).toMatchObject({ both: true, vertices: 10 });
  });
});

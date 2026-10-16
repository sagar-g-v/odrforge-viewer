import { describe, expect, it } from "vitest";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

// the <elevationGrid> XML example of OpenDRIVE 1.8.0 §12.11, on a 20 m junction reference line along +x
const XODR = `<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="8"><geoReference><![CDATA[+proj=tmerc +lat_0=48 +lon_0=11 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m]]></geoReference></header>
<road id="1" length="10" junction="-1"><planView><geometry s="0" x="-10" y="0" hdg="0" length="10"><line/></geometry></planView>
<lanes><laneSection s="0"><center><lane id="0" type="none"/></center><right>
 <lane id="-1" type="driving"><width sOffset="0" a="3.5" b="0" c="0" d="0"/>
  <material sOffset="0" surface="asphalt" friction="0.8" roughness="0"/><material sOffset="5" surface="cobble" friction="0.6" roughness="0.02"/>
  <speed sOffset="0" max="50" unit="km/h"/><speed sOffset="6" max="30" unit="km/h"/>
  <access sOffset="0" rule="deny" restriction="bus"/><rule sOffset="0" value="no stopping at any time"/>
  <userData code="laneTag" value="x"/></lane></right></laneSection></lanes>
<userData code="osmWays" value="-77"/><userData code="osmWays" value="-76"/><userData code="attribution" value="OSM"/></road>
<junction id="5"><planView><geometry s="0" x="0" y="0" hdg="0" length="20"><line/></geometry></planView>
 <elevationGrid sStart="1.35191514000e+00" gridSpacing="4.000000000e+00">
 <elevation left="5.0" center="5.0" right="5.0 5.0"/>
 <elevation left="5.0 5.0" center="5.0" right="5.0 5.0"/>
 <elevation left="5.0 5.0" center="5.0" right="5.0 5.0 5.0"/>
 <elevation left="5.0 5.0" center="5.0" right="5.0 5.0 5.0"/>
 <elevation left="5.05 5.0" center="5.1" right="5.05 5.0 5.0"/>
 <elevation left="5.1 5.0" center="5.2" right="5.1 5.0 5.0"/>
 <elevation left="5.05 5.0" center="5.1" right="5.05 5.0 5.0"/>
 <elevation left="5.0 5.0" center="5.0" right="5.0 5.0 5.0"/>
 <elevation center="5.0" right="5.0 5.0 5.0"/>
 </elevationGrid></junction>
</OpenDRIVE>`;

describe("junction reference line and elevation grid (1.8.0 §12.9, §12.11)", () => {
  const od = parseOpenDrive(XODR);
  const proj = makeProjector(od.header.geoReference);
  const r = buildRender(od, proj.forward);
  const j = od.junctions[0];
  it("parses the grid rows as given", () => {
    expect(j.refLine).toHaveLength(1);
    expect(j.elevationGrid!.gridSpacing).toBe(4);
    expect(j.elevationGrid!.rows).toHaveLength(9);
    expect(j.elevationGrid!.rows[5]).toEqual({ center: [5.2], left: [5.1, 5.0], right: [5.1, 5.0, 5.0] });
    expect(j.elevationGrid!.rows[8].left).toEqual([]);
  });
  const pts = r.grids.points.positions, n = pts.length / 3;
  const xyz = Array.from({ length: n }, (_, i) => { const [x, y] = proj.inverse(pts[3 * i], pts[3 * i + 1]); return [x, y, pts[3 * i + 2]]; });
  const has = (x: number, y: number, z: number) => xyz.some((q) => Math.abs(q[0] - x) < 1e-6 && Math.abs(q[1] - y) < 1e-6 && Math.abs(q[2] - z) < 1e-9);
  it("places row k at s = sStart + k * gridSpacing, left (+t) and right (-t) every gridSpacing, inside to outside", () => {
    expect(n).toBe(9 + 15 + 25); // centre, left, right values in the example
    expect(has(1.35191514, 0, 5)).toBe(true); // row 0 centre
    expect(has(1.35191514, 4, 5)).toBe(true); // row 0, first left
    expect(has(1.35191514, -8, 5)).toBe(true); // row 0, second right
    expect(has(1.35191514 + 5 * 4, 0, 5.2)).toBe(true); // row 5 centre (past the 20 m line: continued straight)
    expect(has(1.35191514 + 5 * 4, -4, 5.1)).toBe(true);
    expect(has(1.35191514 + 8 * 4, -12, 5)).toBe(true); // last row, outermost right
  });
  it("joins only neighbouring grid points", () => {
    // across: per row (points - 1); along: shared lateral indices of consecutive rows
    const across = [4, 5, 6, 6, 6, 6, 6, 6, 4].reduce((a, k) => a + k - 1, 0);
    const along = [4, 5, 6, 6, 6, 6, 6, 4].reduce((a, b) => a + b, 0); // row 8 has no left points
    expect(r.grids.lines.meta.length).toBe(across + along);
    expect(r.grids.refLines.meta).toEqual([-1]); // no junction area drawn for a junction without connecting roads
  });
  it("reads lane material, speed, access, rule records and every userData entry", () => {
    const lane = od.roads[0].sections[0].right[0];
    expect(lane.materials.map((m) => m.surface)).toEqual(["asphalt", "cobble"]);
    expect(lane.speeds.map((s) => [s.s, s.max, s.unit])).toEqual([[0, 50, "km/h"], [6, 30, "km/h"]]);
    expect(lane.access).toEqual([{ s: 0, rule: "deny", restriction: "bus" }]);
    expect(lane.rules[0].value).toBe("no stopping at any time");
    expect(lane.userData).toEqual([{ code: "laneTag", value: "x" }]);
    expect(od.roads[0].userData.filter((u) => u.code === "osmWays").map((u) => u.value)).toEqual(["-77", "-76"]);
  });
});

// A virtual junction's area (OpenDRIVE 1.5+, 1.8.0 §12.5: mainRoad, sStart, sEnd): its main road between sStart and sEnd,
// full width. Without it the hull of its connecting roads (one crossing path) collapsed to a line: no area, no hatch.
import { describe, expect, it } from "vitest";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

const road = (id: string, junction: string, x: number, y: number, hdg: number, len: number, w: number) =>
  `<road id="${id}" length="${len}" junction="${junction}"><planView><geometry s="0" x="${x}" y="${y}" hdg="${hdg}" length="${len}"><line/></geometry></planView>
<lanes><laneSection s="0"><left><lane id="1" type="driving"><width sOffset="0" a="${w}" b="0" c="0" d="0"/></lane></left><center><lane id="0" type="none"/></center>
<right><lane id="-1" type="driving"><width sOffset="0" a="${w}" b="0" c="0" d="0"/></lane><lane id="-2" type="sidewalk"><width sOffset="0" a="2" b="0" c="0" d="0"/></lane></right></laneSection></lanes></road>`;
// main road 1 along x (left 3.5 m, right 3.5 + 2 m); a 4 m wide crossing (road 2) across it inside virtual junction 9
const XODR = `<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="8"><geoReference><![CDATA[+proj=tmerc +lat_0=35 +lon_0=139 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m]]></geoReference></header>
${road("1", "-1", 0, 0, 0, 100, 3.5)}${road("2", "9", 42, -5.5, Math.PI / 2, 9, 0.001)}
<junction id="9" name="crossing" type="virtual" mainRoad="1" sStart="40" sEnd="44" orientation="none"><connection id="0" incomingRoad="-1" connectingRoad="2" contactPoint="start"/></junction>
<junction id="10" type="virtual" mainRoad="404" sStart="1" sEnd="2"/></OpenDRIVE>`;

describe("virtual junction area", () => {
  const od = parseOpenDrive(XODR), proj = makeProjector(od.header.geoReference), r = buildRender(od, proj.forward);
  it("reads mainRoad, sStart and sEnd", () => {
    expect(od.junctions[0]).toMatchObject({ type: "virtual", mainRoad: "1", sStart: 40, sEnd: 44 });
  });
  it("is the main road's span s 40..44, from its outermost left border to its outermost right border, drawn solid", () => {
    const i = r.junctions.meta.findIndex((m) => m.id === "9");
    expect(r.junctions.meta[i]).toMatchObject({ outline: "span", exact: true, type: "virtual" });
    const J = r.junctions, xs: number[] = [], ys: number[] = [];
    for (let v = J.starts[i]; v < J.starts[i + 1]; v++) { const [x, y] = proj.inverse(J.positions[3 * v], J.positions[3 * v + 1]); xs.push(x); ys.push(y); }
    expect(Math.min(...xs)).toBeCloseTo(40, 6); expect(Math.max(...xs)).toBeCloseTo(44, 6);
    expect(Math.max(...ys)).toBeCloseTo(3.5, 6); expect(Math.min(...ys)).toBeCloseTo(-5.5, 6);
  });
  it("an unknown main road gives no span (and no area without connecting roads)", () => {
    expect(r.junctions.meta.find((m) => m.id === "10")).toBeUndefined();
  });
});

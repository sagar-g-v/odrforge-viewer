import { describe, expect, it } from "vitest";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

// a flat road 517.25 m above the datum with a mark, a crosswalk outline and a junction boundary around its end
const XODR = `<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="8"><geoReference><![CDATA[+proj=tmerc +lat_0=48 +lon_0=11 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m]]></geoReference></header>
<road id="1" length="40" junction="-1"><planView><geometry s="0" x="0" y="0" hdg="0" length="40"><line/></geometry></planView>
<elevationProfile><elevation s="0" a="517.25" b="0" c="0" d="0"/></elevationProfile>
<lanes><laneSection s="0"><center><lane id="0" type="none"><roadMark sOffset="0" type="solid" color="white" width="0.12"/></lane></center>
<right><lane id="-1" type="driving"><width sOffset="0" a="3.5" b="0" c="0" d="0"/><roadMark sOffset="0" type="broken" color="white" width="0.12"/></lane></right></laneSection></lanes>
<objects><object id="c" type="crosswalk" s="20" t="-1.75" zOffset="0" hdg="0"><outline><cornerLocal u="-1" v="-1.75" z="0"/><cornerLocal u="1" v="-1.75" z="0"/><cornerLocal u="1" v="1.75" z="0"/><cornerLocal u="-1" v="1.75" z="0"/></outline></object></objects>
</road></OpenDRIVE>`;

describe("geometry at the file's heights (nothing lifted or lowered for display)", () => {
  const od = parseOpenDrive(XODR);
  const r = buildRender(od, makeProjector(od.header.geoReference).forward);
  const zs = (a: Float64Array) => new Set(Array.from({ length: a.length / 3 }, (_, i) => a[3 * i + 2]));
  it("lanes, marks, reference line, object outlines and direction arrows all lie at the road surface", () => {
    for (const buf of [r.lanes.positions, r.marks.positions, r.refs.positions, r.objects.positions, r.arrows.positions]) expect([...zs(buf)]).toEqual([517.25]);
    expect(r.arrows.meta.length).toBeGreaterThan(0);
  });
});

describe("superelevation sign (1.8.0 §10.5: positive = the road falls to the right)", () => {
  const xml = XODR.replace('<elevationProfile><elevation s="0" a="517.25" b="0" c="0" d="0"/></elevationProfile>',
    '<elevationProfile><elevation s="0" a="517.25" b="0" c="0" d="0"/></elevationProfile><lateralProfile><superelevation s="0" a="0.05" b="0" c="0" d="0"/></lateralProfile>');
  const od = parseOpenDrive(xml), proj = makeProjector(od.header.geoReference), r = buildRender(od, proj.forward);
  it("z = elevation + t tan(se): the right lane's outer border (t = -3.5) is lower, by 3.5 tan(0.05)", () => {
    const L = r.lanes.positions;
    let low = Infinity, high = -Infinity;
    for (let v = 0; v < L.length / 3; v++) { low = Math.min(low, L[3 * v + 2]); high = Math.max(high, L[3 * v + 2]); }
    expect(low).toBeCloseTo(517.25 - 3.5 * Math.tan(0.05), 9);
    expect(high).toBeCloseTo(517.25, 9); // the right lane's inner border lies on the reference line
  });
});

describe("lane offset (1.8.0 §9.3: lane 0 sits at t = laneOffset(s), not on the reference line)", () => {
  // flag #19-#23 (Munich road 242) asked whether the viewer shifts lanes off the reference line: it draws what the file says
  const xml = XODR.replace("<lanes>", '<lanes><laneOffset s="0" a="-1.5" b="0" c="0" d="0"/>');
  const od = parseOpenDrive(xml), proj = makeProjector(od.header.geoReference), r = buildRender(od, proj.forward);
  it("the reference line stays at t = 0; the right lane spans t = -1.5 .. -5.0", () => {
    const local = (a: Float64Array) => Array.from({ length: a.length / 3 }, (_, i) => proj.inverse(a[3 * i], a[3 * i + 1]));
    for (const [, y] of local(r.refs.positions)) expect(y).toBeCloseTo(0, 6);
    const ys = local(r.lanes.positions).map(([, y]) => y);
    expect(Math.max(...ys)).toBeCloseTo(-1.5, 6);
    expect(Math.min(...ys)).toBeCloseTo(-5.0, 6);
  });
});

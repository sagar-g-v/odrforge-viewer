import { describe, expect, it } from "vitest";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

const XODR = `<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="8" name="t" version="3" north="10" south="-10" east="50" west="0" vendor="v">
<geoReference><![CDATA[+proj=tmerc +lat_0=48 +lon_0=11 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m]]></geoReference>
<license name="Open Data Commons Open Database License 1.0" resource="https://opendatacommons.org/licenses/odbl/1-0/" spdxid="ODbL-1.0"/>
<userData code="attribution" value="OSM"/></header>
<road id="1" length="50" junction="-1"><planView><geometry s="0" x="0" y="0" hdg="0" length="50"><line/></geometry></planView>
<elevationProfile><elevation s="0" a="2" b="0" c="0" d="0"/></elevationProfile>
<lanes><laneSection s="0"><center><lane id="0" type="none"/></center><right><lane id="-1" type="driving"><width sOffset="0" a="3.5" b="0" c="0" d="0"/>
 <access sOffset="0" rule="deny"><restriction type="truck"/><restriction type="bus"/></access><access sOffset="0" rule="allow" restriction="bicycle"/></lane></right></laneSection></lanes>
<objects>
 <object id="a" type="trafficIsland" s="10" t="5" zOffset="0" hdg="0">
  <outlines>
   <outline id="0" closed="true" fillType="grass" outer="true"><cornerRoad s="8" t="4" dz="0" height="0.15"/><cornerRoad s="12" t="4" dz="0" height="0.15"/><cornerRoad s="12" t="6" dz="0.1" height="0.15"/><cornerRoad s="8" t="6" dz="0" height="0.15"/></outline>
   <outline id="1" closed="false"><cornerLocal u="0" v="0" z="0" height="0"/><cornerLocal u="3" v="0" z="0" height="0"/></outline>
   <outline id="2" closed="true"><cornerLocal u="0" v="0" z="0" height="0"/><cornerLocal u="1" v="0" z="0" height="0"/><cornerLocal u="1" v="1" z="0" height="0"/></outline>
  </outlines>
 </object>
 <object id="b" type="crosswalk" s="30" t="0" zOffset="0" hdg="0"><outline><cornerLocal u="-1" v="-2" z="0"/><cornerLocal u="1" v="-2" z="0"/><cornerLocal u="1" v="2" z="0"/><cornerLocal u="-1" v="2" z="0"/></outline></object>
</objects></road>
<junction id="7"/><junction id="8"/>
<junctionGroup name="Roundabout" id="1" type="roundabout"><junctionReference junction="7"/><junctionReference junction="8"/></junctionGroup>
</OpenDRIVE>`;

describe("object outlines (1.8.0 §13.3), access restrictions, junction groups, header", () => {
  const od = parseOpenDrive(XODR);
  const proj = makeProjector(od.header.geoReference);
  const r = buildRender(od, proj.forward);
  const o = od.roads[0].objects;
  it("reads every outline with its corners, a 1.4 <outline> as an area", () => {
    expect(o[0].outlines.map((x) => [x.id, x.closed, x.corners.length, x.corners[0].kind])).toEqual([["0", true, 4, "road"], ["1", false, 2, "local"], ["2", true, 3, "local"]]);
    expect(o[0].outlines[0]).toMatchObject({ fillType: "grass", outer: true });
    expect(o[1].outlines).toHaveLength(1);
    expect(o[1].outlines[0].closed).toBe(true);
  });
  it("draws areas flat, raised areas as prisms, open outlines as lines; cornerRoad at s / t, z = reference line + dz", () => {
    expect(r.objects.meta.map((m) => m.index)).toEqual([0, 1]); // object a outline 2, object b
    expect(r.objectLines.meta).toHaveLength(1);
    const prism = r.features.boxes.meta.findIndex((m) => m.kind === "object" && m.index === 0);
    expect(prism).toBeGreaterThanOrEqual(0);
    expect(r.features.boxes.elevations[prism]).toBeCloseTo(0.15, 6);
    const B = r.features.boxes, v = B.starts[prism];
    const c2 = proj.inverse(B.positions[3 * (v + 2)], B.positions[3 * (v + 2) + 1]);
    expect(c2[0]).toBeCloseTo(12, 6);
    expect(c2[1]).toBeCloseTo(6, 6);
    expect(B.positions[3 * (v + 2) + 2]).toBeCloseTo(2.1, 9); // elevation 2 + dz 0.1
  });
  it("reads <restriction> children (1.8) and @restriction (<= 1.7)", () => {
    expect(od.roads[0].sections[0].right[0].access).toEqual([{ s: 0, rule: "deny", restriction: "truck, bus" }, { s: 0, rule: "allow", restriction: "bicycle" }]);
  });
  it("reads junction groups and the header's version, extent, license and user data", () => {
    expect(od.junctionGroups).toEqual([{ id: "1", name: "Roundabout", type: "roundabout", junctions: ["7", "8"] }]);
    expect(od.header.version).toBe("3");
    expect(od.header.bounds).toEqual({ north: 10, south: -10, east: 50, west: 0 });
    expect(od.header.license?.spdxid).toBe("ODbL-1.0");
    expect(od.header.userData).toEqual([{ code: "attribution", value: "OSM" }]);
  });
});

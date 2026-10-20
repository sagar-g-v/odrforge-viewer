// The map's hover tooltip names what is under the pointer (docs/design-system.md §6: it always names the lane type; §8:
// a finding has no label, so the tooltip names it).
import { describe, expect, it } from "vitest";
import { hoverText } from "../src/map/hoverInfo";
import { buildRender } from "../src/xodr/build";
import { makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

const XODR = `<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="8"><geoReference><![CDATA[+proj=tmerc +lat_0=48 +lon_0=11 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m]]></geoReference></header>
<road id="42" name="Hauptstraße" length="40" junction="-1"><planView><geometry s="0" x="0" y="0" hdg="0" length="40"><line/></geometry></planView>
<lanes><laneSection s="0"><center><lane id="0" type="none"/></center>
<right><lane id="-1" type="driving"><width sOffset="0" a="3.5" b="0" c="0" d="0"/></lane><lane id="-2" type="sidewalk"><width sOffset="0" a="2" b="0" c="0" d="0"/></lane></right></laneSection></lanes></road>
<junction id="9" type="virtual" mainRoad="42" sStart="10" sEnd="14"/></OpenDRIVE>`;

describe("hover tooltip text", () => {
  const od = parseOpenDrive(XODR), r = buildRender(od, makeProjector(od.header.geoReference).forward);
  it("a lane: its type, lane id and road (id and name)", () => {
    const i = r.lanes.meta.findIndex((m) => m.lane === -2);
    expect(hoverText("lanes", i, r)).toBe("sidewalk · lane -2 · road 42 · Hauptstraße");
  });
  it("a virtual junction, by the hatch layer's own index", () => {
    expect(hoverText("junctions-virtual", 0, r)).toBe("virtual junction 9");
  });
  it("a reference line names its road", () => {
    expect(hoverText("refs", 0, r)).toBe("reference line · road 42 · Hauptstraße");
  });
  it("a finding is named by its tip; a flag by its tip or number", () => {
    expect(hoverText("findings", 0, r, { findings: [{ tip: "error · lane gap 0.4 m" }] })).toBe("error · lane gap 0.4 m");
    expect(hoverText("flags", 0, r, { flags: [{ label: "16" }] })).toBe("flag #16");
  });
  it("an LLM review ring is named by its tip", () => {
    expect(hoverText("review", 0, r, { review: [{ tip: "review #19 · critical · leads_nowhere: …" }] })).toBe("review #19 · critical · leads_nowhere: …");
    expect(hoverText("review", 3, r, { review: [] })).toBeNull();
  });
  it("a lane of a temporary lane layer (1.9.0 §11.2) says so", () => {
    const tmp = XODR.replace('<lanes><laneSection s="0">', '<lanes layer="temporary"><laneSection s="5" length="20"><center><lane id="0" type="none"/></center><right><lane id="-1" type="driving"><width sOffset="0" a="3" b="0" c="0" d="0"/></lane></right></laneSection></lanes><lanes layer="permanent"><laneSection s="0">');
    const od2 = parseOpenDrive(tmp), r2 = buildRender(od2, makeProjector(od2.header.geoReference).forward);
    expect(hoverText("lanes-temporary", 0, r2)).toBe("driving · lane -1 · temporary layer (roadworks) · road 42 · Hauptstraße");
    expect(hoverText("lanes-temporary", 0, r)).toBeNull(); // no temporary layer
  });
  it("nothing for no pick or an unknown layer", () => {
    expect(hoverText("lanes", -1, r)).toBeNull();
    expect(hoverText("basemap", 0, r)).toBeNull();
  });
});

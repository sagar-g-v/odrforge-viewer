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
  it("lanes, marks, reference line and object outlines all lie at the road surface", () => {
    for (const buf of [r.lanes.positions, r.marks.positions, r.refs.positions, r.objects.positions]) expect([...zs(buf)]).toEqual([517.25]);
  });
});

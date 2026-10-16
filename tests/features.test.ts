import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRender, markLines } from "../src/xodr/build";
import { signalKind } from "../src/xodr/features";
import { makeProjector } from "../src/xodr/geo";
import type { RoadMark } from "../src/xodr/model";
import { parseOpenDrive } from "../src/xodr/parse";

const mark = (o: Partial<RoadMark>): RoadMark => ({ s: 0, type: "solid", color: "white", width: 0.12, weight: "standard", laneChange: "", lines: [], ...o });

describe("road marks (1.8.0 §11.8; 1.9.0 Annex A e_roadMarkType)", () => {
  it("two-line types run from inside to outside: a right lane's inside is +t", () => {
    const [a, b] = markLines(mark({ type: "broken solid" }), 1);
    expect(a.dash).not.toBeNull(); // broken first, inside (+t)
    expect(a.off).toBeGreaterThan(0);
    expect(b.dash).toBeNull();
    expect(b.off).toBeLessThan(0);
  });
  it("a left lane's inside is -t; the centre lane runs from left to right", () => {
    expect(markLines(mark({ type: "broken solid" }), -1)[0].off).toBeLessThan(0);
    const [a, b] = markLines(mark({ type: "solid broken", color: "yellow" }), 0);
    expect(a.off).toBeGreaterThan(0); // solid on the left
    expect(a.dash).toBeNull();
    expect(b.dash).not.toBeNull();
    expect(a.color).toEqual([245, 196, 66, 255]);
  });
  it("explicit <type><line> elements override the type's lines", () => {
    const ls = markLines(mark({ type: "custom", lines: [
      { length: 2, space: 4, tOffset: 0.2, sOffset: 0, width: 0.15, color: "blue", rule: "" },
      { length: 0, space: 0, tOffset: -0.2, sOffset: 0, width: 0.15, color: "white", rule: "" },
    ] }), 1);
    expect(ls.map((l) => [l.off, l.dash])).toEqual([[0.2, [2, 4]], [-0.2, null]]);
  });
  it("none draws nothing; botts dots are a dotted line", () => {
    expect(markLines(mark({ type: "none" }), 1)).toEqual([]);
    expect(markLines(mark({ type: "botts dots" }), 1)[0].dash).not.toBeNull();
  });
});

const XODR = `<?xml version="1.0"?><OpenDRIVE><header revMajor="1" revMinor="8"><geoReference><![CDATA[+proj=tmerc +lat_0=48 +lon_0=11 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m]]></geoReference></header>
<road id="1" length="100" junction="-1"><planView><geometry s="0" x="0" y="0" hdg="0" length="100"><line/></geometry></planView>
<lanes><laneSection s="0"><center><lane id="0" type="none"><roadMark sOffset="0" type="solid solid" color="yellow" width="0.12"/></lane></center>
<right><lane id="-1" type="driving"><width sOffset="0" a="3.5" b="0" c="0" d="0"/><roadMark sOffset="0" type="broken" color="white" width="0.12"/></lane></right></laneSection></lanes>
<objects>
 <object id="t1" type="tree" s="10" t="-6" zOffset="0" radius="2" height="8"/>
 <object id="g1" type="barrier" subtype="guardRail" s="20" t="-4" zOffset="0.4"><repeat s="20" length="10" distance="0" tStart="-4" tEnd="-4" heightStart="0.3" heightEnd="0.3" zOffsetStart="0.4" zOffsetEnd="0.4" widthStart="0.1" widthEnd="0.1"/></object>
 <bridge s="40" length="10" id="b1" type="concrete"/><tunnel s="60" length="10" id="u1" type="standard"/>
</objects>
<signals>
 <signal id="L" s="90" t="-5" dynamic="yes" orientation="+" zOffset="2.4" type="1000001" subtype="-1" height="1" width="0.4"/>
 <signal id="S" s="88" t="-1.75" dynamic="no" orientation="+" zOffset="0" type="1100001" subtype="-1" height="0.03" width="3.5"><validity fromLane="-1" toLane="-1"/><dependency id="L" type="trafficLight"/></signal>
 <signal id="V" s="5" t="-4" dynamic="no" orientation="+" zOffset="2" country="DE" type="274" subtype="-1" value="50" unit="km/h" height="0.6" width="0.6"/>
</signals></road>
<controller id="c1" name="phase0" sequence="0"><control signalId="L" type="0"/></controller>
</OpenDRIVE>`;

describe("road furniture (xodr/features.ts)", () => {
  const od = parseOpenDrive(XODR);
  const r = buildRender(od, makeProjector(od.header.geoReference).forward);
  const F = r.features;
  const cols = F.columns.flatMap((c) => c.meta.map((m, i) => ({ ...m, radius: c.radius, h: c.elevations[i] })));
  it("parses signal logic, object repeats, structures and controllers", () => {
    const sg = od.roads[0].signals;
    expect(sg.map((x) => signalKind(x))).toEqual(["light", "line", "speed"]);
    expect(sg[1].validity).toEqual([{ fromLane: -1, toLane: -1 }]);
    expect(sg[1].dependencies[0].id).toBe("L");
    expect(od.roads[0].objects[1].repeats).toHaveLength(1);
    expect(od.roads[0].structures.map((x) => x.kind)).toEqual(["bridge", "tunnel"]);
    expect(od.controllers[0].controls[0].signalId).toBe("L");
  });
  it("a tree is the logo's tree: a trunk and four lobes of three slices, within its radius and height", () => {
    const tree = cols.filter((c) => c.kind === "object" && c.index === 0);
    expect(tree).toHaveLength(1 + 4 * 3);
    expect(Math.max(...tree.map((c) => c.radius))).toBeCloseTo(0.64 * 2, 2); // top lobe .64r, r = the file's 2 m
    const trunk = tree.reduce((a, b) => (a.radius < b.radius ? a : b));
    expect(trunk.radius).toBeCloseTo(0.14 * 2, 2);
    expect(trunk.h).toBeCloseTo(8 - 0.64 * 2, 5); // ground to the top lobe's centre, h = the file's 8 m
  });
  it("a continuous guard rail is cut into pieces of at most 2 m along its 10 m", () => {
    expect(F.boxes.meta.filter((m) => m.kind === "object" && m.index === 1)).toHaveLength(5);
  });
  it("a traffic light is a housing, three lamps and a post; the stop line a flat bar; the sign a board with its value", () => {
    expect(F.boxes.meta.filter((m) => m.kind === "signal" && m.index === 0)).toHaveLength(1);
    expect(cols.filter((c) => c.kind === "signal" && c.index === 0)).toHaveLength(4);
    const bar = F.boxes.meta.findIndex((m) => m.kind === "signal" && m.index === 1);
    expect(F.boxes.elevations[bar]).toBeCloseTo(0.03, 5);
    expect(F.labels.texts).toEqual(["50"]);
  });
  it("bridge and tunnel cover their s range; the double centre line gives two marks", () => {
    expect(F.structures.meta.map((m) => m.tunnel)).toEqual([false, true]);
    expect(r.marks.meta.filter((m) => m.color[0] === 245 && m.color[1] === 196)).toHaveLength(2);
  });
});

describe("Stelvio fixture", () => {
  it("every sign becomes a board with a post, speed signs carry their value", () => {
    const od = parseOpenDrive(readFileSync(new URL("./fixtures/stelvio_standard.xodr", import.meta.url), "utf8"));
    const F = buildRender(od, makeProjector(od.header.geoReference).forward).features;
    expect(F.boxes.meta.filter((m) => m.kind === "signal")).toHaveLength(33);
    expect(F.labels.texts.filter((t) => /^\d+$/.test(t))).toHaveLength(32);
    expect(F.crossPaths.meta).toHaveLength(4);
  });
});

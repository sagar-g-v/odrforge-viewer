// Broken and hostile inputs (release readiness): a file that is not OpenDRIVE or not well-formed XML is refused with a
// clear message; what a readable file gets wrong is listed in `issues` and the rest is drawn; nothing is dropped
// silently, nothing hangs, and a rendering error stops at an ErrorBoundary.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { buildRender } from "../src/xodr/build";
import { geoReferenceIssue, makeProjector } from "../src/xodr/geo";
import { parseOpenDrive } from "../src/xodr/parse";

const read = (xml: string) => { const od = parseOpenDrive(xml); return { od, r: buildRender(od, makeProjector(od.header.geoReference).forward) }; };
const lanes = `<lanes><laneSection s="0"><center><lane id="0" type="none"/></center><right><lane id="-1" type="driving"><width sOffset="0" a="3" b="0" c="0" d="0"/></lane></right></laneSection></lanes>`;
const road = (attrs: string, geom = `<planView><geometry s="0" x="0" y="0" hdg="0" length="10"><line/></geometry></planView>`) =>
  `<OpenDRIVE><header/><road id="1" ${attrs} junction="-1">${geom}${lanes}</road></OpenDRIVE>`;
const stelvio = readFileSync("tests/fixtures/stelvio_standard.xodr", "utf8");

describe("files that are not OpenDRIVE, or not well-formed", () => {
  it("are refused with a message saying why", () => {
    for (const text of ["", "  \n", "hello", "<?xml version='1.0'?><svg><rect/></svg>"]) expect(() => parseOpenDrive(text)).toThrow(/not an OpenDRIVE file/);
  });
  it("a truncated file is refused, naming the open element and line - never shown as a partial network", () => {
    expect(() => parseOpenDrive(stelvio.slice(0, Math.floor(stelvio.length / 2)))).toThrow(/malformed XML: <\w+> is not closed \(file truncated\?\) \(line \d+\)/);
    expect(() => parseOpenDrive(stelvio.slice(0, stelvio.length - 5))).toThrow(/malformed XML/);
  });
  it("mismatched or stray closing tags, and unterminated comments, CDATA and tags are refused", () => {
    expect(() => parseOpenDrive("<OpenDRIVE><header></road></OpenDRIVE>")).toThrow(/<\/road> closes <header> \(line 1\)/);
    expect(() => parseOpenDrive("<OpenDRIVE></OpenDRIVE></OpenDRIVE>")).toThrow(/closes nothing/);
    expect(() => parseOpenDrive("<OpenDRIVE><!-- open")).toThrow(/comment is not closed/);
    expect(() => parseOpenDrive("<OpenDRIVE><header><geoReference><![CDATA[+proj")).toThrow(/CDATA section is not closed/);
    expect(() => parseOpenDrive('<OpenDRIVE><header name="x')).toThrow(/tag is not closed/);
  });
  it("well-formed files read as before (the fixture)", () => {
    expect(parseOpenDrive(stelvio).roads.length).toBeGreaterThan(200);
  });
});

describe("readable files with problems: listed, the rest drawn", () => {
  it("attribute values that are not numbers are read as their default and listed with a count", () => {
    const { od } = read(road('length="abc"', `<planView><geometry s="0" x="NaN" y="0" hdg="zz" length="10"><line/></geometry><geometry s="10" x="NaN" y="0" hdg="0" length="1"><line/></geometry></planView>`));
    expect(od.issues).toEqual(expect.arrayContaining([
      'not a number, read as its default: <road> length="abc"', 'not a number, read as its default: <geometry> x="NaN" (2 times)',
      'not a number, read as its default: <geometry> hdg="zz"',
    ]));
  });
  it("roads that cannot be drawn are named and skipped; a network with nothing to draw says so", () => {
    const none = read(road('length="10"', ""));
    expect(none.r.issues).toEqual(["road 1 not drawn: no <planView> geometry", "nothing to draw: no road has drawable geometry"]);
    expect(read(road('length="-5"')).r.issues?.[0]).toMatch(/^road 1 not drawn: length -5 m/);
    const empty = read("<OpenDRIVE><header/></OpenDRIVE>");
    expect(empty.r.issues).toEqual(["nothing to draw: no road has drawable geometry"]);
    expect(empty.r.lanes.meta.length).toBe(0);
  });
  it("an absurd road length is refused at once (it took 2.7 s and then crashed with 'Invalid array length')", () => {
    const t0 = performance.now(), { r } = read(road('length="1e12"', `<planView><geometry s="0" x="0" y="0" hdg="0" length="1e12"><line/></geometry></planView>`));
    expect(performance.now() - t0).toBeLessThan(200);
    expect(r.issues?.[0]).toMatch(/^road 1 not drawn: length 1000000000000 m/);
  });
  it("a sound road next to a broken one is still drawn", () => {
    const xml = `<OpenDRIVE><header/><road id="1" length="10" junction="-1"><planView><geometry s="0" x="0" y="0" hdg="0" length="10"><line/></geometry></planView>${lanes}</road>
      <road id="2" length="-1" junction="-1"><planView><geometry s="0" x="0" y="20" hdg="0" length="-1"><line/></geometry></planView>${lanes}</road></OpenDRIVE>`;
    const { r } = read(xml);
    expect(r.lanes.meta.length).toBe(1);
    expect(r.issues).toEqual([expect.stringMatching(/^road 2 not drawn/)]);
    expect([...r.lanes.positions].every(Number.isFinite)).toBe(true);
  });
  it("lane layers (1.9.0 §11.2): the permanent layer is drawn whatever the order; a temporary layer is reported", () => {
    const layer = (name: string, w: number) => `<lanes layer="${name}"><laneSection s="0"><center><lane id="0" type="none"/></center><right><lane id="-1" type="driving"><width sOffset="0" a="${w}" b="0" c="0" d="0"/></lane></right></laneSection></lanes>`;
    const xml = (inner: string) => `<OpenDRIVE><header revMajor="1" revMinor="9"/><road id="1" length="10" junction="-1"><planView><geometry s="0" x="0" y="0" hdg="0" length="10"><line/></geometry></planView>${inner}</road></OpenDRIVE>`;
    for (const order of [[layer("temporary", 2), layer("permanent", 3)], [layer("permanent", 3), layer("temporary", 2)]]) {
      const { od, r } = read(xml(order.join("")));
      expect(od.roads[0].sections[0].right[0].widths[0].a).toBe(3); // the permanent lane (3 m), not the temporary one
      expect(r.issues).toEqual([expect.stringMatching(/^road 1: its temporary lane layer \(OpenDRIVE 1\.9 §11\.2/)]);
    }
    // before 1.9: one <lanes> without @layer, no issue
    expect(read(road('length="10"')).r.issues).toEqual([]);
  });
  it("a well-formed file has no issues (the fixture)", () => {
    expect(read(stelvio).r.issues).toEqual([]);
  });
  it("a geoReference that cannot be used is reported (drawn on the local plane); none given is not a problem", () => {
    const bad = "+proj=nonsense +foo";
    expect(geoReferenceIssue(bad, makeProjector(bad))).toMatch(/^geoReference not usable \("\+proj=nonsense \+foo"\): drawn on a local plane/);
    expect(geoReferenceIssue("", makeProjector(""))).toBeNull();
    const good = "+proj=tmerc +lat_0=46.53 +lon_0=10.45 +ellps=WGS84 +units=m";
    expect(geoReferenceIssue(good, makeProjector(good))).toBeNull();
  });
});

describe("a rendering error stops at an ErrorBoundary", () => {
  it("catches the error, and clears it when another network is opened (resetKey)", () => {
    const err = new Error("boom");
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
    const a = {}, b = {};
    expect(ErrorBoundary.getDerivedStateFromProps({ label: "the map", resetKey: b, children: null }, { error: err, key: a })).toEqual({ error: null, key: b });
    expect(ErrorBoundary.getDerivedStateFromProps({ label: "the map", resetKey: a, children: null }, { error: err, key: a })).toBeNull();
  });
});

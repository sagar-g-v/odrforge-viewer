// .xodr text -> OpenDrive model. Element and attribute names follow the ASAM OpenDRIVE 1.8.1 XSD; 1.4 files read
// the same (their extra / missing attributes default as below).
import type { Controller, Geom, Junction, Lane, LaneSection, Link, OpenDrive, OutlineCorner, Poly3, Road, RoadObject, Signal } from "./model";
import { kid, kids, num, parseXml, type XmlNode } from "./xml";

const poly = (n: XmlNode, sAttr = "s"): Poly3 => ({ s: num(n, sAttr), a: num(n, "a"), b: num(n, "b"), c: num(n, "c"), d: num(n, "d") });
const byS = <T extends { s: number }>(xs: T[]): T[] => xs.sort((p, q) => p.s - q.s);

function link(n: XmlNode | undefined): Link | null {
  if (!n) return null;
  return { type: n.attrs.elementType ?? "road", id: n.attrs.elementId ?? "", contact: n.attrs.contactPoint ?? "" };
}

function geometry(g: XmlNode): Geom {
  const base: Geom = {
    s: num(g, "s"), x: num(g, "x"), y: num(g, "y"), hdg: num(g, "hdg"), length: num(g, "length"), kind: "line",
    k0: 0, k1: 0, aU: 0, bU: 1, cU: 0, dU: 0, aV: 0, bV: 0, cV: 0, dV: 0, normalized: true,
  };
  const arc = kid(g, "arc"), spiral = kid(g, "spiral"), p3 = kid(g, "poly3"), pp3 = kid(g, "paramPoly3");
  if (arc) return { ...base, kind: "arc", k0: num(arc, "curvature"), k1: num(arc, "curvature") };
  if (spiral) return { ...base, kind: "spiral", k0: num(spiral, "curvStart"), k1: num(spiral, "curvEnd") };
  if (p3) return { ...base, kind: "poly3", aV: num(p3, "a"), bV: num(p3, "b"), cV: num(p3, "c"), dV: num(p3, "d") };
  if (pp3)
    return {
      ...base, kind: "paramPoly3",
      aU: num(pp3, "aU"), bU: num(pp3, "bU"), cU: num(pp3, "cU"), dU: num(pp3, "dU"),
      aV: num(pp3, "aV"), bV: num(pp3, "bV"), cV: num(pp3, "cV"), dV: num(pp3, "dV"),
      normalized: (pp3.attrs.pRange ?? "normalized") !== "arcLength",
    };
  return base;
}

const userData = (n: XmlNode | undefined) =>
  kids(n, "userData").map((u) => ({ code: u.attrs.code ?? "", value: u.attrs.value ?? u.text.trim() }));
const numList = (v: string | undefined) => (v ?? "").trim().split(/\s+/).filter(Boolean).map(Number);

function lane(n: XmlNode): Lane {
  const l = kid(n, "link");
  const pred = kid(l, "predecessor"), succ = kid(l, "successor");
  const speed = kid(n, "speed");
  let sp: number | null = null;
  if (speed) {
    const v = num(speed, "max", NaN);
    const unit = speed.attrs.unit ?? "m/s";
    if (Number.isFinite(v)) sp = unit === "km/h" ? v / 3.6 : unit === "mph" ? v * 0.44704 : v;
  }
  return {
    id: num(n, "id"), type: n.attrs.type ?? "none", direction: n.attrs.direction ?? "standard",
    level: n.attrs.level === "true" || n.attrs.level === "1",
    widths: byS(kids(n, "width").map((w) => poly(w, "sOffset"))),
    borders: byS(kids(n, "border").map((w) => poly(w, "sOffset"))),
    heights: byS(kids(n, "height").map((h) => ({ s: num(h, "sOffset"), inner: num(h, "inner"), outer: num(h, "outer") }))),
    marks: byS(kids(n, "roadMark").map((m) => ({
      s: num(m, "sOffset"), type: m.attrs.type ?? "none", color: m.attrs.color ?? "standard", width: num(m, "width", 0.12),
      weight: m.attrs.weight ?? "standard", laneChange: m.attrs.laneChange ?? "",
      lines: kids(kid(m, "type"), "line").map((l) => ({
        length: num(l, "length"), space: num(l, "space"), tOffset: num(l, "tOffset"), sOffset: num(l, "sOffset"),
        width: num(l, "width", num(m, "width", 0.12)), color: l.attrs.color ?? m.attrs.color ?? "standard", rule: l.attrs.rule ?? "",
      })),
    }))),
    pred: pred ? num(pred, "id") : null, succ: succ ? num(succ, "id") : null, speed: sp,
    speeds: byS(kids(n, "speed").map((x) => ({ s: num(x, "sOffset"), max: num(x, "max", NaN), unit: x.attrs.unit ?? "m/s" }))),
    materials: byS(kids(n, "material").map((x) => ({
      s: num(x, "sOffset"), surface: x.attrs.surface ?? "", friction: num(x, "friction", NaN), roughness: num(x, "roughness", NaN),
    }))),
    access: byS(kids(n, "access").map((x) => ({
      s: num(x, "sOffset"), rule: x.attrs.rule ?? "",
      restriction: [x.attrs.restriction ?? "", ...kids(x, "restriction").map((r) => r.attrs.type ?? "")].filter(Boolean).join(", "),
    }))),
    rules: byS(kids(n, "rule").map((x) => ({ s: num(x, "sOffset"), value: x.attrs.value ?? "" }))),
    userData: userData(n),
  };
}

function section(n: XmlNode): LaneSection {
  const side = (tag: string, sign: number) =>
    kids(kid(n, tag), "lane").map(lane).sort((a, b) => sign * (a.id - b.id)); // inner lane first
  const centre = kids(kid(n, "center"), "lane")[0];
  return {
    s: num(n, "s"), singleSide: n.attrs.singleSide === "true",
    left: side("left", 1), right: side("right", -1), center: centre ? lane(centre) : null,
  };
}

function signal(n: XmlNode): Signal {
  const v = num(n, "value", NaN);
  return {
    id: n.attrs.id ?? "", name: n.attrs.name ?? "", s: num(n, "s"), t: num(n, "t"), zOffset: num(n, "zOffset"),
    dynamic: n.attrs.dynamic === "yes", orientation: n.attrs.orientation ?? "none", type: n.attrs.type ?? "",
    subtype: n.attrs.subtype ?? "", country: n.attrs.country ?? "", value: Number.isFinite(v) ? v : null, unit: n.attrs.unit ?? "",
    height: num(n, "height"), width: num(n, "width"), hOffset: num(n, "hOffset"), text: n.attrs.text ?? "",
    validity: kids(n, "validity").map((x) => ({ fromLane: num(x, "fromLane"), toLane: num(x, "toLane") })),
    dependencies: kids(n, "dependency").map((x) => ({ id: x.attrs.id ?? "", type: x.attrs.type ?? "" })),
    references: kids(n, "reference").map((x) => ({ elementType: x.attrs.elementType ?? "", elementId: x.attrs.elementId ?? "", type: x.attrs.type ?? "" })),
    semantics: (kid(n, "semantics")?.children ?? []).map((x) => [x.tag, ...Object.entries(x.attrs).map(([k, val]) => `${k}=${val}`)].join(" ")),
  };
}

function object(n: XmlNode): RoadObject {
  return {
    id: n.attrs.id ?? "", name: n.attrs.name ?? "", type: n.attrs.type ?? "", s: num(n, "s"), t: num(n, "t"),
    zOffset: num(n, "zOffset"), hdg: num(n, "hdg"), length: num(n, "length"), width: num(n, "width"),
    radius: num(n, "radius"), height: num(n, "height"), subtype: n.attrs.subtype ?? "",
    repeats: kids(n, "repeat").map((r) => ({
      s: num(r, "s"), length: num(r, "length"), distance: num(r, "distance"), tStart: num(r, "tStart"), tEnd: num(r, "tEnd"),
      heightStart: num(r, "heightStart"), heightEnd: num(r, "heightEnd"), zOffsetStart: num(r, "zOffsetStart"), zOffsetEnd: num(r, "zOffsetEnd"),
      widthStart: num(r, "widthStart"), widthEnd: num(r, "widthEnd"), lengthStart: num(r, "lengthStart"), lengthEnd: num(r, "lengthEnd"),
    })),
    outlines: [...kids(kid(n, "outlines"), "outline"), ...kids(n, "outline")].map((ol) => ({
      id: ol.attrs.id ?? "", closed: ol.attrs.closed === undefined ? true : ol.attrs.closed === "true" || ol.attrs.closed === "1",
      fillType: ol.attrs.fillType ?? "", laneType: ol.attrs.laneType ?? "",
      outer: ol.attrs.outer === undefined ? null : ol.attrs.outer === "true" || ol.attrs.outer === "1",
      corners: ol.children.flatMap((c): OutlineCorner[] =>
        c.tag === "cornerLocal" ? [{ kind: "local", u: num(c, "u"), v: num(c, "v"), z: num(c, "z"), height: num(c, "height") }]
          : c.tag === "cornerRoad" ? [{ kind: "road", s: num(c, "s"), t: num(c, "t"), dz: num(c, "dz"), height: num(c, "height") }] : []),
    })),
  };
}

function road(n: XmlNode): Road {
  const l = kid(n, "link");
  const lanes = kid(n, "lanes");
  const rule = (n.attrs.rule ?? "RHT").toUpperCase() === "LHT" ? "LHT" : "RHT";
  return {
    id: n.attrs.id ?? "", name: n.attrs.name ?? "", length: num(n, "length"), junction: n.attrs.junction ?? "-1", rule,
    pred: link(kid(l, "predecessor")), succ: link(kid(l, "successor")),
    types: kids(n, "type").map((t) => {
      const sp = kid(t, "speed");
      const v = num(sp, "max", NaN);
      return { s: num(t, "s"), type: t.attrs.type ?? "", speed: Number.isFinite(v) ? v : null, unit: sp?.attrs.unit ?? "" };
    }),
    geoms: byS(kids(kid(n, "planView"), "geometry").map(geometry)),
    elevation: byS(kids(kid(n, "elevationProfile"), "elevation").map((e) => poly(e))),
    superelevation: byS(kids(kid(n, "lateralProfile"), "superelevation").map((e) => poly(e))),
    laneOffset: byS(kids(lanes, "laneOffset").map((e) => poly(e))),
    sections: byS(kids(lanes, "laneSection").map(section)),
    signals: kids(kid(n, "signals"), "signal").map(signal),
    objects: kids(kid(n, "objects"), "object").map(object),
    structures: [
      ...kids(kid(n, "objects"), "bridge").map((b) => ({ kind: "bridge" as const, id: b.attrs.id ?? "", name: b.attrs.name ?? "", s: num(b, "s"), length: num(b, "length"), type: b.attrs.type ?? "" })),
      ...kids(kid(n, "objects"), "tunnel").map((b) => ({ kind: "tunnel" as const, id: b.attrs.id ?? "", name: b.attrs.name ?? "", s: num(b, "s"), length: num(b, "length"), type: b.attrs.type ?? "" })),
    ],
    userData: userData(n),
  };
}

function junction(n: XmlNode): Junction {
  const grid = kid(n, "elevationGrid");
  return {
    id: n.attrs.id ?? "", name: n.attrs.name ?? "", type: n.attrs.type ?? "default",
    connections: kids(n, "connection").map((c) => ({
      id: c.attrs.id ?? "", incomingRoad: c.attrs.incomingRoad ?? "", connectingRoad: c.attrs.connectingRoad ?? "",
      contactPoint: c.attrs.contactPoint ?? "",
      laneLinks: kids(c, "laneLink").map((ll) => ({ from: num(ll, "from"), to: num(ll, "to") })),
    })),
    crossPaths: kids(n, "crossPath").map((c) => {
      const ll = (x: XmlNode | undefined) => (x ? { s: num(x, "s"), from: num(x, "from"), to: num(x, "to") } : null);
      return {
        id: c.attrs.id ?? "", crossingRoad: c.attrs.crossingRoad ?? "", roadAtStart: c.attrs.roadAtStart ?? "", roadAtEnd: c.attrs.roadAtEnd ?? "",
        startLaneLink: ll(kid(c, "startLaneLink")), endLaneLink: ll(kid(c, "endLaneLink")),
      };
    }),
    priorities: kids(n, "priority").map((p) => ({ high: p.attrs.high ?? "", low: p.attrs.low ?? "" })),
    controllers: kids(n, "controller").map((c) => ({ id: c.attrs.id ?? "", type: c.attrs.type ?? "", sequence: c.attrs.sequence ?? "" })),
    boundary: kids(kid(n, "boundary"), "segment").map((g) => ({
      type: g.attrs.type === "joint" ? "joint" : "lane", roadId: g.attrs.roadId ?? "",
      boundaryLane: num(g, "boundaryLane"), sStart: g.attrs.sStart ?? "start", sEnd: g.attrs.sEnd ?? "end",
      contactPoint: g.attrs.contactPoint ?? "end",
      jointLaneStart: g.attrs.jointLaneStart !== undefined ? num(g, "jointLaneStart") : null,
      jointLaneEnd: g.attrs.jointLaneEnd !== undefined ? num(g, "jointLaneEnd") : null,
    })),
    refLine: byS(kids(kid(n, "planView"), "geometry").map(geometry)),
    elevationGrid: grid ? {
      gridSpacing: num(grid, "gridSpacing"), sStart: num(grid, "sStart"),
      rows: kids(grid, "elevation").map((e) => ({ center: numList(e.attrs.center), left: numList(e.attrs.left), right: numList(e.attrs.right) })),
    } : null,
    userData: userData(n),
  };
}

export function parseOpenDrive(text: string): OpenDrive {
  const doc = parseXml(text);
  const od = kid(doc, "OpenDRIVE");
  if (!od) throw new Error("not an OpenDRIVE file: no <OpenDRIVE> root element");
  const h = kid(od, "header");
  const off = kid(h, "offset"), lic = kid(h, "license");
  return {
    header: {
      revMajor: num(h, "revMajor", 1), revMinor: num(h, "revMinor", 4), name: h?.attrs.name ?? "",
      vendor: h?.attrs.vendor ?? "", date: h?.attrs.date ?? "",
      geoReference: (kid(h, "geoReference")?.text ?? "").trim(),
      version: h?.attrs.version ?? "",
      bounds: h && ["north", "south", "east", "west"].every((k) => h.attrs[k] !== undefined)
        ? { north: num(h, "north"), south: num(h, "south"), east: num(h, "east"), west: num(h, "west") } : null,
      license: lic ? { name: lic.attrs.name ?? "", resource: lic.attrs.resource ?? "", spdxid: lic.attrs.spdxid ?? "", text: lic.text.trim() } : null,
      userData: userData(h),
      offset: { x: num(off, "x"), y: num(off, "y"), z: num(off, "z"), hdg: num(off, "hdg") },
    },
    roads: kids(od, "road").map(road),
    junctions: kids(od, "junction").map(junction),
    controllers: kids(od, "controller").map((c): Controller => ({
      id: c.attrs.id ?? "", name: c.attrs.name ?? "", sequence: c.attrs.sequence ?? "",
      controls: kids(c, "control").map((x) => ({ signalId: x.attrs.signalId ?? "", type: x.attrs.type ?? "" })),
    })),
    junctionGroups: kids(od, "junctionGroup").map((g) => ({
      id: g.attrs.id ?? "", name: g.attrs.name ?? "", type: g.attrs.type ?? "",
      junctions: kids(g, "junctionReference").map((r) => r.attrs.junction ?? ""),
    })),
  };
}

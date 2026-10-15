// OpenDRIVE data model as read from a .xodr file (ASAM OpenDRIVE 1.4 - 1.8; element names per the 1.8.1 XSD).

/** cubic a + b ds + c ds^2 + d ds^3, ds measured from `s` (absolute s, or sOffset within a lane section) */
export interface Poly3 { s: number; a: number; b: number; c: number; d: number; }

export type GeomKind = "line" | "arc" | "spiral" | "poly3" | "paramPoly3";

/** one planView <geometry> (1.8.0 §9.4 - §9.7) */
export interface Geom {
  s: number; x: number; y: number; hdg: number; length: number; kind: GeomKind;
  k0: number; k1: number; // arc: k0 = k1 = curvature; spiral: curvStart / curvEnd
  aU: number; bU: number; cU: number; dU: number; aV: number; bV: number; cV: number; dV: number;
  normalized: boolean; // paramPoly3 @pRange
}

export interface LaneHeight { s: number; inner: number; outer: number; }
/** one explicit <line> of a road mark's <type> (1.8.0 §11.8.3): dash length / gap, lateral offset */
export interface MarkLine { length: number; space: number; tOffset: number; sOffset: number; width: number; color: string; rule: string; }
export interface RoadMark { s: number; type: string; color: string; width: number; weight: string; laneChange: string; lines: MarkLine[]; }

export interface Lane {
  id: number; type: string; direction: string; level: boolean;
  widths: Poly3[]; // sOffset relative to the section start (1.8.0 §11.6.1)
  borders: Poly3[]; // alternative to widths (1.8.0 §11.6.2)
  heights: LaneHeight[];
  marks: RoadMark[];
  pred: number | null; succ: number | null;
  speed: number | null; // m/s, first <speed> record
}

export interface LaneSection { s: number; singleSide: boolean; left: Lane[]; right: Lane[]; center: Lane | null; }

export interface Link { type: string; id: string; contact: string; }

export interface Signal {
  id: string; name: string; s: number; t: number; zOffset: number; dynamic: boolean; orientation: string;
  type: string; subtype: string; country: string; value: number | null; unit: string;
  height: number; width: number; hOffset: number; text: string;
  validity: { fromLane: number; toLane: number }[];
  dependencies: { id: string; type: string }[];
  references: { elementType: string; elementId: string; type: string }[];
  semantics: string[]; // e.g. "priority: trafficLight", "speed: maximum 30 km/h"
}

export interface RoadObject {
  id: string; name: string; type: string; s: number; t: number; zOffset: number; hdg: number;
  length: number; width: number; radius: number; height: number;
  subtype: string;
  outline: { u: number; v: number; z: number }[]; // local corners (cornerLocal), empty when none
  repeats: ObjectRepeat[]; // 1.8.0 §13.3: the object repeated / stretched along the road
}

export interface ObjectRepeat {
  s: number; length: number; distance: number; tStart: number; tEnd: number;
  heightStart: number; heightEnd: number; zOffsetStart: number; zOffsetEnd: number;
  widthStart: number; widthEnd: number; lengthStart: number; lengthEnd: number;
}

/** <bridge> / <tunnel> (1.8.0 §13.11 / §13.12): a stretch of the road */
export interface Structure { kind: "bridge" | "tunnel"; id: string; name: string; s: number; length: number; type: string; }

export interface Road {
  id: string; name: string; length: number; junction: string; rule: "RHT" | "LHT";
  pred: Link | null; succ: Link | null;
  types: { s: number; type: string; speed: number | null; unit: string }[];
  geoms: Geom[];
  elevation: Poly3[]; superelevation: Poly3[]; laneOffset: Poly3[];
  sections: LaneSection[];
  signals: Signal[]; objects: RoadObject[]; structures: Structure[];
  userData: Record<string, string>;
}

export interface LaneLink { from: number; to: number; }
export interface Connection { id: string; incomingRoad: string; connectingRoad: string; contactPoint: string; laneLinks: LaneLink[]; }
/** one <boundary> <segment> (1.8.0 §12.10): along a lane's outer border, or across a road end ("joint") */
export interface BoundarySegment {
  type: "lane" | "joint"; roadId: string;
  boundaryLane: number; sStart: string; sEnd: string; // lane: s values or "start" / "end"
  contactPoint: string; jointLaneStart: number | null; jointLaneEnd: number | null; // joint
}
/** <crossPath> (1.8.0 §12.12): a pedestrian crossing road between two sidewalk lanes */
export interface CrossPath {
  id: string; crossingRoad: string; roadAtStart: string; roadAtEnd: string;
  startLaneLink: { s: number; from: number; to: number } | null; endLaneLink: { s: number; from: number; to: number } | null;
}
export interface Junction {
  id: string; name: string; type: string; connections: Connection[]; boundary: BoundarySegment[];
  crossPaths: CrossPath[]; priorities: { high: string; low: string }[]; controllers: { id: string; type: string; sequence: string }[];
}
/** <controller> (1.8.0 §14.6): signals switched together */
export interface Controller { id: string; name: string; sequence: string; controls: { signalId: string; type: string }[]; }

export interface Header {
  revMajor: number; revMinor: number; name: string; vendor: string; date: string;
  geoReference: string;
  offset: { x: number; y: number; z: number; hdg: number }; // 1.8.0 §6.3 <offset>: inertial = rotate(hdg) * local + (x, y)
}

export interface OpenDrive { header: Header; roads: Road[]; junctions: Junction[]; controllers: Controller[]; }

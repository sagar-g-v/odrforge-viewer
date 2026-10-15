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
export interface RoadMark { s: number; type: string; color: string; width: number; }

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
}

export interface RoadObject {
  id: string; name: string; type: string; s: number; t: number; zOffset: number; hdg: number;
  length: number; width: number; radius: number; height: number;
  outline: { u: number; v: number; z: number }[]; // local corners (cornerLocal), empty when none
}

export interface Road {
  id: string; name: string; length: number; junction: string; rule: "RHT" | "LHT";
  pred: Link | null; succ: Link | null;
  types: { s: number; type: string; speed: number | null; unit: string }[];
  geoms: Geom[];
  elevation: Poly3[]; superelevation: Poly3[]; laneOffset: Poly3[];
  sections: LaneSection[];
  signals: Signal[]; objects: RoadObject[];
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
export interface Junction { id: string; name: string; type: string; connections: Connection[]; boundary: BoundarySegment[]; }

export interface Header {
  revMajor: number; revMinor: number; name: string; vendor: string; date: string;
  geoReference: string;
  offset: { x: number; y: number; z: number; hdg: number }; // 1.8.0 §6.3 <offset>: inertial = rotate(hdg) * local + (x, y)
}

export interface OpenDrive { header: Header; roads: Road[]; junctions: Junction[]; }

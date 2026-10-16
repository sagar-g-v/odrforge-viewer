// Lane colours by OpenDRIVE lane type (1.8.0 §11.7, Table 59): the design system's sets for the dark and the light
// theme (docs/design-system.md §3, src/design/tokens.css --lane-*), tuned for colour-vision deficiency; alpha ~.92.
import type { LaneMeta } from "../xodr/build";

export type Rgba = [number, number, number, number];

const DARK: Record<string, Rgba> = {
  driving: [74, 85, 102, 235], junction: [102, 116, 138, 235], sidewalk: [156, 150, 138, 235], walking: [156, 150, 138, 235],
  curb: [210, 205, 194, 235], biking: [30, 140, 97, 235], parking: [84, 117, 178, 235], shoulder: [176, 154, 98, 235],
  border: [68, 57, 48, 235], median: [61, 107, 46, 235], restricted: [183, 50, 46, 235], bidirectional: [160, 152, 201, 235],
  bus: [219, 160, 75, 235], stop: [176, 154, 98, 235], entry: [74, 85, 102, 235], exit: [74, 85, 102, 235],
  onRamp: [74, 85, 102, 235], offRamp: [74, 85, 102, 235], connectingRamp: [74, 85, 102, 235],
  rail: [90, 90, 90, 230], tram: [100, 100, 110, 230], none: [60, 60, 60, 120],
};
const LIGHT: Record<string, Rgba> = {
  driving: [125, 136, 152, 235], junction: [161, 173, 189, 235], sidewalk: [217, 210, 196, 235], walking: [217, 210, 196, 235],
  curb: [241, 237, 229, 235], biking: [81, 196, 159, 235], parking: [132, 159, 211, 235], shoulder: [198, 170, 117, 235],
  border: [147, 125, 92, 235], median: [156, 200, 90, 235], restricted: [223, 127, 126, 235], bidirectional: [196, 188, 226, 235],
  bus: [210, 134, 48, 235], stop: [198, 170, 117, 235], entry: [125, 136, 152, 235], exit: [125, 136, 152, 235],
  onRamp: [125, 136, 152, 235], offRamp: [125, 136, 152, 235], connectingRamp: [125, 136, 152, 235],
  rail: [150, 150, 150, 230], tram: [160, 160, 170, 230], none: [200, 200, 200, 120],
};
export const SELECTED: Rgba = [30, 155, 255, 255]; // --data-selected #1e9bff

export function laneColor(m: LaneMeta, theme: "dark" | "light", selected: boolean): Rgba {
  if (selected) return SELECTED;
  const t = theme === "dark" ? DARK : LIGHT;
  if (m.junction && m.type === "driving") return t.junction;
  return t[m.type] ?? t.driving;
}

export const LEGEND = ["driving", "junction", "sidewalk", "curb", "biking", "parking", "shoulder", "border", "median", "restricted", "bidirectional", "bus"];
export const legendColor = (type: string, theme: "dark" | "light") => (theme === "dark" ? DARK : LIGHT)[type] ?? DARK.driving;

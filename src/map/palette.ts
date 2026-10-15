// Lane colours by OpenDRIVE lane type (1.8.0 §11.7, Table 59), tuned for the dark and the light basemap.
import type { LaneMeta } from "../xodr/build";

export type Rgba = [number, number, number, number];

const DARK: Record<string, Rgba> = {
  driving: [72, 80, 96, 235], junction: [92, 104, 124, 235], sidewalk: [150, 146, 136, 240], walking: [150, 146, 136, 240],
  curb: [190, 186, 176, 245], biking: [47, 140, 105, 235], parking: [45, 90, 140, 230], shoulder: [110, 98, 76, 230],
  border: [96, 84, 72, 220], median: [53, 110, 60, 230], restricted: [160, 70, 70, 230], bidirectional: [120, 96, 150, 235],
  bus: [170, 90, 40, 235], stop: [130, 100, 60, 230], entry: [80, 92, 112, 235], exit: [80, 92, 112, 235],
  onRamp: [80, 92, 112, 235], offRamp: [80, 92, 112, 235], connectingRamp: [80, 92, 112, 235],
  rail: [90, 90, 90, 230], tram: [100, 100, 110, 230], none: [60, 60, 60, 120],
};
const LIGHT: Record<string, Rgba> = {
  driving: [120, 128, 142, 235], junction: [146, 156, 172, 235], sidewalk: [214, 208, 196, 245], walking: [214, 208, 196, 245],
  curb: [236, 232, 224, 250], biking: [110, 190, 150, 235], parking: [120, 160, 205, 230], shoulder: [180, 166, 136, 230],
  border: [170, 156, 140, 220], median: [120, 175, 120, 230], restricted: [215, 120, 120, 230], bidirectional: [170, 145, 200, 235],
  bus: [220, 140, 80, 235], stop: [190, 160, 110, 230], entry: [130, 140, 156, 235], exit: [130, 140, 156, 235],
  onRamp: [130, 140, 156, 235], offRamp: [130, 140, 156, 235], connectingRamp: [130, 140, 156, 235],
  rail: [150, 150, 150, 230], tram: [160, 160, 170, 230], none: [200, 200, 200, 120],
};
const SELECTED: Rgba = [90, 169, 255, 255];

export function laneColor(m: LaneMeta, theme: "dark" | "light", selected: boolean): Rgba {
  if (selected) return SELECTED;
  const t = theme === "dark" ? DARK : LIGHT;
  if (m.junction && m.type === "driving") return t.junction;
  return t[m.type] ?? t.driving;
}

export const LEGEND = ["driving", "junction", "sidewalk", "curb", "biking", "parking", "shoulder", "border", "median", "restricted", "bidirectional", "bus"];
export const legendColor = (type: string, theme: "dark" | "light") => (theme === "dark" ? DARK : LIGHT)[type] ?? DARK.driving;

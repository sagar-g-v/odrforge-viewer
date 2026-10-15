// Checker findings as map markers: ASAM Quality Checker reports (.xqar, qc-opendrive), OdrForge exact invariants
// (tools/inspect/invariants.py -> invariants.json) and a generic {"findings": [{x, y, rule, message}]} JSON.
import { parseXml, type XmlNode } from "../xodr/xml";

export interface Finding {
  source: string; // "ASAM qc", "invariants", ...
  rule: string;
  level: "error" | "warning" | "info";
  message: string;
  x: number; y: number; // file coordinates
  road?: string;
}

function walk(n: XmlNode, tag: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of n.children) { if (c.tag === tag) out.push(c); walk(c, tag, out); }
  return out;
}

export function parseXqar(text: string): Finding[] {
  const out: Finding[] = [];
  for (const issue of walk(parseXml(text), "Issue")) {
    const loc = walk(issue, "InertialLocation")[0];
    if (!loc) continue;
    const lvl = Number(issue.attrs.level ?? 2);
    out.push({
      source: "ASAM qc",
      rule: (issue.attrs.ruleUID ?? "").replace(/^asam\.net:xodr:[\d.]+:/, ""),
      level: lvl === 1 ? "error" : lvl === 2 ? "warning" : "info",
      message: issue.attrs.description ?? "",
      x: Number(loc.attrs.x), y: Number(loc.attrs.y),
    });
  }
  return out;
}

export function parseFindingsJson(text: string): Finding[] {
  const d = JSON.parse(text);
  const out: Finding[] = [];
  if (d.invariants) {
    for (const [rule, v] of Object.entries(d.invariants as Record<string, { level?: string; instances?: Record<string, unknown>[] }>)) {
      for (const i of v.instances ?? []) {
        if (typeof i.x !== "number" || typeof i.y !== "number") continue;
        out.push({
          source: "invariants", rule, level: v.level === "MUST" ? "error" : "warning",
          message: `value ${i.value ?? ""}${i.limit !== undefined ? ` (limit ${i.limit})` : ""}${i.lane !== undefined ? ` lane ${i.lane}` : ""}${i.s !== undefined ? ` s ${i.s}` : ""}`,
          x: i.x, y: i.y, road: i.road !== undefined ? String(i.road) : undefined,
        });
      }
    }
  } else if (Array.isArray(d.findings)) {
    for (const f of d.findings)
      if (typeof f.x === "number" && typeof f.y === "number")
        out.push({ source: f.source ?? "findings", rule: f.rule ?? "finding", level: f.level ?? "warning", message: f.message ?? "", x: f.x, y: f.y, road: f.road });
  }
  return out;
}

export function parseFindings(name: string, text: string): Finding[] {
  return /\.xqar$/i.test(name) || text.trimStart().startsWith("<") ? parseXqar(text) : parseFindingsJson(text);
}


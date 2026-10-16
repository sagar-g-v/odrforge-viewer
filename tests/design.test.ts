// Guards docs/design-system.md (§2 contrast, §3 colour-blind separation, §3/§8 one meaning per overlay hue) from the
// sources the app uses: src/design/tokens.css, src/map/palette.ts and src/design/scene.ts. Limits are the documented,
// measured values; do not lower one to make a change pass (docs/ACCURACY.md §7).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGEND, legendColor, SELECTED } from "../src/map/palette";
import { JUNCTION, MARK, MARKER, OVERLAY, SIGNAL } from "../src/design/scene";

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

// ---------- tokens.css: both themes, var() chains resolved ----------
const css = readFileSync(new URL("../src/design/tokens.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
function themeVars(theme: "dark" | "light"): Map<string, string> {
  const vars = new Map<string, string>();
  const blocks = [...css.matchAll(/(:root(?:\[data-theme="light"\])?)\s*\{([^{}]*)\}/g)];
  for (const pass of ["base", "light"] as const) {
    for (const [, sel, body] of blocks) {
      const isLight = sel.includes("light");
      if ((pass === "base" && isLight) || (pass === "light" && (!isLight || theme === "dark"))) continue;
      for (const [, k, v] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars.set(k, v.trim());
    }
  }
  return vars;
}
function resolve(vars: Map<string, string>, name: string, depth = 0): string {
  const v = vars.get(name);
  if (v === undefined) throw new Error(`--${name} is not defined`);
  const m = v.match(/^var\(--([\w-]+)\)$/);
  return m && depth < 10 ? resolve(vars, m[1], depth + 1) : v;
}
function parseColor(s: string): RGBA {
  const h = s.match(/^#([0-9a-f]{6})$/i);
  if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const r = s.match(/^rgba?\(([^)]+)\)$/);
  if (r) { const p = r[1].split(",").map((x) => parseFloat(x)); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error(`not a colour: ${s}`);
}
const THEMES = { dark: themeVars("dark"), light: themeVars("light") };
const tok = (theme: "dark" | "light", name: string): RGB => {
  const c = parseColor(resolve(THEMES[theme], name));
  expect(c[3], `--${name} (${theme}) must be opaque to be checked for contrast`).toBe(1);
  return [c[0], c[1], c[2]];
};

// ---------- WCAG 2.x contrast ----------
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---------- CIELAB ΔE76 under Machado 2009 colour-vision simulation ----------
const MACHADO: Record<string, number[][]> = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const gam = (c: number) => { c = Math.min(Math.max(c, 0), 1); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055); };
const simulate = (c: RGB, mode: string): RGB => {
  if (mode === "normal") return c;
  const l = c.map(lin), m = MACHADO[mode];
  return m.map((row) => gam(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])) as RGB;
};
const lab = (c: RGB) => {
  const [r, g, b] = c.map(lin);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
export const deltaE = (a: RGB, b: RGB, mode = "normal") => { const p = lab(simulate(a, mode)), q = lab(simulate(b, mode)); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const rgb = (c: number[]): RGB => [c[0], c[1], c[2]];
const minPair = (cols: Record<string, RGB>, mode: string) => {
  const k = Object.keys(cols); let best = { d: Infinity, a: "", b: "" };
  for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
    const d = deltaE(cols[k[i]], cols[k[j]], mode); if (d < best.d) best = { d, a: k[i], b: k[j] };
  }
  return best;
};

// ---------- §2 contrast: every documented pair, both themes ----------
const TEXT = ["text", "muted", "accent", "secondary", "ok", "warn", "err", "info"];
const SURFACES = ["bg", "surface", "surface-2", "surface-3"];
const PAIRS: [string, string, number][] = [
  ...TEXT.flatMap((t) => SURFACES.map((s) => [t, s, 4.5] as [string, string, number])),
  ["ok", "ok-soft", 4.5], ["warn", "warn-soft", 4.5], ["err", "err-soft", 4.5], ["info", "info-soft", 4.5], ["secondary", "secondary-soft", 4.5], ["accent", "accent-soft", 4.5],
  ["accent-ink", "accent", 4.5], ["accent-ink", "accent-hover", 4.5], ["secondary-ink", "secondary", 4.5], ["warn-ink", "warn-solid", 4.5],
  ["topbar-ink", "topbar-start", 4.5], ["topbar-ink", "topbar-end", 4.5], ["topbar-on-ink", "topbar-on", 4.5], // active segment on the sky bar
  ["line-strong", "surface", 3], ["line-strong", "surface-2", 3], ["focus", "surface", 3], ["focus", "surface-2", 3], ["focus", "bg", 3],
];

describe("design contract §2: WCAG AA contrast in both themes (tokens.css)", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme}: text ≥ 4.5:1, control boundaries and focus ≥ 3:1`, () => {
      const fails = PAIRS.map(([fg, bg, min]) => ({ fg, bg, min, r: contrast(tok(theme, fg), tok(theme, bg)) })).filter((p) => p.r < p.min);
      expect(fails.map((f) => `--${f.fg} on --${f.bg}: ${f.r.toFixed(2)} < ${f.min}`)).toEqual([]);
    });
  }
});

// ---------- §3 lanes: the drawn set equals the documented set, and keeps its colour-blind separation ----------
// worst pair ΔE76 per vision mode, measured on the proven sets (docs/design-system.md §3); limits = measured, floored
const LANE_MIN: Record<"dark" | "light", Record<string, number>> = {
  dark: { normal: 12.5, deuteranopia: 12.5, protanopia: 12.5, tritanopia: 9.5 },
  light: { normal: 9.5, deuteranopia: 9.5, protanopia: 9.5, tritanopia: 6.5 },
};
describe("design contract §3: lane colours (palette.ts = tokens.css, colour-blind ΔE minimums)", () => {
  for (const theme of ["dark", "light"] as const) {
    const lanes = Object.fromEntries(LEGEND.map((t) => [t, rgb(legendColor(t, theme))])) as Record<string, RGB>;
    it(`${theme}: palette.ts draws exactly the --lane-* colours of tokens.css`, () => {
      for (const t of LEGEND) expect(lanes[t], t).toEqual(tok(theme, `lane-${t}`));
    });
    for (const [mode, min] of Object.entries(LANE_MIN[theme])) {
      it(`${theme}: closest lane pair under ${mode} keeps ΔE ≥ ${min}`, () => {
        const p = minPair(lanes, mode);
        expect(p.d, `${p.a} / ${p.b}`).toBeGreaterThanOrEqual(min);
      });
    }
  }
});

// ---------- §3 / §8 one meaning per overlay hue ----------
// distinct meanings drawn over the map; a hue may be shared only where the doc says so (listed in SHARED)
const OVERLAYS: Record<string, RGB> = {
  selected: rgb(OVERLAY.selected), junction: rgb(OVERLAY.junctionEdge), virtualJunction: rgb(OVERLAY.virtualEdge), crossPath: rgb(OVERLAY.crossPath), junctionRef: rgb(OVERLAY.junctionRef), refLine: rgb(OVERLAY.refLine),
  elevation: rgb(OVERLAY.elevation), compare: rgb(OVERLAY.compare),
  flagOpen: rgb(MARKER.flag.open), flagFixed: rgb(MARKER.flag.fixed), flagQuestion: rgb(MARKER.flag.question), flagWontfix: rgb(MARKER.flag.wontfix),
  findingError: rgb(MARKER.finding.error), findingWarning: rgb(MARKER.finding.warning), findingInfo: rgb(MARKER.finding.info),
};
// documented shares: amber = junction areas and open flags; the "attention" family (open flag, warning finding);
// question flags and info findings are the same "info" meaning
const SHARED = [["junction", "flagOpen"], ["flagOpen", "findingWarning"], ["junction", "findingWarning"], ["flagQuestion", "findingInfo"]];
const shared = (a: string, b: string) => SHARED.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
const OVERLAY_MIN = 20; //    ΔE76 between two different meanings
const UNIQUE_MIN: Record<string, number> = { compare: 30, crossPath: 25, refLine: 40, virtualJunction: 24 }; // against everything else drawn (cross path vs elevation teal: 25.1)
const SELECTED_MIN = 25; //   selection against every lane colour and overlay

describe("design contract §3/§8: one meaning per overlay hue (scene.ts, palette.ts)", () => {
  it(`different meanings stay ΔE ≥ ${OVERLAY_MIN} apart`, () => {
    const k = Object.keys(OVERLAYS), bad: string[] = [];
    for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
      if (shared(k[i], k[j])) continue;
      const d = deltaE(OVERLAYS[k[i]], OVERLAYS[k[j]]); if (d < OVERLAY_MIN) bad.push(`${k[i]} / ${k[j]}: ${d.toFixed(1)}`);
    }
    expect(bad).toEqual([]);
  });
  const everythingElse = (skip: string) => {
    const out: Record<string, RGB> = {};
    for (const [k, v] of Object.entries(OVERLAYS)) if (k !== skip) out[k] = v;
    for (const theme of ["dark", "light"] as const) for (const t of LEGEND) out[`lane ${t} (${theme})`] = rgb(legendColor(t, theme));
    for (const [k, v] of Object.entries(SIGNAL)) out[`signal ${k}`] = rgb(v);
    for (const [k, v] of Object.entries(MARKER.dot)) out[`dot ${k}`] = rgb(v);
    for (const [k, v] of Object.entries(MARK)) out[`mark ${k}`] = rgb(v);
    return out;
  };
  for (const key of ["compare", "crossPath", "refLine", "virtualJunction"]) {
    it(`${key} is used for nothing else (ΔE ≥ ${UNIQUE_MIN[key]} from every lane, overlay, marker and signal colour)`, () => {
      const bad = Object.entries(everythingElse(key)).map(([k, v]) => [k, deltaE(OVERLAYS[key], v)] as const).filter(([, d]) => d < UNIQUE_MIN[key]);
      expect(bad.map(([k, d]) => `${k}: ${d.toFixed(1)}`)).toEqual([]);
    });
  }
  it(`selection stands out from every lane colour and overlay (ΔE ≥ ${SELECTED_MIN}); palette.ts and scene.ts agree`, () => {
    expect(rgb(SELECTED)).toEqual(OVERLAYS.selected);
    const bad = Object.entries(everythingElse("selected")).filter(([k]) => !k.startsWith("signal") && !k.startsWith("dot") && !k.startsWith("mark "))
      .map(([k, v]) => [k, deltaE(OVERLAYS.selected, v)] as const).filter(([, d]) => d < SELECTED_MIN);
    expect(bad.map(([k, d]) => `${k}: ${d.toFixed(1)}`)).toEqual([]);
  });
  it("virtual and real junctions stay apart in every vision mode (ΔE ≥ 40) and differ in fill form", () => {
    for (const mode of ["normal", "deuteranopia", "protanopia", "tritanopia"])
      expect(deltaE(OVERLAYS.junction, OVERLAYS.virtualJunction, mode), mode).toBeGreaterThanOrEqual(40);
    expect(JUNCTION.kind("virtual")).toBe("virtual");
    for (const t of ["default", "direct", "crossing", ""]) expect(JUNCTION.kind(t), t).toBe("real");
    expect(JUNCTION.hatch.line).toBeGreaterThan(0);
  });
  it("2D sign and object dots never look like a finding (ΔE ≥ 20 from every finding colour)", () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(MARKER.dot)) for (const [f, c] of Object.entries(MARKER.finding)) {
      const d = deltaE(rgb(v), rgb(c)); if (d < 20) bad.push(`dot ${k} / finding ${f}: ${d.toFixed(1)}`);
    }
    expect(bad).toEqual([]);
  });
});

// one-off report of the measured numbers, kept so a reviewer can see the margins
describe.skipIf(!process.env.DESIGN_REPORT)("design contract: report", () => {
  it("prints the measured values", () => {
    for (const theme of ["light", "dark"] as const) {
      const worst = PAIRS.map(([fg, bg, min]) => ({ p: `${fg}/${bg}`, r: contrast(tok(theme, fg), tok(theme, bg)), min })).sort((a, b) => a.r / a.min - b.r / b.min).slice(0, 5);
      console.log(theme, "tightest contrast", worst.map((w) => `${w.p} ${w.r.toFixed(2)}`).join(", "));
      const lanes = Object.fromEntries(LEGEND.map((t) => [t, rgb(legendColor(t, theme))])) as Record<string, RGB>;
      for (const mode of ["normal", "deuteranopia", "protanopia", "tritanopia"]) { const p = minPair(lanes, mode); console.log(theme, mode, p.a, p.b, p.d.toFixed(2)); }
    }
    const k = Object.keys(OVERLAYS); const ds: [string, number][] = [];
    for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) ds.push([`${k[i]}/${k[j]}`, deltaE(OVERLAYS[k[i]], OVERLAYS[k[j]])]);
    console.log("closest overlays", ds.sort((a, b) => a[1] - b[1]).slice(0, 8).map(([n, d]) => `${n} ${d.toFixed(1)}`).join(", "));
  });
});

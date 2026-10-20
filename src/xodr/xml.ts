// Minimal XML reader for OpenDRIVE files. Runs where DOMParser does not (Web Workers, Node tests): elements,
// attributes, text and CDATA; comments, processing instructions and DOCTYPE are skipped. Entities in attribute
// values and text are decoded (the five predefined ones and numeric references).
// It is strict about structure: an element left open at the end (a truncated file), a closing tag that does not match,
// or an unterminated tag, comment or CDATA section throws an XmlError naming the line, so a broken file is never shown
// as a partial network.

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITY[e] ?? m;
  });
}

const ATTR = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export class XmlError extends Error {}
const lineOf = (src: string, at: number) => { let l = 1; for (let k = src.indexOf("\n"); k >= 0 && k < at; k = src.indexOf("\n", k + 1)) l++; return l; };

export function parseXml(src: string): XmlNode {
  const opened: number[] = []; // where each open element starts (for messages)
  const fail = (msg: string, at: number) => { throw new XmlError(`malformed XML: ${msg} (line ${lineOf(src, at)})`); };
  const root: XmlNode = { tag: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) {
      const text = src.slice(i, lt);
      if (text.trim()) stack[stack.length - 1].text += decode(text);
    }
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end < 0) fail("a comment is not closed", lt);
      i = end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      if (end < 0) fail("a CDATA section is not closed", lt);
      stack[stack.length - 1].text += src.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (src[lt + 1] === "?" || src[lt + 1] === "!") {
      const end = src.indexOf(">", lt + 2);
      if (end < 0) fail("a declaration is not closed", lt);
      i = end + 1;
      continue;
    }
    // a tag: find its end outside quoted attribute values
    let j = lt + 1;
    let quote = "";
    while (j < n) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j++;
    }
    if (j >= n) fail("a tag is not closed (file truncated?)", lt);
    const body = src.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === "/") {
      const name = body.slice(1).trim(), top = stack[stack.length - 1];
      if (stack.length === 1) fail(`</${name}> closes nothing`, lt);
      if (name !== top.tag) fail(`</${name}> closes <${top.tag}>`, lt);
      stack.pop();
      opened.pop();
      continue;
    }
    const selfClosing = body.endsWith("/");
    const inner = selfClosing ? body.slice(0, -1) : body;
    const sp = inner.search(/\s/);
    const tag = sp < 0 ? inner : inner.slice(0, sp);
    const attrs: Record<string, string> = {};
    if (sp >= 0) {
      ATTR.lastIndex = 0;
      const rest = inner.slice(sp);
      let m: RegExpExecArray | null;
      while ((m = ATTR.exec(rest))) attrs[m[1]] = decode(m[3] ?? m[4] ?? "");
    }
    const node: XmlNode = { tag, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) { stack.push(node); opened.push(lt); }
  }
  if (stack.length > 1) fail(`<${stack[stack.length - 1].tag}> is not closed (file truncated?)`, opened[opened.length - 1]);
  return root;
}

export const kids = (n: XmlNode | undefined, tag: string): XmlNode[] => (n ? n.children.filter((c) => c.tag === tag) : []);
export const kid = (n: XmlNode | undefined, tag: string): XmlNode | undefined => n?.children.find((c) => c.tag === tag);
/** where num() reports attribute values that are not numbers (set while a file is read; parse.ts) */
let numberIssues: Map<string, number> | null = null;
/** run `read` collecting the non-numeric attribute values num() met: "tag@attr="value"" -> count */
export function collectNumberIssues<T>(read: () => T): [T, Map<string, number>] {
  const prev = numberIssues, found = new Map<string, number>();
  numberIssues = found;
  try { return [read(), found]; } finally { numberIssues = prev; }
}
export const num = (n: XmlNode | undefined, a: string, def = 0): number => {
  const v = n?.attrs[a];
  if (v === undefined || v === "") return def;
  const x = Number(v);
  if (Number.isFinite(x)) return x;
  if (numberIssues && n) { const k = `<${n.tag}> ${a}="${v.length > 24 ? v.slice(0, 24) + "…" : v}"`; numberIssues.set(k, (numberIssues.get(k) ?? 0) + 1); }
  return def;
};

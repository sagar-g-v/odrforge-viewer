// Minimal XML reader for OpenDRIVE files. Runs where DOMParser does not (Web Workers, Node tests): elements,
// attributes, text and CDATA; comments, processing instructions and DOCTYPE are skipped. Entities in attribute
// values and text are decoded (the five predefined ones and numeric references).

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

export function parseXml(src: string): XmlNode {
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
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      stack[stack.length - 1].text += src.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src[lt + 1] === "?" || src[lt + 1] === "!") {
      const end = src.indexOf(">", lt + 2);
      i = end < 0 ? n : end + 1;
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
    const body = src.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === "/") {
      if (stack.length > 1) stack.pop();
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
    if (!selfClosing) stack.push(node);
  }
  return root;
}

export const kids = (n: XmlNode | undefined, tag: string): XmlNode[] => (n ? n.children.filter((c) => c.tag === tag) : []);
export const kid = (n: XmlNode | undefined, tag: string): XmlNode | undefined => n?.children.find((c) => c.tag === tag);
export const num = (n: XmlNode | undefined, a: string, def = 0): number => {
  const v = n?.attrs[a];
  if (v === undefined || v === "") return def;
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
};

// Minimal, dependency-free XML reader/writer helpers. Enough for mxGraph / draw.io files: elements,
// attributes, text, entities, comments, CDATA and processing instructions. It runs anywhere (the
// unit tests run in Node, which has no DOMParser) and never executes or fetches anything.

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text content (entities decoded). */
  text: string;
}

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Escapes text for an attribute value or element body (newlines kept as &#10; in attributes). */
export function escapeXml(s: string, attr = true): string {
  const out = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return attr ? out.replace(/"/g, "&quot;").replace(/\n/g, "&#10;") : out;
}

const NAME = /[A-Za-z_:][-\w:.]*/y;
const ATTR = /\s*([A-Za-z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

/** Parses an XML document and returns its root element. Throws XmlError on malformed input. */
export function parseXml(src: string): XmlElement {
  let i = 0;
  const root: XmlElement = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  const fail = (msg: string): never => {
    throw new XmlError(`${msg} (at character ${i})`);
  };

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const top = stack[stack.length - 1];
    if (lt === -1) {
      top.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));
    i = lt;
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end === -1) fail("Unclosed comment");
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      if (end === -1) fail("Unclosed CDATA section");
      top.text += src.slice(i + 9, end);
      i = end + 3;
    } else if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2);
      if (end === -1) fail("Unclosed processing instruction");
      i = end + 2;
    } else if (src.startsWith("<!", i)) {
      // DOCTYPE (internal subsets with nested brackets are not supported, nor needed).
      const end = src.indexOf(">", i + 2);
      if (end === -1) fail("Unclosed declaration");
      i = end + 1;
    } else if (src[i + 1] === "/") {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(src);
      if (!m) fail("Bad closing tag");
      const name = m![0];
      const end = src.indexOf(">", NAME.lastIndex);
      if (end === -1) fail("Unclosed closing tag");
      const open = stack.pop();
      if (!open || open === root || open.name !== name) fail(`Unexpected </${name}>`);
      i = end + 1;
    } else {
      NAME.lastIndex = i + 1;
      const m = NAME.exec(src);
      if (!m) fail("Bad tag");
      const el: XmlElement = { name: m![0], attrs: {}, children: [], text: "" };
      let j = NAME.lastIndex;
      for (;;) {
        ATTR.lastIndex = j;
        const a = ATTR.exec(src);
        if (!a) break;
        el.attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? "");
        j = ATTR.lastIndex;
      }
      while (j < src.length && /\s/.test(src[j])) j++;
      top.children.push(el);
      if (src.startsWith("/>", j)) {
        i = j + 2;
      } else if (src[j] === ">") {
        stack.push(el);
        i = j + 1;
      } else {
        fail(`Malformed <${el.name}> tag`);
      }
    }
  }
  if (stack.length > 1) fail(`Unclosed <${stack[stack.length - 1].name}>`);
  const docEl = root.children[0];
  if (!docEl) throw new XmlError("The document has no root element");
  return docEl;
}

/** Direct children with a given name. */
export const childrenNamed = (el: XmlElement, name: string) => el.children.filter((c) => c.name === name);

/** Depth-first search for the first descendant (or self) with a given name. */
export function findFirst(el: XmlElement, name: string): XmlElement | undefined {
  if (el.name === name) return el;
  for (const c of el.children) {
    const hit = findFirst(c, name);
    if (hit) return hit;
  }
  return undefined;
}

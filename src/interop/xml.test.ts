import { describe, expect, it } from "vitest";
import { decodeEntities, escapeXml, findFirst, parseXml } from "./xml";

describe("xml", () => {
  it("parses elements, attributes, entities, comments and CDATA", () => {
    const root = parseXml(`<?xml version="1.0"?>
<!-- top -->
<a x="1" y='two &amp; &lt;3&gt;'><b/><c k="&#10;&#x41;">text <![CDATA[<raw>]]> &quot;q&quot;</c></a>`);
    expect(root.name).toBe("a");
    expect(root.attrs).toEqual({ x: "1", y: "two & <3>" });
    expect(root.children.map((c) => c.name)).toEqual(["b", "c"]);
    expect(root.children[1].attrs.k).toBe("\nA");
    expect(root.children[1].text).toBe('text <raw> "q"');
    expect(findFirst(root, "c")?.name).toBe("c");
  });

  it("rejects malformed documents", () => {
    expect(() => parseXml("<a><b></a>")).toThrow(/Unexpected/);
    expect(() => parseXml("<a>")).toThrow(/Unclosed/);
    expect(() => parseXml("")).toThrow(/no root/);
  });

  it("escapes and decodes symmetrically", () => {
    const s = `a & b < c > "d"\nline`;
    expect(decodeEntities(escapeXml(s))).toBe(s);
    expect(parseXml(`<x v="${escapeXml(s)}"/>`).attrs.v).toBe(s);
  });
});

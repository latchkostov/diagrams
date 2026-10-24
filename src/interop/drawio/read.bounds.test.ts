import { afterEach, expect, it, vi } from "vitest";
import { opGrowth, ops } from "../../test/opCounter";
import { LIMITS } from "../native";
import { importText } from "../formats";
import { parseXml } from "../xml";
import { drawioPageToDiagram, htmlToLines } from "./read";

afterEach(() => vi.restoreAllMocks());

it("does not rescan an unterminated tag suffix", () => {
  const input = "<".repeat(8000);
  const search = vi.spyOn(String.prototype, "indexOf");
  expect(htmlToLines(input, true)).toEqual([input]);
  expect(search.mock.calls.filter(([delimiter]) => delimiter === ">")).toHaveLength(1);
});

it("scans unfinished HTML tags linearly without invoking an unanchored tag regex", () => {
  const small = "<".repeat(1000);
  const large = "<".repeat(8000);
  // Native regexp backtracking is invisible to source probes. Also forbid sending this hostile
  // suffix through a tag replacement regexp, so a constant native call cannot fake linear work.
  const replace = vi.spyOn(String.prototype, "replace");
  expect(
    opGrowth(
      () => htmlToLines(small, true),
      () => htmlToLines(large, true),
    ),
  ).toBeLessThan(24);
  expect(htmlToLines(large, true)).toEqual([large]);
  expect(replace.mock.calls.filter(([pattern]) => pattern instanceof RegExp && pattern.source.includes("<"))).toEqual(
    [],
  );
});

it("keeps normal HTML, block breaks, entities and plain-text imports unchanged", () => {
  expect(htmlToLines('<div class="label">Orders <b>API</b><br/>v2 &amp; v3</div><p>Ready&nbsp;now</p>', true)).toEqual([
    "Orders API",
    "v2 & v3",
    "Ready now",
  ]);
  expect(htmlToLines("<BR >A<brx>B<h2>Heading</h2><li>C</li>", true)).toEqual(["AB", "Heading", "C"]);
  expect(htmlToLines("<b>Literal</b>\r\n  next  line", false)).toEqual(["<b>Literal</b>", "next line"]);
  expect(htmlToLines("incomplete <tag", true)).toEqual(["incomplete <tag"]);
});

function pageXml(nodes: number) {
  return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${Array.from(
    { length: nodes },
    (_, i) =>
      `<mxCell id="n${i}" value="Service" vertex="1" parent="1" style="shape=cloud;"><mxGeometry x="${i * 100}" y="0" width="80" height="40"/></mxCell>`,
  ).join("")}</root></mxGraphModel>`;
}

function page(nodes: number) {
  return {
    id: "p",
    name: "Page-1",
    model: parseXml(pageXml(nodes)),
  };
}

it("returns an announced error outcome when selecting an oversized draw.io page", async () => {
  const outcome = await importText(
    `<mxfile><diagram name="Small">${pageXml(1)}</diagram><diagram name="Large">${pageXml(LIMITS.maxNodes + 1)}</diagram></mxfile>`,
    "services.drawio",
  );
  expect(outcome.ok).toBe("pages");
  if (outcome.ok !== "pages") throw new Error("Expected a page picker");
  expect(outcome.pick(1)).toEqual({ ok: false, error: "This page exceeds the node budget." });
  expect(outcome.pick(0).ok).toBe(true);
});

it("rejects oversized foreign pages before pairwise scaling", () => {
  const small = page(LIMITS.maxNodes + 1);
  const large = page((LIMITS.maxNodes + 1) * 8);
  const convert = (input: ReturnType<typeof page>) => expect(() => drawioPageToDiagram(input)).toThrow("node budget");
  const a = ops(() => convert(small), (LIMITS.maxNodes + 1) * 500);
  const b = ops(() => convert(large), a * 24);
  expect(a).toBeGreaterThan(0);
  expect(b / a).toBeLessThan(24);
});

it("keeps the foreign-page spacing calculation for normal nodes", () => {
  const { diagram, warnings } = drawioPageToDiagram(page(2));
  expect(warnings).toEqual([]);
  expect(diagram.nodes.map(({ id, label, x, y }) => ({ id, label, x, y }))).toEqual([
    { id: "n0", label: "Service", x: 20, y: 30 },
    { id: "n1", label: "Service", x: 340, y: 30 },
  ]);
});

import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  deflateRaw,
  inflateRaw,
  textToBytes,
  bytesToText,
  TooLargeError,
} from "./codec";
import { LIMITS } from "./native";
import {
  decodeShare,
  embedSnippet,
  embedUrl,
  encodeShare,
  sharePayloadFromHash,
  sharePayloadFromInput,
  shareUrl,
} from "./share";
import { detectFormat, importText, titleFromFileName } from "./formats";
import { diagramToDrawio } from "./drawio/write";
import { diagramToMermaid } from "./mermaid/write";

const examples = import.meta.glob<DiagramFile>("../examples/*.json", { eager: true, import: "default" });

describe("codec", () => {
  it("base64url round-trips arbitrary bytes without padding or unsafe characters", () => {
    const bytes = new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * 37) % 256));
    const s = bytesToBase64Url(bytes);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect([...base64UrlToBytes(s)]).toEqual([...bytes]);
  });

  it("deflate-raw round-trips unicode text", async () => {
    const text = "Kafka → Service Bus · 東京 ✓ ".repeat(50);
    const packed = await deflateRaw(textToBytes(text));
    expect(packed.length).toBeLessThan(text.length);
    expect(bytesToText(await inflateRaw(packed))).toBe(text);
  });
});

describe("share links", () => {
  for (const [path, ex] of Object.entries(examples)) {
    it(`round-trips ${path.split("/").pop()} including simulations`, async () => {
      const payload = await encodeShare(ex);
      expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
      const back = await decodeShare(payload);
      expect(back).toEqual(ex);
      if (ex.simulations) expect(back.simulations).toEqual(ex.simulations);
    });
  }

  it("parses payloads from hashes, URLs and bare strings", async () => {
    const payload = await encodeShare(Object.values(examples)[0]);
    const url = shareUrl(payload, "https://www.latchkostov.com/tools/diagrams/");
    expect(url).toBe(`https://www.latchkostov.com/tools/diagrams/#d=${payload}`);
    expect(sharePayloadFromHash(`#d=${payload}`)).toBe(payload);
    expect(sharePayloadFromInput(url)).toBe(payload);
    expect(sharePayloadFromInput(`  ${payload} `)).toBe(payload);
    expect(sharePayloadFromInput("not a link")).toBeUndefined();
    expect(sharePayloadFromHash("#other=1")).toBeUndefined();
  });

  it("rejects damaged links with a helpful message", async () => {
    await expect(decodeShare("AAAA")).rejects.toThrow(/damaged|readable/);
    const notDiagram = bytesToBase64Url(await deflateRaw(textToBytes('{"format":"x"}')));
    await expect(decodeShare(notDiagram)).rejects.toThrow(/can't be opened/);
  });

  it("builds embed URLs and an escaped iframe snippet", () => {
    const base = "https://example.com/diagrams/";
    expect(embedUrl({ example: "kafka-order-pipeline" }, base)).toBe(`${base}?embed=1&example=kafka-order-pipeline`);
    expect(embedUrl({ payload: "abc", live: true, sim: "s1" }, base)).toBe(`${base}?embed=1&live=1&sim=s1#d=abc`);
    const snippet = embedSnippet(`${base}?embed=1&example=x`, { title: 'A "B" <C>', height: 480 });
    expect(snippet).toContain('src="https://example.com/diagrams/?embed=1&amp;example=x"');
    expect(snippet).toContain('title="A &quot;B&quot; &lt;C>"');
    expect(snippet).toContain('height="480"');
  });
});

describe("format detection and importText", () => {
  const ex = Object.values(examples)[0];
  it("detects formats from content first, then the file name", () => {
    expect(detectFormat(JSON.stringify(ex))).toBe("native");
    expect(detectFormat(diagramToDrawio(ex))).toBe("drawio");
    expect(detectFormat(diagramToMermaid(ex))).toBe("mermaid");
    expect(detectFormat("<mxGraphModel><root/></mxGraphModel>")).toBe("drawio");
    expect(detectFormat("A-->B", "flow.mmd")).toBe("mermaid");
    expect(detectFormat("hello world")).toBeUndefined();
  });

  it("imports every format and reports unknown text", async () => {
    for (const text of [JSON.stringify(ex), diagramToDrawio(ex), diagramToMermaid(ex)]) {
      const r = await importText(text);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok === true) expect(r.diagram.nodes).toHaveLength(ex.nodes.length);
    }
    const bad = await importText("just some words");
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.error).toMatch(/Supported/);
    const empty = await importText("  ");
    expect(empty.ok === false && empty.error).toMatch(/empty/);
  });

  it("names imports after the file", () => {
    expect(titleFromFileName("C:\\x\\order-flow.drawio")).toBe("order flow");
    expect(titleFromFileName("My Pipeline.diagram.json")).toBe("My Pipeline");
    expect(titleFromFileName("arch.drawio.svg")).toBe("arch");
  });
});

describe("payload limits", () => {
  it("stops inflating once the output passes the cap (zip-bomb guard)", async () => {
    const bomb = await deflateRaw(new Uint8Array(2_000_000));
    expect(bomb.length).toBeLessThan(10_000);
    await expect(inflateRaw(bomb, 100_000)).rejects.toBeInstanceOf(TooLargeError);
    expect((await inflateRaw(bomb)).length).toBe(2_000_000);
  });

  it("share links reject payloads that inflate past the limit", async () => {
    const payload = bytesToBase64Url(await deflateRaw(new Uint8Array(LIMITS.maxTextChars + 10).fill(32)));
    await expect(decodeShare(payload)).rejects.toThrow(/too large/);
  });
});

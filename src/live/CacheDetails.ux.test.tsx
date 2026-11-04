import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CacheDetails } from "./CacheDetails";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "../sim/engine";
import { cacheLatency } from "../planning/cacheWords";
import { cacheRuntime } from "../sim/cache/cacheRuntime";
import blackFriday from "../examples/black-friday-commerce.json";
import type { DiagramFile } from "../model/types";

const plain = (html: string) => html.replace(/[\u2068\u2069]/g, "");
const paragraph = (html: string, id: string) =>
  html.match(new RegExp(`<p[^>]*data-testid="${id}"[^>]*>(.*?)</p>`))?.[1];

it("reports offload from avoided fetches including coalesced requests", () => {
  const diagram = cacheFixture();
  const table = diagram.nodes[1].props!.cache as import("../model/caching").CacheTable;
  table.default!.coalesce = true;
  const engine = createEngine({ seed: 7 });
  engine.load(diagram, cacheRuntime.plan(diagram));
  const s = engine.snapshot().nodes.cache;
  s.cacheDetails = { window: { requests: 100, hits: 20, misses: 80, fetches: 10, seconds: 5 } };
  const html = plain(renderToStaticMarkup(<CacheDetails diagram={diagram} id="cache" s={s} />));
  expect(paragraph(html, "cache-window-counts")).toBe("Answered here (hits): 4/s · Fetches: 2/s · Not cached: 0/s");
  expect(paragraph(html, "cache-offload-counts")).toBe(
    "Requests kept away from Origin: 18/s (origin offload over 10 s)",
  );
});

it("names only Black Friday's applicable Order status destination and keeps multi-origin offload aggregate", () => {
  const diagram = structuredClone(blackFriday) as DiagramFile;
  const engine = createEngine({ seed: 7 });
  engine.load(diagram, cacheRuntime.plan(diagram));
  const s = engine.snapshot().nodes.cdn;
  s.cache!.rules.orders = { requests: 30, hits: 0, misses: 0, notCached: 30, fetches: 30, fills: 0 };
  s.cacheDetails = { window: { requests: 100, hits: 70, misses: 0, fetches: 30, seconds: 10 } };
  const html = plain(renderToStaticMarkup(<CacheDetails diagram={diagram} id="cdn" s={s} />));
  expect(paragraph(html, "cache-live-rule-orders")).toBe(
    "Order status: Not cached · 30 requests since restart. Configured destinations: API gateway.",
  );
  expect(paragraph(html, "cache-offload-counts")).toBe(
    "Requests kept away from services behind this cache: 7/s (origin offload over 10 s)",
  );
});

it("starts with counts, distinguishes unused rules, scopes latency and isolates mixed-direction facts", () => {
  const diagram = cacheFixture();
  diagram.nodes[1].props!.cache = {
    rules: [{ id: "unused", label: "Unexercised", match: { types: ["Unused"] }, policy: { ttlMs: 1000 } }],
    default: { ttlMs: 1000, keys: 20, popularity: "even" },
  };
  const engine = createEngine({ seed: 7 });
  engine.load(diagram, cacheRuntime.plan(diagram));
  for (let n = 0; n < 150; n++) {
    engine.inject("source", 4, { type: "Page" });
    engine.step(20);
  }
  const html = renderToStaticMarkup(<CacheDetails diagram={diagram} id="cache" s={engine.snapshot().nodes.cache} />);
  const text = html.replace(/[\u2068\u2069]/g, "");
  expect(text).not.toContain("hits over 10 s");
  expect(text).toContain("Answered here (hits)");
  expect(text).toContain("Requests kept away from Origin");
  expect(text).toContain("Unexercised: No requests yet");
  expect(text).not.toContain("Unexercised: 0%");
  expect(text).toContain("At this cache");
  expect(text).toContain("0 ms modelled lookup");
  expect(text).toContain("95 of 100 requests finish within this time.");
  expect(html).toContain("\u2068Origin\u2069");
  expect(html).toMatch(/\u2068[\d.]+\/s\u2069/);
});

it("formats sub-second cache times in milliseconds without inventing positive lookup time", () => {
  expect(cacheLatency(0, true)).toBe("0 ms modelled lookup");
  expect(cacheLatency(0.2, true)).toBe("0.2 ms");
  expect(cacheLatency(0.01, true)).toBe("0.01 ms");
  expect(cacheLatency(60)).toBe("60 ms");
  expect(cacheLatency(800)).toBe("800 ms");
  expect(cacheLatency(1200)).toBe("1.2 s");
});

it("discloses a long rule list independently of the cache's counts", () => {
  const diagram = cacheFixture();
  diagram.nodes[1].props!.cache = {
    rules: Array.from({ length: 4 }, (_, i) => ({
      id: `rule-${i}`,
      match: { types: [`Type${i}`] },
      policy: { ttlMs: 1000 },
    })),
  };
  const engine = createEngine({ seed: 7 });
  engine.load(diagram);
  const html = renderToStaticMarkup(<CacheDetails diagram={diagram} id="cache" s={engine.snapshot().nodes.cache} />);
  expect(html).toContain('data-testid="cache-live-rules"');
  expect(html).not.toMatch(/data-testid="cache-live-rules"[^>]*open/);
  expect(html.match(/No requests yet/g)).toHaveLength(4);
});

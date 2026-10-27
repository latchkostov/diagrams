import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { OVERVIEW_WORK_BUDGET, overviewConnection, overviewLayout, type OverviewItem } from "./overview";
import { intersects } from "./geometry/rect";
import { t } from "../i18n/core";

const measure = (text: string) => [...text].length * 6;
const zone: OverviewItem = { id: "eks", name: "EKS · storefront", box: { x: 0, y: 0, width: 240, height: 180 } };
const node = (id: string, x: number, y: number, width = 60): OverviewItem => ({
  id,
  name: "Catalog API",
  group: "eks",
  box: { x, y, width, height: 20 },
});

describe("large Live Overview", () => {
  it("keeps all individual cards, including crowded, tiny and spotlit members", () => {
    const nodes = [
      node("catalog", 12, 10),
      node("cart", 30, 10, 20),
      { ...node("checkout", 12, 100), spotlight: true },
    ];
    const before = structuredClone(nodes);
    const layout = overviewLayout(nodes, [zone], measure);
    expect(nodes).toEqual(before);
    expect(layout.headers[0]).toMatchObject({ id: "eks", count: 0, lines: ["EKS · storefront"] });
    for (const card of nodes) expect(intersects(layout.headers[0].box, card.box)).toBe(false);
    expect(layout).not.toHaveProperty("hidden");
    expect(layout).not.toHaveProperty("tiles");
  });

  it("moves a wrapped title to a clear header band without covering cards", () => {
    const narrow = { ...zone, box: { ...zone.box, width: 70 } };
    const nodes = [node("a", 5, 17), node("b", 5, 80)];
    const layout = overviewLayout(nodes, [narrow], measure);
    expect(layout.headers[0].lines).toEqual(["EKS ·", "storefro…"]);
    for (const card of nodes) expect(intersects(layout.headers[0].box, card.box)).toBe(false);
  });
  it("bounds a single long word to a narrow header beside a neighbouring card", () => {
    const narrow = { ...zone, name: "Production", box: { ...zone.box, width: 45 } };
    const nodes = [node("neighbour", 46, 0)];
    const header = overviewLayout(nodes, [narrow], measure).headers[0];
    expect(header.lines).toEqual(["Prod…"]);
    for (const line of header.lines) expect(measure(line)).toBeLessThanOrEqual(header.box.width - 12);
    expect(header.box.height).toBe(header.lines.length * 12 + 6);
    expect(intersects(header.box, nodes[0].box)).toBe(false);
  });
  it("does not search outside when the internal header band is clear", () => {
    const reads = (x: number) => {
      let count = 0;
      const nodes = Array.from({ length: 32 }, (_, i) => {
        const item = node(String(i), x, -(i + 1) * 22);
        return {
          ...item,
          get box() {
            count++;
            return item.box;
          },
        };
      });
      expect(overviewLayout(nodes, [zone], measure).headers[0].box.y).toBe(zone.box.y);
      return count;
    };
    expect(reads(0)).toBe(reads(1000));
  });

  it("keeps a full zone's outside band clear of neighbouring cards too", () => {
    const full = { ...zone, box: { ...zone.box, height: 20 } };
    const nodes = [node("inside", 0, 0, 240), node("above", 0, -30, 240)];
    const header = overviewLayout(nodes, [full], measure).headers[0];
    for (const card of nodes) expect(intersects(header.box, card.box)).toBe(false);
    expect(header.box.y + header.box.height).toBeLessThan(nodes[1].box.y);
  });

  it("keeps a tight nested zone's outside header clear of its parent's header", () => {
    // Screen pixels from the review: the child has no internal band, and its outside band used to land on
    // the parent's header at y=0.
    const parent = { ...zone, id: "parent", name: "Region", box: { x: 0, y: 0, width: 240, height: 120 } };
    const child = { ...zone, id: "child", name: "Subnet", box: { x: 10, y: 24, width: 200, height: 36 } };
    const card = { ...node("api", 20, 34), box: { x: 20, y: 34, width: 60, height: 18 } };
    for (const zones of [
      [parent, child],
      [child, parent],
    ]) {
      const { headers } = overviewLayout([card], zones, measure);
      expect(headers).toHaveLength(2);
      expect(intersects(headers[0].box, headers[1].box)).toBe(false);
      for (const header of headers) expect(intersects(header.box, card.box)).toBe(false);
    }
  });

  it("keeps every header clear of every card and every other header", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 48271) % 2147483647) / 2147483647) * 400;
    for (let round = 0; round < 40; round++) {
      const nodes = Array.from({ length: 30 }, (_, i) => ({
        ...node(`n${i}`, random(), random(), 20 + random() / 8),
        box: { x: random(), y: random(), width: 20 + random() / 8, height: 10 + random() / 20 },
      }));
      const zones = Array.from({ length: 12 }, (_, i) => ({
        ...zone,
        id: `z${i}`,
        name: `Zone ${i} storefront`,
        box: { x: random(), y: random(), width: 40 + random() / 2, height: 10 + random() / 2 },
      }));
      const { headers } = overviewLayout(nodes, zones, measure);
      for (const [i, header] of headers.entries()) {
        for (const card of nodes) expect(intersects(header.box, card.box)).toBe(false);
        for (const other of headers.slice(i + 1)) expect(intersects(header.box, other.box)).toBe(false);
      }
    }
  });

  it("reads each card's geometry once, however dense the zone's column", () => {
    let reads = 0;
    // Abutting cards leave no internal band, so every candidate used to rescan the column.
    const nodes = Array.from({ length: 1000 }, (_, i) => {
      const item = { ...node(String(i), 0, i * 20), box: { x: 0, y: i * 20, width: 60, height: 20 } };
      return {
        ...item,
        get box() {
          reads++;
          return item.box;
        },
      };
    });
    const zones = Array.from({ length: 20 }, (_, i) => ({
      ...zone,
      id: `z${i}`,
      box: { x: 0, y: 0, width: 300, height: 20_000 },
    }));
    const { headers } = overviewLayout(nodes, zones, measure);
    expect(reads).toBe(nodes.length);
    for (const [i, header] of headers.entries())
      for (const other of headers.slice(i + 1)) expect(intersects(header.box, other.box)).toBe(false);
  });

  it("bounds placement work for an imported diagram of stacked zones and cards", () => {
    // Valid import: 5,000 cards in one column and 1,000 identical boundaries over them.
    const nodes = Array.from({ length: 5000 }, (_, i) => ({
      ...node(String(i), 0, i * 80),
      box: { x: 0, y: i * 80, width: 120, height: 60 },
    }));
    const zones = Array.from({ length: 1000 }, (_, i) => ({
      ...zone,
      id: `z${i}`,
      name: "Zone",
      box: { x: 0, y: 0, width: 300, height: 400_200 },
    }));
    const { headers, work } = overviewLayout(nodes, zones, measure);
    expect(work).toBeLessThanOrEqual(OVERVIEW_WORK_BUDGET);
    expect(headers).toHaveLength(zones.length);
    // Headers placed within the budget still respect every obstacle.
    expect(intersects(headers[0].box, headers[1].box)).toBe(false);
    for (const card of nodes) expect(intersects(headers[1].box, card.box)).toBe(false);
  });

  it("draws only narrated-near and current-rate main connections", () => {
    expect(overviewConnection(false, false)).toBe(false);
    expect(overviewConnection(true, false)).toBe(true);
    expect(overviewConnection(false, true)).toBe(true);
    expect(overviewConnection(true, true)).toBe(true);
  });

  it("keeps the text floor, five-percent silhouettes, contrasting outlines and the navigation hint", () => {
    const css = readFileSync(new URL("../styles/canvas/detail.css", import.meta.url), "utf8");
    expect(css).toContain("500 10.5px/12px var(--font-ui)");
    expect(css).toContain("color-mix(in srgb, var(--tone, var(--ann)) 5%, transparent)");
    expect(css).toMatch(
      /\[data-detail-overview\] \.ann-zone\s*\{[^}]*outline: calc\(1.5px \/ var\(--rf-zoom\)\) solid var\(--text-2\)/,
    );
    expect(css).toMatch(/\[data-detail-overview\] \.react-flow__node-diagram \.nb\s*\{[^}]*solid var\(--text-2\)/);
    expect(css).toMatch(
      /\.react-flow__edge:is\(\[data-live-main\], \[data-live-near\]\)[^{]+\{[^}]*stroke-width: calc\(1.5px \/ var\(--rf-zoom\)\)/,
    );
    expect(t("camera.dig")).toBe("Select a service, or a zone name, to focus");
  });
});

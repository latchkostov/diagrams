import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { overviewConnection, overviewLayout, type OverviewItem } from "./overview";
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

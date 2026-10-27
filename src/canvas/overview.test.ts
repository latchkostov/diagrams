import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { overviewConnection, overviewLayout, overviewName, type OverviewItem } from "./overview";
import { intersects } from "./geometry/rect";
import { t } from "../i18n/core";

const measure = (text: string) => [...text].length * 6;
const aggregate = (name: string, count: number) => t("camera.aggregate", { name, count });
const zone: OverviewItem = { id: "eks", name: "EKS · storefront", box: { x: 0, y: 0, width: 240, height: 180 } };
const node = (id: string, x: number, y: number, width = 60): OverviewItem => ({
  id,
  name: "Catalog API",
  group: "eks",
  box: { x, y, width, height: 20 },
});

describe("large Live Overview", () => {
  it("keeps fitting names and measured abbreviations; never substitutes an anonymous tile", () => {
    expect(overviewName("Orders", 40, measure)).toBe("Orders");
    expect(overviewName("Catalog API", 48, measure)).toBe("Catalog…");
    expect(overviewName("Catalog API", 23, measure)).toBeNull();
    expect(overviewName("  ", 80, measure)).toBeNull();
    expect(
      overviewLayout(
        [{ ...node("unnamed", 10, 60), name: "", spotlight: true }],
        [zone],
        measure,
        aggregate,
      ).hidden.has("unnamed"),
    ).toBe(true);
    expect(overviewName("😀😀😀😀😀", 24, measure)).toBe("😀😀😀…");
    const layout = overviewLayout(
      [node("catalog", 12, 60), { ...node("tiny", 90, 90, 20), group: undefined }],
      [zone],
      measure,
      aggregate,
    );
    expect(layout.tiles.map((tile) => [tile.id, tile.label])).toEqual([["catalog", "Catalog…"]]);
    expect([...layout.hidden]).toEqual(["tiny"]);
    for (const tile of layout.tiles) expect(measure(tile.label)).toBeLessThanOrEqual(tile.box.width - 8);
  });

  it("replaces a crowded group with its full name and exact count, keeping spotlight names", () => {
    const nodes = [node("catalog", 12, 10), node("cart", 90, 60), { ...node("checkout", 12, 100), spotlight: true }];
    const layout = overviewLayout(nodes, [zone], measure, aggregate);
    expect([...layout.hidden]).toEqual(["catalog", "cart"]);
    expect(layout.tiles).toEqual([]);
    expect(layout.headers[0]).toMatchObject({ id: "eks", count: 2, lines: ["EKS · storefront · 2 services"] });
    expect(layout.hidden.has("checkout")).toBe(false);
    // No node disappears from a counted group without being represented by its aggregate.
    expect(layout.headers[0].count + nodes.filter((n) => n.spotlight).length).toBe(nodes.length);
  });

  it("reserves wrapped header bands inside zones and removes every intersecting node box", () => {
    const narrow = { ...zone, box: { ...zone.box, width: 120 } };
    const layout = overviewLayout([node("a", 5, 17), node("b", 5, 80)], [narrow], measure, aggregate);
    expect(layout.headers[0].lines).toEqual(["EKS · storefront ·", "2 services"]);
    const band = layout.headers[0].box;
    expect(band.y).toBe(narrow.box.y);
    expect(band.height).toBe(30);
    expect(band.y + band.height).toBeLessThanOrEqual(narrow.box.y + narrow.box.height);
    for (const tile of layout.tiles) expect(intersects(band, tile.box)).toBe(false);
    expect(layout.hidden.has("a")).toBe(true);
  });

  it("collapses overlapping members and too-small grouped tiles into counted targets", () => {
    for (const nodes of [
      [node("a", 10, 60), node("b", 30, 60)],
      [node("a", 10, 60, 20), node("b", 90, 60)],
    ]) {
      const layout = overviewLayout(nodes, [zone], measure, aggregate);
      expect(layout.tiles).toEqual([]);
      expect(layout.headers[0].count).toBe(2);
    }
  });

  it("draws only narrated-near and current-rate main connections", () => {
    expect(overviewConnection(false, false)).toBe(false);
    expect(overviewConnection(true, false)).toBe(true);
    expect(overviewConnection(false, true)).toBe(true);
    expect(overviewConnection(true, true)).toBe(true);
  });

  it("recounts neighbouring aggregates when a count wraps into another tile's space", () => {
    const narrow = { ...zone, box: { ...zone.box, width: 120 } };
    const other = { ...zone, id: "other", name: "Other", box: { ...zone.box, y: -40 } };
    const layout = overviewLayout(
      [node("a", 5, 10), { ...node("b", 50, 20), group: "other" }],
      [narrow, other],
      measure,
      aggregate,
    );
    expect([...layout.hidden].sort()).toEqual(["a", "b"]);
    expect(layout.headers.map((h) => h.count)).toEqual([1, 1]);
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

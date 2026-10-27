import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { overviewConnection } from "./overview";
import { t } from "../i18n/core";

describe("large Live Overview", () => {
  it("draws only narrated-near and current-rate main connections", () => {
    expect(overviewConnection(false, false)).toBe(false);
    expect(overviewConnection(true, false)).toBe(true);
    expect(overviewConnection(false, true)).toBe(true);
    expect(overviewConnection(true, true)).toBe(true);
  });

  it("keeps five-percent silhouettes, contrasting outlines and the navigation hint", () => {
    const css = readFileSync(new URL("../styles/canvas/detail.css", import.meta.url), "utf8");
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

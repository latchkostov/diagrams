// Image export (File ▸ More formats ▸ Image…), in both themes, for a few examples:
// - SVG: html-to-image's serialisation of the canvas. Its structure is compared (elements, data-testids, classes,
//   text, geometry and a few visual properties; one element per line, grouped by drawn
//   element), and its embedded fonts by hash. The full computed-style dump is not: it grows with every Chromium.
// - PNG: existing 4× downscaled references, a 16/255 channel threshold, and at most
//   min(0.1% of pixels, 600) pixels above it. Full-size E2E comparisons use the same cap.
//   Moved-card and missing-label controls reject real content changes. SVG stays exact. docs/PARITY.md.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { readFileSync } from "node:fs";
import { expectGolden, expectGoldenText } from "../lib/golden";
import { sha256 } from "../lib/hash";
import { openExample } from "./canvas";
import { expectGoldenPng } from "./png";

const EXAMPLES = [
  "corpus-hand-shaped-lines",
  "kafka-order-pipeline",
  "branch-to-datacentre",
  "aks-app-config-key-vault",
];

async function exportImage(page: Page, kind: "png" | "svg"): Promise<Buffer> {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await expect(page.getByTestId("file-more-formats-menu")).toBeVisible();
  await page.getByTestId("export-image").click();
  await expect(page.getByTestId("image-dialog")).toBeVisible();
  await page.getByTestId("image-options-toggle").click();
  await page.getByTestId(`image-format-${kind}`).click();
  if (kind === "png") await page.getByTestId("image-scale-1").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("image-export").click()]);
  return readFileSync(await download.path());
}

/** The SVG's structure, one element per line, grouped by drawn element (node, edge, group, annotation, header). */
async function svgDigest(page: Page, svg: string) {
  const fonts = [...svg.matchAll(/url\((?:&quot;|["']?)data:([^;,]+)[^)]*?base64,([A-Za-z0-9+/=]+)/g)].map(
    ([, type, data]) => `${type} ${sha256(data).slice(0, 16)}`,
  );
  const digest = await page.evaluate((text) => {
    const KEEP = [
      "width",
      "height",
      "left",
      "top",
      "transform",
      "color",
      "background-color",
      "fill",
      "stroke",
      "stroke-width",
      "stroke-dasharray",
      "opacity",
      "display",
      "visibility",
      "font-size",
      "font-weight",
      "border-top-color",
      "border-top-width",
      "border-radius",
    ];
    // Initial values say nothing: a property is listed only when it differs from these (a change either way shows).
    const INITIAL: Record<string, string[]> = {
      left: ["0px", "auto"],
      top: ["0px", "auto"],
      transform: ["none"],
      "background-color": ["rgba(0, 0, 0, 0)"],
      fill: ["rgb(0, 0, 0)"],
      stroke: ["none"],
      "stroke-width": ["1px"],
      "stroke-dasharray": ["none"],
      opacity: ["1"],
      display: ["inline", "block"],
      visibility: ["visible"],
      "border-top-width": ["0px"],
      "border-radius": ["0px"],
    };
    const ATTRS = ["d", "x", "y", "width", "height", "cx", "cy", "r", "points", "viewBox", "transform", "href", "src"];
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = doc.documentElement;
    const parts: Record<string, string[]> = {};
    let count = 0;
    /** Embedded data (fonts, icons) as a short hash (FNV-1a), not inline. */
    const fnv = (s: string) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
      return h.toString(16).padStart(8, "0");
    };
    const noData = (s: string) => s.replace(/data:[^"')\s]*/g, (d) => `data:…${fnv(d)}`);
    const line = (el: Element, depth: number) => {
      const style = (el as HTMLElement).style;
      const props = style
        ? KEEP.map((p) => [p, style.getPropertyValue(p)]).filter(([p, v]) => v && !INITIAL[p]?.includes(v))
        : [];
      const attrs = ATTRS.map((a) => [a, el.getAttribute(a)]).filter(([, v]) => v !== null);
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ");
      return [
        "  ".repeat(depth) + el.localName,
        el.getAttribute("data-testid") ? `#${el.getAttribute("data-testid")}` : "",
        (el.getAttribute("class") ?? "")
          .split(/\s+/)
          .filter(Boolean)
          .sort()
          .map((c) => `.${c}`)
          .join(""),
        ...attrs.map(([a, v]) => `${a}=${noData(v ?? "")}`),
        ...props.map(([p, v]) => `${p}:${v}`),
        own ? `"${noData(own)}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
    };
    const PART = /^(node|edge|group|annotation|export)-[^]*$/;
    const walk = (el: Element, depth: number, part: string) => {
      count++;
      const id = el.getAttribute("data-testid") ?? "";
      const here = part === "(page)" && PART.test(id) ? id : part;
      (parts[here] ??= []).push(line(el, depth));
      for (const child of el.children) walk(child, depth + 1, here);
    };
    walk(root, 0, "(page)");
    return {
      width: root.getAttribute("width"),
      height: root.getAttribute("height"),
      viewBox: root.getAttribute("viewBox"),
      elements: count,
      parts: Object.fromEntries(Object.entries(parts).map(([k, lines]) => [k, lines.join("\n")])),
    };
  }, svg);
  return {
    width: digest.width,
    height: digest.height,
    viewBox: digest.viewBox,
    elements: digest.elements,
    embedded: fonts,
    // One element per line, grouped by drawn element in a fixed order: a change reads as a line diff.
    structure: Object.entries(digest.parts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, text]) => `== ${k}\n${text}\n`)
      .join(""),
  };
}

for (const slug of EXAMPLES)
  for (const theme of ["light", "dark"] as const)
    test(`image export: ${slug} (${theme})`, async ({ page }) => {
      await page.addInitScript(
        (t) => localStorage.setItem("diagrams.settings.v1", JSON.stringify({ theme: t })),
        theme,
      );
      await openExample(page, slug);
      const svg = (await exportImage(page, "svg")).toString("utf8");
      const { structure, ...digest } = await svgDigest(page, svg);
      expectGolden(`images/${slug}.${theme}.svg.json`, digest);
      expectGoldenText(`images/${slug}.${theme}.svg.txt`, structure);
      const size = await expectGoldenPng(page, `images/${slug}.${theme}.png`, await exportImage(page, "png"));
      expectGolden(`images/${slug}.${theme}.png.json`, { size });
    });

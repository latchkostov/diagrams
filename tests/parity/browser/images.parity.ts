// Image export (File ▸ More formats ▸ Image…), in both themes, for a few examples:
// - SVG: html-to-image's serialisation of the canvas. Its structure is compared (elements, data-testids, classes,
//   text, geometry and a few visual properties; one element per line, grouped by drawn
//   element), and its embedded fonts by hash. The full computed-style dump is not: it grows with every Chromium.
// - PNG: a tolerant image diff against a stored reference, both downscaled by 4: at most 0.1% of pixels may differ by
//   more than 16 of 255 in a channel. Two runs in the pinned image are pixel-identical; the tolerance absorbs
//   rasteriser differences between host CPUs. (Windows against Linux differed by 1.2 to 1.5%.) A moved node or a
//   changed colour fails it; a single thin line may not, which is what the SVG structure is for. docs/PARITY.md.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { readFileSync } from "node:fs";
import { expectGolden, expectGoldenBinary, expectGoldenText } from "../lib/golden";
import { sha256 } from "../lib/hash";
import { openExample } from "./canvas";

const EXAMPLES = ["kafka-order-pipeline", "branch-to-datacentre", "aks-app-config-key-vault"];
const DOWNSCALE = 4;
const CHANNEL_TOLERANCE = 16;
const PIXEL_SHARE = 0.001;

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

/** Downscales the PNG in the page and, given a reference, counts the pixels that differ past the tolerance. */
async function pngCompare(page: Page, actual: Buffer, golden?: Buffer) {
  return page.evaluate(
    async ({ actual, golden, downscale, tolerance }) => {
      const load = (b64: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("not a PNG"));
          img.src = `data:image/png;base64,${b64}`;
        });
      const pixels = (img: HTMLImageElement, w: number, h: number) => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2D canvas");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        return { canvas, data: ctx.getImageData(0, 0, w, h).data };
      };
      const img = await load(actual);
      const w = Math.max(1, Math.round(img.naturalWidth / downscale));
      const h = Math.max(1, Math.round(img.naturalHeight / downscale));
      const small = pixels(img, w, h);
      const out = {
        size: `${img.naturalWidth}×${img.naturalHeight}`,
        reference: small.canvas.toDataURL("image/png").slice("data:image/png;base64,".length),
        diff: undefined as undefined | string[],
      };
      if (!golden) return out;
      const ref = await load(golden);
      if (ref.naturalWidth !== w || ref.naturalHeight !== h) {
        out.diff = [`size ${ref.naturalWidth}×${ref.naturalHeight} → ${w}×${h} (downscaled by ${downscale})`];
        return out;
      }
      const before = pixels(ref, w, h).data;
      let over = 0;
      let worst = 0;
      for (let i = 0; i < before.length; i += 4) {
        const delta = Math.max(
          Math.abs(before[i] - small.data[i]),
          Math.abs(before[i + 1] - small.data[i + 1]),
          Math.abs(before[i + 2] - small.data[i + 2]),
          Math.abs(before[i + 3] - small.data[i + 3]),
        );
        worst = Math.max(worst, delta);
        if (delta > tolerance) over++;
      }
      const share = over / (w * h);
      (out as { share?: number }).share = share;
      out.diff = [
        `${over} of ${w * h} pixels differ by more than ${tolerance} (${(share * 100).toFixed(3)}%), worst ${worst}`,
      ];
      return { ...out, share };
    },
    {
      actual: actual.toString("base64"),
      golden: golden?.toString("base64"),
      downscale: DOWNSCALE,
      tolerance: CHANNEL_TOLERANCE,
    },
  );
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
      const png = await exportImage(page, "png");
      const first = await pngCompare(page, png);
      expectGolden(`images/${slug}.${theme}.png.json`, { size: first.size });
      await expectGoldenBinary(
        `images/${slug}.${theme}.png`,
        Buffer.from(first.reference, "base64"),
        async (golden) => {
          const compared = await pngCompare(page, png, golden);
          const share = (compared as { share?: number }).share;
          return share !== undefined && share <= PIXEL_SHARE ? undefined : compared.diff;
        },
      );
    });

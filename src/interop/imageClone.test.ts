// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cloneNode, shareRasterStyles, Slicer, type RasterStyles } from "./imageClone";
import type { Options } from "html-to-image/es/types";

vi.mock("html-to-image/es/util", async (original) => ({
  ...(await original<object>()),
  getStyleProperties: (options: Options) => options.includeStyleProperties ?? [],
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function computed(values: Record<string, string>) {
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (_node, pseudo) =>
      ({
        cssText: "",
        getPropertyValue: (name: string) => (pseudo ? "none" : (values[name] ?? "")),
      }) as CSSStyleDeclaration,
  );
  return { includeStyleProperties: Object.keys(values) };
}

it("captures PNG declarations without complete native writes or read-back", async () => {
  const values = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`--capture-${i}`, `${i}`]));
  Object.assign(values, { "font-size": "14.8px", "font-family": "Example", "background-image": "none" });
  const options = computed(values);
  const source = document.createElement("div");
  const rasterStyles: RasterStyles = new WeakMap();
  const writes = vi.spyOn(CSSStyleDeclaration.prototype, "setProperty");
  const slicer = new Slicer(1);
  const clone = (await cloneNode(source, { ...options, rasterStyles }, slicer, true))!;
  expect(writes.mock.calls.length).toBeLessThanOrEqual(2);
  expect(clone.style.fontFamily).toBe("Example");
  expect(rasterStyles.get(clone)?.get("font-size")).toBe("13.9px");
  const reads = vi.spyOn(clone.style, "getPropertyValue");
  await shareRasterStyles(clone, slicer, rasterStyles);
  expect(reads.mock.calls.map(([name]) => name)).not.toContain("--capture-99");
  expect(clone.firstElementChild?.textContent).toContain("--capture-99:99;");
  expect(rasterStyles.has(clone)).toBe(false);
  expect(source.getAttribute("style")).toBeNull();
  slicer.dispose();
});

it("shares final embedded resources and root overrides, retaining inline extras and priorities", async () => {
  const options = computed({
    "font-family": "Example",
    "background-image": 'url("original.png")',
    width: "20px",
    color: "red",
  });
  const source = document.createElement("div");
  source.style.setProperty("--extra", "kept", "important");
  source.style.setProperty("color", "blue", "important");
  source.style.setProperty("font", "20px Example", "important");
  const slicer = new Slicer(1);
  const rasterStyles: RasterStyles = new WeakMap();
  const clone = (await cloneNode(source, { ...options, rasterStyles }, slicer, true))!;
  expect(clone.style.backgroundImage).toContain("original.png");
  // The existing embedding/applyStyle phases mutate only this small native block.
  clone.style.backgroundImage = 'url("data:image/png;base64,AAAA")';
  clone.style.width = "40px";
  await shareRasterStyles(clone, slicer, rasterStyles);
  const rules = clone.firstElementChild!.textContent;
  expect(rules).toContain("data:image/png;base64,AAAA");
  expect(rules).not.toContain("original.png");
  expect(rules).toContain("width:40px;");
  expect(rules).toContain("--extra:kept !important;");
  expect(rules).toContain("color:red;");
  expect(rules).not.toContain("color:blue");
  expect(rules).not.toContain("font:20px");
  slicer.dispose();
});

it("keeps SVG's native style path and iframe/path/font adjustments", async () => {
  const options = computed({ display: "inline", "font-size": "16px", d: "none" });
  const iframe = document.createElement("iframe");
  const slicer = new Slicer(1);
  const svgClone = (await cloneNode(iframe, options, slicer, true))!;
  expect(svgClone.style.display).toBe("block");
  expect(svgClone.style.fontSize).toBe("15.9px");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M0 0L10 10");
  const rasterStyles: RasterStyles = new WeakMap();
  const clone = (await cloneNode(path as unknown as HTMLElement, { ...options, rasterStyles }, slicer, true))!;
  expect(rasterStyles.get(clone)?.get("d")).toBe("path(M0 0L10 10)");
  expect(rasterStyles.get(clone)?.get("font-size")).toBe("15.9px");
  slicer.dispose();
});

it("shares captured blocks with per-element differences and native SVG subtree styles", async () => {
  const root = document.createElement("div");
  const child = document.createElement("div");
  root.append(child);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.fill = "red";
  root.append(svg);
  const captured: RasterStyles = new WeakMap([
    [root, new Map([["color", "red"]])],
    [child, new Map([["color", "blue"]])],
  ]);
  const slicer = new Slicer(3);
  await shareRasterStyles(root, slicer, captured);
  expect(root.className).toBe(child.className);
  expect(child.style.color).toBe("blue");
  expect(root.firstElementChild!.textContent).toContain("fill: red;");
  expect(root.firstElementChild!.textContent).toContain("color:red;");
  slicer.dispose();
});

it("uses computed declaration order regardless of original inline longhands or shorthands", async () => {
  const options = computed({ width: "20px", height: "30px", "font-size": "20px", "font-family": "Example" });
  const source = document.createElement("div");
  source.style.setProperty("font", "20px Example", "important");
  const child = document.createElement("div");
  child.style.height = "30px";
  source.append(child);
  const rasterStyles: RasterStyles = new WeakMap();
  const slicer = new Slicer(2);
  const clone = (await cloneNode(source, { ...options, rasterStyles }, slicer, true))!;
  expect([...rasterStyles.get(clone)!.keys()]).toEqual([...rasterStyles.get(clone.firstElementChild!)!.keys()]);
  await shareRasterStyles(clone, slicer, rasterStyles);
  expect(clone.className).toBe(clone.lastElementChild!.className);
  expect(clone.firstElementChild!.textContent).toContain("font-size:19.9px;");
  expect(clone.firstElementChild!.textContent).not.toContain("font:20px");
  slicer.dispose();
});

it("refreshes resource aliases even when native CSSOM enumerates only their canonical spelling", async () => {
  const root = document.createElement("div");
  const embedded = 'url("data:image/png;base64,AAAA")';
  root.style.setProperty("mask-image", embedded);
  const read = root.style.getPropertyValue.bind(root.style);
  vi.spyOn(root.style, "getPropertyValue").mockImplementation((name) =>
    read(name === "-webkit-mask-image" ? "mask-image" : name),
  );
  const captured: RasterStyles = new WeakMap([
    [
      root,
      new Map([
        ["mask-image", 'url("original.png")'],
        ["-webkit-mask-image", 'url("original.png")'],
      ]),
    ],
  ]);
  const slicer = new Slicer(1);
  await shareRasterStyles(root, slicer, captured);
  expect(root.firstElementChild!.textContent).not.toContain("original.png");
  expect(root.firstElementChild!.textContent).toContain(`-webkit-mask-image:${embedded};`);
  slicer.dispose();
});

it("bounds preparation notifications by visible percentage changes", () => {
  const progress: number[] = [];
  const slicer = new Slicer(1, { onProgress: (done) => progress.push(done) });
  for (let i = 0; i <= 1200; i++) slicer.progress(i / 10_000);
  expect(progress.length).toBeGreaterThan(0);
  expect(progress.length).toBeLessThanOrEqual(12);
  expect(progress.at(-1)).toBe(0.12);
  slicer.dispose();
});

it("counts clone elements consistently and reserves completion for the final picture", async () => {
  const progress: number[] = [];
  const slicer = new Slicer(2, { sliceMs: 0, onProgress: (done) => progress.push(done) });
  await slicer.step();
  await slicer.step();
  expect(progress).toHaveLength(2);
  expect(progress[0]).toBeCloseTo(0.425);
  expect(progress[1]).toBe(0.7);
  slicer.progress(0.8);
  await slicer.breathe();
  expect(progress.at(-1)).toBe(0.8);
  expect(progress.every((done) => done < 1)).toBe(true);
  slicer.dispose();
});

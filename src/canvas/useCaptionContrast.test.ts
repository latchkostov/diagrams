import { afterEach, expect, it, vi } from "vitest";
import { toFlow } from "./convert";
import { measureCaptionContrast } from "./useCaptionContrast";

afterEach(() => vi.unstubAllGlobals());

it("shares background conversion across captions and refreshes contrast when regions move", () => {
  const readback = vi.fn(() => ({ data: [47, 128, 237, 13] }));
  const createElement = vi.fn(() => ({
    getContext: () => ({ clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: "", getImageData: readback }),
  }));
  vi.stubGlobal("document", { createElement });
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  vi.stubGlobal("getComputedStyle", () => ({ backgroundColor: "azure-fill" }));
  const rect = (x: number) => ({ left: x, right: x + 200, top: 0, bottom: 100 }) as DOMRect;
  let regionX = 1000;
  const inks = new Map<string, string>();
  const canvas = {
    querySelectorAll: () =>
      ["group-g", ...Array.from({ length: 100 }, (_, i) => `annotation-c${i}`)].map((selector) => ({
        dataset: { testid: selector },
        getBoundingClientRect: () => rect(selector.includes("group-") ? regionX : 0),
        style: { setProperty: (_key: string, value: string) => inks.set(selector, value) },
      })),
  } as unknown as HTMLElement;
  const nodes = toFlow({
    format: "diagrams/v1",
    title: "Captions",
    nodes: [],
    edges: [],
    groups: [{ id: "g", label: "Region", x: 1000, y: 0, width: 200, height: 100 }],
    annotations: Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      kind: "text",
      text: "Caption",
      color: "#707070",
      x: 0,
      y: 0,
      width: 200,
      height: 30,
    })),
  }).nodes;
  const background = { r: 250, g: 250, b: 250, a: 1 };
  measureCaptionContrast(canvas, nodes, background);
  expect([...inks.values()].every((ink) => ink === "#707070")).toBe(true);
  regionX = 0;
  measureCaptionContrast(canvas, nodes, background);
  expect([...inks.values()].every((ink) => ink === "var(--text)")).toBe(true);
  expect(createElement).toHaveBeenCalledTimes(1);
  expect(readback).toHaveBeenCalledTimes(1);
});

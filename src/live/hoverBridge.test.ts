// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { OpCounter } from "../test/opCounter";
import type { ReadoutLayer } from "../canvas/interaction/readoutLayer";
import { inHoverBridge } from "./hoverBridge";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it.each(["absent", "pinned", "unreadable", "unpinned"] as const)("counts bridge DOM work when %s", (state) => {
  const pane = document.createElement("div");
  const anchor = document.createElement("div");
  anchor.dataset.testid = "node-worker";
  const card = document.createElement("div");
  card.dataset.liveReadout = "node";
  pane.append(anchor);
  document.body.append(pane, card);
  const selectors = new OpCounter(),
    rectangles = new OpCounter();
  const queryDocument = document.querySelector.bind(document),
    queryPane = pane.querySelector.bind(pane);
  vi.spyOn(document, "querySelector").mockImplementation((selector) => {
    selectors.add();
    return queryDocument(selector);
  });
  vi.spyOn(pane, "querySelector").mockImplementation((selector) => {
    selectors.add();
    return queryPane(selector);
  });
  vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => {
    rectangles.add();
    return new DOMRect(10, 10, 20, 20);
  });
  vi.spyOn(card, "getBoundingClientRect").mockImplementation(() => {
    rectangles.add();
    return new DOMRect(10, 50, 60, 30);
  });
  const readouts = {
    get: () => (state === "absent" ? null : { kind: "node", id: "worker", pinned: state === "pinned" }),
    readable: () => state !== "unreadable",
  } as Pick<ReadoutLayer, "get" | "readable">;
  for (let i = 0; i < 64; i++) {
    expect(inHoverBridge(readouts, pane, 20, 40)).toBe(state === "unpinned");
  }
  expect(selectors.total).toBe(state === "unpinned" ? 128 : 0);
  expect(rectangles.total).toBe(state === "unpinned" ? 128 : 0);
  if (state === "unpinned") expect(inHoverBridge(readouts, pane, 100, 40)).toBe(false);
});

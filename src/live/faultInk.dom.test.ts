// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { Decorator } from "./decorations";
import type { SimSnapshot } from "../sim/types";

const optional = vi.hoisted(() => ({ requested: vi.fn() }));
vi.mock("./chipInk", async () => {
  optional.requested();
  return new Promise(() => {});
});

it("paints and clears baseline outages and cuts with the optional chip chunk held", async () => {
  const root = document.createElement("div");
  root.innerHTML = '<div class="grp" data-caption-root="zone"></div><g class="react-flow__edge" data-id="link"></g>';
  const decorator = new Decorator(root);
  const snapshot = {
    time: 0,
    nodes: {},
    edges: {},
    particles: [],
    events: [],
    inSystem: 0,
    faults: [
      { kind: "boundary", boundary: "zone", down: true },
      { kind: "link", edge: "link", cut: true },
    ],
  } as SimSnapshot;
  const apply = () => decorator.apply({ snapshot, health: snapshot, spotlight: null });
  apply();
  expect(root.firstElementChild?.getAttribute("data-live-status")).toBe("down");
  expect(root.lastElementChild?.getAttribute("data-live-cut")).toBe("1");
  expect(optional.requested).not.toHaveBeenCalled();
  for (const chips of [true, false, true]) {
    root.toggleAttribute("data-low-zoom", chips);
    apply();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(root.firstElementChild?.getAttribute("data-live-status")).toBe("down");
    expect(root.lastElementChild?.getAttribute("data-live-cut")).toBe("1");
  }
  expect(optional.requested).toHaveBeenCalledOnce();
  snapshot.faults = [];
  apply();
  expect(root.firstElementChild?.hasAttribute("data-live-status")).toBe(false);
  expect(root.lastElementChild?.hasAttribute("data-live-cut")).toBe(false);
  snapshot.faults = [{ kind: "link", edge: "link", cut: true }];
  apply();
  decorator.clear();
  expect(root.querySelector("[data-live-cut], [data-live-status]")).toBeNull();
});

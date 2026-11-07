// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FrameDetail } from "./FrameDetail";

vi.mock("@xyflow/react", () => {
  const nodes = ["source", "target"].map((id, i) => ({
    id,
    type: "diagram",
    selected: !i,
    position: { x: i * 500 + 100, y: 200 },
    internals: { positionAbsolute: { x: i * 500 + 100, y: 200 } },
    measured: { width: 100, height: 72 },
    data: { label: id, stencil: "service.go" },
  }));
  const state = {
    nodes,
    nodeLookup: new Map(nodes.map((n) => [n.id, n])),
    edges: [{ id: "flow", source: "source", target: "target" }],
    transform: [0, 0, 0.75],
  };
  const store = {
    getState: () => state,
    setState: (next: object) => Object.assign(state, next),
    subscribe: () => () => {},
  };
  return {
    useStoreApi: () => store,
    useStore: () => "",
    ViewportPortal: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("./camera/useCameraCore", () => {
  const camera = {
    phase: "idle",
    interacting: false,
    state: { view: "focus", mode: "edit", live: { focus: [] } },
    subscribe: () => () => {},
  };
  return { useCameraController: () => camera };
});
vi.mock("./IdentityDetail", () => ({ IdentityDetail: () => null }));
vi.mock("../i18n", () => ({ useLocale: () => "en", t: (s: string) => s }));
vi.mock("./edges/useEdgeRoute", () => ({
  useRoutingOptions: () => ({ style: "straight", direction: "LR" }),
  routeInputFromStore: () => ({ nodes: [] }),
  selectRoutes: () =>
    new Map([
      [
        "flow",
        {
          path: "M200,200 L200,-300 L700,-300 L700,400",
          points: [
            { x: 200, y: 200 },
            { x: 200, y: -300 },
            { x: 700, y: -300 },
            { x: 700, y: 400 },
          ],
        },
      ],
    ]),
}));

it("keeps the text floor when Focus brings an off-screen caption onto a visible segment", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("getComputedStyle", (el: HTMLElement) => ({
    fontSize: el.style.fontSize || "10px",
    lineHeight: "12px",
    direction: "ltr",
  }));
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const host = document.createElement("div");
  Object.defineProperties(host, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
  host.innerHTML =
    '<div class="react-flow__viewport"><div class="react-flow__node react-flow__node-diagram" data-id="source"></div><div class="react-flow__node react-flow__node-diagram" data-id="target"></div><svg class="react-flow__edge" data-id="flow"><g class="fe"><path class="fe-path"/></g></svg><div class="fe-label" data-testid="edge-label-flow">A caption</div></div>';
  const label = host.querySelector<HTMLElement>('[data-testid="edge-label-flow"]')!;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this === host) return new DOMRect(0, 0, 1000, 800);
    if (this === label) return new DOMRect(-200, -200, label.style.width ? 180 : 100, 22);
    return new DOMRect(this.getAttribute("data-id") === "source" ? 100 : 600, 200, 100, 72);
  });
  const mount = document.createElement("div");
  document.body.append(host, mount);
  const root = createRoot(mount);
  try {
    await act(() =>
      root.render(<FrameDetail host={{ current: host }} routing={{ style: "straight", direction: "LR" }} decorate />),
    );
    await act(async () => {
      await Promise.resolve();
      for (const run of frames.splice(0)) run(0);
    });
    expect(label.hasAttribute("data-detail-hidden")).toBe(false);
    expect(label.style.translate).not.toBe("");
    expect(parseFloat(getComputedStyle(label).fontSize) * 0.75).toBeGreaterThanOrEqual(10.5);
  } finally {
    await act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  }
});

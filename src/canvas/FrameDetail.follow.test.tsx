// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FrameDetail } from "./FrameDetail";
import type { DiagramFlowEdge, FlowNode } from "./types";
const fixture = vi.hoisted(() => ({
  state: {} as { nodes: FlowNode[]; edges: DiagramFlowEdge[]; nodeLookup: Map<string, unknown>; transform: number[] },
  camera: {
    phase: "idle",
    interacting: false,
    state: {
      view: "follow",
      mode: "live",
      focus: undefined,
      zone: undefined,
      live: { focus: [] as string[], subject: "subject" },
    },
    subscribe: vi.fn(),
    dispatch: vi.fn(),
  },
}));
vi.mock("@xyflow/react", () => {
  const store = { getState: () => fixture.state, subscribe: () => () => {} };
  return {
    useStoreApi: () => store,
    useStore: () => "",
    ViewportPortal: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("./camera/useCameraCore", () => ({ useCameraController: () => fixture.camera }));
vi.mock("./IdentityDetail", () => ({ IdentityDetail: () => null }));
vi.mock("../i18n", () => ({ useLocale: () => "en", t: (s: string) => s }));
vi.mock("./edges/useEdgeRoute", () => ({
  useRoutingOptions: () => ({ style: "straight", direction: "LR", captions: false, hideDependencies: false }),
  routeInputFromStore: () => ({ nodes: [] }),
  selectRoutes: () => new Map(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it.each([false, true])(
  "keeps an oversized Follow subject painted on a 390px phone at double zoom (narrated: %s)",
  async (narrated) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("innerWidth", 390);
    fixture.camera.subscribe.mockReturnValue(() => {});
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const frames = new Map<number, FrameRequestCallback>();
    let seq = 0;
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      frames.set(++seq, run);
      return seq;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    fixture.camera.state.live.focus = narrated ? ["subject", "neighbour"] : [];
    const node = {
      id: "subject",
      type: "diagram",
      position: { x: 0, y: 0 },
      data: { label: "Subject", stencil: "service" },
      internals: { positionAbsolute: { x: 0, y: 0 } },
      measured: { width: 220, height: 72 },
    } as FlowNode;
    const neighbour = { ...node, id: "neighbour", data: { ...node.data, label: "Neighbour" } } as FlowNode;
    fixture.state = {
      nodes: [node, neighbour],
      edges: [],
      nodeLookup: new Map([
        [node.id, node],
        [neighbour.id, neighbour],
      ]),
      transform: [-25, 300, 2],
    };
    const host = document.createElement("div");
    Object.defineProperties(host, { clientWidth: { value: 390 }, clientHeight: { value: 844 } });
    host.innerHTML =
      '<div class="react-flow__node react-flow__node-diagram" data-id="subject"><div class="nb">Subject</div></div><div class="react-flow__node react-flow__node-diagram" data-id="neighbour"><div class="nb">Neighbour</div></div><div data-testid="node-badge-subject"><span class="lv-metric">1</span></div>';
    const card = host.firstElementChild!;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return this === host
        ? new DOMRect(0, 0, 390, 844)
        : this.getAttribute("data-id") === "neighbour"
          ? new DOMRect(360, 520, 220, 72)
          : new DOMRect(-25, 300, 440, 144);
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(220);
    const mount = document.createElement("div");
    document.body.append(host, mount);
    const root = createRoot(mount);
    try {
      await act(() =>
        root.render(
          <FrameDetail
            host={{ current: host }}
            routing={{ style: "straight", direction: "LR", captions: false }}
            decorate
          />,
        ),
      );
      // The camera is settled; run the decoration frames that decide cards versus pins.
      await act(async () => {
        for (let i = 0; i < 3; i++) {
          const pending = [...frames.values()];
          frames.clear();
          for (const run of pending) run(0);
          await Promise.resolve();
        }
      });
      expect(host.dataset.detailView).toBe("follow");
      expect(card.hasAttribute("data-detail-hidden")).toBe(false);
      expect(host.querySelector('[data-id="neighbour"]')!.hasAttribute("data-detail-hidden")).toBe(true);
      expect(host.querySelector('[data-testid="node-badge-subject"]')!.hasAttribute("data-detail-hidden")).toBe(false);
      expect(mount.querySelector('[data-testid="focus-offscreen-subject"]')).toBeNull();
      expect(fixture.state.transform[2]).toBe(2);
    } finally {
      await act(() => root.unmount());
      fixture.camera.state.live.focus = [];
    }
  },
);

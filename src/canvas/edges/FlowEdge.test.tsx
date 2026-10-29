// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { EdgeProps, ReactFlowState } from "@xyflow/react";
import { expect, it, vi } from "vitest";
import type { DiagramFlowEdge } from "../types";
import { FlowEdge } from "./FlowEdge";

const fixture = vi.hoisted(() => ({ focused: false }));
vi.mock("../../components/useTooltip", async (original) => ({
  ...(await original<typeof import("../../components/useTooltip")>()),
  useKeyboardFocusOn: () => fixture.focused,
}));
vi.mock("@xyflow/react", () => ({
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => children,
  useStore: (select: (state: Pick<ReactFlowState, "transform" | "edges" | "nodeLookup">) => unknown) =>
    select({
      transform: [0, 0, 0.5],
      edges: [
        {
          id: "config",
          source: "api",
          target: "settings",
          data: { relation: "config", props: { settings: [{ key: "PageSize" }] } },
        },
      ],
      nodeLookup: new Map(),
    }),
}));
vi.mock("../DiagramContext", () => ({ useDiagram: () => ({}) }));
vi.mock("../lowZoom", () => ({
  useChip: () => ({ value: { natural: "M0 0L100 0", path: "M0 0L100 0" }, chips: { Edge: () => null } }),
}));
vi.mock("./useEdgeRoute", () => ({
  useRoutingOptions: () => ({}),
  useEdgeRoute: () => ({
    path: "M0 0L100 0",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  }),
}));
vi.mock("./readiness", () => ({ requireEdgeModules: () => {} }));
vi.mock("./edgeDetailsRuntime", async () => {
  const details = await import("./SettingsCard");
  return { edgeDetailsSnapshot: () => details, subscribeEdgeDetails: () => () => {} };
});

it.each(["selection", "focus"] as const)("reactivates dismissed chip settings on a new %s", async (activation) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.focused = false;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (selected: boolean, focused = fixture.focused) => {
    fixture.focused = focused;
    const props = {
      id: "config",
      source: "api",
      target: "settings",
      selected,
      data: { kind: "async", relation: "config" },
    } as EdgeProps<DiagramFlowEdge>;
    return act(() =>
      root.render(
        <StrictMode>
          <FlowEdge {...props} />
        </StrictMode>,
      ),
    );
  };
  const card = () => host.querySelector('[data-testid="edge-settings-config"]');
  const escape = () => act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  try {
    await render(true, activation === "focus");
    expect(card()).not.toBeNull();
    await escape();
    await render(true);
    expect(card()).toBeNull();
    // Losing focus alone must not reopen an already selected connection.
    await render(true, false);
    expect(card()).toBeNull();
    if (activation === "selection") await render(false);
    // A focus activation must work even when selection was held throughout.
    await render(true, activation === "focus");
    expect(card()).not.toBeNull();
    await escape();
    await render(true);
    expect(card()).toBeNull();
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MiniMap, ReactFlowProvider } from "@xyflow/react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import type { CanvasMenus } from "../menus/useCanvasMenus";
import { CanvasControls, CanvasMinimap } from "./CanvasControls";
import type { FlowNode } from "../types";

vi.mock("@xyflow/react", async (load) => ({
  ...(await load<typeof import("@xyflow/react")>()),
  MiniMap: vi.fn(() => null),
}));

it("the minimap retains annotation outlines and note fills", () => {
  renderToString(<CanvasMinimap />);
  const { nodeColor, nodeStrokeColor } = vi.mocked(MiniMap).mock.calls.at(-1)![0];
  if (typeof nodeColor !== "function" || typeof nodeStrokeColor !== "function")
    throw new Error("Expected minimap color callbacks");
  for (const kind of ["note", "text", "zone", "shape"] as const) {
    const node = { type: "annotation", data: { kind, color: "#123456" } } as FlowNode;
    expect(nodeColor(node)).toBe(kind === "note" ? "#123456" : "transparent");
    expect(nodeStrokeColor(node)).toBe(kind === "note" ? "transparent" : "#123456");
  }
});

it("the zoom chevron and accessible action point toward hiding, then showing the controls", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(() =>
      root.render(
        <ReactFlowProvider>
          <CanvasControls
            editor={{} as EditorApi}
            menus={{} as CanvasMenus}
            menu={null}
            fit={vi.fn()}
            zoomedByButton={vi.fn()}
          />
        </ReactFlowProvider>,
      ),
    );
    const button = container.querySelector<HTMLButtonElement>('[data-testid="collapse-toolbar-button"]')!;
    const glyph = () =>
      container
        .querySelector('[data-testid="zoom-controls-chevron"]')!
        .firstElementChild!.firstElementChild!.getAttribute("d");
    expect(button.title).toBe("Hide zoom controls");
    expect(button.getAttribute("aria-label")).toBe(button.title);
    expect(glyph()).toBe("M3.5 4 7.5 8l-4 4M8.5 4l4 4-4 4");
    await act(() => button.click());
    expect(button.title).toBe("Show zoom controls");
    expect(button.getAttribute("aria-label")).toBe(button.title);
    expect(glyph()).toBe("M7.5 4 3.5 8l4 4M12.5 4l-4 4 4 4");
    expect(container.querySelector('[data-testid="zoom-in-button"]')).toBeNull();
    await act(() => button.click());
    expect(button.title).toBe("Hide zoom controls");
    expect(container.querySelector('[data-testid="zoom-in-button"]')).not.toBeNull();
  } finally {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

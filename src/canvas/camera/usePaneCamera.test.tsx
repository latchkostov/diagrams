// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePaneCamera, type PaneInputs } from "./usePaneCamera";
import type { CameraController } from "./controller";

it("R-c6a836a8ae reframes on every sheet snap without a canvas resize", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const dispatch = vi.fn();
  const controller = { dispatch, takePlacement: () => false } as unknown as CameraController;
  const inputs: PaneInputs = {
    paletteHidden: true,
    aiDock: { open: false, width: 300 },
    inspectorHidden: false,
    sheetResize: 0,
    sheetSnap: "half",
    inspectorPref: false,
    inspectorByHand: false,
    livePanelOpen: false,
    narrow: true,
    cramped: true,
    nodes: [],
    edges: [],
    inspectorRequest: 0,
    nothingSelected: true,
    live: false,
    presenting: false,
  };
  function Pane({ snap }: { snap: PaneInputs["sheetSnap"] }) {
    usePaneCamera(controller, { ...inputs, sheetSnap: snap });
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(() => root.render(<Pane snap="half" />));
    expect(dispatch).not.toHaveBeenCalled();
    for (const snap of ["peek", "full", "half"] as const) {
      dispatch.mockClear();
      await act(() => root.render(<Pane snap={snap} />));
      expect(dispatch.mock.calls).toEqual([[{ type: "pane.changed", cause: "panel" }]]);
    }
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

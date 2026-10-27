// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import type { CanvasMenus } from "../menus/useCanvasMenus";
import { CanvasControls } from "./CanvasControls";

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

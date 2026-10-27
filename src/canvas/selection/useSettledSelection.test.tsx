// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { CameraController } from "../camera";
import { useSettledSelection } from "./useSettledSelection";

for (const track of [false, true])
  it(`pointer-up ${track ? "publishes a selection that can switch dock tabs" : "avoids another render when Properties already follows the selection"}`, async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const release = vi.fn();
    const controller = { hold: () => release } as unknown as CameraController;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let selected = "first";
    let renders = 0;
    function Probe() {
      renders++;
      const wrapper = useRef<HTMLDivElement>(null);
      const settled = useSettledSelection({
        wrapper,
        controller,
        editGestures: true,
        nothingSelected: false,
        selectionKey: selected,
        trackSelectionKey: track,
      });
      return (
        <div ref={wrapper} data-testid="selection-pane">
          {settled.key}
        </div>
      );
    }
    try {
      await act(() => root.render(<Probe />));
      const pane = host.firstElementChild!;
      pane.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
      selected = "next";
      await act(() => root.render(<Probe />));
      const before = renders;
      await act(() => {
        window.dispatchEvent(new Event("pointerup"));
        vi.advanceTimersToNextFrame();
        vi.runOnlyPendingTimers();
      });
      if (track) expect(pane.textContent).toBe("next");
      else expect(renders).toBe(before);
      expect(release).toHaveBeenCalledOnce();
    } finally {
      await act(() => root.unmount());
      host.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

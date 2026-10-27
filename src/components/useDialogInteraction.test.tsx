// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Dialog } from "../interop/ui/Dialog";

it.each([false, true])(
  "restores the original opener only on actual dialog close (controller=%s)",
  async (controller) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const opener = document.createElement("button");
    const host = document.createElement("div");
    document.body.append(opener, host);
    opener.focus();
    const restore = vi.fn((element: HTMLElement | null) => element?.focus());
    const root = createRoot(host);
    try {
      await act(() =>
        root.render(
          <StrictMode>
            <Dialog
              title="Room"
              testId="test-dialog"
              onClose={() => {}}
              restoreFocus={controller ? restore : undefined}
            >
              <input data-autofocus data-testid="test-dialog-input" />
            </Dialog>
          </StrictMode>,
        ),
      );
      expect(document.activeElement).toBe(document.querySelector('[data-testid="test-dialog-input"]'));
      expect(restore).not.toHaveBeenCalled();
      await act(() => root.render(null));
      expect(document.activeElement).toBe(opener);
      if (controller) expect(restore.mock.calls).toEqual([[opener]]);
      expect(opener.inert).toBeFalsy();
    } finally {
      await act(() => root.unmount());
      opener.remove();
      host.remove();
      vi.unstubAllGlobals();
    }
  },
);

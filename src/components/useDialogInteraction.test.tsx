// @vitest-environment happy-dom
import { act, Fragment, StrictMode } from "react";
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

it.each([
  { strict: false, controller: false },
  { strict: false, controller: true },
  { strict: true, controller: false },
  { strict: true, controller: true },
])("restores the original opener after replacing a dialog ($strict, $controller)", async ({ strict, controller }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const opener = document.createElement("button");
  const host = document.createElement("div");
  document.body.append(opener, host);
  opener.focus();
  const restore = vi.fn((element: HTMLElement | null) => element?.focus());
  const root = createRoot(host);
  const Wrapper = strict ? StrictMode : Fragment;
  const renderDialog = (name: string) =>
    root.render(
      <Wrapper>
        <Dialog
          key={name}
          title={name}
          testId={`dialog-${name}`}
          onClose={() => root.render(null)}
          restoreFocus={controller ? restore : undefined}
        >
          <input data-autofocus data-testid={`dialog-${name}-input`} />
        </Dialog>
      </Wrapper>,
    );
  try {
    await act(() => renderDialog("a"));
    expect(document.activeElement).toBe(document.querySelector('[data-testid="dialog-a-input"]'));
    await act(() => renderDialog("b"));
    const replacementInput = document.querySelector('[data-testid="dialog-b-input"]');
    expect(document.activeElement).toBe(replacementInput);
    expect(document.querySelector('[data-testid="dialog-a"]')).toBeNull();
    if (controller) expect(restore.mock.calls).toEqual([[opener]]);
    await act(() => replacementInput?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[data-testid="dialog-b"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    if (controller) expect(restore.mock.calls).toEqual([[opener], [opener]]);
    expect(opener.inert).toBeFalsy();
  } finally {
    await act(() => root.unmount());
    opener.remove();
    host.remove();
    vi.unstubAllGlobals();
  }
});

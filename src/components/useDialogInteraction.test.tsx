import { toast as interaction } from "../interop/ui/toastRuntime";
// @vitest-environment happy-dom
import { act, Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Dialog } from "../interop/ui/Dialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Toaster } from "../interop/ui/Toaster";
import { notify, toast } from "../interop/ui/toast";
import { modalLayers } from "../lib/modalLayers";

it.each([
  { surface: "dialog", strict: false },
  { surface: "dialog", strict: true },
  { surface: "shortcuts", strict: false },
  { surface: "shortcuts", strict: true },
])(
  "$surface owns a focused toast before autofocus releases it to a waiting notification (strict=$strict)",
  async ({ surface, strict }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(host, outside);
    const root = createRoot(host);
    const dismissed = vi.fn();
    const Wrapper = strict ? StrictMode : Fragment;
    const render = (open: boolean) =>
      root.render(
        <Wrapper>
          <Toaster />
          {open &&
            (surface === "dialog" ? (
              <Dialog title="Test" testId="test-dialog" onClose={() => {}}>
                <input data-autofocus data-testid="test-dialog-input" />
              </Dialog>
            ) : (
              <ShortcutsDialog onClose={() => {}} />
            ))}
        </Wrapper>,
      );
    try {
      await act(() => render(false));
      await act(() => notify("First", { action: { label: "Undo", run() {} }, onDismiss: dismissed }));
      const action = document.querySelector<HTMLButtonElement>('[data-testid="toast-action"]')!;
      await act(() => action.focus());
      await act(() => toast.info("Waiting"));
      await act(() => render(true));
      expect(modalLayers.top?.opener).toBe(action);
      expect(modalLayers.top?.panel.contains(document.activeElement)).toBe(true);
      expect(action.isConnected).toBe(true);
      expect(dismissed).not.toHaveBeenCalled();
      await act(() => render(false));
      expect(modalLayers.top).toBeNull();
      expect(document.activeElement).toBe(action);
      expect(dismissed).not.toHaveBeenCalled();
      await act(() => outside.focus());
      expect(interaction.current?.text).toBe("Waiting");
      expect(dismissed).toHaveBeenCalledTimes(1);
    } finally {
      await act(() => root.unmount());
      interaction.release();
      toast.dismiss();
      host.remove();
      outside.remove();
      vi.unstubAllGlobals();
    }
  },
);

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

it.each(["retained", "removed"])("a dialog Retry returns focus before the next frame (%s origin)", async (origin) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Hold frames: pressing Escape must work even before the browser paints again.
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const close = vi.fn();
  const retry = vi.fn();
  try {
    await act(() =>
      root.render(
        <>
          <Toaster />
          <Dialog title="Sequence" testId="test-sequence" onClose={close}>
            <button data-autofocus data-testid="test-download">
              Download
            </button>
          </Dialog>
        </>,
      ),
    );
    await act(() => toast.error("Download failed", { action: { label: "Retry", run: retry, testId: "test-retry" } }));
    const button = document.querySelector<HTMLButtonElement>('[data-testid="test-retry"]')!;
    await act(() => button.focus());
    if (origin === "removed") document.querySelector('[data-testid="test-download"]')!.remove();
    await act(() => button.click());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(modalLayers.top?.panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.closest('[data-testid="toast"]')).toBeNull();
    await act(() =>
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
    interaction.release();
    toast.dismiss();
    host.remove();
    vi.unstubAllGlobals();
  }
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PaletteDialog } from "./PaletteDialog";
import { paletteHost, publish } from "./host";

vi.mock("./sources", () => ({
  collectCommands: () =>
    ["First", "Second", "Third"].map((label) => ({
      id: `action:${label.toLowerCase()}`,
      label,
      group: "actions",
      idle: true,
    })),
}));

it("keeps the keyboard's highlighted command when the canvas context republishes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(<PaletteDialog view="canvas" diagrams={[]} onOpenDiagram={() => {}} onClose={() => {}} />),
    );
    const input = document.querySelector<HTMLInputElement>('[data-testid="command-input"]');
    if (!input) throw new Error("Missing palette search");
    const active = (id: string) =>
      document.querySelector(`[data-testid="command-item-action:${id}"]`)?.getAttribute("data-active");
    await act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(active("second")).toBe("true");
    await act(() => {
      publish("session", { run: () => {} });
    });
    expect(active("second")).toBe("true");
    await act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setValue) throw new Error("Missing native text setter");
      setValue.call(input, "First");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(active("first")).toBe("true");
  } finally {
    await act(() => root.unmount());
    host.remove();
    paletteHost.reset();
    vi.unstubAllGlobals();
  }
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ChecksStore } from "../checks/useChecks";
import { ToolRail } from "./ToolRail";
import { tools, type ToolHost } from "./tools";

it("Live disables Add and Annotate with editing hints and Edit enables them again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const host: ToolHost = {
    live: false,
    pinned: false,
    checks: new ChecksStore(),
    select: vi.fn(),
    shortcuts: vi.fn(),
  };
  let disconnect = tools.connect(host);
  try {
    await act(() => root.render(<ToolRail view="canvas" onView={vi.fn()} />));
    const add = container.querySelector<HTMLButtonElement>('[data-testid="rail-add"]')!;
    const annotate = container.querySelector<HTMLButtonElement>('[data-testid="rail-annotate"]')!;
    expect(add.disabled).toBe(false);
    expect(annotate.disabled).toBe(false);
    await act(() => {
      disconnect();
      disconnect = tools.connect({ ...host, live: true });
    });
    for (const [button, hint] of [
      [add, "Back to editing to add parts"],
      [annotate, "Back to editing to add notes"],
    ] as const) {
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(hint);
      const hintText = container.querySelector(`[data-testid="${button.dataset.testid}-description"]`)!;
      expect(hintText.textContent?.trim()).toBe(hint);
      expect(button.getAttribute("aria-describedby")).toBe(hintText.id);
      expect(button.tabIndex).toBe(-1);
    }
    expect(add.getAttribute("draggable")).toBe("false");
    await act(() => {
      disconnect();
      disconnect = tools.connect(host);
    });
    expect(add.disabled).toBe(false);
    expect(annotate.disabled).toBe(false);
    expect(add.hasAttribute("aria-describedby")).toBe(false);
    expect(annotate.hasAttribute("aria-describedby")).toBe(false);
  } finally {
    await act(() => {
      root.unmount();
      disconnect();
    });
    container.remove();
    vi.unstubAllGlobals();
  }
});

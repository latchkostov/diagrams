// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTooltip } from "./useTooltip";

it("keeps an external activation dismissed until explicitly reactivated", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let tooltip!: ReturnType<typeof useTooltip>;
  function Harness({ shown }: { shown: boolean }) {
    tooltip = useTooltip(shown);
    return <span data-testid="open">{String(tooltip.open)}</span>;
  }
  const render = (shown: boolean) =>
    act(() =>
      root.render(
        <StrictMode>
          <Harness shown={shown} />
        </StrictMode>,
      ),
    );
  try {
    await render(true);
    expect(tooltip.open).toBe(true);
    await act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(tooltip.open).toBe(false);
    await render(true);
    expect(tooltip.open).toBe(false);
    await render(false);
    await act(() => tooltip.reactivate());
    expect(tooltip.open).toBe(false);
    await render(true);
    expect(tooltip.open).toBe(true);
    await act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(tooltip.open).toBe(false);
    await act(() => tooltip.reactivate());
    expect(tooltip.open).toBe(true);
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

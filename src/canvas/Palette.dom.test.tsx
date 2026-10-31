// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Palette } from "./Palette";

it("consumes a loading-shell Enter once across StrictMode and preserves its search", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const add = vi.fn();
  const render = () => (
    <StrictMode>
      <Palette collapsed={false} initialQuery="kafka topic" initialPick="kafka topic" onToggle={() => {}} onAdd={add} />
    </StrictMode>
  );
  try {
    await act(() => root.render(render()));
    await act(() => root.render(render()));
    expect(add.mock.calls).toEqual([["kafka.topic"]]);
    expect(container.querySelector<HTMLInputElement>('[data-testid="palette-search"]')?.value).toBe("kafka topic");
  } finally {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { HoverHistory } from "./HoverHistory";

const state = vi.hoisted(() => ({ snapshot: { time: 0, nodes: { caller: { throughput: 0 } } } }));
vi.mock("./context", () => ({ useLive: () => ({ controller: {} }), useLiveState: () => state }));

it("samples on simulation-second boundaries before capping and resets on backward seek", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const values = () => container.querySelector('[data-testid="hover-history-values"]')?.textContent;
  const at = async (time: number) => {
    state.snapshot = { time, nodes: { caller: { throughput: time / 1000 } } };
    await act(() => root.render(<HoverHistory id="caller" />));
  };
  try {
    await at(0);
    expect(values()).toBe("Throughput each second, oldest first: 0/s");
    await at(999);
    expect(values()).toBe("Throughput each second, oldest first: 0/s");
    await at(1000);
    expect(values()).toBe("Throughput each second, oldest first: 0/s, 1/s");
    await at(1999);
    expect(values()).toBe("Throughput each second, oldest first: 0/s, 1/s");
    await at(2000);
    expect(values()).toBe("Throughput each second, oldest first: 0/s, 1/s, 2/s");
    for (let second = 3; second <= 12; second++) await at(second * 1000);
    expect(values()).toBe("Throughput each second, oldest first: 3/s, 4/s, 5/s, 6/s, 7/s, 8/s, 9/s, 10/s, 11/s, 12/s");
    await at(1000);
    expect(values()).toBe("Throughput each second, oldest first: 1/s");
  } finally {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

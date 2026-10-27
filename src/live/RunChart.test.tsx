// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RunChart } from "./RunChart";
import { RunHistory } from "./runHistory";

it("reuses decimated observations until history, width, window or node changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resize = (_width: number) => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
        resize = (width) => callback([{ contentRect: { width } }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  const history = new RunHistory();
  const snapshot = (time: number) => ({ time, inSystem: 0, nodes: { api: { throughput: 17, backlog: 2 } } });
  history.sample(snapshot(0), 1);
  const reads = vi.spyOn(history, "series");
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = (time = 0, node = "api") =>
    act(() =>
      root.render(
        <RunChart history={history} node={node} name="API" time={time} total={60000} markers={[]} vitals={[]} />,
      ),
    );
  try {
    await render();
    expect(reads).toHaveBeenCalledTimes(1);
    history.sample(snapshot(200), 1);
    await render(200);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid="hover-history-values"]')?.textContent).toBe("17/s");
    await render(250);
    expect(reads).toHaveBeenCalledTimes(2);
    await act(() => resize(120));
    expect(reads).toHaveBeenLastCalledWith("api");
    expect(reads).toHaveBeenCalledTimes(3);
    await render(12000);
    expect(reads).toHaveBeenCalledTimes(4);
    await render(12000, "other");
    expect(reads).toHaveBeenCalledTimes(5);
    history.reset();
    await render(12000, "other");
    expect(reads).toHaveBeenCalledTimes(6);
    expect(host.querySelector('[data-testid="hover-history-values"]')?.textContent).toBe("");
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

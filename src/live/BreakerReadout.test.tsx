// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BreakerReadout } from "./BreakerReadout";
import type { BreakerView } from "../sim/breaker";

const rendered = vi.hoisted(() => vi.fn());
vi.mock("../i18n", async (original) => {
  const module = await original<typeof import("../i18n")>();
  return {
    ...module,
    useLocale: () => {
      rendered();
      return module.useLocale();
    },
  };
});

it("renders only changed countdown buckets, while preserving settled counts and breaker transitions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  let breaker: BreakerView = {
    state: "open",
    remainingMs: 3000,
    calls: 20,
    failurePercent: 100,
    probesSent: 0,
    probesSettled: 0,
    probesInFlight: 0,
    probes: 5,
  };
  const calls = { inFlight: 0, held: 0, timedOut: 0, failed: 2, late: 0, succeeded: 8 };
  const render = () =>
    act(() => root.render(<BreakerReadout id="call" breaker={breaker} calls={{ ...calls }} testId="breaker" />));
  const renders = () => rendered.mock.calls.length;
  rendered.mockClear();
  try {
    await render();
    expect(renders()).toBe(1);
    for (const remainingMs of [2999, 2875, 2500, 2001]) {
      breaker = { ...breaker, remainingMs };
      await render();
    }
    expect(renders()).toBe(1);
    breaker = { ...breaker, remainingMs: 2000 };
    await render();
    expect(renders()).toBe(2);
    expect(container.querySelector('[data-testid="breaker-open-call"]')?.textContent).toContain("2 seconds");
    for (const remainingMs of [1999, 1750, 1001]) {
      breaker = { ...breaker, remainingMs };
      await render();
    }
    expect(renders()).toBe(2);
    breaker = { ...breaker, remainingMs: 1000 };
    await render();
    expect(renders()).toBe(3);
    expect(container.querySelector('[data-testid="breaker-open-call"]')?.textContent).toContain("1 second");
    calls.failed = 3;
    await render();
    expect(renders()).toBe(4);
    expect(container.textContent).toContain("27%");
    breaker = { ...breaker, state: "half-open", probesSettled: 1, probesInFlight: 2 };
    await render();
    expect(renders()).toBe(5);
    expect(container.querySelector('[data-testid="breaker-probes-call"]')?.textContent).toContain("1 of 5");
    breaker = { ...breaker, state: "closed" };
    await render();
    expect(renders()).toBe(6);
    expect(container.querySelector('[data-testid="breaker"]')?.getAttribute("data-state")).toBe("closed");
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

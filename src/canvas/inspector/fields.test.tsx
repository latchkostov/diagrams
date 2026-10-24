// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { Segmented } from "./fields";

it("selected segments ignore clicks and Home/End without losing keyboard focus", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  const options = [
    { value: "off", label: t("resilience.off") },
    { value: "on", label: t("resilience.on") },
  ];
  try {
    for (const value of ["off", "on"]) {
      await act(() =>
        root.render(
          <Segmented
            value={value}
            options={options}
            onChange={onChange}
            testId="choice"
            label={t("resilience.breaker")}
          />,
        ),
      );
      const selected = container.querySelector<HTMLButtonElement>(`[data-testid="choice-${value}"]`)!;
      onChange.mockClear();
      await act(() => selected.click());
      await act(() =>
        selected.dispatchEvent(new KeyboardEvent("keydown", { key: value === "off" ? "Home" : "End", bubbles: true })),
      );
      expect(onChange).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(selected);
      await act(() => selected.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      expect(onChange).toHaveBeenCalledExactlyOnceWith(value === "off" ? "on" : "off");
    }
  } finally {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("keyboard moves retain the latest intent while controlled props await commit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  try {
    await act(() =>
      root.render(
        <Segmented
          value="blocking"
          options={[
            { value: "blocking", label: t("threads.holds") },
            { value: "non-blocking", label: t("threads.frees") },
          ]}
          onChange={onChange}
          testId="wait"
          label={t("threads.whileWaiting")}
        />,
      ),
    );
    const holds = container.querySelector<HTMLButtonElement>('[data-testid="wait-blocking"]')!;
    const frees = container.querySelector<HTMLButtonElement>('[data-testid="wait-non-blocking"]')!;
    holds.focus();
    await act(() => holds.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement).toBe(frees);
    // Keep the controlled prop unchanged to represent an owner whose first update is still pending.
    await act(() => frees.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(onChange.mock.calls).toEqual([["non-blocking"], ["blocking"]]);
    expect(document.activeElement).toBe(holds);
  } finally {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

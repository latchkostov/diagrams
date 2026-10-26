// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Slider } from "./Slider";

it("commits fractional drafts on Enter/blur, cancels Escape, clamps, and disables both controls", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const changed = vi.fn();
  function Harness({ disabled = false }: { disabled?: boolean }) {
    const [value, setValue] = useState(0.5);
    return (
      <Slider
        label="Fraction"
        value={value}
        min={0.1}
        max={1}
        step={0.1}
        testId="fraction"
        disabled={disabled}
        onChange={(v) => {
          changed(v);
          setValue(v);
        }}
      />
    );
  }
  try {
    await act(() => root.render(<Harness />));
    const input = host.querySelector<HTMLInputElement>('[data-testid="fraction-input"]')!;
    const range = host.querySelector<HTMLInputElement>('[data-testid="fraction-slider"]')!;
    const type = async (value: string) => {
      await act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const key = async (key: string) =>
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    expect(input.value).toBe("0.5");
    await type("0.76");
    await key("Enter");
    expect(changed).toHaveBeenLastCalledWith(0.8);
    expect(range.value).toBe("0.8");
    await type("0.2");
    await key("Escape");
    expect(input.value).toBe("0.8");
    await type("9");
    await act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(changed).toHaveBeenLastCalledWith(1);
    await type("-2");
    await key("Enter");
    expect(changed).toHaveBeenLastCalledWith(0.1);
    await act(() => root.render(<Harness disabled />));
    expect(input.disabled).toBe(true);
    expect(range.disabled).toBe(true);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

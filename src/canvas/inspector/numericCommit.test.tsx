// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Slider } from "../../components/Slider";
import { t } from "../../i18n";
import { SizeInput } from "./fields";

it.each(["slider", "size"] as const)("%s compares the final numeric commit with the stored value", async (kind) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const write = vi.fn();
  const begin = vi.fn();
  const end = vi.fn();
  function Harness() {
    const [value, setValue] = useState(20.4);
    const change = (next: number) => {
      write(next);
      setValue(next);
    };
    return kind === "slider" ? (
      <Slider
        label={t("inspector.borderRadius")}
        value={value}
        min={10}
        max={40}
        testId="number"
        onChange={change}
        onEditStart={begin}
        onEditEnd={end}
      />
    ) : (
      <SizeInput label={t("inspector.width")} value={value} min={10} testId="number-input" onCommit={change} />
    );
  }
  try {
    await act(() => root.render(<Harness />));
    const input = host.querySelector<HTMLInputElement>('[data-testid="number-input"]')!;
    const commit = async (draft: string, blur = false) => {
      await act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, draft);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(() =>
        input.dispatchEvent(
          blur
            ? new FocusEvent("focusout", { bubbles: true })
            : new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
      );
    };
    // The display rounds to 20, but the file still has 20.4: committing 20 must write.
    expect(input.value).toBe("20");
    await commit("20.0");
    expect(write.mock.calls).toEqual([[20]]);
    for (const blur of [false, true]) {
      await commit("20.0", blur);
      await commit("20.2", blur);
    }
    expect(write.mock.calls).toEqual([[20]]);
    // Empty drafts must be rejected away from the minimum: a clamp to 10 would be an edit here.
    for (const blur of [false, true]) {
      for (const draft of ["", "   "]) {
        const starts = begin.mock.calls.length;
        const ends = end.mock.calls.length;
        await commit(draft, blur);
        expect(write.mock.calls).toEqual([[20]]);
        expect(input.value).toBe("20");
        expect(begin).toHaveBeenCalledTimes(starts);
        expect(end).toHaveBeenCalledTimes(ends);
      }
    }
    // A valid replacement still commits after rejecting an empty draft.
    await commit("27");
    expect(write.mock.calls).toEqual([[20], [27]]);
    await commit("-1");
    expect(write.mock.calls).toEqual([[20], [27], [10]]);
    const starts = begin.mock.calls.length;
    const ends = end.mock.calls.length;
    for (const blur of [false, true]) {
      await commit("-100", blur);
      await commit("10", blur);
      await commit("", blur);
      await commit("Infinity", blur);
    }
    expect(write.mock.calls).toEqual([[20], [27], [10]]);
    expect(begin).toHaveBeenCalledTimes(starts);
    expect(end).toHaveBeenCalledTimes(ends);
  } finally {
    await act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

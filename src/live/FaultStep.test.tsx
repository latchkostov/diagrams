// @vitest-environment happy-dom
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, it, vi } from "vitest";
import { FaultStep } from "./FaultStep";
import { SimErrors } from "./validationContext";
import { cacheFixture } from "../lab/cacheFixture";

it("keeps an unresolved purge rule visible with its field error until explicitly repaired", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const onChange = vi.fn();
  flushSync(() =>
    root.render(
      <SimErrors.Provider value={new Set(["step-fault-rule"])}>
        <FaultStep
          diagram={cacheFixture()}
          fault={{ kind: "purge", node: "cache", rule: "deleted" }}
          testId="step"
          onChange={onChange}
        />
      </SimErrors.Provider>,
    ),
  );
  try {
    const select = host.querySelector<HTMLSelectElement>('[data-testid="step-fault-rule"]')!;
    expect(select.value).toBe("rule:deleted");
    expect(select.selectedOptions[0].textContent).toContain("deleted");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(select.getAttribute("aria-describedby")).toBe("step-fault-rule-error");
    select.value = "all";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "purge", node: "cache", rule: undefined });
  } finally {
    flushSync(() => root.unmount());
  }
});

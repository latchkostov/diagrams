// @vitest-environment happy-dom
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, it, vi } from "vitest";
import { FaultStep } from "./FaultStep";
import { SimErrors } from "./validationContext";
import { cacheFixture } from "../lab/cacheFixture";

it.each(["deleted", ""])(
  "keeps an unresolved purge rule %s visible with its field error until explicitly repaired",
  (rule) => {
    const diagram = cacheFixture();
    diagram.nodes[1].props!.cache = {
      rules: [{ id: "pages", match: { types: ["Page"] }, policy: { ttlMs: 1000, keys: 1 } }],
    };
    const host = document.createElement("div");
    const root = createRoot(host);
    const onChange = vi.fn();
    flushSync(() =>
      root.render(
        <SimErrors.Provider value={new Set(["step-fault-rule"])}>
          <FaultStep
            diagram={diagram}
            fault={{ kind: "purge", node: "cache", rule }}
            testId="step"
            onChange={onChange}
          />
        </SimErrors.Provider>,
      ),
    );
    try {
      const select = host.querySelector<HTMLSelectElement>('[data-testid="step-fault-rule"]')!;
      expect(select.value).toBe(`rule:${rule}`);
      expect(select.selectedOptions[0].textContent).toContain(rule || "Everything else");
      expect(select.getAttribute("aria-invalid")).toBe("true");
      expect(select.getAttribute("aria-describedby")).toBe("step-fault-rule-error");
      select.value = "all";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      expect(onChange).toHaveBeenLastCalledWith({ kind: "purge", node: "cache", rule: undefined });
    } finally {
      flushSync(() => root.unmount());
    }
  },
);

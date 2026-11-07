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
      const error = host.querySelector('[data-testid="step-fault-rule-error"]');
      expect(error?.textContent).toBe("Rule: choose an existing target in this diagram.");
      expect(select.closest("label")?.nextElementSibling).toBe(error);
      select.value = "all";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      expect(onChange).toHaveBeenLastCalledWith({ kind: "purge", node: "cache", rule: undefined });
    } finally {
      flushSync(() => root.unmount());
    }
  },
);

it.each(["hard", "soft", "deploy-hard", "deploy-soft"])("authors %s from one cache action", (value) => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const onChange = vi.fn();
  try {
    flushSync(() =>
      root.render(
        <FaultStep
          diagram={cacheFixture()}
          fault={{ kind: "purge", node: "cache", mode: "soft", reason: "deploy", rule: "pages" }}
          testId="step"
          onChange={onChange}
        />,
      ),
    );
    const select = host.querySelector<HTMLSelectElement>('[data-testid="step-fault-value"]')!;
    expect(select.value).toBe("deploy-soft");
    expect(host.querySelector('[data-testid="step-fault-reason"]')).toBeNull();
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "purge",
      node: "cache",
      rule: "pages",
      mode: value.endsWith("soft") ? "soft" : "hard",
      reason: value.startsWith("deploy-") ? "deploy" : undefined,
    });
  } finally {
    flushSync(() => root.unmount());
  }
});

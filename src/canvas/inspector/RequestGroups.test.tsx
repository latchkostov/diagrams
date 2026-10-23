import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { safeStorage } from "../../lib/storage";
import { recommendedRetry } from "../../sim/resiliencePresets";
import { RetryFields } from "./RetryFields";
import { BreakerFields } from "./BreakerFields";

it("keeps retry tuning collapsed and the load limit visible beside attempts", () => {
  const read = vi.spyOn(safeStorage, "getItem").mockReturnValue(null);
  try {
    const html = renderToStaticMarkup(<RetryFields retry={recommendedRetry("GET")} set={() => {}} />);
    expect(html).toContain("Extra calls limited to 20% or 10 retries/s, whichever is greater, over 10 seconds");
    expect(html).toContain('data-testid="inspector-group-retries"');
    expect(html).not.toContain('data-testid="inspector-field-retry-backoff"');
    expect(html).not.toContain('data-testid="inspector-field-retry-budget-percent"');
  } finally {
    read.mockRestore();
  }
});

it("opened groups have associated explanations and breaker prose uses actual tuning", () => {
  const read = vi
    .spyOn(safeStorage, "getItem")
    .mockReturnValue('{"retry-details":true,"retry-safety":true,"breaker-details":true}');
  try {
    const retry = renderToStaticMarkup(<RetryFields retry={recommendedRetry("GET")} set={() => {}} />);
    expect(retry).toContain("Wait before retrying");
    expect(retry).toContain("Increase the wait");
    expect(retry).toContain("Spread retries randomly (jitter)");
    expect(retry).toContain("Safe to repeat (idempotent)");
    const breaker = renderToStaticMarkup(
      <BreakerFields
        breaker={{ minimumCalls: 12, failurePercent: 40, windowMs: 2000, openMs: 3000, halfOpenCalls: 7 }}
        set={() => {}}
      />,
    );
    expect(breaker).toContain(
      "at least 12 calls have been observed over 2 seconds and 40% fail; wait 3 seconds, then try 7 calls.",
    );
    expect(breaker).not.toContain("Resilience4j");
    for (const html of [retry, breaker]) {
      for (const [, id] of html.matchAll(/aria-describedby="([^"]+)"/g)) expect(html).toContain(`id="${id}"`);
      expect(html).toContain('role="group"');
    }
  } finally {
    read.mockRestore();
  }
});

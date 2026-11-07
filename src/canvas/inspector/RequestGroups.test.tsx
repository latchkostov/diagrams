// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, it, vi } from "vitest";
import { safeStorage } from "../../lib/storage";
import { recommendedRetry } from "../../sim/resiliencePresets";
import { RetryFields } from "./RetryFields";
import { BreakerFields } from "./BreakerFields";
import { CallWaitFields } from "./CallWaitFields";
import { cacheAsideFixture } from "../../lab/cacheAsideFixture";
import type { EditorApi } from "../../editor/types";

it.each(["active", "every-request", "no-rules", "older-model"])(
  "only an active cache-aside condition describes automatic write-back (%s)",
  (mode) => {
    const d = cacheAsideFixture();
    if (mode === "every-request") d.edges[2].props!.caller = { wait: "blocking" };
    if (mode === "no-rules") delete d.nodes[2].props!.cache;
    if (mode === "older-model") d.planning!.revision = "p3-w2";
    const editor = {
      getDiagram: () => d,
      getEdge: (id: string) => d.edges.find((e) => e.id === id),
      getNode: (id: string) => d.nodes.find((n) => n.id === id),
    } as EditorApi;
    const read = vi.spyOn(safeStorage, "getItem").mockReturnValue('{"call-advanced":true}');
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      flushSync(() =>
        root.render(
          <CallWaitFields editor={editor} edgeId="fetch" stencil="generic.service" caller={d.edges[2].props!.caller} />,
        ),
      );
      const html = container.innerHTML;
      expect(html).toContain('data-testid="inspector-field-onMiss"');
      expect(html.includes('data-testid="inspector-hint-onMiss"')).toBe(mode === "active");
      expect(html.includes('aria-describedby="cache-aside-hint"')).toBe(mode === "active");
    } finally {
      root.unmount();
      read.mockRestore();
    }
  },
);

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

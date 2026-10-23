import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { safeStorage } from "../../lib/storage";
import { recommendedRetry } from "../../sim/resiliencePresets";
import { RetryFields } from "./RetryFields";

it.each([
  { minPerSec: undefined, expected: "10 retries/s" },
  { minPerSec: 0, expected: "0 retries/s" },
  { minPerSec: 2, expected: "2 retries/s" },
])("the collapsed retry summary includes the effective minimum: $expected", ({ minPerSec, expected }) => {
  const retry = { ...recommendedRetry("GET"), budget: { percent: 20, minPerSec } };
  const html = renderToStaticMarkup(<RetryFields retry={retry} set={() => {}} />);
  expect(html).toContain(`20% or ${expected}, whichever is greater, over 10 seconds`);
});

it("each retry checkbox has one label, without nested labels stealing its accessible name", () => {
  const read = vi
    .spyOn(safeStorage, "getItem")
    .mockImplementation((key) =>
      key === "diagrams.inspector.open.v1"
        ? '{"retry-details":true,"retry-safety":true,"retry-budget-details":true}'
        : null,
    );
  try {
    const html = renderToStaticMarkup(<RetryFields retry={recommendedRetry("GET")} set={() => {}} />);
    let depth = 0;
    for (const [tag] of html.matchAll(/<\/?label\b[^>]*>/g)) {
      if (tag.startsWith("</")) depth--;
      else {
        expect(depth).toBe(0);
        depth++;
      }
    }
    expect(depth).toBe(0);
    expect(html).toContain('data-testid="inspector-field-retry-timeout"');
  } finally {
    read.mockRestore();
  }
});

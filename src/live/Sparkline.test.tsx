import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SampleSparkline } from "./Sparkline";

it("SampleSparkline describes samples accurately", () => {
  const markup = renderToStaticMarkup(<SampleSparkline samples={[3, 1, 5, 2]} />);
  const text = (testId: string) =>
    markup.match(new RegExp(`<span id="([^"]+)"[^>]*data-testid="${testId}"[^>]*>([^<]*)</span>`)) ?? [];
  const [, summaryId, summary] = text("hover-history-summary");
  const [, valuesId, values] = text("hover-history-values");
  expect(summary).toBe("Now \u20682/s\u2069 · low \u20681/s\u2069 · peak \u20685/s\u2069");
  expect(values).toBe("Throughput each second, oldest first: 3/s, 1/s, 5/s, 2/s");
  // The chart names itself and is described by exactly those two texts.
  expect(markup).toContain('aria-label="Recent throughput · 4 samples"');
  expect(markup).toContain(`aria-describedby="${summaryId} ${valuesId}"`);
});

import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SampleSparkline } from "./Sparkline";
import { ThreadCeiling } from "./ThreadCeiling";

it.each([0, 300])("flat observed %s/s spans the strip at mid-height above its text footer", (value) => {
  const html = renderToStaticMarkup(<SampleSparkline docked samples={[value, value, value]} />);
  expect(html).toContain('preserveAspectRatio="none"');
  expect(html).toContain('d="M0 27 L260 27"');
  expect(html).toContain('data-testid="hover-history-baseline"');
  expect(html).toContain('data-testid="hover-history-scope">Last 10 seconds');
  expect(html.indexOf("</svg>")).toBeLessThan(html.indexOf('data-testid="hover-history-summary"'));
  expect(html).toContain(`Now ${value}/s`);
});

it("docked ceilings are label/value facts with the shared explanatory sentence", () => {
  const html = renderToStaticMarkup(
    <ThreadCeiling
      docked
      noun="threads"
      wait={{ slots: 4, ceiling: 40, workMs: 10, callMs: 90, threadHoldMs: 100, memoryResidenceMs: 100 }}
    />,
  );
  expect(html).toContain('<dt>Ceiling</dt><dd class="mono">40/s</dd>');
  expect(html).toContain("4 threads");
  expect(html).toContain("10 ms work + 90 ms call");
});

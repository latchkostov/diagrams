import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ThreadMeter } from "./ThreadMeter";
import { formatScale } from "./format";

it("describes unknown caller capacity without invalid numeric meter attributes", () => {
  const html = renderToStaticMarkup(
    <ThreadMeter
      id="caller"
      noun="threads"
      threads={{ slots: Infinity, working: 1, waiting: 2, queued: 0, waitingOn: [] }}
    />,
  );
  expect(html).toContain("capacity unknown");
  expect(html).not.toContain('role="meter"');
  expect(html).not.toContain("aria-valuemax");
  expect(html).not.toContain("Infinity");
});

it("keeps fractional caller sampling weights distinct in labels", () => {
  expect(formatScale(1.5)).toBe("1.5");
  expect(formatScale(2)).toBe("2");
});

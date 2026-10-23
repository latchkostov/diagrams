import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { LiveOutcomes } from "./LiveDetails";
import { verdictSection } from "../live/verdictSection";
import type { NodeSimState } from "../sim/types";

const metrics: NodeSimState = {
  id: "worker",
  role: "processor",
  status: "up",
  processed: 1234,
  throughput: 20,
  inFlight: 3,
  backlog: 7,
  failed: 0,
  dropped: 0,
  deadLettered: 9,
  lag: {},
};

test("Outcomes uses definition rows, omits zeros and keeps dead letters separate from loss", () => {
  const html = renderToStaticMarkup(<LiveOutcomes metrics={metrics} />);
  expect(html).toContain("<dl");
  expect(html).toContain("<dt>Processed</dt>");
  expect(html).toContain("<dt>Moved to dead-letter queue</dt>");
  expect(html).not.toContain("<dt>Lost</dt>");
  expect(html).not.toContain("<dt>Failed</dt>");
  expect(html).not.toContain("<dt>Rejected</dt>");
  expect(html).toContain("No failures, losses or rejections");
});

test("Outcomes exposes each nonzero failure, loss, blocked and rejected count", () => {
  const html = renderToStaticMarkup(
    <LiveOutcomes metrics={{ ...metrics, failed: 4, dropped: 5, blocked: 6, rejected: 8 }} />,
  );
  for (const label of ["Failed", "Lost", "Blocked", "Rejected"]) expect(html).toContain(`<dt>${label}</dt>`);
  expect(html).not.toContain("No failures, losses or rejections");
});

test("the verdict chooses its corresponding default section", () => {
  for (const [problem, section] of [
    ["threads", "threads"],
    ["timeout", "latency"],
    ["lag", "readers"],
    ["loss", "outcomes"],
    ["memory", "resources"],
  ])
    expect(verdictSection(problem)).toBe(section);
  expect(verdictSection("waiting", "node", true)).toBe("readers");
  expect(verdictSection("waiting", "node", false)).toBeNull();
  expect(verdictSection()).toBeNull();
  expect(verdictSection("breaker", "edge")).toBe("breaker");
  expect(verdictSection("retry", "edge")).toBe("retries");
});

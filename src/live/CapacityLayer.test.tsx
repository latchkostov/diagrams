import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CapacityChip } from "./CapacityLayer";
import type { NodeHeat } from "./capacityModel";

it("keeps capacity text accessible while reserving raw numeric diagnostics for E2E", () => {
  const heat = { id: "api", label: "API", level: "hot", utilization: 0.95, text: "95%" } as NodeHeat;
  const html = renderToStaticMarkup(<CapacityChip heat={heat} />);
  expect(html).toContain('aria-label="API: near capacity, 95%"');
  expect(html).toContain('data-testid="capacity-label-api"');
  expect(html.includes('data-utilization="0.950"')).toBe(import.meta.env.VITE_E2E === "1");
});

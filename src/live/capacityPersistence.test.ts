import { expect, it } from "vitest";
import kafka from "../examples/kafka-order-pipeline.json";
import type { DiagramFile } from "../model/types";
import { emptyInputs } from "./capacityModel";
import { capacitySaveCandidate, capacitySaveError } from "./capacityPersistence";
import { validateDiagram } from "../interop/native";
const d = kafka as DiagramFile;
it.each([null, d.simulations!.find((s) => s.id === "black-friday")!])(
  "rejects excessive rates before saving (base: %s)",
  (base) => {
    const before = JSON.stringify(d);
    const inputs = { ...emptyInputs(), rates: { shopper: 12000 } };
    expect(capacitySaveError(capacitySaveCandidate(d, base, inputs).diagram)).toContain("10,000");
    expect(JSON.stringify(d)).toBe(before);
    expect(inputs.rates.shopper).toBe(12000);
  },
);
it("rejects the complete document's multiplied traffic budget", () => {
  const base = d.simulations!.find((s) => s.id === "black-friday")!;
  const candidate = capacitySaveCandidate(d, base, { ...emptyInputs(), traffic: 10 });
  expect(capacitySaveError(candidate.diagram)).toContain("traffic volume budget");
});
it("rejects free-play rates folded past the limit and accepts lossless supported saves", () => {
  const excessive = capacitySaveCandidate(d, null, { ...emptyInputs(), traffic: 10, rates: { shopper: 2000 } });
  expect(capacitySaveError(excessive.diagram)).toContain("Cannot save");
  const valid = capacitySaveCandidate(d, null, { ...emptyInputs(), capacity: 2, rates: { shopper: 100 } });
  expect(capacitySaveError(valid.diagram)).toBeNull();
  const result = validateDiagram(valid.diagram);
  expect(result.ok && result.diagram).toEqual(valid.diagram);
});

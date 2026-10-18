import { expect, it } from "vitest";
import { faultDrillFixture } from "../lab/faultDrillFixture";
import { faultLabel, nodeFaultLabel } from "../model/faultWords";
import { faultTrouble } from "./faultTrouble";
import type { Trouble } from "./observedTrouble";

const down: Trouble = {
  key: "down:worker",
  kind: "down",
  node: "worker",
  headline: "Worker is down",
  announce: "Worker is down",
  detail: "Messages sent to it fail",
  action: { kind: "revive", node: "worker" },
};

it("restores the enclosing boundary and reports actual loss rather than hypothetical failure", () => {
  const diagram = faultDrillFixture();
  const faults = [{ kind: "boundary", boundary: "zone-b", down: true }] as const;
  expect(faultTrouble(down, diagram, faults)).toMatchObject({
    headline: "Zone b is down",
    detail: "No messages dropped here. New requests can go elsewhere.",
    action: { kind: "restore-boundary", boundary: "zone-b", label: "Zone b" },
  });
  expect(faultTrouble(down, diagram, faults, { worker: { dropped: 26 } })?.detail).toBe("26 messages dropped");
  expect(faultTrouble(down, diagram)).toBe(down);
});

it("faults on a blamed consumer replace capacity advice with Clear fault", () => {
  const faults = [
    { kind: "slow", node: "worker", factor: 5 },
    { kind: "fail", node: "worker", rate: 0.5 },
  ] as const;
  const lag: Trouble = { ...down, kind: "lag", node: "queue", related: ["worker"], action: { kind: "inputs" } };
  expect(nodeFaultLabel("worker", faults)).toBe("5× slower · fails 50%");
  expect(faultTrouble(lag, faultDrillFixture(), faults)).toMatchObject({
    action: { kind: "clear-fault", node: "worker" },
  });
  expect(faultTrouble(lag, faultDrillFixture(), faults)?.detail).toContain("5× slower · fails 50%");
});

it("fault markers resolve human labels while preserving IDs as a missing-target fallback", () => {
  const fault = { kind: "boundary", boundary: "zone-b", down: true } as const;
  expect(faultLabel(fault, "zone-outage", faultDrillFixture())).toBe("Zone outage: Zone b");
  expect(faultLabel({ ...fault, boundary: "missing" }, "zone-outage", faultDrillFixture())).toBe(
    "Zone outage: missing",
  );
});

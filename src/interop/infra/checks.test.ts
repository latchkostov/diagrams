import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { runChecks } from "../../checks/run";
import type { ImportOutcome } from "../formats";
import { importAsyncApi, importCompose, importKubernetes, importTerraform, replayOutcome } from "./pipeline";

// The architecture checks on every import fixture, as imported: the regression snapshot behind the "Imports"
// addendum to docs/research/architecture-checks.md ("Batch 3: precision gate"). Each finding was judged there; a
// change to this list is a change to that table.

const DIR = "tests/fixtures/imports";
const read = (path: string) => ({ name: path.replace(/^.*\//, ""), text: readFileSync(`${DIR}/${path}`, "utf8") });

function diagramOf(outcome: ImportOutcome): DiagramFile {
  if (outcome.ok !== true) throw new Error(`import failed: ${JSON.stringify(outcome)}`);
  return outcome.diagram;
}
const terraform = (file: string) => importTerraform([read(`terraform/${file}`)]);
/** Draw everything: the import's replay, drawn. */
const everything = (file: string) => {
  const outcome = terraform(file);
  if (outcome.ok !== true || !outcome.replay) throw new Error("no replay");
  return diagramOf(replayOutcome(outcome.replay));
};

const IMPORTS: Record<string, () => DiagramFile> = {
  compose: () => diagramOf(importCompose([read("compose/docker-compose.yml")])),
  kubernetes: () =>
    diagramOf(
      importKubernetes(
        readdirSync(`${DIR}/k8s`)
          .sort()
          .map((name) => read(`k8s/${name}`)),
      ),
    ),
  asyncapi: () =>
    diagramOf(
      importAsyncApi(
        ["orders-service", "shipping-service", "notifications-2.6"].map((n) => read(`asyncapi/${n}.asyncapi.yaml`)),
      ),
    ),
  "terraform aws-plan": () => diagramOf(terraform("aws-plan.json")),
  "terraform aws-plan, Draw everything": () => everything("aws-plan.json"),
  "terraform azure-state": () => diagramOf(terraform("azure-state.json")),
  "terraform azure-state, Draw everything": () => everything("azure-state.json"),
};

const EXPECTED: Record<string, string[]> = {
  compose: ["warning no-reader:topic-payments.completed.v1"],
  kubernetes: ["warning no-reader:topic-payments.completed.v1"],
  asyncapi: [
    "warning no-reader:topic-orders.cancelled.v1",
    "warning no-reader:topic-shipping.dispatched.v1",
    "warning no-reader:topic-email.sent",
    "suggestion dead-letter:topic-order-notifications",
    "suggestion no-reader:topic-shipping.orders-placed.dlq",
  ],
  "terraform aws-plan": ["suggestion no-reader:orders-dlq"],
  "terraform aws-plan, Draw everything": ["suggestion no-reader:orders-dlq"],
  "terraform azure-state": ["warning no-reader:billing-events", "suggestion dead-letter:billing-inbox"],
  "terraform azure-state, Draw everything": ["warning no-reader:billing-events", "suggestion dead-letter:billing-inbox"],
};

describe("checks on the import fixtures", () => {
  it.each(Object.keys(IMPORTS))("%s", (name) => {
    const findings = runChecks(IMPORTS[name]()).findings.map((f) => `${f.severity} ${f.id}`);
    expect(findings).toEqual(EXPECTED[name]);
  });

  it("reads the one-replica counts the Kubernetes fixture says, on nodes single-point doesn't fire for", () => {
    const d = IMPORTS.kubernetes();
    const ones = d.nodes.filter((n) => n.props?.replicas === 1).map((n) => `${n.id} ${n.stencil}`);
    // A database and a cache (stores), and a KEDA-scaled consumer (async: its broker buffers).
    expect(ones.sort()).toEqual(["payments-worker generic.service", "postgres postgres", "redis redis.cache"]);
  });
});

import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import type { ImportOutcome } from "../formats";
import type { ImportReport } from "./graph";
import { importKubernetes, replayOutcome } from "./pipeline";
import { kubernetesChain as chain } from "../../test/kubernetesChain";

function ok(outcome: ImportOutcome): { diagram: DiagramFile; report: ImportReport } {
  if (outcome.ok !== true) throw new Error(`import failed: ${JSON.stringify(outcome)}`);
  if (!outcome.report) throw new Error("no report");
  return { diagram: outcome.diagram, report: outcome.report };
}
const k8s = (text: string, name = "manifests.yaml") => ok(importKubernetes([{ name, text }]));

describe("Kubernetes import: Helm and hostile input", () => {
  it("reads 2,000 documents, and refuses more", () => {
    const docs = chain(1_000);
    const { report } = k8s(docs);
    // Over 300 nodes: the import draws some namespaces, and every one of them drawn is the whole set.
    expect(report.nodes).toBeLessThanOrEqual(300);
    const pick = report.pick!;
    expect(pick.total).toBe(1_000);
    const { diagram } = ok(
      replayOutcome(
        pick.graph,
        pick.format,
        pick.groups.map((g) => g.key),
      ),
    );
    expect(diagram.nodes).toHaveLength(1_000);
    expect(diagram.edges).toHaveLength(1_000);
    expect(diagram.groups).toHaveLength(20);
    const more = `${docs}---\napiVersion: v1\nkind: ConfigMap\nmetadata: { name: one-too-many }\n`;
    expect(() => importKubernetes([{ name: "big.yaml", text: more }])).toThrow(/more than 2,000/);
  });
});

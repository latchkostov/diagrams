import { describe, expect, it } from "vitest";
import { validateDiagram } from "../../interop/native";
import { stencils } from "../../stencils/registry";
import { FAMILIES, FAMILY_IDS, describeWorkload, type Family } from ".";
import { publicExamples } from "./examples";
import { asyncApiDocuments, composeFile, kubernetesManifests, terraformPlan } from "./sources";
import { importAsyncApi, importCompose, importKubernetes, importTerraform } from "../../interop/infra/pipeline";

// The benchmark workloads (docs/BENCHMARKS.md § Workloads) are inputs, so they must be valid, exactly the size they
// claim, and the same every time: a benchmark that measures a different diagram on another run measures nothing.

const known = new Set(stencils.map((s) => s.id));

function expectWellFormed(family: Family, n: number) {
  const d = FAMILIES[family].make(n);
  const r = validateDiagram(structuredClone(d));
  expect(r.ok, r.ok ? "" : r.error).toBe(true);
  if (FAMILIES[family].exact) expect(d.nodes.length).toBe(n);
  else {
    expect(d.nodes.length).toBeGreaterThan(n * 0.8);
    expect(d.nodes.length).toBeLessThan(n * 1.2);
  }
  expect(d.edges.length).toBeGreaterThan(d.nodes.length * 0.6);
  const unknown = [...new Set(d.nodes.map((node) => node.stencil).filter((s) => !known.has(s)))];
  expect(unknown).toEqual([]);
  const ids = new Set([...d.nodes.map((x) => x.id), ...(d.annotations ?? []).map((a) => a.id)]);
  expect(ids.size).toBe(d.nodes.length + (d.annotations?.length ?? 0));
  for (const e of d.edges) expect(ids.has(e.from) && ids.has(e.to), e.id).toBe(true);
  const groups = new Set((d.groups ?? []).map((g) => g.id));
  for (const node of d.nodes) if (node.group) expect(groups.has(node.group), node.id).toBe(true);
  return d;
}

describe("benchmark workloads", () => {
  for (const family of FAMILY_IDS)
    for (const n of [100, 500])
      it(`${family} at ${n} nodes is valid, the right size and deterministic`, () => {
        const a = expectWellFormed(family, n);
        const b = FAMILIES[family].make(n);
        expect(describeWorkload(b)).toEqual(describeWorkload(a));
      });

  it("reaches the largest tier within the file format's limits", () => {
    for (const family of ["mesh", "pipeline", "annotated", "examples"] as const) expectWellFormed(family, 5_000);
  }, 60_000);

  it("draws on the public examples only", () => {
    const slugs = publicExamples().map((e) => e.slug);
    expect(slugs.length).toBeGreaterThan(10);
    expect(slugs).toContain("kafka-order-pipeline");
    expect(slugs.some((s) => s.includes("/"))).toBe(false);
  });

  it("gives the importers sources they read", () => {
    const k8s = importKubernetes(kubernetesManifests(12));
    const tf = importTerraform([terraformPlan(6)]);
    const compose = importCompose([composeFile(12)]);
    const asyncapi = importAsyncApi(asyncApiDocuments(6));
    for (const [what, r] of Object.entries({ k8s, tf, compose, asyncapi })) {
      expect(r.ok, `${what}: ${r.ok ? "" : "error" in r ? r.error : ""}`).toBe(true);
      if (r.ok === true) {
        expect(r.diagram.nodes.length, what).toBeGreaterThan(5);
        expect(r.diagram.edges.length, what).toBeGreaterThan(3);
      }
    }
  });
});

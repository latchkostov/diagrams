import { describe, expect, it } from "vitest";
import { catalog } from "../stencils/catalog";
import { matchesStencil, searchStencils, STENCIL_ALIASES, tokenize } from "./stencilSearch";
import { withRecent } from "./recentStencils";

const ids = (q: string) => searchStencils(catalog, q).map((s) => s.id);

describe("stencil search", () => {
  it("matches everything for an empty query", () => {
    expect(ids("")).toHaveLength(catalog.length);
    expect(ids("   ")).toHaveLength(catalog.length);
  });

  it("finds stencils by alias", () => {
    expect(ids("sb").slice(0, 2).sort()).toEqual(["azure.service-bus.queue", "azure.service-bus.topic"]);
    expect(ids("pg")[0]).toBe("postgres");
    expect(ids("k8s")).toEqual(expect.arrayContaining(["k8s.pod", "k8s.deployment", "azure.aks"]));
    expect(ids("otel")[0]).toBe("opentelemetry");
    expect(ids("apim")[0]).toBe("azure.api-management");
  });

  it("ranks the stencil named by the query above alias matches", () => {
    expect(ids("lambda")[0]).toBe("aws.lambda");
    expect(ids("lambda")).toContain("azure.functions");
  });

  it("matches by role, vendor and id", () => {
    const queues = ids("queue");
    expect(queues).toEqual(expect.arrayContaining(["azure.service-bus.queue", "aws.sqs", "rabbitmq.queue", "generic.queue"]));
    expect(queues).not.toContain("kafka.topic");
    expect(ids("azure").every((id) => catalog.find((s) => s.id === id)!.vendor.match(/Azure|Microsoft/) || id.startsWith("azure"))).toBe(true);
    expect(ids("kafka.schema-registry")[0]).toBe("kafka.schema-registry");
  });

  it("requires every word to match", () => {
    expect(ids("service bus topic")[0]).toBe("azure.service-bus.topic");
    expect(ids("aws queue")).toEqual(["aws.sqs"]);
    expect(ids("zzz-no-such")).toEqual([]);
  });

  it("doesn't let two-letter tokens match mid-word", () => {
    const pg = catalog.find((s) => s.id === "azure.app-gateway")!;
    expect(matchesStencil(pg, "pg")).toBe(false);
  });

  it("only aliases real stencil ids", () => {
    const known = new Set(catalog.map((s) => s.id));
    expect(Object.keys(STENCIL_ALIASES).filter((id) => !known.has(id))).toEqual([]);
  });

  it("tokenizes on whitespace, case-insensitively", () => {
    expect(tokenize("  Service  BUS ")).toEqual(["service", "bus"]);
  });
});

describe("recent stencils", () => {
  it("moves the newest to the front, de-duplicates and caps", () => {
    expect(withRecent([], "a")).toEqual(["a"]);
    expect(withRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(withRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

import { describe, expect, it } from "vitest";
import { resolveKind, findStencils } from "./stencils";

describe("stencil resolution", () => {
  it.each([
    ["service.dotnet", "service.dotnet"],
    [".NET consumer", "service.dotnet"],
    ["pg", "postgres"],
    ["Kafka topic", "kafka.topic"],
    ["sb queue", "azure.service-bus.queue"],
    ["Key Vault", "azure.key-vault"],
  ])("resolves %s", (kind, id) => expect(resolveKind(kind, "worker").id).toBe(id));
  it("reports exact ids as high confidence", () => expect(resolveKind("service.dotnet").confidence).toBe("high"));
  it("uses inference on label after kind search misses", () =>
    expect(resolveKind("Custom frobnicator", "Postgres writer").id).toBe("postgres"));
  it.each(["", "   ", "Unrecognized frobnicator"])("falls back for %s", (kind) =>
    expect(resolveKind(kind)).toMatchObject({ id: "generic.service", confidence: "low" }),
  );
  it("limits alternatives and excludes the chosen stencil", () => {
    const result = resolveKind("Azure");
    expect(result.alternatives.length).toBeLessThanOrEqual(3);
    expect(result.alternatives).not.toContain(result.id);
  });
  it("searches a filtered catalog with a bounded result", () => {
    const found = findStencils("Azure", { category: "messaging", limit: 2 });
    expect(found).toHaveLength(2);
    expect(found.every((s) => s.category === "messaging")).toBe(true);
    expect(Object.keys(found[0]).sort()).toEqual(["category", "description", "id", "label", "simRole", "vendor"]);
  });
});

import { describe, expect, it } from "vitest";
import { examples } from "./index";
import { exampleFeatures, filterExamples } from "./gallery";
import { exampleShows } from "../../scripts/example-shows";
import { loadExample } from "./index";

const publicItems = examples.filter((e) => !e.localOnly);
describe("example gallery", () => {
  it("groups in theme order and keeps input order inside each theme", () => {
    const sections = filterExamples(publicItems, "");
    expect(sections.map((s) => s.theme?.id)).toEqual(["streaming", "data", "cloud", "integration", "reliability"]);
    expect(sections[0].items.map((e) => e.slug)).toEqual(
      publicItems.filter((e) => e.theme === "streaming").map((e) => e.slug),
    );
  });
  it("matches all words across title, summary, description, slug and translated feature labels", () => {
    expect(
      filterExamples(publicItems, "backlog turns", "latency")
        .flatMap((s) => s.items)
        .map((e) => e.slug),
    ).toEqual(["where-the-time-goes"]);
    expect(
      filterExamples(publicItems, "  KAFKA order ")
        .flatMap((s) => s.items)
        .some((e) => e.slug === "kafka-order-pipeline"),
    ).toBe(true);
    expect(
      filterExamples(publicItems, "rag-assistant")
        .flatMap((s) => s.items)
        .map((e) => e.slug),
    ).toEqual(["rag-assistant"]);
    expect(filterExamples(publicItems, "not present anywhere")).toEqual([]);
    expect(
      filterExamples(publicItems, "Network devices")
        .flatMap((s) => s.items)
        .map((e) => e.slug),
    ).toEqual(["ev-charging-network", "branch-to-datacentre", "contoso-dmz"]);
  });
  it("combines search and feature filters, without empty theme sections", () => {
    expect(
      filterExamples(publicItems, "", "rateLimits")
        .flatMap((s) => s.items)
        .map((e) => e.slug),
    ).toEqual([
      "delivery-dispatch",
      "ev-charging-network",
      "shared-api-quotas",
      "black-friday-commerce",
      "payments-ledger",
      "notification-fanout",
    ]);
    expect(filterExamples(publicItems, "Kafka", "networkDevices")).toEqual([]);
  });
  it("uses only features actually configured in the public examples", () => {
    const tags = (slug: string) => publicItems.find((e) => e.slug === slug)?.shows;
    expect(tags("branch-to-datacentre")).toEqual(["networkDevices"]);
    expect(tags("notification-fanout")).toEqual(["partitions", "rateLimits"]);
    expect(tags("nightly-batch-elt")).toEqual([]);
    expect(tags("keda-render-workers")).toEqual(["partitions", "autoscaling"]);
    expect(tags("autoscaling-image-workers")).toEqual(["partitions", "autoscaling"]);
    expect(tags("cloud-run-timetable-api")).toEqual(["autoscaling"]);
    expect(
      filterExamples(publicItems, "", "autoscaling")
        .flatMap((s) => s.items)
        .map((e) => e.slug),
    ).toEqual([
      "delivery-dispatch",
      "keda-render-workers",
      "autoscaling-image-workers",
      "black-friday-commerce",
      "cloud-run-timetable-api",
    ]);
    expect(
      filterExamples(publicItems, "", "routing")
        .flatMap((s) => s.items)
        .map((e) => e.slug),
    ).toEqual(["delivery-dispatch", "black-friday-commerce", "payments-ledger", "api-route-table"]);
  });
  it("tags each showcase only with features its configuration demonstrates", () => {
    const expected: Record<string, string[]> = {
      "partitions-vs-subscriptions": ["partitions"],
      "shared-worker-pool": ["partitions"],
      "shared-api-quotas": ["rateLimits"],
      "serverless-burst-buffer": [],
      "measured-order-capacity": [],
      "contoso-dmz": ["networkDevices"],
      "api-route-table": ["routing"],
      // The large showcases: each tag is backed by a configured node.
      "black-friday-commerce": ["partitions", "rateLimits", "autoscaling", "routing"],
      "delivery-dispatch": ["partitions", "rateLimits", "autoscaling", "routing"],
      "payments-ledger": ["partitions", "rateLimits", "routing"],
      "ev-charging-network": ["partitions", "rateLimits", "networkDevices"],
      "cell-based-bookings": [],
    };
    for (const [slug, tags] of Object.entries(expected)) {
      expect(publicItems.find((e) => e.slug === slug)?.shows, slug).toEqual(tags);
      for (const tag of tags) {
        expect(
          filterExamples(publicItems, slug, tag)
            .flatMap((s) => s.items)
            .map((e) => e.slug),
        ).toEqual([slug]);
      }
    }
  });
  it("publishes only supported, evidence-backed tags and saved simulation ids", async () => {
    for (const e of publicItems) {
      const d = await loadExample(e.slug);
      expect(e.shows).toEqual(exampleShows(d));
      expect(e.shows?.every((id) => exampleFeatures.some((f) => f.id === id))).toBe(true);
      expect(e.simulation).toBe(d.simulations?.[0]?.id);
    }
  });
  it("requires async work reachable from spiked traffic for the latency tag", async () => {
    const diagram = structuredClone(await loadExample("where-the-time-goes"));
    expect(exampleShows(diagram)).toContain("latency");
    diagram.edges[0].kind = "sync";
    expect(exampleShows(diagram)).not.toContain("latency");
    diagram.edges[0].kind = "async";
    diagram.edges[0].relation = "telemetry";
    expect(exampleShows(diagram)).not.toContain("latency");
    diagram.edges[0].relation = "flow";
    diagram.edges = diagram.edges.filter((edge) => edge.id !== "orders-billing");
    diagram.edges.push({ id: "loop", from: "orders", to: "checkout", kind: "async" });
    expect(exampleShows(diagram)).not.toContain("latency");
  });
});

import { describe, expect, it } from "vitest";
import { examples } from "./index";
import { exampleFeatures, filterExamples } from "./gallery";
import { exampleShows } from "../../scripts/example-shows";
import { loadExample } from "./index";

const publicItems = examples.filter((e) => !e.localOnly);
describe("example gallery", () => {
  it("groups in theme order and keeps input order inside each theme", () => {
    const sections = filterExamples(publicItems, "");
    expect(sections.map((s) => s.theme?.id)).toEqual([
      "systems",
      "streaming",
      "data",
      "cloud",
      "integration",
      "reliability",
    ]);
    expect(sections[1].items.map((e) => e.slug)).toEqual(
      publicItems.filter((e) => e.theme === "streaming").map((e) => e.slug),
    );
    // The large examples lead the gallery, as one theme.
    expect(sections[0].items.map((e) => e.slug)).toEqual([
      "black-friday-commerce",
      "cell-based-bookings",
      "payments-ledger",
      "delivery-dispatch",
      "ev-charging-network",
      "recommendations-feature-store",
      "video-on-demand-pipeline",
      "observability-pipeline",
      "hybrid-enterprise-network",
    ]);
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
    ).toEqual(["ev-charging-network", "hybrid-enterprise-network", "branch-to-datacentre", "contoso-dmz"]);
  });
  it("combines search and feature filters, without empty theme sections", () => {
    expect(
      filterExamples(publicItems, "", "rateLimits")
        .flatMap((s) => s.items)
        .map((e) => e.slug),
    ).toEqual([
      "black-friday-commerce",
      "payments-ledger",
      "delivery-dispatch",
      "ev-charging-network",
      "video-on-demand-pipeline",
      "observability-pipeline",
      "shared-api-quotas",
      "notification-fanout",
    ]);
    expect(filterExamples(publicItems, "Kafka", "networkDevices")).toEqual([]);
  });
  it("uses only features actually configured in the public examples", () => {
    const tags = (slug: string) => publicItems.find((e) => e.slug === slug)?.shows;
    expect(tags("branch-to-datacentre")).toEqual(["networkDevices"]);
    expect(tags("notification-fanout")).toEqual(["partitions", "rateLimits"]);
    expect(tags("nightly-batch-elt")).toEqual([]);
    expect(tags("autoscaling-basics")).toEqual(["partitions", "autoscaling"]);
    expect(tags("cloud-run-timetable-api")).toEqual(["autoscaling"]);
    expect(
      filterExamples(publicItems, "", "autoscaling")
        .flatMap((s) => s.items)
        .map((e) => e.slug),
    ).toEqual([
      "black-friday-commerce",
      "delivery-dispatch",
      "recommendations-feature-store",
      "video-on-demand-pipeline",
      "observability-pipeline",
      "autoscaling-basics",
      "cloud-run-timetable-api",
      "blocking-call",
      "scale-on-busy-threads",
    ]);
    expect(
      filterExamples(publicItems, "", "routing")
        .flatMap((s) => s.items)
        .map((e) => e.slug),
    ).toEqual([
      "black-friday-commerce",
      "payments-ledger",
      "delivery-dispatch",
      "recommendations-feature-store",
      "video-on-demand-pipeline",
      "api-route-table",
    ]);
  });
  it("teaches requests that wait in blocking, timeout, pool and busy-thread order", () => {
    expect(
      filterExamples(publicItems, "", "requestsWait")
        .flatMap((s) => s.items)
        .map((e) => e.slug),
    ).toEqual(["blocking-call", "retry-storm", "slow-payment-provider", "scale-on-busy-threads"]);
  });
  it("tags each showcase only with features its configuration demonstrates", () => {
    const expected: Record<string, string[]> = {
      "vendor-edge-storefront": ["vendorStencils"],
      "scale-on-busy-threads": ["requestsWait", "autoscaling"],
      "slow-payment-provider": ["requestsWait", "resilience", "faultDrills"],
      "retry-storm": ["requestsWait", "resilience", "faultDrills"],
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
      "recommendations-feature-store": ["faultDrills", "partitions", "autoscaling", "routing"],
      "video-on-demand-pipeline": ["latency", "partitions", "rateLimits", "autoscaling", "routing"],
      "observability-pipeline": ["faultDrills", "partitions", "rateLimits", "autoscaling"],
      "hybrid-enterprise-network": ["faultDrills", "networkDevices"],
      "zone-outage-drill": ["faultDrills"],
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
      expect(e.shows).toEqual(exampleShows(d).filter((tag) => !e.omitShows?.includes(tag)));
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

it("finds the shared retry comparison by its established circuit breaker name", () => {
  expect(
    filterExamples(publicItems, "circuit breaker")
      .flatMap((s) => s.items)
      .map((e) => e.slug),
  ).toContain("retry-storm");
});

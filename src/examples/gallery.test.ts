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
    expect(filterExamples(publicItems, "Network devices")[0].items.map((e) => e.slug)).toEqual([
      "branch-to-datacentre",
      "contoso-dmz",
    ]);
  });
  it("combines search and feature filters, without empty theme sections", () => {
    expect(
      filterExamples(publicItems, "", "rateLimits")
        .flatMap((s) => s.items)
        .map((e) => e.slug),
    ).toEqual(["shared-api-quotas", "notification-fanout"]);
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
    ).toEqual(["keda-render-workers", "autoscaling-image-workers", "cloud-run-timetable-api"]);
  });
  it("tags each showcase only with features its configuration demonstrates", () => {
    const expected: Record<string, string[]> = {
      "partitions-vs-subscriptions": ["partitions"],
      "shared-worker-pool": ["partitions"],
      "shared-api-quotas": ["rateLimits"],
      "serverless-burst-buffer": [],
      "measured-order-capacity": [],
      "contoso-dmz": ["networkDevices"],
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
});

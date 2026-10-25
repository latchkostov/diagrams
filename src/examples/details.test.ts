import { expect, expectTypeOf, it } from "vitest";
import { examples, exampleSummary, type EnrichedExample, type ExampleIdentity } from "./index";
import { withExampleDetails } from "./details";
import { filterExamples, gallerySummary } from "./gallery";
import { diagramThumb } from "../lib/thumbnail";

it("requires enrichment before reading discovery fields or filtering the gallery", () => {
  expectTypeOf<ExampleIdentity>().not.toExtend<EnrichedExample>();
  expectTypeOf<ReturnType<typeof withExampleDetails>>().toEqualTypeOf<EnrichedExample[]>();
  expectTypeOf<Parameters<typeof filterExamples>[0]>().toEqualTypeOf<readonly EnrichedExample[]>();
  expectTypeOf<Parameters<typeof gallerySummary>[0]>().toEqualTypeOf<EnrichedExample>();
  const identity = examples.find((example) => !example.localOnly)!;
  // @ts-expect-error Startup identities do not expose discovery thumbnails.
  expect(identity.thumb).toBeUndefined();
  // @ts-expect-error Startup identities do not expose discovery descriptions.
  expect(identity.description).toBeUndefined();
  // @ts-expect-error Startup identities do not expose discovery feature tags.
  expect(identity.shows).toBeUndefined();
  const enriched = withExampleDetails([identity])[0];
  expect(enriched.thumb).toBeDefined();
  expect(filterExamples([enriched], identity.slug)[0].items).toEqual([enriched]);
});

it("preserves summary fallbacks and supplied local details through enrichment", () => {
  const diagram = { format: "diagrams/v1" as const, title: "Synthetic", nodes: [], edges: [] };
  const local: ExampleIdentity = {
    slug: "synthetic",
    title: diagram.title,
    localOnly: true,
    diagram,
    description: "A synthetic description",
    thumb: diagramThumb(diagram),
    shows: ["messageTypes", "routing"],
    omitShows: ["routing"],
  };
  const [enriched] = withExampleDetails([local]);
  expect(enriched.thumb).toBe(local.thumb);
  expect(enriched.description).toBe(local.description);
  expect(enriched.shows).toEqual(["messageTypes"]);
  expect(exampleSummary(local)).toBe(local.description);
  expect(gallerySummary(enriched)).toBe(local.description);
  expect(exampleSummary({ slug: "synthetic", title: "Synthetic" })).toBeUndefined();
  expect(exampleSummary({ ...local, summary: () => "Authored summary" })).toBe("Authored summary");
});

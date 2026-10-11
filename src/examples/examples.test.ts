import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { diagramThumb } from "../lib/thumbnail";
import { examples, getLoadedExample, loadExample } from "./index";
import { exampleMetadata } from "./metadata";
import { labMetadata } from "./labMetadata";

// Public fixtures only: this shallow glob never descends into local-only examples.
const files = import.meta.glob<DiagramFile>("./*.json", { eager: true, import: "default" });
const publicExamples = examples.filter((e) => !e.localOnly);

describe("example metadata and loading", () => {
  it("covers every public JSON exactly once and keeps eager metadata in sync", () => {
    const slugs = Object.keys(files)
      .map((path) => path.slice(2, -5))
      .sort();
    expect(publicExamples.map((e) => e.slug).sort()).toEqual(slugs);
    expect(Object.keys(exampleMetadata).sort()).toEqual(slugs);
    expect(Object.keys(labMetadata).sort()).toEqual(slugs);
    for (const example of publicExamples) {
      const d = files[`./${example.slug}.json`];
      expect(example).not.toHaveProperty("diagram");
      expect(example.title).toBe(d.title);
      expect(example.description).toBe(d.description);
      expect(example.thumb).toEqual(diagramThumb(d));
      expect(example.theme).toBeTruthy();
      expect(example.summary).toBeTruthy();
      expect(labMetadata[example.slug]).toEqual(
        (d.simulations ?? []).map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          deadLetter: (s.expectations ?? []).some(
            (x) => "node" in x.metric && x.metric.field === "deadLettered" && (x.op === ">" || x.op === ">="),
          ),
        })),
      );
    }
  });

  it("imports full diagrams only on request, shares pending loads and caches successes", async () => {
    for (const example of publicExamples) {
      expect(getLoadedExample(example.slug)).toBeUndefined();
      const first = loadExample(example.slug);
      expect(loadExample(example.slug)).toBe(first);
      const d = await first;
      expect(d).toEqual(files[`./${example.slug}.json`]);
      expect(getLoadedExample(example.slug)).toBe(d);
      expect(await loadExample(example.slug)).toBe(d);
    }
  });

  it("rejects unknown slugs without poisoning later loads", async () => {
    await expect(loadExample("missing-example")).rejects.toThrow("unavailable");
    await expect(loadExample("missing-example")).rejects.toThrow("unavailable");
    expect((await loadExample(publicExamples[0].slug)).title).toBe(publicExamples[0].title);
  });
});

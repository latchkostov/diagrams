import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { exampleTutorials } from "./tutorials";
import { tutorials } from "../tutorials/catalog";

describe("example tutorial links", () => {
  it("links existing public examples to available lessons about that example", () => {
    for (const [slug, id] of Object.entries(exampleTutorials)) {
      expect(fs.existsSync(`src/examples/${slug}.json`), slug).toBe(true);
      const lesson = tutorials.find((tutorial) => tutorial.id === id);
      expect(lesson, id).toBeDefined();
      expect(
        (typeof lesson!.start === "function"
          ? lesson!.start().title ===
            (JSON.parse(fs.readFileSync(`src/examples/${slug}.json`, "utf8")) as { title: string }).title
          : lesson!.start.example === slug) || lesson!.finish.example?.slug === slug,
        `${slug}: ${id}`,
      ).toBe(true);
    }
  });
});

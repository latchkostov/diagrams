import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { combinedNotes, readFragments, streams, validateFragment } from "../../scripts/fragments";
import { assertTextEncoding, checkRepositoryTextEncoding } from "../../scripts/text-encoding";

describe("documentation fragments", () => {
  it("keeps marketplace, skill text, fragments and frozen histories free of mojibake and BOMs", () => {
    checkRepositoryTextEncoding(process.cwd());
  });

  it("rejects raw and JSON-escaped encoding corruption", () => {
    for (const bad of ["\u00c3", "\u00e2\u20ac\u00a6", "\u00c2", "\uFEFFwords"])
      expect(() => assertTextEncoding("fragment.md", bad)).toThrow(/UTF-8/);
    expect(() => assertTextEncoding("marketplace.json", '"\\u00e2\\u20ac\\u00a6"')).toThrow(/UTF-8/);
    expect(() => assertTextEncoding("marketplace.json", '"Pub/Sub…"')).not.toThrow();
  });
  it("validates every repository fragment as part of pnpm test", () => {
    for (const stream of Object.keys(streams) as (keyof typeof streams)[]) readFragments(process.cwd(), stream);
  });

  it("rejects empty fragments, malformed dates/names and missing headings", () => {
    expect(validateFragment("2026-10-17-good-slug.md", "## A change\n\nDetails.")).toEqual([]);
    for (const name of [
      "bad.md",
      "2026-02-30-invalid.md",
      "2026-13-17-invalid.md",
      "2026-10-17-A.md",
      "2026-10-17-invalid.txt",
    ])
      expect(validateFragment(name, "## Heading")).not.toEqual([]);
    expect(validateFragment("2026-10-17-empty.md", " ")).toContain("fragment is empty");
    expect(validateFragment("2026-10-17-no-heading.md", "words")).toContain(
      "include a level-two heading, as in the historical sections",
    );
  });

  it("combines newest first with deterministic same-day order, then frozen history; skips asset directories", () => {
    const root = mkdtempSync(join(tmpdir(), "diagrams-fragments-"));
    try {
      const dir = join(root, "docs/release-notes");
      mkdirSync(join(dir, "screenshots"), { recursive: true });
      for (const name of ["2026-10-16-old", "2026-10-17-alpha", "2026-10-17-zebra"])
        writeFileSync(join(dir, `${name}.md`), `## ${name}\n\nDetails.\n`);
      writeFileSync(join(root, "docs/RELEASE-NOTES-HISTORY.md"), "# Release notes\n\n## History\n\nOld.\n");
      const text = combinedNotes(root);
      expect([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual([
        "2026-10-17-zebra",
        "2026-10-17-alpha",
        "2026-10-16-old",
        "History",
      ]);
      writeFileSync(join(dir, "bad.md"), "");
      expect(() => combinedNotes(root)).toThrow(/bad.md/);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

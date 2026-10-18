import { expect, it } from "vitest";
import { normalizeScriptOutput } from "../../tests/parity/lib/scriptOutput";

it("folds a temporary directory inside the checkout before folding the checkout", () => {
  const root = "/work/project",
    temporary = `${root}/tests/.output/tmp/run-abc`;
  expect(normalizeScriptOutput(`${temporary}/laid.json\n${root}/schema.json\n`, root, temporary)).toBe(
    "<tmp>/laid.json\n<repo>/schema.json\n",
  );
});

it("does the same for Windows separators, spaces and CRLF", () => {
  const root = "L:\\diagram projects",
    temporary = `${root}\\tests\\.output\\tmp\\run-abc`;
  expect(normalizeScriptOutput(`${temporary}\\export.html\r\n${root}\\schema.json\r\n`, root, temporary)).toBe(
    "<tmp>/export.html\n<repo>/schema.json\n",
  );
});

it("preserves transcripts when temporary files live outside the checkout", () => {
  expect(
    normalizeScriptOutput("/tmp/run-abc/laid.json\n/work/project/schema.json\n", "/work/project", "/tmp/run-abc"),
  ).toBe("<tmp>/laid.json\n<repo>/schema.json\n");
});

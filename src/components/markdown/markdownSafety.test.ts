import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { propertyRuns } from "../../test/fastCheck";
import { MARKDOWN_LIMITS, type BlockToken } from "./markdownParser";

// A blocked parser cannot block Vitest: terminate its worker at the test-timeout scale.
function parseInWorker(inputs: string[], inline = false): Promise<{ ast: BlockToken[]; work: number }[]> {
  const module = new URL("./markdownParser.ts", import.meta.url).href;
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require("node:worker_threads");
      import(workerData.module).then(({parseMarkdown, parseInline}) => {
        parentPort.postMessage(workerData.inputs.map(text => {
          const stats = {work: 0};
          const ast = (workerData.inline ? parseInline : parseMarkdown)(text, stats);
          return {ast, work: stats.work};
        }));
      }).catch(error => { throw error; });
    `,
      { eval: true, workerData: { module, inputs, inline }, execArgv: [] },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Markdown worker exceeded the hang backstop"));
    }, 10_000);
    worker.once("message", (result) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      void worker.terminate();
      reject(error);
    });
  });
}

function astDepth(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  return 1 + Math.max(0, ...Object.values(value).map(astDepth));
}

describe("untrusted Markdown", () => {
  it.each([
    "# Heading\rbody",
    "# Heading\r\nbody",
    "# foo\u2028bar",
    "# foo\u2029bar",
    "- alpha\rbody",
    "- alpha\u2028beta",
    "- alpha\u2029beta",
  ])("normalizes line terminators and always progresses: %j", async (source) => {
    const [{ ast }] = await parseInWorker([source]);
    expect(JSON.stringify(ast)).toMatch(/Heading|foo|alpha/);
    expect(JSON.stringify(ast)).toMatch(/body|bar|beta/);
  });
  it.each(["-", "*", "_"])("scans thematic and paragraph near matches linearly: %s", async (marker) => {
    const inputs = [marker + " ", "paragraph\n" + marker + " "].map(
      (prefix) => prefix + (marker + " ").repeat(24) + "x",
    );
    const results = await parseInWorker(inputs);
    results.forEach(({ ast, work }, i) => {
      expect(JSON.stringify(ast)).toContain("x");
      expect(work).toBeLessThanOrEqual(inputs[i].length * MARKDOWN_LIMITS.workPerChar);
    });
  });
  it("handles 50,000 unmatched brackets within a linear work bound and preserves all text", async () => {
    const source = "[".repeat(50_000);
    const [{ ast, work }] = await parseInWorker([source]);
    expect(ast).toEqual([{ type: "paragraph", tokens: [{ type: "text", text: source }] }]);
    expect(work).toBeGreaterThan(0);
    expect(work).toBeLessThanOrEqual(source.length * MARKDOWN_LIMITS.workPerChar);
  });
  it.each(["blockquotes", "lists", "links", "combined"])(
    "bounds 10,000-deep %s and retains excess nesting literally",
    async (kind) => {
      const links = "[".repeat(10_000) + "retained" + "](url)".repeat(10_000);
      const input =
        kind === "blockquotes"
          ? ">".repeat(10_000) + " retained"
          : kind === "lists"
            ? Array.from({ length: 10_000 }, (_, i) => " ".repeat(i) + "- retained").join("\n")
            : kind === "combined"
              ? "> ".repeat(20) + "- " + links
              : links;
      const [{ ast, work }] = await parseInWorker([input]);
      expect(JSON.stringify(ast)).toContain("retained");
      expect(astDepth(ast)).toBeLessThanOrEqual(MARKDOWN_LIMITS.depth * 5);
      expect(work).toBeLessThanOrEqual(input.length * MARKDOWN_LIMITS.workPerChar);
    },
  );
  it("caps columns and total padded cells, and rejects mismatched table widths without losing source", async () => {
    const inputs = [
      "|h".repeat(1000) + "|\n" + "|-".repeat(1000) + "|\n" + "|\n".repeat(1000),
      "|h".repeat(32) + "|\n" + "|-".repeat(32) + "|\n" + "|\n".repeat(1000),
      "|a|b|\n|-|\n|value|",
    ];
    const results = await parseInWorker(inputs);
    results.forEach(({ ast }, i) => {
      expect(ast).toHaveLength(1);
      const block = ast[0];
      expect(block.type).toBe("paragraph");
      if (block.type === "paragraph") {
        expect(block.tokens).toHaveLength(1);
        expect(block.tokens[0].type).toBe("text");
        if (block.tokens[0].type === "text") expect(block.tokens[0].text.trimEnd()).toBe(inputs[i].trimEnd());
      }
    });
  });
  it(
    "arbitrary strings through the 50,000-character schema limit never throw or exceed work; literal text round trips",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.string({ maxLength: 50_000 }),
            fc
              .array(fc.constantFrom("[", "]", "*", "-", ">", "\r", "\u2028", "x"), {
                minLength: 49_000,
                maxLength: 50_000,
              })
              .map((chars) => chars.join("")),
          ),
          async (source) => {
            const normalized = source.replace(/\r\n|[\r\u2028\u2029]/g, "\n");
            const fence = "`".repeat(source.length + 3);
            const [{ work }, { ast }] = await parseInWorker([source, fence + "\n" + normalized + "\n" + fence]);
            expect(work).toBeLessThanOrEqual(Math.max(1, source.length) * MARKDOWN_LIMITS.workPerChar);
            expect(ast).toEqual([{ type: "code", lang: "", code: normalized }]);
          },
        ),
        { numRuns: propertyRuns(30) },
      );
    },
    30_000 * propertyRuns(1),
  );
});

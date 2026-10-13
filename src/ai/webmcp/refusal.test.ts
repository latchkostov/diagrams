import { describe, expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import { buildTools, type WebMcpHost } from "./tools";

// Agents told no by a private diagram hear "Private diagrams…", the app's word, never "Local-only…".

describe("the tools' refusal", () => {
  it("says Private diagrams, for every tool that reads or changes the diagram", async () => {
    const editor = { getDiagram: () => ({ format: "diagrams/v1", title: "x", nodes: [], edges: [] }) };
    const host: WebMcpHost = {
      getEditor: () => editor as unknown as EditorApi,
      canUseAi: () => false,
      documentId: () => "doc",
      onApplied: vi.fn(),
      newDiagram: vi.fn(async () => editor as unknown as EditorApi),
      shareLink: vi.fn(async () => ({ url: "", length: 0 })),
    };
    const tools = buildTools(host);
    for (const name of ["describe_diagram", "check_diagram", "new_diagram"]) {
      const tool = tools.find((t) => t.name === name)!;
      await expect(Promise.resolve().then(() => tool.run({}, new AbortController().signal))).rejects.toThrow(
        /^Private diagrams are excluded from AI\./,
      );
    }
  });
});

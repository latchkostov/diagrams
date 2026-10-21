import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { configForStorage, contentId, DEFAULT_CONFIG } from "../../integrations/confluence-forge/src/config";
import { listAttachments, downloadDiagram, uploadDiagram } from "../../integrations/confluence-forge/src/attachments";
import { checkManifest, checkBudget } from "../../integrations/confluence-forge/check.mjs";
import { textFieldsFixture } from "../lab/textFieldsFixture";

describe("Forge configuration is a reference, never a diagram", () => {
  it("allowlists only the four settings on both read and save", () => {
    const input = {
      attachmentId: "att123",
      simulation: "flow",
      height: 480,
      theme: "dark",
      diagram: textFieldsFixture,
      content: JSON.stringify(textFieldsFixture),
      nested: { body: "confidential" },
      pageId: "99",
      autoplay: true,
    };
    expect(configForStorage(input)).toEqual({ attachmentId: "123", simulation: "flow", height: 480, theme: "dark" });
    expect(Object.keys(configForStorage(input))).toEqual(["attachmentId", "simulation", "height", "theme"]);
    expect(JSON.stringify(configForStorage(input))).not.toContain("confidential");
  });
  it.each([
    null,
    undefined,
    "json",
    { attachmentId: { content: "secret" }, simulation: textFieldsFixture, height: Infinity, theme: "javascript:" },
  ])("normalizes untrusted config %j", (input) => {
    expect(configForStorage(input)).toEqual(DEFAULT_CONFIG);
  });
  it.each(["../123", "https://example.com/7", "7?version=2", "0", "7/8"])("rejects path injection %s", (id) =>
    expect(() => contentId(id)).toThrow(),
  );
});

describe("Forge attachment transport", () => {
  it("paginates the current page, filters files, and never follows outside links", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          results: [{ id: "1", title: "notes.txt" }],
          _links: { next: "/wiki/api/v2/pages/42/attachments?cursor=a%2Fb" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ results: [{ id: "2", title: "orders.livediagram.json" }] }));
    expect(await listAttachments(request, "42")).toEqual([{ id: "2", title: "orders.livediagram.json" }]);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/wiki/api/v2/pages/42/attachments?limit=100",
      "/wiki/api/v2/pages/42/attachments?limit=100&cursor=a%2Fb",
    ]);
    request.mockResolvedValueOnce(
      Response.json({
        results: [],
        _links: { next: "https://outside.invalid/wiki/api/v2/pages/42/attachments?cursor=1" },
      }),
    );
    await expect(listAttachments(request, "42")).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("downloads through the reader bridge and makes a private in-memory diagram", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(textFieldsFixture)));
    expect(await downloadDiagram(request, "42", "7")).toMatchObject({ title: "Fields", private: true });
    expect(request).toHaveBeenCalledWith("/wiki/rest/api/content/42/child/attachment/7/download");
  });
  it.each([403, 404, 302])("reports denied, missing and unresolved redirect responses (%i)", async (status) => {
    await expect(downloadDiagram(vi.fn().mockResolvedValue(new Response(null, { status })), "42", "7")).rejects.toThrow(
      String(status),
    );
  });
  it("uploads with multipart data; replace preserves the ID and filename", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ id: "att7", title: "orders.livediagram.json" }));
    const file = new File([JSON.stringify(textFieldsFixture)], "local.livediagram.json", { type: "application/json" });
    expect(await uploadDiagram(request, "42", file, { id: "7", title: "orders.livediagram.json" })).toEqual({
      id: "7",
      title: "orders.livediagram.json",
    });
    const [path, options] = request.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/wiki/rest/api/content/42/child/attachment/7/data");
    expect(options).toMatchObject({ method: "POST", headers: { "X-Atlassian-Token": "nocheck" } });
    const body = options.body as FormData;
    expect((body.get("file") as File).name).toBe("orders.livediagram.json");
    expect(body.get("minorEdit")).toBe("false");
    expect(await (body.get("file") as File).text()).toBe(JSON.stringify(textFieldsFixture));
    request.mockResolvedValueOnce(Response.json({ results: [{ id: "att9", title: file.name }] }));
    await uploadDiagram(request, "42", file);
    expect(request.mock.calls[1][0]).toBe("/wiki/rest/api/content/42/child/attachment");
  });
  it("validates before writing, including size and future formats", async () => {
    const request = vi.fn();
    for (const file of [
      new File(["{}"], "bad.json"),
      new File(['{"format":"diagrams/v99"}'], "new.livediagram.json"),
      new File([" ".repeat(8_000_001)], "big.livediagram.json"),
    ]) {
      await expect(uploadDiagram(request, "42", file)).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });
});

it("lints the manifest offline, rejecting egress, broad scopes and fixed macro viewports", () => {
  const source = readFileSync("integrations/confluence-forge/manifest.yml", "utf8");
  expect(() => checkManifest(source)).not.toThrow();
  for (const changed of [
    source.replace("  scopes:", "  external:\n    fetch:\n      client: ['*']\n  scopes:"),
    source.replace("read:attachment:confluence", "read:confluence-content.all"),
    source.replace("      title: Live Diagram", "      viewportSize: large\n      title: Live Diagram"),
  ])
    expect(() => checkManifest(changed)).toThrow();
});

it("enforces total raw and gzip resource budgets", () => {
  expect(() => checkBudget(new Map([["large.js", "x".repeat(5_000_001)]]))).toThrow(/raw bytes/);
});

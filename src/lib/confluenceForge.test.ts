import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { configForStorage, contentId, DEFAULT_CONFIG } from "../../integrations/confluence-forge/src/config";
import {
  listAttachments,
  downloadDiagram,
  downloadDiagramText,
  uploadDiagram,
  MAX_FILE_BYTES,
} from "../../integrations/confluence-forge/src/attachments";
import { checkManifest, checkBudget } from "../../integrations/confluence-forge/check.mjs";
import { t } from "../i18n/core";
import { textFieldsFixture } from "../lab/textFieldsFixture";
import { macroHeight } from "../../integrations/confluence-forge/src/height";

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
          results: [
            { id: "1", title: "notes.txt" },
            { id: "3", title: "notes.json" },
            { id: "4", title: "orders.diagram.json" },
          ],
          _links: { next: "/wiki/api/v2/pages/42/attachments?cursor=a%2Fb" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ results: [{ id: "2", title: "orders.livediagram.json" }] }));
    expect(await listAttachments(request, "42")).toEqual([
      { id: "4", title: "orders.diagram.json" },
      { id: "2", title: "orders.livediagram.json" },
    ]);
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
    const text = JSON.stringify(textFieldsFixture);
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: "7",
          pageId: "42",
          fileSize: new TextEncoder().encode(text).byteLength,
          version: { number: 3 },
        }),
      )
      .mockResolvedValueOnce(new Response(text));
    expect(await downloadDiagram(request, "42", "7")).toMatchObject({ title: "Fields", private: true });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/wiki/api/v2/attachments/7",
      "/wiki/rest/api/content/42/child/attachment/7/download?version=3",
    ]);
  });
  it.each([403, 404, 302])("reports denied, missing and unresolved redirect responses (%i)", async (status) => {
    await expect(downloadDiagram(vi.fn().mockResolvedValue(new Response(null, { status })), "42", "7")).rejects.toThrow(
      String(status),
    );
  });
  it("rejects oversized metadata before requesting any body", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        Response.json({ id: "7", pageId: "42", fileSize: MAX_FILE_BYTES + 1, version: { number: 3 } }),
      );
    await expect(downloadDiagramText(request, "42", "7")).rejects.toThrow(t("viewerForge.tooLarge"));
    expect(request.mock.calls).toEqual([["/wiki/api/v2/attachments/7"]]);
  });
  it("downloads the checked version when the current attachment is replaced", async () => {
    const text = JSON.stringify(textFieldsFixture);
    const request = vi.fn(async (path: string) => {
      if (path === "/wiki/api/v2/attachments/7")
        return Response.json({
          id: "7",
          pageId: "42",
          fileSize: new TextEncoder().encode(text).byteLength,
          version: { number: 3 },
        });
      // Version 4 is a larger replacement. The checked version must still be requested.
      return new Response(path.endsWith("?version=3") ? text : "x".repeat(MAX_FILE_BYTES + 1));
    });
    expect(await downloadDiagramText(request, "42", "7")).toBe(text);
    expect(request).toHaveBeenLastCalledWith("/wiki/rest/api/content/42/child/attachment/7/download?version=3");
  });
  it.each([
    { id: "8", pageId: "42", fileSize: 1, version: { number: 3 } },
    { id: "7", pageId: "43", fileSize: 1, version: { number: 3 } },
    { id: "7", pageId: "42", fileSize: 1, version: { number: 0 } },
    { id: "7", pageId: "42", fileSize: -1, version: { number: 3 } },
  ])("rejects inconsistent metadata without downloading: %j", async (metadata) => {
    const request = vi.fn().mockResolvedValue(Response.json(metadata));
    await expect(downloadDiagramText(request, "42", "7")).rejects.toThrow();
    expect(request).toHaveBeenCalledOnce();
  });
  it("rejects bytes inconsistent with the checked version", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "7", pageId: "42", fileSize: 1, version: { number: 3 } }))
      .mockResolvedValueOnce(new Response("{}"));
    await expect(downloadDiagramText(request, "42", "7")).rejects.toThrow(t("viewerForge.bridgeError"));
  });
  it("upload enforces the UTF-8 byte boundary using otherwise valid JSON", async () => {
    const base = JSON.stringify({ ...textFieldsFixture, description: "" });
    const remaining = MAX_FILE_BYTES - new TextEncoder().encode(base).byteLength;
    const atLimit = JSON.stringify({
      ...textFieldsFixture,
      description: "\u00e9".repeat(Math.floor(remaining / 2)) + "a".repeat(remaining % 2),
    });
    expect(new TextEncoder().encode(atLimit).byteLength).toBe(MAX_FILE_BYTES);
    const request = vi.fn().mockResolvedValue(Response.json({ id: "9", title: "boundary.livediagram.json" }));
    await expect(uploadDiagram(request, "42", new File([atLimit], "boundary.livediagram.json"))).resolves.toMatchObject(
      { id: "9" },
    );
    request.mockClear();
    const above = atLimit + " ";
    // Exercise both the File.size preflight and the defensive text-byte check.
    const big = new File([above], "boundary.livediagram.json");
    const read = vi.spyOn(big, "text");
    await expect(uploadDiagram(request, "42", big)).rejects.toThrow(t("viewerForge.tooLarge"));
    expect(read).not.toHaveBeenCalled();
    const inaccurateSize = new File([above], "boundary.livediagram.json");
    Object.defineProperty(inaccurateSize, "size", { value: MAX_FILE_BYTES });
    await expect(uploadDiagram(request, "42", inaccurateSize)).rejects.toThrow(t("viewerForge.tooLarge"));
    expect(request).not.toHaveBeenCalled();
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
    ]) {
      await expect(uploadDiagram(request, "42", file)).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["orders.diagram.json", "orders.livediagram.json"])("accepts and preserves %s on upload", async (name) => {
    const request = vi.fn().mockResolvedValue(Response.json({ results: [{ id: "7", title: name }] }));
    await expect(uploadDiagram(request, "42", new File([JSON.stringify(textFieldsFixture)], name))).resolves.toEqual({
      id: "7",
      title: name,
    });
    const body = request.mock.calls[0][1].body as FormData;
    expect((body.get("file") as File).name).toBe(name);
  });
  it.each(["orders.json", "orders.diagram.json.txt", "orders.livediagram.json.zip"])(
    "rejects other files before reading %s",
    async (name) => {
      const file = new File([JSON.stringify(textFieldsFixture)], name);
      const read = vi.spyOn(file, "text");
      const request = vi.fn();
      await expect(uploadDiagram(request, "42", file)).rejects.toThrow(t("viewerForge.invalidFilename"));
      expect(read).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    },
  );
});

it("bounds automatic fit-to-width reports and preserves fixed heights", () => {
  expect(macroHeight(0)).toBe(480);
  expect(macroHeight(0, 200)).toBe(480);
  expect(macroHeight(0, 720)).toBe(720);
  expect(macroHeight(0, 1600)).toBe(900);
  for (const fixed of [200, 600, 1600]) {
    expect(macroHeight(fixed, 200)).toBe(fixed);
    expect(macroHeight(fixed, 1600)).toBe(fixed);
  }
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

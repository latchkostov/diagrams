import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import { importText } from "./formats";
import { diagramToDrawio } from "./drawio/write";
import { diagramToMermaid } from "./mermaid/write";
import { serializeNative } from "./native";
import { authorized } from "./storage/http";
import { StorageError } from "./storage/types";
import { createDriveClient } from "./gdrive/client";

// Private diagrams keep their marking through every format that imports back (native JSON, draw.io,
// Mermaid), and a cloud write that's cancelled (the diagram became private meanwhile) never uploads.

const work: DiagramFile = {
  format: "diagrams/v1",
  title: "Payroll flow",
  nodes: [
    { id: "intake", stencil: "generic.service", label: "Intake service", x: 0, y: 0 },
    { id: "ledger", stencil: "postgres", label: "Ledger", x: 320, y: 0 },
  ],
  edges: [{ id: "intake-to-ledger", from: "intake", to: "ledger" }],
};
const secret: DiagramFile = { ...work, private: true };

async function reimport(text: string, name: string): Promise<DiagramFile> {
  const outcome = await importText(text, name);
  if (outcome.ok !== true) throw new Error(outcome.ok === false ? outcome.error : "pages");
  return outcome.diagram;
}

describe("the Private marking round-trips through every importable format", () => {
  const formats: [string, (d: DiagramFile) => string, string][] = [
    ["native JSON", serializeNative, "x.diagram.json"],
    ["draw.io", (d) => diagramToDrawio(d), "x.drawio"],
    ["Mermaid", (d) => diagramToMermaid(d), "x.mmd"],
    ["Mermaid without metadata", (d) => diagramToMermaid(d, { metadata: false }), "x.mmd"],
  ];
  for (const [name, write, file] of formats) {
    it(`${name}: private stays private, public stays public`, async () => {
      expect((await reimport(write(secret), file)).private).toBe(true);
      expect(await reimport(write(work), file)).not.toHaveProperty("private");
    });
  }

  it("an odd marking fails closed", async () => {
    const xml = diagramToDrawio(secret).replace('dg_private="true"', 'dg_private="yes"');
    expect((await reimport(xml, "x.drawio")).private).toBe(true);
    const mmd = diagramToMermaid(secret).replace('"private":true', '"private":"yes"');
    expect((await reimport(mmd, "x.mmd")).private).toBe(true);
  });
});

describe("a cancelled cloud write never uploads", () => {
  const blocked = new StorageError("Not saved: it became private.", undefined, true);
  const mapError = () => "failed";

  it("stops after the token (a sign-in can take a while) and before the upload", async () => {
    const cancel = new AbortController();
    const fetch = vi.fn(async () => new Response("{}"));
    const getToken = vi.fn(async () => {
      cancel.abort(blocked); // became private while signing in
      return "token";
    });
    await expect(
      authorized(
        { fetch, getToken },
        "OneDrive",
        mapError,
        "https://x",
        { method: "PUT", signal: cancel.signal },
        "save",
      ),
    ).rejects.toBe(blocked);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an upload in flight rejects with the reason, not as a network error", async () => {
    const cancel = new AbortController();
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      cancel.abort(blocked);
      init?.signal?.throwIfAborted();
      return new Response("{}");
    });
    await expect(
      authorized(
        { fetch: fetch as typeof globalThis.fetch, getToken: async () => "t" },
        "Dropbox",
        mapError,
        "https://x",
        { method: "POST", signal: cancel.signal },
        "save",
      ),
    ).rejects.toBe(blocked);
  });

  it("Google Drive's client honours the signal too", async () => {
    const cancel = new AbortController();
    const fetch = vi.fn(async () => new Response("{}"));
    const client = createDriveClient({
      fetch,
      getToken: async () => {
        cancel.abort(blocked);
        return "t";
      },
    });
    await expect(client.update("id", { content: "{}", mimeType: "application/json" }, cancel.signal)).rejects.toBe(
      blocked,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

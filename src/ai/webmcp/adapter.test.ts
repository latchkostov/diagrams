import { describe, expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import type { DiagramFile } from "../../model/types";
import { diagramDiff } from "../../model/diagramDiff";
import {
  errorResult,
  getModelContext,
  registerTools,
  toModelContextTool,
  toToolResult,
  type ModelContextTool,
  type ToolDef,
} from "./adapter";
import { buildTools, EDIT_TOOLS, LIVE_TOOLS, type WebMcpHost } from "./tools";

const ctx = () => ({
  registerTool: vi.fn(async (_tool: ModelContextTool, _opts?: { signal?: AbortSignal }) => undefined),
});

describe("feature detection", () => {
  it("prefers document.modelContext and falls back to the navigator alias", () => {
    const a = ctx();
    const b = ctx();
    expect(getModelContext({ modelContext: a }, { modelContext: b })).toBe(a);
    expect(getModelContext({}, { modelContext: b })).toBe(b);
    expect(getModelContext({}, {})).toBeUndefined();
    expect(getModelContext({ modelContext: {} }, {})).toBeUndefined();
    expect(getModelContext(undefined, undefined)).toBeUndefined();
  });
});

describe("return format", () => {
  it("wraps strings as they are and objects as JSON, flagging failures", () => {
    expect(toToolResult("Diagram")).toEqual({ content: [{ type: "text", text: "Diagram" }] });
    expect(toToolResult({ ok: true })).toEqual({ content: [{ type: "text", text: '{"ok":true}' }] });
    expect(toToolResult({ ok: false, error: "x" })).toEqual({
      content: [{ type: "text", text: '{"ok":false,"error":"x"}' }],
      isError: true,
    });
    expect(JSON.parse(errorResult(new Error("bad")).content[0].text)).toMatchObject({ ok: false, error: "bad" });
  });

  it("never throws from execute", async () => {
    const def: ToolDef = {
      name: "t",
      title: "T",
      description: "d",
      inputSchema: {},
      annotations: {},
      run: () => {
        throw new Error("boom");
      },
    };
    const res = await toModelContextTool(def).execute({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("boom");
  });
});

describe("registerTools", () => {
  const defs = (names: string[]): ToolDef[] =>
    names.map((name) => ({ name, title: name, description: name, inputSchema: {}, annotations: {}, run: () => name }));

  it("registers every tool with the shared signal", async () => {
    const c = ctx();
    const ac = new AbortController();
    expect(await registerTools(c, defs(["a", "b"]), ac.signal)).toEqual(["a", "b"]);
    expect(c.registerTool).toHaveBeenCalledTimes(2);
    expect(c.registerTool.mock.calls[0][1]).toEqual({ signal: ac.signal });
  });

  it("retries a name still held by an aborted registration (StrictMode), then gives up quietly", async () => {
    let held = true;
    const c = {
      registerTool: vi.fn(async (tool: ModelContextTool) => {
        if (tool.name === "a" && held) {
          held = false;
          throw new DOMException("Tool a is already registered", "InvalidStateError");
        }
      }),
    };
    expect(await registerTools(c, defs(["a"]), new AbortController().signal)).toEqual(["a"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const always = { registerTool: vi.fn(async () => Promise.reject(new TypeError("bad schema"))) };
    expect(await registerTools(always, defs(["a"]), new AbortController().signal)).toEqual([]);
    expect(always.registerTool).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("stops when aborted", async () => {
    const c = ctx();
    const ac = new AbortController();
    ac.abort();
    expect(await registerTools(c, defs(["a"]), ac.signal)).toEqual([]);
    expect(c.registerTool).not.toHaveBeenCalled();
  });
});

describe("tools", () => {
  const diagram = (): DiagramFile => ({
    format: "diagrams/v1",
    title: "T",
    nodes: [{ id: "orders-api", stencil: "service.dotnet", label: "orders-api", x: 0, y: 0 }],
    edges: [],
  });
  const fakeHost = () => {
    let d = diagram();
    const editor = {
      getDiagram: () => d,
      // Like the editor: no step (and hasChanges false) when nothing changes.
      applyDiagram: vi.fn((next: DiagramFile) => {
        const diff = diagramDiff(d, next);
        if (diff.hasChanges) d = next;
        return diff;
      }),
    } as unknown as EditorApi;
    const host: WebMcpHost = {
      getEditor: () => editor,
      onApplied: vi.fn(),
      newDiagram: vi.fn(async () => editor),
      shareLink: vi.fn(async () => ({ url: "https://x/#d=1", length: 14 })),
    };
    return { host, editor, get: () => d };
  };

  it("has the six tools with their annotations, and a reduced live set", () => {
    const tools = buildTools(fakeHost().host);
    expect(tools.map((t) => t.name)).toEqual([...EDIT_TOOLS]);
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(by.describe_diagram.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(by.edit_diagram.annotations).toEqual({ untrustedContentHint: true });
    expect(by.new_diagram.annotations).toEqual({ consequentialHint: true });
    expect(by.get_share_link.annotations).toEqual({ readOnlyHint: true });
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
    }
    expect(buildTools(fakeHost().host, LIVE_TOOLS).map((t) => t.name)).toEqual(["describe_diagram", "get_share_link"]);
  });

  it("edit_diagram applies once and reports; dryRun and failures change nothing", async () => {
    const { host, editor, get } = fakeHost();
    const edit = toModelContextTool(buildTools(host).find((t) => t.name === "edit_diagram")!);
    const dry = JSON.parse(
      (await edit.execute({ ops: [{ op: "add_node", kind: "Kafka topic", label: "orders" }], dryRun: true })).content[0]
        .text,
    );
    expect(dry).toMatchObject({ ok: true, dryRun: true, summary: "+1 node" });
    expect(editor.applyDiagram).not.toHaveBeenCalled();

    const ok = JSON.parse(
      (
        await edit.execute({
          ops: [
            { op: "add_node", kind: "Kafka topic", label: "orders", key: "t" },
            { op: "connect", from: "orders-api", to: "t" },
          ],
          summary: "Added an orders topic",
        })
      ).content[0].text,
    );
    expect(ok).toMatchObject({ ok: true, summary: "+1 node, +1 connection" });
    expect(editor.applyDiagram).toHaveBeenCalledTimes(1);
    expect(get().nodes).toHaveLength(2);
    // The change is recorded for the AI panel: the agent's note, what changed, and its own history step.
    expect(host.onApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "edit_diagram",
        note: "Added an orders topic",
        summary: "+1 node, +1 connection",
        editor,
        historyKey: expect.stringMatching(/^ai:/),
      }),
    );
    const tag = (editor.applyDiagram as ReturnType<typeof vi.fn>).mock.calls[0][1] as { merge: string };
    expect((host.onApplied as ReturnType<typeof vi.fn>).mock.calls[0][0].historyKey).toBe(tag.merge);

    const bad = await edit.execute({ ops: [{ op: "remove", targets: ["nope"] }] });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0].text)).toMatchObject({ ok: false, applied: false });
    expect(editor.applyDiagram).toHaveBeenCalledTimes(1);
  });

  it("records no turn when the call changes nothing", async () => {
    const { host } = fakeHost();
    const tools = Object.fromEntries(buildTools(host).map((t) => [t.name, toModelContextTool(t)]));
    const rename = { ops: [{ op: "update", target: "orders-api", props: { label: "orders" } }], layout: "none" };
    await tools.edit_diagram.execute(rename);
    expect(host.onApplied).toHaveBeenCalledTimes(1);
    const same = JSON.parse((await tools.edit_diagram.execute(rename)).content[0].text);
    expect(same).toMatchObject({ ok: true, changed: false });
    expect(host.onApplied).toHaveBeenCalledTimes(1);

    const sim = { title: "Storm", traffic: [{ from: "orders-api", pattern: "burst", count: 5 }] };
    await tools.set_simulation.execute(sim);
    expect(host.onApplied).toHaveBeenCalledTimes(2);
    // The same simulation again, replacing itself.
    const again = JSON.parse((await tools.set_simulation.execute({ ...sim, replace: "Storm" })).content[0].text);
    expect(again).toMatchObject({ ok: true, changed: false });
    expect(again.undo).toBeUndefined();
    expect(host.onApplied).toHaveBeenCalledTimes(2);
  });

  it("describe_diagram returns text; get_share_link returns the host's link", async () => {
    const { host } = fakeHost();
    const tools = Object.fromEntries(buildTools(host).map((t) => [t.name, toModelContextTool(t)]));
    const text = (await tools.describe_diagram.execute({})).content[0].text;
    expect(text).toContain("orders-api");
    expect(JSON.parse((await tools.get_share_link.execute({})).content[0].text)).toEqual({
      url: "https://x/#d=1",
      length: 14,
    });
  });
});

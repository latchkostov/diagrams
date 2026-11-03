// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CacheFields } from "./CacheFields";
import { cacheFixture } from "../lab/cacheFixture";
import { coalesceRule } from "../sim/cachePresets";
import { LiveController } from "../live/controller";
import { planningHost } from "../live/planningHost";
import type { EditorApi } from "../editor/types";
import type { LiveUi } from "../live/context";
import type { CacheTable } from "../model/caching";
import "../sim/cache/cacheRuntime";

it("reads the running policy and writes inspector toggles only into its saved simulation", async () => {
  const diagram = cacheFixture();
  const table = diagram.nodes[1].props!.cache as CacheTable;
  diagram.simulations = [
    { id: "ttl", title: diagram.title!, traffic: [] },
    {
      id: "one",
      title: diagram.title!,
      traffic: [],
      setup: { props: { cache: { cache: coalesceRule(table, "") } } },
    },
  ];
  const controller = new LiveController(diagram);
  controller.selectSimulation(diagram.simulations[1]);
  const unpublish = planningHost.publish({ controller, slowmo: { active: false } } as LiveUi);
  const version = { identity: 1, revision: 0 };
  const editor = {
    getDiagram: () => diagram,
    getDocumentVersion: () => version,
    updateMeta: vi.fn<EditorApi["updateMeta"]>((patch) => Object.assign(diagram, patch)),
    setNodeProps: vi.fn(),
  };
  const host = document.createElement("div"),
    root = createRoot(host);
  const before = structuredClone(diagram);
  try {
    await act(async () =>
      root.render(
        <CacheFields
          editor={editor as unknown as EditorApi}
          nodeId="cache"
          props={diagram.nodes[1].props!}
          counts={{ nodes: 3, edges: 2 }}
        />,
      ),
    );
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="cache-default-toggle"]')!.click());
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="cache-default-expires-toggle"]')!.click(),
    );
    const toggle = host.querySelector<HTMLInputElement>('[data-testid="cache-default-coalesce"]')!;
    expect(toggle.checked).toBe(true);
    await act(async () => toggle.click());
    expect(toggle.checked).toBe(false);
    expect(editor.setNodeProps).not.toHaveBeenCalled();
    expect(editor.updateMeta).toHaveBeenCalledOnce();
    expect(diagram.simulations[1].setup?.props?.cache.cache).toMatchObject({ default: { coalesce: false } });
    expect(diagram.nodes).toEqual(before.nodes);
    expect(diagram.simulations[0]).toEqual(before.simulations![0]);
  } finally {
    await act(async () => root.unmount());
    unpublish();
    controller.dispose();
  }
});

it("reuses the ownership snapshot above the analysis limit until the document changes", async () => {
  const diagram = cacheFixture();
  const version = { identity: {}, revision: 0 };
  const editor = {
    getDiagram: vi.fn(() => diagram),
    getDocumentVersion: () => version,
  };
  const host = document.createElement("div"),
    root = createRoot(host);
  const render = () =>
    root.render(
      <CacheFields
        editor={editor as unknown as EditorApi}
        nodeId="cache"
        props={diagram.nodes[1].props!}
        counts={{ nodes: 257, edges: 2 }}
      />,
    );
  try {
    for (let frame = 0; frame < 8; frame++) await act(async () => render());
    expect(editor.getDiagram).toHaveBeenCalledTimes(1);
    version.revision++;
    await act(async () => render());
    expect(editor.getDiagram).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});

it("takes a controlled Undo snapshot before the imperative document version catches up", async () => {
  const diagram = cacheFixture();
  const table: CacheTable = { rules: [{ id: "first", match: { types: ["First"] }, policy: { ttlMs: 1000, keys: 1 } }] };
  diagram.nodes[1].props!.cache = table;
  const version = { identity: {}, revision: 0 };
  const editor = { getDiagram: () => diagram, getDocumentVersion: () => version };
  const host = document.createElement("div"),
    root = createRoot(host);
  const render = (doc: typeof diagram) =>
    root.render(
      <CacheFields
        editor={editor as unknown as EditorApi}
        nodeId="cache"
        props={doc.nodes[1].props!}
        readDiagram={() => doc}
        counts={{ nodes: 3, edges: 2 }}
      />,
    );
  try {
    await act(async () => render(diagram));
    const restored = structuredClone(diagram);
    (restored.nodes[1].props!.cache as CacheTable).rules.push({
      id: "second",
      match: { types: ["Second"] },
      policy: { ttlMs: 1000, keys: 1 },
    });
    await act(async () => render(restored));
    expect(host.querySelector('[data-testid="cache-rule-second"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

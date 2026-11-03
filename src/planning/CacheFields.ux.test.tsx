// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CacheFields } from "./CacheFields";
import { cacheFixture } from "../lab/cacheFixture";
import type { EditorApi } from "../editor/types";

it("prioritizes policy over match editing and describes Don't store as intentionally uncached", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const d = cacheFixture();
  d.nodes[1].props!.cache = {
    rules: [{ id: "pages", label: d.title, match: { types: ["*"] }, policy: { noStore: true } }],
  };
  const host = document.createElement("div"),
    root = createRoot(host);
  const version = { identity: {}, revision: 0 };
  const editor = { getDiagram: () => d, getDocumentVersion: () => version } as unknown as EditorApi;
  try {
    await act(() =>
      root.render(
        <CacheFields editor={editor} nodeId="cache" props={d.nodes[1].props!} counts={{ nodes: 3, edges: 2 }} />,
      ),
    );
    const expected = host.querySelector('[data-testid="cache-rule-pages-expected"]')!;
    expect(expected.textContent?.replace(/[\u2068\u2069]/g, "")).toBe("Not cached: all 200/s reach Origin");
    expect(host.querySelector('[data-testid="cache-rule-pages-match-summary"]')?.textContent).toContain("Match:");
    const match = host.querySelector<HTMLDetailsElement>('[data-testid="cache-rule-pages-edit-match"]')!;
    expect(match.open).toBe(false);
    const actions = host.querySelector<HTMLDetailsElement>('[data-testid="cache-rule-pages-actions"]')!;
    expect(actions.open).toBe(false);
    expect(
      actions.querySelectorAll('[data-testid$="-up"], [data-testid$="-down"], [data-testid$="-delete"]'),
    ).toHaveLength(3);
  } finally {
    await act(() => root.unmount());
  }
});

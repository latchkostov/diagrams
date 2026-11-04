// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PlanningUpgrade } from "./PlanningUpgrade";
import { cacheFixture } from "../lab/cacheFixture";
import type { EditorApi } from "../editor/types";
import { t } from "../i18n";
import { notify } from "../interop/ui/toast";
import { PLANNING_REVISIONS, revisionAtLeast } from "../model/revisions";

vi.mock("../interop/ui/toast", () => ({ notify: vi.fn() }));

it("joins upgrade consequences by node id when two CDNs share a name", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const diagram = cacheFixture();
  diagram.planning!.revision = "p3-w2";
  diagram.nodes.push(
    { ...diagram.nodes[1], id: "other-cache", props: {} },
    // eslint-disable-next-line local/no-literal-ui-text -- authored node label in the regression diagram
    { ...diagram.nodes[2], id: "other-origin", label: "Unaffected service" },
  );
  diagram.edges.push({ id: "other-fetch", from: "other-cache", to: "other-origin", kind: "sync" });
  const host = document.createElement("div"),
    root = createRoot(host);
  const editor = { getDiagram: () => diagram } as unknown as EditorApi;
  try {
    await act(() => root.render(<PlanningUpgrade editor={editor} planning={diagram.planning} />));
    await act(() => host.querySelector<HTMLElement>('[data-testid="cache-upgrade-preview"]')!.click());
    const preview = host.querySelector('[data-testid="planning-upgrade-preview"]')!;
    // Technical capacity details may name all nodes; the consequence sentence must not.
    expect(preview.firstElementChild!.textContent?.replace(/[\u2068\u2069]/g, "")).toBe(
      "Enable cache rules on Edge cache. Requests answered there will no longer reach Origin.",
    );
  } finally {
    await act(() => root.unmount());
  }
});

it.each(PLANNING_REVISIONS)(
  "keeps %s legacy behavioural losses outside collapsed implementation details",
  async (revision) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const diagram = cacheFixture();
    diagram.planning!.revision = revision;
    const host = document.createElement("div"),
      root = createRoot(host);
    const editor = { getDiagram: () => diagram } as unknown as EditorApi;
    try {
      await act(() => root.render(<PlanningUpgrade editor={editor} planning={diagram.planning} />));
      await act(() => host.querySelector<HTMLElement>('[data-testid="planning-preview"]')!.click());
      const preview = host.querySelector('[data-testid="planning-legacy-preview"]')!;
      const details = host.querySelector<HTMLDetailsElement>('[data-testid="planning-legacy-details"]')!;
      expect(details.open).toBe(false);
      const visible = [...preview.children]
        .filter((el) => el !== details)
        .map((el) => el.textContent)
        .join(" ");
      if (revisionAtLeast(revision, "p3-w1")) expect(visible).toContain(t("threads.exportLoss"));
      if (revisionAtLeast(revision, "p3-w2")) expect(visible).toContain(t("resilience.exportLoss"));
      if (revisionAtLeast(revision, "p3-w3")) expect(visible).toContain(t("cache.exportLoss"));
      expect(details.textContent).toContain("planning.revision");
      expect(visible).not.toContain("planning.revision");
    } finally {
      await act(() => root.unmount());
    }
  },
);

it("explains consequences, folds capacity machinery, and focuses the new model with a bound Undo toast", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let diagram = cacheFixture();
  diagram.planning!.revision = "p3-w2";
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  const render = () => root.render(<PlanningUpgrade editor={editor} planning={diagram.planning} />);
  const editor = {
    getDiagram: () => diagram,
    applyDiagram: (next: typeof diagram) => {
      diagram = next;
      render();
    },
    undo: vi.fn(),
  } as unknown as EditorApi;
  const find = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  try {
    await act(() => render());
    await act(() => find("cache-upgrade-preview").click());
    expect(find("planning-upgrade-preview").textContent?.replace(/[\u2068\u2069]/g, "")).toContain(
      "Enable cache rules on Edge cache. Requests answered there will no longer reach Origin.",
    );
    expect(find("planning-capacity-changes").textContent).toBe("");
    expect((find("cache-upgrade-details") as HTMLDetailsElement).open).toBe(false);
    expect(find("planning-upgrade").textContent).toBe("Enable caching");
    await act(() => find("planning-upgrade").click());
    expect(diagram.planning?.revision).toBe("p3-w3");
    expect(document.activeElement).toBe(find("planning-model-summary"));
    expect(notify).toHaveBeenCalledWith(
      "Enabled caching",
      expect.objectContaining({ action: expect.objectContaining({ label: t("routing.undo"), undoes: true }) }),
    );
    await act(() => find("planning-preview").click());
    expect(find("planning-legacy-preview").textContent).toContain(
      "In the older file, every request reaches the origin; cache rules won't run.",
    );
    expect(find("planning-legacy-preview").textContent).toContain("Your diagram keeps its current behaviour.");
    expect((find("planning-legacy-details") as HTMLDetailsElement).open).toBe(false);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

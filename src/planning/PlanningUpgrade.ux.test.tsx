// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PlanningUpgrade } from "./PlanningUpgrade";
import { cacheFixture } from "../lab/cacheFixture";
import type { EditorApi } from "../editor/types";
import { t } from "../i18n";
import { notify } from "../interop/ui/toast";

vi.mock("../interop/ui/toast", () => ({ notify: vi.fn() }));

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

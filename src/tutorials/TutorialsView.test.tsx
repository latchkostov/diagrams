// @vitest-environment happy-dom
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mobileApi } from "./catalog/mobileApi";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "../interop/ui/toast";
import { tutorials } from "./catalog";
import { savedProgress, writeTutorials } from "./progress";
import { TutorialsView } from "./TutorialsView";
import { tracks } from "./chapters";

let host: HTMLDivElement;
let root: Root;
const control = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  toast.dismiss();
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("reset chapter labels follow their descriptors even when chapter display order changes", async () => {
  tracks.reverse();
  try {
    await act(() => root.render(<TutorialsView />));
    await act(() => control("tutorials-more").click());
    await act(() => control("context-menu-item-tutorials-reset").click());
    const select = control("tutorials-reset-chapter-select") as HTMLSelectElement;
    for (const chapter of tracks) {
      expect([...select.options].find((option) => option.value === chapter.id)?.textContent).toBe(
        `${chapter.numeral} ${chapter.label()}`,
      );
    }
  } finally {
    tracks.reverse();
  }
});

it("names lesson buttons with their visible action, number, title and progress", async () => {
  await act(() => root.render(<TutorialsView />));
  const lesson = tutorials[0];
  const button = control(`tutorial-open-${lesson.id}`);
  for (const [step, completed, action] of [
    [0, false, "Start"],
    [1, false, "Continue"],
    [1, true, "Review"],
  ] as const) {
    await act(() =>
      writeTutorials(() => ({ progress: { [lesson.id]: { version: lesson.version, step, completed } } })),
    );
    expect(button.textContent).toBe(action);
    expect(button.getAttribute("aria-label")).toContain(`${action} 1.1 ${lesson.title()},`);
    expect(button.getAttribute("aria-label")).toContain(control(`tutorial-status-${lesson.id}`).textContent);
  }
});

it("persists backfilled seal dates through hub remounts", async () => {
  const first = 1000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(first);
  try {
    writeTutorials(() => ({
      progress: Object.fromEntries(
        tutorials
          .filter((lesson) => lesson.track === "basics")
          .map((lesson) => [lesson.id, { version: lesson.version, step: 0, completed: true }]),
      ),
    }));
    await act(() => root.render(<TutorialsView />));
    const stored = () => JSON.parse(localStorage.getItem("diagrams.tutorials.v1") ?? "{}").marks?.["chapter-basics"];
    expect(stored()).toBe(first);
    await act(() => root.render(null));
    clock.mockReturnValue(2000);
    await act(() => root.render(<TutorialsView />));
    expect(stored()).toBe(first);
  } finally {
    clock.mockRestore();
  }
});

it("returns focus to More after dismissing or confirming reset from its menu", async () => {
  await act(() => root.render(<TutorialsView />));
  const more = control("tutorials-more");
  for (const close of ["escape", "cancel", "confirm"] as const) {
    await act(() => {
      more.focus();
      more.click();
    });
    await act(() => control("context-menu-item-tutorials-reset").click());
    const cancel = control("tutorials-reset-cancel");
    expect(document.activeElement).toBe(cancel);
    await act(() => {
      if (close === "escape") cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else control(`tutorials-reset-${close}`).click();
    });
    expect(document.activeElement).toBe(more);
  }
});

for (const step of [-1, 0.5, null, "1", 1000000]) {
  it(`renders a safe resume step for saved index ${JSON.stringify(step)}`, async () => {
    const lesson = tutorials[0];
    localStorage.setItem(
      "diagrams.tutorials.v1",
      JSON.stringify({ progress: { [lesson.id]: { version: lesson.version, step, completed: false } } }),
    );
    await act(() => root.render(<TutorialsView />));
    const index = typeof step === "number" && Number.isInteger(step) && step >= 0 ? lesson.steps.length - 1 : 0;
    expect(control("tutorials-resume").textContent).toContain(`Step ${index + 1} of ${lesson.steps.length}`);
    expect(control("tutorials-resume").textContent).toContain(lesson.steps[index].title());
  });
}

it.each([-1, 0.5, null, "bad", 1000000])("keeps the hub usable with stored step %s", (step) => {
  const raw = JSON.stringify({ progress: { [mobileApi.id]: { version: mobileApi.version, step, completed: false } } });
  localStorage.setItem("diagrams.tutorials.v1", raw);
  const html = renderToStaticMarkup(<TutorialsView />);
  expect(html).toContain('data-testid="tutorials-resume"');
  expect(html).toContain('data-testid="tutorials-reset-basics"');
  expect(savedProgress(mobileApi)?.step).toBe(step === 1000000 ? step : 0);
});

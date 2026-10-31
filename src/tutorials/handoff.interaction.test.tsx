// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinishHandoff } from "./FinishHandoff";
import { ResetProgressDialog } from "./ResetProgressDialog";
import { mobileApi } from "./catalog/mobileApi";
import { cancelLessonStart, startNextLesson, takeLessonStart } from "./handoff";
import { tutorialRoute } from "./route";
import { createTutorialStart } from "./start";

const host = document.createElement("div");
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.append(host);
  root = createRoot(host);
  window.history.replaceState(null, "", "/?view=tutorials");
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  cancelLessonStart();
  vi.unstubAllGlobals();
});

it.each(["Stay", "Escape"])(
  "%s detaches the handoff's Escape listener for continued keyboard practice",
  async (how) => {
    await act(() =>
      root.render(
        <>
          <FinishHandoff tutorial={mobileApi} catalog={[mobileApi]} before={{}} progress={{}} />
          <button data-testid="canvas-wrap" />
          <button data-testid="practice-node" />
        </>,
      ),
    );
    await act(() => {
      if (how === "Stay") host.querySelector<HTMLButtonElement>('[data-testid="tutorial-handoff-dismiss"]')!.click();
      else window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    expect(host.querySelector('[data-testid="tutorial-handoff"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[data-testid="canvas-wrap"]'));
    const node = host.querySelector<HTMLButtonElement>('[data-testid="practice-node"]')!;
    node.focus();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(() => node.dispatchEvent(escape));
    expect(document.activeElement).toBe(node);
    expect(escape.defaultPrevented).toBe(false);
  },
);

it.each(["all", "track", "lesson"] as const)(
  "reset scope %s has one radio Tab stop and wraps Shift+Tab",
  async (kind) => {
    await act(() =>
      root.render(
        <ResetProgressDialog
          initialScope={
            kind === "all" ? { all: true } : kind === "track" ? { track: "basics" } : { lesson: mobileApi.id }
          }
          current={mobileApi}
          progress={{}}
          onClose={() => {}}
          onConfirm={() => {}}
          restoreFocus={(opener) => opener?.focus()}
        />,
      ),
    );
    const radio = document.querySelector<HTMLInputElement>(`[data-testid="tutorials-reset-scope-${kind}"]`)!;
    for (const option of ["all", "track", "lesson"])
      expect(
        document.querySelector<HTMLInputElement>(`[data-testid="tutorials-reset-scope-${option}"]`)!.tabIndex,
      ).toBe(option === kind ? 0 : -1);
    const first =
      kind === "lesson"
        ? document.querySelector<HTMLSelectElement>('[data-testid="tutorials-reset-chapter-select"]')!
        : radio;
    first.focus();
    const back = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    await act(() => first.dispatchEvent(back));
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[data-testid="tutorials-reset-confirm"]'));
    const all = document.querySelector<HTMLInputElement>('[data-testid="tutorials-reset-scope-all"]')!;
    await act(() => all.click());
    expect(all.tabIndex).toBe(0);
    expect(radio.tabIndex).toBe(kind === "all" ? 0 : -1);
  },
);

it.each(["cancel", "failure", "supersede"])(
  "abandons Start next on %s so a normal reopen keeps its intro",
  async (how) => {
    startNextLesson(mobileApi);
    const loader = createTutorialStart(
      mobileApi,
      () => (how === "failure" ? Promise.reject(new Error("offline")) : new Promise(() => {})),
      cancelLessonStart,
    );
    const stop = loader.connect();
    await Promise.resolve();
    if (how === "failure") {
      expect(loader.getSnapshot().value).toBe("failed");
      expect(takeLessonStart(mobileApi.id)).toBe(false);
    } else if (how === "supersede") tutorialRoute.open("quick-add");
    else tutorialRoute.close();
    // close() without a pushed history entry replaces this direct lesson link synchronously.
    stop();
    tutorialRoute.open(mobileApi.id);
    expect(takeLessonStart(mobileApi.id)).toBe(false);
  },
);

it("starts the successful handoff exactly once", () => {
  startNextLesson(mobileApi);
  expect(takeLessonStart(mobileApi.id)).toBe(true);
  expect(takeLessonStart(mobileApi.id)).toBe(false);
});

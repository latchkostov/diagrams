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
import { chapters } from "./chapters";
import { BlueprintBoard } from "./BlueprintBoard";
import { state as locale } from "../i18n";
import { quickAdd } from "./catalog/quickAdd";
import { dotsAndSides } from "./catalog/dotsAndSides";
import { annotate } from "./catalog/annotate";
import { circuitBreaker } from "./catalog/circuitBreaker";
import { loadTutorialStart } from "./start";
import { canvasInteraction } from "../canvas/interaction/canvasInteraction";
import { initialEditorMode, type EditorModeState } from "../canvas/interaction/mode";

const host = document.createElement("div");
let root: ReturnType<typeof createRoot>;
let stopInteraction: (() => void) | undefined;
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
  locale.l = "en";
  stopInteraction?.();
  stopInteraction = undefined;
});

it("retires a final quick-add name request before the finish heading takes focus", async () => {
  const done = vi.fn(() =>
    expect(document.activeElement).not.toBe(host.querySelector('[data-testid="tutorial-handoff-heading"]')),
  );
  stopInteraction = canvasInteraction.publish({
    mode: { ...initialEditorMode, value: "naming", target: "db" },
    dispatch: done,
    subscribeMode: () => () => {},
    setGuide: () => {},
  });
  await act(() => root.render(<FinishHandoff tutorial={quickAdd} catalog={[quickAdd]} before={{}} progress={{}} />));
  expect(done).toHaveBeenCalledExactlyOnceWith({ type: "naming.done", flowId: "db" });
  expect(document.activeElement).toBe(host.querySelector('[data-testid="tutorial-handoff-heading"]'));
});

it.each(["committing", "released"] as const)(
  "waits for a name in %s to release its final focus move",
  async (value) => {
    let mode: EditorModeState = { ...initialEditorMode, value, target: "db" };
    let changed: ((next: EditorModeState, previous: EditorModeState) => void) | undefined;
    const unsubscribe = vi.fn();
    const dispatch = vi.fn();
    stopInteraction = canvasInteraction.publish({
      get mode() {
        return mode;
      },
      dispatch,
      setGuide: () => {},
      subscribeMode: (listener) => {
        changed = listener;
        return unsubscribe;
      },
    });
    await act(() => root.render(<FinishHandoff tutorial={quickAdd} catalog={[quickAdd]} before={{}} progress={{}} />));
    const heading = host.querySelector('[data-testid="tutorial-handoff-heading"]');
    expect(document.activeElement).not.toBe(heading);
    expect(dispatch).not.toHaveBeenCalled();
    await act(() => {
      const previous = mode;
      mode = initialEditorMode;
      changed?.(mode, previous);
    });
    expect(document.activeElement).toBe(heading);
    expect(unsubscribe).toHaveBeenCalled();
  },
);

it("refreshes a mounted blueprint's authored labels when the language changes", async () => {
  const lesson = {
    ...mobileApi,
    start: () => ({
      ...mobileApi.start(),
      nodes: [{ id: "api", stencil: "generic.service", label: locale.l, x: 0, y: 0 }],
    }),
    steps: [],
  };
  await act(() => root.render(<BlueprintBoard lesson={lesson} catalog={[lesson]} />));
  expect(host.querySelector('[data-testid="tutorial-handoff-drawing"]')?.textContent).toContain("en");
  await act(() => {
    locale.l = "es";
    locale.f.forEach((listener) => listener());
  });
  expect(host.querySelector('[data-testid="tutorial-handoff-drawing"]')?.textContent).toContain("es");
});

it("places a node's numbered markers in reading order", async () => {
  await act(() => root.render(<BlueprintBoard lesson={quickAdd} catalog={[quickAdd]} />));
  const marks = [...host.querySelectorAll('[data-testid="tutorial-handoff-preview-mark"]')];
  const x = (number: string) =>
    Number(/translate\((\d+)/.exec(marks.find((mark) => mark.textContent === number)!.getAttribute("transform")!)![1]);
  expect(x("2")).toBeLessThan(x("3"));
});

it("renders configuration presence as readable Off → On values", async () => {
  const initial = await loadTutorialStart(circuitBreaker);
  const lesson = { ...circuitBreaker, start: () => initial };
  await act(() => root.render(<BlueprintBoard lesson={lesson} catalog={[lesson]} />));
  expect(host.querySelector('[data-testid="tutorial-handoff-setting-before"]')?.textContent).toBe("Off");
  expect(host.querySelector('[data-testid="tutorial-handoff-setting-after"]')?.textContent).toBe("On");
});

it("shows the annotation lesson's steps without a blank drawing board", async () => {
  await act(() =>
    root.render(<FinishHandoff tutorial={quickAdd} catalog={[quickAdd, annotate]} before={{}} progress={{}} />),
  );
  expect(host.querySelector('[data-testid="tutorial-handoff-drawing"]')).toBeNull();
  expect(host.querySelector('[data-testid="tutorial-handoff-board-content"]')).toBeNull();
  expect(host.querySelector('[data-testid="tutorial-handoff-next-title"]')?.textContent).toBe(annotate.title());
  expect(host.querySelectorAll('[data-testid="tutorial-handoff-step-title"]')).toHaveLength(3);
});

it("isolates dimmed regions and wraps both sheet boundaries, restoring previous inertness", async () => {
  await act(() =>
    root.render(
      <>
        <button data-testid="outside" inert />
        <div>
          <button data-testid="canvas-wrap" />
          <FinishHandoff tutorial={mobileApi} catalog={[mobileApi, quickAdd]} before={{}} progress={{}} />
        </div>
      </>,
    ),
  );
  const canvas = host.querySelector<HTMLElement>('[data-testid="canvas-wrap"]')!;
  const outside = host.querySelector<HTMLElement>('[data-testid="outside"]')!;
  expect(canvas.inert).toBe(true);
  const first = host.querySelector<HTMLElement>('[data-testid="tutorial-handoff-body"]')!;
  const last = host.querySelector<HTMLElement>('[data-testid="tutorial-done-exit"]')!;
  for (const from of [first, host.querySelector<HTMLElement>('[data-testid="tutorial-handoff-heading"]')!]) {
    from.focus();
    await act(() =>
      from.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })),
    );
    expect(document.activeElement).toBe(last);
  }
  await act(() => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(first);
  await act(() => host.querySelector<HTMLButtonElement>('[data-testid="tutorial-handoff-dismiss"]')!.click());
  expect(canvas.inert).toBeFalsy();
  expect(outside.inert).toBe(true);
  expect(document.activeElement).toBe(canvas);
});

it("leaves the strip, app bar and handoff dialogs active while covering the workbench", async () => {
  await act(() =>
    root.render(
      <div data-testid="tutorial-app">
        <button data-testid="file-button" />
        <button data-testid="tutorial-save-copy" />
        <button data-testid="tutorial-exit" />
        <div data-testid="canvas-wrap">
          <button data-testid="canvas-node" />
        </div>
        <div data-testid="inspector">
          <input />
        </div>
        <div className="live-transport-mount">
          <button />
        </div>
        <FinishHandoff tutorial={mobileApi} catalog={[mobileApi, quickAdd]} before={{}} progress={{}} />
        <input data-testid="command-input" />
      </div>,
    ),
  );
  for (const id of ["file-button", "tutorial-save-copy", "tutorial-exit", "command-input"])
    expect(host.querySelector(`[data-testid="${id}"]`)!.closest("[inert]")).toBeNull();
  for (const id of ["canvas-wrap", "inspector"])
    expect(host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.inert).toBe(true);
  expect(host.querySelector<HTMLElement>(".live-transport-mount")!.inert).toBe(true);
  const input = host.querySelector<HTMLInputElement>('[data-testid="command-input"]')!;
  input.focus();
  expect(document.activeElement).toBe(input);
});

it("keeps a named connection's markers and label clear of its nodes", async () => {
  await act(() => root.render(<BlueprintBoard lesson={dotsAndSides} catalog={[dotsAndSides]} />));
  const marks = [...host.querySelectorAll('[data-testid="tutorial-handoff-preview-mark"]')];
  expect(marks).toHaveLength(4);
  for (const mark of marks) {
    const y = Number(/translate\([^ ]+ ([^)]+)\)/.exec(mark.getAttribute("transform")!)![1]);
    expect(y).toBeGreaterThanOrEqual(Number(mark.firstElementChild!.getAttribute("r")));
  }
  const labelY = Number(host.querySelector('[data-testid="tutorial-handoff-edge-label"]')!.getAttribute("y"));
  for (const node of host.querySelectorAll('[data-testid="tutorial-handoff-preview-node"]')) {
    const y = Number(/translate\([^ ]+ ([^)]+)\)/.exec(node.getAttribute("transform")!)![1]);
    expect(labelY - 11).toBeGreaterThan(y + 44);
  }
});

it.each(["Stay", "Escape", "Scrim"])(
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
      else if (how === "Scrim") host.querySelector<HTMLElement>('[data-testid="tutorial-handoff-scrim"]')!.click();
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

it.each([false, true])("shows the %s end state with a single header seal", async (whole) => {
  const other = { ...mobileApi, id: "another-chapter", track: "blocks" as const };
  const completed = { version: mobileApi.version, step: mobileApi.steps.length, completed: true };
  const progress = { progress: { [mobileApi.id]: completed, ...(whole ? { [other.id]: completed } : {}) } };
  await act(() =>
    root.render(<FinishHandoff tutorial={mobileApi} catalog={[mobileApi, other]} before={{}} progress={progress} />),
  );
  expect(host.querySelector('[data-testid="tutorial-handoff-heading"]')?.textContent).toBe(
    whole ? "You've finished the syllabus" : "Chapter I complete",
  );
  expect(host.querySelectorAll('[data-testid^="tutorial-handoff-seal-"]')).toHaveLength(1);
  expect(
    host.querySelector(`[data-testid="tutorial-handoff-seal-${whole ? "whole-syllabus" : chapters.basics.seal}"]`),
  ).not.toBeNull();
  expect(host.querySelector('[data-testid="tutorial-next"]') === null).toBe(whole);
});

it("reads the recap once before next-lesson detail, with heading focus and no live duplication", async () => {
  const next = { ...mobileApi, id: "next" };
  await act(() =>
    root.render(<FinishHandoff tutorial={mobileApi} catalog={[mobileApi, next]} before={{}} progress={{}} />),
  );
  const recap = host.querySelector('[data-testid="tutorial-handoff-recap"]')!;
  const detail = host.querySelector('[data-testid="tutorial-handoff-next"]')!;
  expect(recap.textContent).toBe(mobileApi.finish.text());
  expect(recap.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(host.textContent!.split(mobileApi.finish.text())).toHaveLength(2);
  expect(document.activeElement).toBe(host.querySelector('[data-testid="tutorial-handoff-heading"]'));
});

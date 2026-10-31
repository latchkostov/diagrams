import type { Page } from "@playwright/test";
import {
  test,
  expect,
  expectNoErrors,
  waitForCameraIdle,
  waitForSelectionSettled,
  waitForLiveSession,
  pageLoadTimeout,
  animationFrames,
} from "./fixtures";
import { type ResolvedKeyboardStep } from "../../src/tutorials/keyboard";
import { chooseNativeSelect } from "./native-select";
import { CATCH_UP_MS } from "../../src/live/frameClock";

export class CompletedStep extends Error {}

/** Every operation below sends real keys. Locator reads choose a route; none moves focus or invokes an action. */
async function write(page: Page, text: string) {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

async function chooseRow(page: Page, id: string) {
  const row = page.getByTestId(id);
  await expect(row).toBeVisible();
  const seen = new Set<string>();
  while ((await row.getAttribute("data-active")) !== "true") {
    const active = await page.getByTestId(/^(command-item-|context-menu-item-)/).evaluateAll((items) =>
      items
        .filter((item) => item.getAttribute("data-active") === "true")
        .map((item) => item.getAttribute("data-testid"))
        .join(),
    );
    if (seen.has(active)) throw new Error(`Keyboard row is unreachable: ${id} (${active})`);
    seen.add(active);
    await page.keyboard.press("ArrowDown");
  }
}

export async function command(page: Page, id: string, query: string) {
  if (await page.evaluate(() => window.__tutorial?.snapshot().state.value === "finished")) throw new CompletedStep();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-input")).toBeFocused();
  await write(page, query);
  await chooseRow(page, `command-item-${id}`);
  await page.keyboard.press("Enter");
}

export async function node(page: Page, id: string) {
  await command(page, `node:${id}`, `@ ${id}`);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__tutorial?.snapshot().state.value === "finished")) ||
        (await page
          .getByTestId(`node-${id}`)
          .evaluate(
            (el, id) => document.activeElement?.getAttribute("data-id") === id && document.activeElement.contains(el),
            id,
          )),
    )
    .toBe(true);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "idle");
  await waitForCameraIdle(page);
  // Finishing during the camera reveal moves focus to the handoff, so navigation is done.
  if (await page.evaluate(() => window.__tutorial?.snapshot().state.value === "finished")) throw new CompletedStep();
}

export async function edge(page: Page, id: string) {
  const from = await page.evaluate((id) => window.__tutorial?.diagram().edges.find((edge) => edge.id === id)?.from, id);
  if (!from) throw new Error(`Missing keyboard edge ${id}`);
  await node(page, from);
  const target = page.getByTestId(`edge-${id}`);
  const count = await page.evaluate(() => window.__tutorial?.diagram().edges.length ?? 0);
  const state = () =>
    page.evaluate(() => ({
      finished: window.__tutorial?.snapshot().state.value === "finished",
      id: document.activeElement?.getAttribute("data-id"),
    }));
  for (let i = 0; i < count; i++) {
    const before = await state();
    if (before.finished) throw new CompletedStep();
    // eslint-disable-next-line no-restricted-syntax -- canvas connection navigation is literal Ctrl on every platform
    await page.keyboard.press("Control+Alt+]");
    let finished = false;
    await expect
      .poll(async () => {
        const next = await state();
        finished = next.finished;
        return finished || next.id !== before.id;
      })
      .toBe(true);
    if (finished) throw new CompletedStep();
    // Focus settles on a frame after the selection; the camera's idle state includes that reveal.
    await waitForCameraIdle(page);
    if ((await state()).finished) throw new CompletedStep();
    if (
      await target.evaluate(
        (el, id) => document.activeElement?.getAttribute("data-id") === id && document.activeElement.contains(el),
        id,
      )
    )
      return;
  }
  throw new Error(`Keyboard could not reach edge ${id}`);
}

export async function waitForScheduledNote(page: Page) {
  await expect
    .poll(
      async () => {
        if (await page.getByTestId("live-note-continue").isVisible()) return true;
        await page.clock.fastForward(CATCH_UP_MS);
        return page.getByTestId("live-note-continue").isVisible();
      },
      { intervals: [0] },
    )
    .toBe(true);
}

export async function focus(page: Page, id: string) {
  if (id.startsWith("node-")) return node(page, id.slice(5));
  if (id.startsWith("edge-label-")) return edge(page, id.slice(11));
  if (id.startsWith("edge-")) return edge(page, id.slice(5));
  if (id.startsWith("command-item-") || id.startsWith("context-menu-item-")) return chooseRow(page, id);
  if (id === "live-note-continue") await waitForScheduledNote(page);
  if (id.startsWith("inspector-") && (await page.evaluate(() => !!document.activeElement?.getAttribute("data-id")))) {
    await page.keyboard.press("F2");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBeNull();
  }
  const target = page.getByTestId(id);
  await expect(target).toBeVisible();
  const backwards = await target.evaluate((el) => {
    const stops = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).filter(
      (stop) =>
        !stop.hasAttribute("disabled") &&
        stop.getClientRects().length &&
        (stop.tabIndex >= 0 || /^(rf__node-|node-live-focus-)/.test(stop.dataset.testid ?? "")),
    );
    const destination = stops.findIndex((stop) => stop === el || stop.contains(el) || el.contains(stop));
    let active = document.activeElement;
    for (let parent = active; parent; parent = parent.parentElement) {
      if (!parent.hasAttribute("data-live-readout")) continue;
      active = stops.find((stop) => stop.getAttribute("data-id") === parent.getAttribute("data-item")) ?? active;
      break;
    }
    const current = stops.findIndex((stop) => stop === active || stop.contains(active));
    if (destination < 0) return !!active && !!(el.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING);
    const forward = current < 0 ? destination + 1 : (destination - current + stops.length) % stops.length;
    const backward = current < 0 ? stops.length - destination : (current - destination + stops.length) % stops.length;
    return backward < forward;
  });
  const seen = new Set<string>();
  const limit = await page.getByTestId(/./).count();
  let moves = 0;
  const readState = (settle = false) =>
    target.evaluate(async (el, settle) => {
      // Keep the two settling frames in the same round trip as the focus observation.
      if (settle)
        for (let frame = 0; frame < 2; frame++)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const active = document.activeElement;
      let reading: string | null = null;
      for (let parent = active; parent; parent = parent.parentElement) {
        if (!parent.hasAttribute("data-live-readout")) continue;
        reading = parent.contains(el) ? null : parent.getAttribute("data-testid");
        break;
      }
      let roving = false;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (
          ["toolbar", "tablist", "menu", "radiogroup"].includes(parent.getAttribute("role") ?? "") ||
          parent.hasAttribute("data-live-readout")
        ) {
          const nativeMenu =
            parent.getAttribute("role") === "menu" &&
            Array.from(parent.children).filter((child) => child instanceof HTMLElement && child.tabIndex >= 0).length >
              1;
          roving = !!active && parent.contains(active) && !nativeMenu;
          break;
        }
      }
      return {
        focused: el === active || el.contains(active) || (active instanceof HTMLButtonElement && active.contains(el)),
        completed: ["completing", "finished"].includes(window.__tutorial?.snapshot().state.value ?? ""),
        reading,
        active: active?.getAttribute("data-testid") ?? `${active?.tagName ?? "none"}:${document.hasFocus()}`,
        roving,
      };
    }, settle);
  let state = await readState();
  for (;;) {
    if (state.focused) return;
    if (state.completed) throw new CompletedStep();
    if (state.reading) {
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(state.reading)).toHaveCount(0);
      seen.clear();
      state = await readState();
      continue;
    }
    const body = state.active.startsWith("BODY:");
    if (++moves > limit || (!body && seen.has(state.active)))
      throw new Error(`Keyboard control is unreachable: ${id} (${[...seen].join(" → ")})`);
    // Native Tab traversal can cross more than one browser-chrome stop while activeElement stays body.
    if (!body) seen.add(state.active);
    const previous = state.active;
    const roving = state.roving;
    await page.keyboard.press(state.roving ? "ArrowDown" : backwards ? "Shift+Tab" : "Tab");
    // Roving focus and portal teardown can cross body before the destination lands on the next frame.
    if (body) state = await readState(true);
    else
      await expect
        .poll(async () => {
          state = await readState(roving);
          return state.active;
        })
        .not.toBe(previous);
  }
}

export async function activate(page: Page, id: string) {
  if (id.startsWith("node-") || id.startsWith("edge-")) return focus(page, id);
  if (id === "canvas-pane") {
    await page.keyboard.press("Escape");
    return;
  }
  await focus(page, id);
  if (id.startsWith("command-item-") || id.startsWith("context-menu-item-")) {
    await page.keyboard.press("Enter");
    return;
  }
  const input = await page.evaluate(() => {
    const el = document.activeElement;
    return el instanceof HTMLInputElement
      ? el.type
      : el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)
        ? "text"
        : null;
  });
  if (input && !["checkbox", "radio", "button", "submit"].includes(input)) return;
  await page.keyboard.press(input === "checkbox" || input === "radio" ? "Space" : "Enter");
}

async function menuItem(page: Page, id: string) {
  await chooseRow(page, `context-menu-item-${id}`);
  await page.keyboard.press("Enter");
}

export async function play(page: Page, action: ResolvedKeyboardStep) {
  if ("close" in action) {
    const close = page.getByTestId(action.close);
    if (await close.isVisible()) {
      await page.keyboard.press("Escape");
      await expect(close).toHaveCount(0);
    }
    return;
  }
  if ("playing" in action) {
    const control = page.getByTestId("live-play");
    const state = await control.getAttribute("data-state");
    const playing = state === "slowmo" ? (await control.getAttribute("data-playing")) === "1" : state === "playing";
    if (state !== "waiting" && playing !== action.playing) {
      const nativeControl = await page.evaluate(() =>
        ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"].includes(document.activeElement?.tagName ?? ""),
      );
      if (state === "slowmo" && !nativeControl) await page.keyboard.press("Space");
      else await activate(page, "live-play");
    }
    return;
  }
  if ("history" in action) {
    const current = await page.getByTestId("tutorial-step").getAttribute("data-step");
    for (
      let edits = 0;
      edits < 3 && (await page.getByTestId("tutorial-step").getAttribute("data-step")) === current;
      edits++
    ) {
      const before = await page.evaluate(() => JSON.stringify(window.__tutorial?.diagram()));
      await activate(page, `${action.history}-button`);
      await expect.poll(() => page.evaluate(() => JSON.stringify(window.__tutorial?.diagram()))).not.toBe(before);
      await waitForSelectionSettled(page);
    }
    return;
  }
  if ("importFixture" in action) {
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("ControlOrMeta+o");
    await (await chooser).setFiles("public/tutorial-status-compose.yaml");
    return;
  }
  if ("activate" in action) return activate(page, action.activate);
  if ("focus" in action) return focus(page, action.focus);
  if ("read" in action) {
    const step = await page.getByTestId("tutorial-step").getAttribute("data-step");
    // Esc on an earlier pinned card restores focus to that card's owner. Close it
    // before navigating, or clearing the new selection can send Enter to the old node.
    const pinned = await page.getByTestId(/^(node|edge)-detail-/).evaluateAll((cards) =>
      cards
        .filter((card) => card.getAttribute("data-pinned") === "true")
        .map((card) => card.getAttribute("data-testid"))
        .filter((id) => id !== null),
    );
    for (const id of pinned) {
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(id)).toHaveCount(0);
    }
    await focus(page, action.read);
    if ((await page.getByTestId("tutorial-step").getAttribute("data-step")) !== step) return;
    const card = page.getByTestId(action.read.replace(/^(node|edge)-/, "$1-detail-"));
    if (await card.isVisible()) {
      await page.keyboard.press("Tab");
      await expect(card).toBeFocused();
      await page.keyboard.press("Enter");
    } else {
      // Enter on an unselected canvas item pins its readout. Escape keeps focus on that item.
      while (await page.evaluate(() => !!window.__tutorial?.snapshot().selected.length)) {
        await page.keyboard.press("Escape");
        await animationFrames(page);
      }
      await page.keyboard.press("Enter");
    }
    await expect
      .poll(
        async () =>
          (await card.isVisible()) || (await page.getByTestId("tutorial-step").getAttribute("data-step")) !== step,
      )
      .toBe(true);
    return;
  }
  if ("menu" in action) {
    await focus(page, action.menu);
    await page.keyboard.press("ArrowRight");
  } else if ("open" in action) {
    const open = await page
      .getByTestId(action.open)
      .evaluate((el) =>
        el instanceof HTMLDetailsElement
          ? el.open
          : el.parentElement instanceof HTMLDetailsElement
            ? el.parentElement.open
            : el.getAttribute("aria-expanded") !== "false",
      );
    if (!open) await activate(page, action.open);
  } else if ("write" in action) {
    await focus(page, action.write);
    await write(page, action.text);
  } else if ("choose" in action) {
    await focus(page, action.choose);
    await chooseNativeSelect(page, action.choose, action.value);
    await expect(page.getByTestId(action.choose)).toHaveValue(
      action.choose === "sim-panel-add-step" || /^sim-panel-step-\d+-focus$/.test(action.choose) ? "" : action.value,
    );
  } else if ("connect" in action) {
    const from = action.connect.slice(5),
      to = action.to.slice(5);
    await node(page, from);
    await page.keyboard.press("Shift+F10");
    await menuItem(page, "node.connect");
    await menuItem(page, `connect:${to}`);
    if (action.side || action.fromSide) {
      const id = await page.evaluate(
        ({ from, to }) => window.__tutorial?.diagram().edges.find((edge) => edge.from === from && edge.to === to)?.id,
        { from, to },
      );
      if (!id) throw new Error("Keyboard connection did not commit");
      for (const [end, side] of [
        ["from", action.fromSide],
        ["to", action.side],
      ] as const) {
        if (!side) continue;
        await edge(page, id);
        await page.keyboard.press("Shift+F10");
        await menuItem(page, "edge.route");
        await menuItem(page, `edge.${end}-side`);
        await menuItem(page, `edge.${end}-side:${side}`);
      }
    }
  } else if ("reconnect" in action) {
    await edge(page, action.reconnect.slice(5));
    await page.keyboard.press("Shift+F10");
    await menuItem(page, "edge.reconnect");
    await menuItem(page, "edge.reconnect:to");
    await menuItem(page, `reconnect-target:${action.to.slice(5)}`);
  } else if ("command" in action) await command(page, action.command, action.query);
  else if ("type" in action) {
    if (action.into) await expect(page.getByTestId(action.into)).toBeFocused();
    await page.keyboard.insertText(action.type);
  } else {
    await waitForCameraIdle(page);
    if (action.press === "ControlOrMeta+d")
      await expect.poll(() => page.evaluate(() => window.__historyProbe?.().pending)).toBe(false);
    await page.keyboard.press(action.press);
    if (action.press === "Escape") {
      await animationFrames(page);
      if (await page.evaluate(() => window.__tutorial?.snapshot().state.value === "finished"))
        throw new CompletedStep();
    }
  }
}

export async function runKeyboardTutorial(page: Page, consoleErrors: string[], id: string) {
  if (id === "import-and-review")
    await page.addInitScript(() =>
      Object.defineProperty(window, "showOpenFilePicker", { value: undefined, configurable: true }),
    );
  test.slow();
  // Any accidental pointer operation in this driver fails the test at the call site.
  for (const operation of ["click", "dblclick", "move", "down", "up"] as const)
    page.mouse[operation] = (() => {
      throw new Error("A keyboard solution used the pointer");
    }) as (typeof page.mouse)[typeof operation];
  await page.clock.install();
  await page.goto(`./?tutorial=${id}`);
  await expect(page.getByTestId("tutorial-start")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  if (id === "capacity") await waitForLiveSession(page);
  await expect(page.getByTestId("tutorial-start")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
  const seen = new Set<string>();
  for (;;) {
    const current = await page.evaluate(() => {
      const runner = window.__tutorial;
      if (!runner) throw new Error("Missing tutorial runner");
      const state = runner.snapshot().state;
      return {
        phase: state.value,
        id: state.stepIds[state.index],
        actions: state.value === "completing" ? [] : runner.keyboardSolution(),
      };
    });
    if (current.phase === "finished") break;
    expect(["active", "hinting", "completing"]).toContain(current.phase);
    expect(seen.has(current.id), `${id}/${current.id} came back`).toBe(false);
    seen.add(current.id);
    try {
      for (const action of current.actions) await play(page, action);
    } catch (error) {
      // A real completion can land while focus travels to an optional speed/readout control.
      if (!(error instanceof CompletedStep)) throw error;
    }
    await expect(page.getByTestId("tutorial-step")).not.toHaveAttribute("data-step", current.id, { timeout: 20_000 });
  }
  await expect(page.getByTestId("tutorial-finished")).toBeVisible();
  if (id === "trace-slowmo") await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
  expectNoErrors(consoleErrors);
}

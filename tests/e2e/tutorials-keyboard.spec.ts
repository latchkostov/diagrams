import type { Page } from "@playwright/test";
import {
  test,
  expect,
  expectNoErrors,
  waitForCameraIdle,
  waitForLiveSession,
  pageLoadTimeout,
  animationFrames,
} from "./fixtures";
import { tutorialEntries } from "../../src/tutorials/catalog/ids";
import { keyboardExceptions, type ResolvedKeyboardStep } from "../../src/tutorials/keyboard";

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

async function command(page: Page, id: string, query: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("command-input")).toBeFocused();
  await write(page, query);
  await chooseRow(page, `command-item-${id}`);
  await page.keyboard.press("Enter");
}

async function node(page: Page, id: string) {
  await command(page, `node:${id}`, `@ ${id}`);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__tutorial?.snapshot().state.value === "finished")) ||
        (await page.getByTestId(`node-${id}`).evaluate((el) => !!document.activeElement?.contains(el))),
    )
    .toBe(true);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "idle");
  await waitForCameraIdle(page);
}

async function edge(page: Page, id: string) {
  const from = await page.evaluate((id) => window.__tutorial?.diagram().edges.find((edge) => edge.id === id)?.from, id);
  if (!from) throw new Error(`Missing keyboard edge ${id}`);
  await node(page, from);
  const target = page.getByTestId(`edge-${id}`);
  const count = await page.evaluate(() => window.__tutorial?.diagram().edges.length ?? 0);
  for (let i = 0; i < count; i++) {
    const before = await page.evaluate(() => document.activeElement?.getAttribute("data-id"));
    // eslint-disable-next-line no-restricted-syntax -- canvas connection navigation is literal Ctrl on every platform
    await page.keyboard.press("Control+Alt+]");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-id"))).not.toBe(before);
    // Focus settles on a frame after the selection; the camera's idle state includes that reveal.
    await waitForCameraIdle(page);
    if (await target.evaluate((el) => !!document.activeElement?.contains(el))) return;
  }
  throw new Error(`Keyboard could not reach edge ${id}`);
}

async function focus(page: Page, id: string) {
  if (id.startsWith("node-")) return node(page, id.slice(5));
  if (id.startsWith("edge-label-")) return edge(page, id.slice(11));
  if (id.startsWith("edge-")) return edge(page, id.slice(5));
  if (id.startsWith("command-item-") || id.startsWith("context-menu-item-")) return chooseRow(page, id);
  if (id.startsWith("inspector-") && (await page.evaluate(() => !!document.activeElement?.getAttribute("data-id")))) {
    await page.keyboard.press("F2");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBeNull();
  }
  const target = page.getByTestId(id);
  await expect(target).toBeVisible();
  const backwards = await target.evaluate(
    (el) =>
      !!document.activeElement &&
      !!(el.compareDocumentPosition(document.activeElement) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  const seen = new Set<string>();
  while (
    !(await target.evaluate(
      (el) =>
        el === document.activeElement ||
        el.contains(document.activeElement) ||
        (document.activeElement instanceof HTMLButtonElement && document.activeElement.contains(el)),
    ))
  ) {
    const reading = await target.evaluate((el) => {
      let parent = document.activeElement;
      while (parent) {
        if (parent.hasAttribute("data-live-readout"))
          return parent.contains(el) ? null : parent.getAttribute("data-testid");
        parent = parent.parentElement;
      }
      return null;
    });
    if (reading) {
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(reading)).toHaveCount(0);
      seen.clear();
      continue;
    }
    const active = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.getAttribute("data-testid") ?? el?.outerHTML ?? "none";
    });
    if (seen.has(active)) throw new Error(`Keyboard control is unreachable: ${id} (${[...seen].join(" → ")})`);
    seen.add(active);
    const roving = await target.evaluate((el) => {
      let parent = el.parentElement;
      while (parent) {
        if (
          ["toolbar", "tablist", "menu", "radiogroup"].includes(parent.getAttribute("role") ?? "") ||
          parent.hasAttribute("data-live-readout")
        )
          return parent.contains(document.activeElement);
        parent = parent.parentElement;
      }
      return false;
    });
    await page.keyboard.press(roving ? "ArrowDown" : backwards ? "Shift+Tab" : "Tab");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.activeElement;
          return el?.getAttribute("data-testid") ?? el?.outerHTML ?? "none";
        }),
      )
      .not.toBe(active);
  }
}

async function activate(page: Page, id: string) {
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

async function play(page: Page, action: ResolvedKeyboardStep) {
  if ("activate" in action) return activate(page, action.activate);
  if ("focus" in action) return focus(page, action.focus);
  if ("read" in action) {
    const step = await page.getByTestId("tutorial-step").getAttribute("data-step");
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
    const values = await page.getByTestId(action.choose).evaluate((el) =>
      Array.from((el as HTMLSelectElement).options)
        .filter((option) => !option.disabled)
        .map((option) => option.value),
    );
    const index = values.indexOf(action.value);
    expect(index).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Alt+ArrowDown");
    await page.keyboard.press("Home");
    for (let i = 0; i < index; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(action.choose)).toHaveValue(
      action.choose === "sim-panel-add-step" ? "" : action.value,
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
    await page.keyboard.press(action.press);
  }
}

for (const { id } of tutorialEntries.filter((entry) => !keyboardExceptions[entry.id])) {
  test(`${id}: keyboard solution plays through the real UI`, async ({ page, consoleErrors }) => {
    test.slow();
    // Any accidental pointer operation in this driver fails the test at the call site.
    for (const operation of ["click", "dblclick", "move", "down", "up"] as const)
      page.mouse[operation] = (() => {
        throw new Error("A keyboard solution used the pointer");
      }) as (typeof page.mouse)[typeof operation];
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
      for (const action of current.actions) await play(page, action);
      await expect(page.getByTestId("tutorial-step")).not.toHaveAttribute("data-step", current.id, { timeout: 20_000 });
    }
    await expect(page.getByTestId("tutorial-finished")).toBeVisible();
    expectNoErrors(consoleErrors);
  });
}

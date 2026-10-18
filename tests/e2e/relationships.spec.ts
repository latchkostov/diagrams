import { TEXT_END } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLab, expectNoErrors, gotoLive } from "./fixtures";
import { RELATION_GLYPHS } from "../../src/components/relationGlyphs";
import { interactionJournalMark, interactionLog } from "./fixtures";

/**
 * Relationships (docs/research/diagram-semantics.md): dependencies are dotted, carry a glyph and no
 * traffic. Uses the public example src/examples/aks-app-config-key-vault.json. Selectors are
 * data-testid only (axe's include takes CSS, so it uses a [data-testid] attribute selector).
 */
const SLUG = "aks-app-config-key-vault";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Expected a visible element");
  return b;
}

async function expectNoViolations(page: Page, scope?: string) {
  let axe = new AxeBuilder({ page }).withTags(WCAG);
  // Focus arrives before the menu's fade finishes. Audit the painted colours,
  // rather than a transient partially transparent frame on a faster machine.
  if (scope) await expect(page.getByTestId(scope)).toHaveCSS("opacity", "1");
  if (scope) axe = axe.include(`[data-testid="${scope}"]`);
  const { violations } = await axe.analyze();
  const report = violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
  expect(report, report.join("\n")).toEqual([]);
}

/** Drags from one node's handle to another's, the way people draw an edge. */
async function drawEdge(page: Page, from: string, to: string) {
  const a = await box(page.getByTestId(from));
  const b = await box(page.getByTestId(to));
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}

/** The live decorator's state for an edge ("active" while messages travel it). */
const liveState = (page: Page, id: string) =>
  page.getByTestId(`edge-${id}`).evaluate((el) => el.parentElement?.getAttribute("data-live-edge") ?? null);

test.describe("relationships", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-api")).toBeVisible();
  });

  test("relationship dropdown exposes the selected value to screen readers", async ({ page }) => {
    await page.getByTestId("edge-label-api-to-sb").click();
    const trigger = page.getByTestId("inspector-field-relation");
    await expect(trigger).toHaveAccessibleName("Relationship");
    await expect(trigger).toHaveAccessibleDescription("Message");
    await trigger.click();
    await menuItem(page, "secret").click();
    await expect(trigger).toHaveAccessibleDescription("Secret");
  });

  test("relationship dropdown supports keyboard selection and cancellation", async ({ page, consoleErrors }) => {
    await page.getByTestId("edge-label-api-to-sb").click();
    const trigger = page.getByTestId("inspector-field-relation");
    const menu = page.getByTestId("inspector-field-relation-menu");
    const edge = page.getByTestId("edge-api-to-sb");
    await trigger.focus();
    await trigger.press("ArrowDown");
    await expect(menu).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toHaveAttribute("role", "menu");
    const menuId = await menu.getAttribute("id");
    if (!menuId) throw new Error("The relationship menu must have an ID");
    await expect(trigger).toHaveAttribute("aria-controls", menuId);
    await expect(menuItem(page, "message")).toHaveAttribute("aria-checked", "true");
    await menu.press("ArrowDown");
    await expect(menuItem(page, "message")).toHaveAttribute("data-active", "true");
    await menu.press("ArrowDown");
    await expect(menuItem(page, "request")).toHaveAttribute("data-active", "true");
    await menu.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleDescription("Request");
    await expect(edge).toHaveAttribute("class", /fe-sync/);
    await trigger.press("Enter");
    await expect(menu).toBeFocused();
    await menu.press("End");
    await expect(menuItem(page, "depends")).toHaveAttribute("data-active", "true");
    await menu.press("ArrowUp");
    await expect(menuItem(page, "deploy")).toHaveAttribute("data-active", "true");
    await expectNoViolations(page, "inspector-field-relation-menu");
    await menu.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).not.toHaveAttribute("aria-controls");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleDescription("Request");
    await expect(edge).toHaveAttribute("class", /fe-sync/);
    await expect(edge).not.toHaveAttribute("data-relation", /.+/);
    expectNoErrors(consoleErrors);
  });

  test("relationship dropdown trigger toggles closed and outside clicks keep their focus", async ({ page }) => {
    await page.getByTestId("edge-label-api-to-sb").click();
    const trigger = page.getByTestId("inspector-field-relation");
    const menu = page.getByTestId("inspector-field-relation-menu");
    await trigger.click();
    await expect(menu).toBeFocused();
    await trigger.click();
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(menu).toBeVisible();
    const label = page.getByTestId("inspector-field-label");
    await label.click();
    await expect(menu).toHaveCount(0);
    await expect(label).toBeFocused();
  });

  test("relationship dropdown renders matching trigger and option glyphs", async ({ page }) => {
    await page.getByTestId("edge-label-api-to-sb").click();
    const trigger = page.getByTestId("inspector-field-relation");
    const triggerIcon = page.getByTestId("inspector-field-relation-icon");
    const glyph = (icon: Locator) => icon.evaluate((el) => el.firstElementChild?.firstElementChild?.getAttribute("d"));
    await expect.poll(() => glyph(triggerIcon)).toBe(RELATION_GLYPHS["rel-message"]);
    await trigger.click();
    for (const choice of [
      "message",
      "request",
      "config",
      "secret",
      "identity",
      "telemetry",
      "deploy",
      "depends",
    ] as const)
      await expect
        .poll(() => glyph(page.getByTestId(`context-menu-icon-${choice}`)))
        .toBe(RELATION_GLYPHS[`rel-${choice}`]);
    await menuItem(page, "secret").click();
    await expect.poll(() => glyph(triggerIcon)).toBe(RELATION_GLYPHS["rel-secret"]);
    await trigger.click();
    await menuItem(page, "request").click();
    await expect.poll(() => glyph(triggerIcon)).toBe(RELATION_GLYPHS["rel-request"]);
  });

  test("the example draws dependencies dotted, with glyphs and derived labels", async ({ page, consoleErrors }) => {
    await expect(page.getByTestId("edge-api-to-appcfg")).toHaveAttribute("data-relation", "config");
    await expect(page.getByTestId("edge-label-api-to-appcfg")).toContainText("4 settings · 2 secret");
    await expect(page.getByTestId("edge-label-appcfg-to-kv")).toContainText("2 references");
    await expect(page.getByTestId("edge-glyph-api-to-ai")).toBeVisible();
    // No default text: telemetry has only its glyph chip.
    await expect(page.getByTestId("edge-label-api-to-ai")).toHaveText("");
    // Flows are unchanged.
    await expect(page.getByTestId("edge-fd-to-api")).toHaveAttribute("class", /fe-sync/);
    await expect(page.getByTestId("edge-glyph-fd-to-api")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("immediate Make it a flow undoes to the inferred dependency", async ({ page, consoleErrors }) => {
    await page.clock.install();
    // Pause relative to the page's own clock: the runner's Date can lag the page and pauseAt can't go back.
    const pageNow = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(pageNow + 1000);
    await drawEdge(page, "handle-notify-bottom", "handle-kv-right");
    const edge = page.getByTestId("edge-e-1");
    await expect(edge).toHaveAttribute("data-relation", "secret");
    await expect(page.getByTestId("edge-glyph-e-1")).toBeVisible();
    await expect(page.getByTestId("toast")).toContainText("Secret dependency: no messages flow here");
    // Frozen clock: conversion happens before the 350 ms history debounce.
    await page.getByTestId("toast-make-flow").click();
    await expect(edge).not.toHaveAttribute("data-relation", /.+/);
    await expect(edge).toHaveAttribute("class", /fe-async/);
    await expect(page.getByTestId("edge-glyph-e-1")).toHaveCount(0);
    // Undo brings the inferred secret back (Make it a flow was its own step).
    await page.getByTestId("canvas-wrap").click({ position: { x: 600, y: 90 } });
    await page.keyboard.press("ControlOrMeta+z");
    await expect(edge).toHaveAttribute("data-relation", "secret");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(edge).not.toHaveAttribute("data-relation", /.+/);
    expectNoErrors(consoleErrors);
  });

  test("Relationship ▸ replaces Make sync / async; dependencies hide flow-only rows", async ({
    page,
    consoleErrors,
  }) => {
    // A flow: Relationship, Dead-letter path and consumer group are there; the old toggle is gone.
    await page.getByTestId("edge-label-api-to-sb").click({ button: "right" });
    await expect(menuItem(page, "edge.relationship")).toBeVisible();
    await expect(menuItem(page, "edge.toggle-kind")).toHaveCount(0);
    await expect(menuItem(page, "edge.toggle-dlq")).toBeVisible();
    const flowRows = await page
      .getByTestId("context-menu")
      .getByTestId(/^context-menu-item-/)
      .count();
    expect(flowRows).toBeLessThanOrEqual(12);
    await menuItem(page, "edge.relationship").click();
    await expect(menuItem(page, "relation:message")).toHaveAttribute("aria-checked", "true");
    for (const r of ["request", "config", "secret", "identity", "telemetry", "deploy", "depends"])
      await expect(menuItem(page, `relation:${r}`)).toBeVisible();
    await expectNoViolations(page, "context-menu");
    await menuItem(page, "relation:depends").click();
    await expect(page.getByTestId("edge-api-to-sb")).toHaveAttribute("data-relation", "depends");
    // Its label keeps the user's words and leads with the glyph.
    await expect(page.getByTestId("edge-label-api-to-sb")).toContainText("OrderCreated");
    await expect(page.getByTestId("edge-glyph-api-to-sb")).toBeVisible();

    // A dependency's menu is shorter: no dead-letter path or consumer group.
    await page.getByTestId("edge-label-api-to-sb").click({ button: "right" });
    await expect(menuItem(page, "edge.toggle-dlq")).toHaveCount(0);
    await expect(menuItem(page, "edge.consumer-group")).toHaveCount(0);
    const depRows = await page
      .getByTestId("context-menu")
      .getByTestId(/^context-menu-item-/)
      .count();
    expect(depRows).toBeLessThan(flowRows);
    await menuItem(page, "edge.relationship").click();
    await menuItem(page, "relation:message").click();
    await expect(page.getByTestId("edge-api-to-sb")).not.toHaveAttribute("data-relation", /.+/);
    await expect(page.getByTestId("edge-api-to-sb")).toHaveAttribute("class", /fe-async/);

    // The inspector offers the same eight choices.
    await page.getByTestId("edge-label-api-to-sb").click();
    await page.getByTestId("inspector-field-relation").click();
    await menuItem(page, "telemetry").click();
    await expect(page.getByTestId("edge-api-to-sb")).toHaveAttribute("data-relation", "telemetry");
    await expect(page.getByTestId("inspector-field-group")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("Ctrl+K sets the relationship of the selected edge", async ({ page, consoleErrors }) => {
    await page.getByTestId("edge-label-api-to-sb").click();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-input").fill("relationship secret");
    await expect(page.getByTestId("command-item-action:relation:secret")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("edge-api-to-sb")).toHaveAttribute("data-relation", "secret");
    expectNoErrors(consoleErrors);
  });

  test("Show ▸ Dependencies hides them, leaves glyph pips on nodes, and is remembered", async ({
    page,
    consoleErrors,
  }) => {
    await expect(page.getByTestId("node-pips-api")).toHaveCount(0);
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 600, y: 90 } });
    await menuItem(page, "canvas.view-options").click();
    await expect(menuItem(page, "view:dependencies")).toHaveAttribute("aria-checked", "true");
    await menuItem(page, "view:dependencies").click();
    await expect(page.getByTestId("edge-api-to-appcfg")).toHaveCount(0);
    await expect(page.getByTestId("edge-label-appcfg-to-kv")).toHaveCount(0);
    await expect(page.getByTestId("edge-fd-to-api")).toBeAttached();
    const pips = page.getByTestId("node-pips-api");
    await expect(pips).toBeVisible();
    await expect(pips).toHaveAttribute("data-count", "3");
    for (const r of ["config", "identity", "telemetry"])
      await expect(page.getByTestId(`node-pip-api-${r}`)).toBeVisible();
    await expect(page.getByTestId("node-pips-appcfg")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("node-pips-api")).toBeVisible();
    await expect(page.getByTestId("edge-api-to-appcfg")).toHaveCount(0);

    // The View menu has the same setting.
    await page.getByTestId("view-button").click();
    await page.getByTestId("dependencies-toggle").click();
    await expect(page.getByTestId("edge-api-to-appcfg")).toBeAttached();
    await expect(page.getByTestId("node-pips-api")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  for (const action of ["edit", "delete"] as const)
    test(`Undo ${action} while Dependencies are hidden finishes focus recovery`, async ({ page, consoleErrors }) => {
      const label = page.getByTestId("edge-label-api-to-appcfg");
      const originalLabel = await label.textContent();
      if (originalLabel === null) throw new Error("Expected the original dependency label");
      await label.click();
      if (action === "edit") {
        await page.getByTestId("inspector-field-label").fill("Configuration lookup");
        await page.getByTestId("inspector-field-label").press("Enter");
        await expect(label).toContainText("Configuration lookup");
      } else {
        await page.getByTestId("canvas-wrap").focus();
        await page.keyboard.press("Delete");
        await expect(page.getByTestId("edge-api-to-appcfg")).toHaveCount(0);
      }
      await page.getByTestId("view-button").click();
      await page.getByTestId("dependencies-toggle").click();
      await expect(page.getByTestId("edge-api-to-appcfg")).toHaveCount(0);
      const wrap = page.getByTestId("canvas-wrap");
      await wrap.focus();
      const mark = await interactionJournalMark(page);
      await page.keyboard.press("ControlOrMeta+z");
      await expect
        .poll(() => interactionLog(page, mark))
        .toEqual(
          expect.arrayContaining([
            "selection.changed:undo -> focus:selection@measured",
            "fallback: focus:selection@measured",
          ]),
        );
      await expect(wrap).toHaveAttribute("data-interaction-state", "idle");
      await expect(wrap).toBeFocused();
      // It is deliberately absent, not a target still awaiting React Flow's measurement.
      await expect(page.getByTestId("edge-api-to-appcfg")).toHaveCount(0);
      await page.getByTestId("view-button").click();
      await page.getByTestId("dependencies-toggle").click();
      await expect(page.getByTestId("edge-api-to-appcfg")).toBeAttached();
      if (action === "edit") await expect(label).toHaveText(originalLabel);
      expectNoErrors(consoleErrors);
    });

  test("a config edge's settings show on hover and focus, with a lock on secrets", async ({ page, consoleErrors }) => {
    const pill = page.getByTestId("edge-label-api-to-appcfg");
    const card = page.getByTestId("edge-settings-api-to-appcfg");
    await expect(card).toHaveCount(0);
    await pill.hover();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Orders:PageSize");
    for (const [i, secret] of [
      [0, false],
      [1, false],
      [2, true],
      [3, true],
    ] as const) {
      const row = page.getByTestId(`edge-setting-api-to-appcfg-${i}`);
      if (secret) await expect(row).toHaveAttribute("data-secret", "1");
      else await expect(row).not.toHaveAttribute("data-secret", /.+/);
    }
    await expectNoViolations(page, "edge-settings-api-to-appcfg");
    await page.mouse.move(5, 500);
    await expect(card).toHaveCount(0);
    // Keyboard: the pill is focusable and shows the same card.
    await pill.focus();
    await expect(card).toBeVisible();
    await pill.blur();

    // The secret reference edge lists what it carries.
    await page.getByTestId("edge-label-appcfg-to-kv").hover();
    await expect(page.getByTestId("edge-settings-appcfg-to-kv")).toContainText("Stripe:ApiKey");
    // The card is readable at any zoom now, so at this fit it reaches over the config pill: leave it first.
    await page.mouse.move(5, 500);
    await expect(page.getByTestId("edge-settings-appcfg-to-kv")).toHaveCount(0);

    // Editing in the inspector: one more secret updates both derived labels.
    await pill.click();
    const field = page.getByTestId("inspector-field-settings");
    await expect(field).toHaveValue(/!Stripe:ApiKey/);
    await field.press(TEXT_END);
    await field.pressSequentially("\n!Payments:WebhookSecret");
    await expect(pill).toContainText("5 settings · 3 secret");
    await expect(page.getByTestId("edge-label-appcfg-to-kv")).toContainText("3 references");
    // Unlock one from the list.
    await page.getByTestId("inspector-setting-lock-4").click();
    await expect(pill).toContainText("5 settings · 2 secret");
    await expectNoViolations(page, "inspector");
    expectNoErrors(consoleErrors);
  });

  test("live view draws no traffic on dependency edges and dims them", async ({ page, consoleErrors }) => {
    await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1`);
    // Flows light up as messages travel them...
    await expect.poll(() => liveState(page, "fd-to-api"), { timeout: 10_000 }).toBe("active");
    // Observe every dependency together over rendered frames, rather than serial
    // cross-process reads and a wall-time sleep per sample.
    const active = await page.evaluate(async () => {
      const active: string[] = [];
      for (let frame = 0; frame < 20; frame++) {
        await new Promise(requestAnimationFrame);
        for (const id of ["api-to-appcfg", "appcfg-to-kv", "api-to-mi", "mi-to-entra", "api-to-ai"]) {
          const edge = document.querySelector(`[data-testid="edge-${id}"]`);
          if (!edge) throw new Error(`Missing dependency ${id}`);
          if (edge.parentElement?.getAttribute("data-live-edge") === "active") active.push(id);
        }
      }
      return active;
    });
    expect(active).toEqual([]);
    await expect
      .poll(() => page.getByTestId("edge-api-to-appcfg").evaluate((el) => Number(getComputedStyle(el).opacity)))
      .toBeLessThan(0.5);
    expectNoErrors(consoleErrors);
  });

  test("the example passes the overlap audit, glyph chips included", async ({ page }) => {
    await gotoLab(page, "overlap-audit", { diagram: SLUG });
    const summary = page.getByTestId("audit-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute("data-total", "0");
  });

  test("axe: canvas with dependencies, hint and settings editor", async ({ page }) => {
    await expectNoViolations(page);
    // A flow into a typed stencil gets a one-line hint offering the dependency.
    await page.getByTestId("edge-label-api-to-mi").click({ button: "right" });
    await menuItem(page, "edge.relationship").click();
    await menuItem(page, "relation:message").click();
    await page.getByTestId("edge-label-api-to-mi").click();
    await expect(page.getByTestId("inspector-relation-hint")).toBeVisible();
    await expectNoViolations(page, "inspector");
    await page.getByTestId("inspector-relation-hint-apply").click();
    await expect(page.getByTestId("edge-api-to-mi")).toHaveAttribute("data-relation", "identity");
    await expect(page.getByTestId("inspector-relation-hint")).toHaveCount(0);
  });
});

async function pasteSettings(page: Page, text: string) {
  const field = page.getByTestId("inspector-field-settings");
  await field.focus();
  await field.selectText();
  await field.evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    if (el.dispatchEvent(event)) {
      // Match the browser's default paste when the app doesn't intercept it.
      const field = el as HTMLTextAreaElement;
      const next = field.value.slice(0, field.selectionStart) + value + field.value.slice(field.selectionEnd);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (!setter) throw new Error("Textarea value setter missing");
      setter.call(field, next);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, text);
}

for (const theme of ["light", "dark"] as const)
  test(`settings cards are hoverable, Escape dismisses and focus restores contrast in ${theme}`, async ({
    page,
    consoleErrors,
  }) => {
    test.slow(); // Hover/focus lifecycle plus a full accessibility audit.
    await page.clock.install();
    await gotoCanvas(page, SLUG);
    if (theme === "dark") await page.getByTestId("theme-toggle").click();
    await page.getByTestId("live-toggle").click();
    await page.clock.runFor(1200);
    const pill = page.getByTestId("edge-label-api-to-appcfg");
    const card = page.getByTestId("edge-settings-api-to-appcfg");
    await pill.hover();
    await expect(card).toBeVisible();
    await card.hover();
    await expect(card).toBeVisible();
    await page.mouse.move(5, 500);
    await expect(card).toHaveCount(0);
    await pill.focus();
    await expect(card).toBeVisible();
    await expect.poll(() => pill.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await expectNoViolations(page, "edge-label-api-to-appcfg");
    await pill.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(pill).toBeFocused();
    await pill.blur();
    await pill.focus();
    await expect(card).toBeVisible();
    await pill.blur();
    await page.getByTestId("relationship-wrapper-api-to-appcfg").focus();
    await expect
      .poll(() => page.getByTestId("edge-api-to-appcfg").evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1");
    expectNoErrors(consoleErrors);
  });

test("hidden dependencies remove wrappers and expose pip lists to keyboard users in Live", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  await page.getByTestId("live-toggle").click();
  await page.getByTestId("view-button").click();
  await page.getByTestId("dependencies-toggle").click();
  await expect(page.getByTestId("relationship-wrapper-api-to-appcfg")).toHaveCount(0);
  const pips = page.getByTestId("node-pips-api");
  const list = page.getByTestId("node-dependencies-api");
  await pips.focus();
  await expect(list).toBeVisible();
  await expect(list).toContainText("Config · orders-config");
  await expect(pips).toHaveAttribute("aria-describedby", "node-dependencies-api");
  await pips.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(pips).toBeFocused();
  await pips.blur();
  await pips.focus();
  await expect(list).toBeVisible();
  await expectNoViolations(page, "node-pips-api");
  expectNoErrors(consoleErrors);
});

test("hiding the focused dependency restores canvas focus @dev", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, SLUG);
  await page.getByTestId("edge-label-api-to-appcfg").focus();
  await page.evaluate(async () => {
    const path = "/src/canvas/dependencyVisibility.ts";
    const { dependencyVisibility } = await import(/* @vite-ignore */ path);
    dependencyVisibility.set(false);
  });
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  await expect(page.getByTestId("relationship-wrapper-api-to-appcfg")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("settings paste stores names only and rejects oversized or nested JSON without changing settings", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  await page.getByTestId("edge-label-api-to-appcfg").click();
  const password = "Fake-password-7!";
  const connection = `Server=db.example;Database=orders;User Id=svc;Password=${password}`;
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlLXN2YyJ9.fake_signature_0123456789";
  const field = page.getByTestId("inspector-field-settings");
  for (const text of [
    JSON.stringify({ Password: password, ConnectionStrings: { Orders: connection }, Token: token }),
    `Password=${password}\nConnectionStrings:Orders=${connection}\nToken=${token}`,
    JSON.stringify([
      { key: "Password", value: password },
      { key: "ConnectionStrings:Orders", value: connection },
      { key: "Token", value: token },
    ]),
  ]) {
    await pasteSettings(page, text);
    await expect(field).toHaveValue("Password\nConnectionStrings:Orders\nToken");
  }
  for (const text of [
    JSON.stringify({ Password: password, Padding: "x".repeat(1_000_000) }),
    '{"nested":'.repeat(12_000) + JSON.stringify(password) + "}".repeat(12_000),
    '{"Password":"Fake-password-7!",',
  ]) {
    await pasteSettings(page, text);
    await expect(page.getByTestId("inspector-settings-error")).toBeVisible();
    await expect(field).toHaveValue("Password\nConnectionStrings:Orders\nToken");
  }
  await page.waitForTimeout(800);
  const persisted = await page.evaluate(() => Object.values(localStorage).join("\n"));
  for (const secret of [password, connection, token]) expect(persisted).not.toContain(secret);
  expectNoErrors(consoleErrors);
});

test("literal names survive editing another row and toggling locks", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await page.getByTestId("edge-label-api-to-appcfg").click();
  await pasteSettings(page, JSON.stringify({ "Feature Flag": true, "A=B": "fake", "!Literal": 1 }));
  const field = page.getByTestId("inspector-field-settings");
  await expect(field).toHaveValue('"Feature Flag"\n"A=B"\n"!Literal"');
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await field.pressSequentially("\nAdded");
  await page.getByTestId("inspector-setting-lock-0").click();
  await expect(field).toHaveValue('!"Feature Flag"\n"A=B"\n"!Literal"\nAdded');
  await page.getByTestId("canvas-wrap").click({ position: { x: 600, y: 90 } });
  await page.getByTestId("edge-label-api-to-appcfg").click();
  await expect(field).toHaveValue('!"Feature Flag"\n"A=B"\n"!Literal"\nAdded');
});

test("relationship-only changes invalidate edit capacity demand and bottleneck fixes", async ({
  page,
  consoleErrors,
}) => {
  await gotoLab(page, "relationship-regressions");
  await page.getByTestId("lab-open-editor").click();
  await page.getByTestId("view-button").click();
  await page.getByTestId("capacity-overlay-toggle").click();
  await expect(page.getByTestId("capacity-label-worker")).toHaveAttribute("data-level", "over");
  await expect(page.getByTestId("bottleneck-fix")).toBeVisible();
  await page.getByTestId("edge-label-demand").click();
  await page.getByTestId("inspector-field-relation").click();
  await menuItem(page, "secret").click();
  await expect(page.getByTestId("capacity-label-worker")).toHaveCount(0);
  await expect(page.getByTestId("bottleneck-fix")).toHaveCount(0);
  await page.getByTestId("inspector-field-relation").click();
  await menuItem(page, "message").click();
  await expect(page.getByTestId("capacity-label-worker")).toHaveAttribute("data-level", "over");
  expectNoErrors(consoleErrors);
});

test("delimiter-bearing node IDs and labels stay one dependency in the hidden list", async ({
  page,
  consoleErrors,
}) => {
  await gotoLab(page, "relationship-regressions");
  await page.getByTestId("lab-open-editor").click();
  await page.getByTestId("view-button").click();
  await page.getByTestId("dependencies-toggle").click();
  const pip = page.getByTestId("node-pips-worker");
  await expect(pip).toHaveAttribute("data-count", "1");
  await pip.focus();
  await expect(page.getByTestId("node-dependencies-worker")).toHaveText("DependenciesSecret · Vault\nInjected label");
  expectNoErrors(consoleErrors);
});

test("the overlap audit uses the same hidden-dependency route set as its rendered edges", async ({
  page,
  consoleErrors,
}) => {
  await page.addInitScript(() => localStorage.setItem("diagrams.showDependencies.v1", "0"));
  await gotoLab(page, "overlap-audit", { diagram: SLUG });
  await expect(page.getByTestId("relationship-wrapper-api-to-appcfg")).toHaveCount(0);
  await expect(page.getByTestId("audit-summary")).toHaveAttribute("data-routes", "5");
  expectNoErrors(consoleErrors);
});

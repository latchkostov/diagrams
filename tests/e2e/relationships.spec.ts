import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLab, expectNoErrors } from "./fixtures";

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

  test("drawing an edge to Key Vault infers a secret; the toast's Make it a flow undoes it", async ({
    page,
    consoleErrors,
  }) => {
    await drawEdge(page, "handle-notify-bottom", "handle-kv-right");
    const edge = page.getByTestId("edge-e-1");
    await expect(edge).toHaveAttribute("data-relation", "secret");
    await expect(page.getByTestId("edge-glyph-e-1")).toBeVisible();
    await expect(page.getByTestId("toast")).toContainText("Secret dependency: no messages flow here");
    // Let the drawn edge settle into its own undo step (history commits after a short quiet time).
    await page.waitForTimeout(600);
    await page.getByTestId("toast-make-flow").click();
    await expect(edge).not.toHaveAttribute("data-relation", /.+/);
    await expect(edge).toHaveAttribute("class", /fe-async/);
    await expect(page.getByTestId("edge-glyph-e-1")).toHaveCount(0);
    // Undo brings the inferred secret back (Make it a flow was its own step).
    await page.getByTestId("canvas-wrap").click({ position: { x: 600, y: 90 } });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(edge).toHaveAttribute("data-relation", "secret");
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
    await page.getByTestId("inspector-field-relation").selectOption("telemetry");
    await expect(page.getByTestId("edge-api-to-sb")).toHaveAttribute("data-relation", "telemetry");
    await expect(page.getByTestId("inspector-field-group")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("Ctrl+K sets the relationship of the selected edge", async ({ page, consoleErrors }) => {
    await page.getByTestId("edge-label-api-to-sb").click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
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

    // Editing in the inspector: one more secret updates both derived labels.
    await pill.click();
    const field = page.getByTestId("inspector-field-settings");
    await expect(field).toHaveValue(/!Stripe:ApiKey/);
    await field.press("End");
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
    await page.goto(`./?view=canvas&example=${SLUG}&live=1`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    // Flows light up as messages travel them...
    await expect.poll(() => liveState(page, "fd-to-api"), { timeout: 10_000 }).toBe("active");
    // ...while dependencies stay idle the whole time and recede.
    for (let i = 0; i < 12; i++) {
      for (const id of ["api-to-appcfg", "appcfg-to-kv", "api-to-mi", "mi-to-entra", "api-to-ai"])
        expect(await liveState(page, id), id).not.toBe("active");
      await page.waitForTimeout(150);
    }
    const opacity = await page.getByTestId("edge-api-to-appcfg").evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(opacity).toBeLessThan(0.5);
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

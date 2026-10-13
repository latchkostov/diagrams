import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, publicExamples } from "./fixtures";
import { installFakeLanguageModel, installFakeModelContext, must, toolNames } from "./ai-helpers";
import { expectHostEmbed, expectShareWithoutLinks, serveHostPage } from "./self-host-helpers";

/**
 * A self-hosted copy (docs/SELF-HOSTING.md), built as `pnpm build:internal` builds it, with a brand name: project
 * "internal" in playwright.config.ts (INTERNAL_ENV). No share links, password links or embed codes are offered
 * anywhere, agents get no tools, new diagrams start Private, the brand names the app; links people send still
 * open, and the file exports still work. Selectors are data-testid only.
 */

const BRAND = "Acme Diagrams (internal)";
const SLUG = "kafka-order-pipeline";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const kafka = must(
  publicExamples.find((e) => e.slug === SLUG),
  "the Kafka example",
);

/** The link a public copy would make for an example: the diagram in the fragment. */
const payload = (slug: string) => deflateRawSync(readFileSync(`src/examples/${slug}.json`)).toString("base64url");

/** Records the page's CSP violations (the build is served with the self-hosting policy's sources). */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __violations: string[] };
    w.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      w.__violations.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  return () => page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);
}

async function openPalette(page: Page) {
  await page.keyboard.press(`${MOD}+k`);
  await expect(page.getByTestId("command-palette")).toBeVisible();
}
/** The palette's items for `query` whose text includes `text`. */
async function paletteCount(page: Page, query: string, text: string) {
  await page.getByTestId("command-input").fill(query);
  await expect(page.getByTestId("command-list")).toBeVisible();
  return page
    .getByTestId(/^command-item-/)
    .filter({ hasText: text })
    .count();
}

test.describe("self-hosted build", () => {
  test("internal build uses self-host security headers", async ({ page, consoleErrors }) => {
    // Served as deploy/self-host/ says (PREVIEW_HEADERS=self-host): no outside origin anywhere in the policy.
    const violations = await watchCsp(page);
    const origin = new URL(must(test.info().project.use.baseURL, "the project's base URL")).origin;
    const outside: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (["http:", "https:"].includes(u.protocol) && u.origin !== origin) outside.push(r.url());
    });
    const app = await page.goto(`./?view=canvas&example=${SLUG}`);
    const csp = (await app?.headerValue("content-security-policy")) ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("frame-ancestors 'self';");
    expect(csp).not.toMatch(/https?:/);
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();

    const embed = await page.goto(`./?embed=1&example=${SLUG}`);
    const embedCsp = (await embed?.headerValue("content-security-policy")) ?? "";
    // Embeds: this site and the host pages the test serves (playwright.config.ts's PREVIEW_FRAME_ANCESTORS).
    expect(embedCsp).toContain("frame-ancestors 'self' http://127.0.0.1:*;");
    expect(embedCsp.replace("http://127.0.0.1:*", "")).not.toMatch(/https?:/);
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();

    expect(await violations()).toEqual([]);
    expect(outside).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test("internal on-device model can be re-enabled after a remembered opt-out", async ({ page, consoleErrors }) => {
    // Without AI tools there's no Advanced, which holds this switch elsewhere: it stays in the panel instead.
    await installFakeLanguageModel(page);
    await page.addInitScript(() => localStorage.setItem("diagrams.ai-ondevice.v1", "0"));
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();
    await page.getByTestId("ai-rail-open").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("ai-ondevice")).toHaveCount(0);
    await expect(page.getByTestId("ai-tools-off")).toContainText("is turned off. Turn it on below.");
    await expect(page.getByTestId("ai-advanced")).toHaveCount(0);

    await page.getByTestId("ai-ondevice-toggle").check();
    await expect(page.getByTestId("ai-ondevice")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("diagrams.ai-ondevice.v1"))).toBe("1");
    expectNoErrors(consoleErrors);
  });

  test("Share… offers the files and the private embed only, and a host page shows a diagram it supplies", async ({
    page,
    baseURL,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();
    await expectShareWithoutLinks(page);

    const diagram = JSON.parse(readFileSync(`src/examples/${SLUG}.json`, "utf8"));
    const host = await serveHostPage(new URL("./", must(baseURL, "the app")).href, diagram);
    try {
      await expectHostEmbed(page, host.origin, kafka.nodeIds[0]);
    } finally {
      await host.close();
    }
    expectNoErrors(consoleErrors);
  });

  test("the brand names the page and the top bar", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await expect(page).toHaveTitle(BRAND);
    await expect(page.getByTestId("brand")).toHaveText(BRAND);
    expectNoErrors(consoleErrors);
  });

  test("no share link, password link or link-carrying embed anywhere: File menu, right-click, palette", async ({
    page,
    consoleErrors,
  }) => {
    const violations = await watchCsp(page);
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();

    // The File menu: Share… (whose rows are the files and the embed the host's page supplies), Privacy and the
    // exports; no link rows anywhere.
    await page.getByTestId("file-button").click();
    await expect(page.getByTestId("file-privacy")).toBeVisible();
    await expect(page.getByTestId("export-png")).toBeVisible();
    await expect(page.getByTestId("file-share")).toBeVisible();
    // Opening a link someone sent is still offered.
    await page.getByTestId("file-import-from").click();
    await expect(page.getByTestId("import-share-link")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // The canvas right-click's Export ▸: the formats, no links.
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 700, y: 60 } });
    await page.getByTestId("context-menu-item-canvas.export").hover();
    await expect(page.getByTestId("context-menu-item-export:json")).toBeVisible();
    await expect(page.getByTestId("context-menu-item-export:html")).toBeVisible();
    // Share… there opens the same chooser, without links.
    await page.getByTestId("context-menu-item-export:share").click();
    await expect(page.getByTestId("share-chooser")).toBeVisible();
    await expect(page.getByTestId("share-option-password")).toHaveCount(0);
    await expect(page.getByTestId("share-public-toggle")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("share-chooser")).toHaveCount(0);

    // Ctrl+K: no link commands and no AI tools (Copy for AI needs a selection, so select a node first).
    await page.getByTestId(`node-${kafka.nodeIds[0]}`).click();
    await openPalette(page);
    expect(await paletteCount(page, "html", "Interactive HTML")).toBeGreaterThan(0);
    expect(await paletteCount(page, "share", "Share…")).toBe(1);
    expect(await paletteCount(page, "share", "share link")).toBe(0);
    expect(await paletteCount(page, "password", "with password")).toBe(0);
    expect(await paletteCount(page, "ai", "AI panel")).toBeGreaterThan(0);
    expect(await paletteCount(page, "ai", "Copy for AI")).toBe(0);
    expect(await paletteCount(page, "build", "Build with AI")).toBe(0);
    await page.keyboard.press("Escape");

    expect(await violations()).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test("agents get no tools, and the AI panel has no copied prompts", async ({ page, consoleErrors }) => {
    await installFakeModelContext(page);
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();
    // The public build registers its tools as the editor mounts (tests/e2e/ai-webmcp.spec.ts); here, never.
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(await toolNames(page)).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __mcp: { log: string[] } }).__mcp.log)).toEqual([]);

    // The panel (the on-device model's place) says AI agents are off here, with no how-to or Advanced.
    await page.getByTestId("ai-rail-open").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("ai-tools-off")).toContainText("AI agents and copied prompts are turned off here.");
    for (const id of ["ai-howto", "ai-advanced", "ai-agent-status", "ai-copy-prompt"])
      await expect(page.getByTestId(id)).toHaveCount(0);
    // A node's right-click has no Copy for AI.
    await page.getByTestId("ai-collapse").click();
    await page.getByTestId(`node-${kafka.nodeIds[0]}`).click({ button: "right" });
    await expect(page.getByTestId("context-menu")).toBeVisible();
    await expect(page.getByTestId("context-menu-item-item.copy-for-ai")).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect(await toolNames(page)).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test("new diagrams start Private, and the setting can still be turned off", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();
    // An example isn't new: it's as it ships.
    await expect(page.getByTestId("private-badge")).toHaveCount(0);

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await expect(page.getByTestId("private-badge")).toBeVisible();

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-privacy").click();
    const setting = page.getByTestId("privacy-new-diagrams");
    await expect(setting).toHaveAttribute("aria-checked", "true");
    await setting.click();
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await expect(page.getByTestId("private-badge")).toHaveCount(0);
    // Remembered across a reload.
    await page.reload();
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-privacy").click();
    await expect(page.getByTestId("privacy-new-diagrams")).toHaveAttribute("aria-checked", "false");
    expectNoErrors(consoleErrors);
  });

  test("an infrastructure import starts Private here: its report offers nothing, and Share… has no link to explain", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();
    await page.getByTestId("import-input").setInputFiles({
      name: "docker-compose.yml",
      mimeType: "application/yaml",
      buffer: readFileSync("tests/fixtures/imports/compose/docker-compose.yml"),
    });
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await page.getByTestId("toast-import-details").click();
    await expect(page.getByTestId("import-report")).toBeVisible();
    // New diagrams are private is already on in this copy: the one-time offer (and Make it private) don't show.
    await expect(page.getByTestId("import-report-offer")).toHaveCount(0);
    await expect(page.getByTestId("import-report-make-private")).toHaveCount(0);
    await page.getByTestId("import-report-done").click();
    // A private diagram in a copy without links: the same three rows, and no line about links (there are none here).
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-share").click();
    await expect(page.getByTestId("share-chooser")).toBeVisible();
    for (const id of ["share-option-html", "share-option-file", "share-option-embed"])
      await expect(page.getByTestId(id)).toBeVisible();
    for (const id of ["share-option-password", "share-public-toggle", "share-private-note"])
      await expect(page.getByTestId(id)).toHaveCount(0);
    await page.keyboard.press("Escape");
    expectNoErrors(consoleErrors);
  });

  test("a link someone sent still opens, in the app and in an embed", async ({ page, consoleErrors }) => {
    const other = must(
      publicExamples.find((e) => e.slug !== SLUG),
      "another public example",
    );
    await page.goto(`./#d=${payload(other.slug)}`);
    await expect(page.getByTestId("shared-banner")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`node-${other.nodeIds[0]}`)).toBeVisible();
    await expect(page).not.toHaveURL(/#d=/);

    await page.goto(`./?embed=1#d=${payload(other.slug)}`);
    await expect(page.getByTestId("embed-view")).toBeVisible();
    await expect(page.getByTestId(`node-${other.nodeIds[0]}`)).toBeVisible();
    await expect(page.getByTestId("embed-open-in-app")).toContainText(`Open in ${BRAND}`);
    expectNoErrors(consoleErrors);
  });

  test("the Interactive HTML and diagram file exports still work", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await expect(page.getByTestId("file-more-formats-menu")).toBeVisible();
    const [json] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-json").click()]);
    expect(json.suggestedFilename()).toBe(`${SLUG}.diagram.json`);
    const file = JSON.parse(readFileSync(await json.path(), "utf8")) as { format: string; nodes: { id: string }[] };
    expect(file.format).toBe("diagrams/v1");
    expect(file.nodes.map((n) => n.id)).toEqual(kafka.nodeIds);

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-html").click();
    await expect(page.getByTestId("html-export-dialog")).toBeVisible();
    const [html] = await Promise.all([page.waitForEvent("download"), page.getByTestId("html-export-download").click()]);
    expect(html.suggestedFilename()).toMatch(/\.html$/);
    const text = readFileSync(await html.path(), "utf8");
    expect(text).toContain('id="diagram"');
    expect(text).toContain(kafka.nodeIds[0]);
    expectNoErrors(consoleErrors);
  });
});

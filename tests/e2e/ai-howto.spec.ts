import type { Page } from "@playwright/test";
import { downloadSkill } from "./skill-download";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import { SLUG, toolNames, callTool, installFakeModelContext, openAiPanel } from "./ai-helpers";

// The idle AI panel answers "how do I use this?": where to type (not here), the ways to use AI, and,
// with WebMCP, an honest status and the tools the page publishes. Selectors are data-testid only.

const TOOLS = [
  "describe_diagram",
  "check_diagram",
  "find_stencils",
  "edit_diagram",
  "set_simulation",
  "new_diagram",
  "get_share_link",
];
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test.describe("with WebMCP", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeModelContext(page);
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await openAiPanel(page);
  });

  test("the status is honest: the page publishes its tools; the assistant must support them", async ({
    page,
    consoleErrors,
  }) => {
    const status = page.getByTestId("ai-agent-status");
    await expect(status).toHaveAttribute("data-available", "1");
    await expect(status).toHaveAttribute("data-tools", "7");
    await expect(page.getByTestId("ai-agent-status-text")).toHaveText(
      "This page publishes 7 tools for AI agents in this browser (WebMCP).",
    );
    await expect(page.getByTestId("ai-agent-status-hint")).toHaveText(
      "Your browser's assistant must support WebMCP to use them. Type your request there, not here.",
    );
    await expect(page.getByTestId("ai-llms-link")).toHaveCount(0);
    // Nowhere to type in the panel itself (Advanced stays closed).
    await expect(page.getByTestId("ai-request")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("three ways to use AI here, the browser's assistant first", async ({ page }) => {
    await expect(page.getByTestId("ai-howto")).toBeVisible();
    await expect(page.getByTestId("ai-way-browser")).toContainText("Your browser's AI assistant");
    await expect(page.getByTestId("ai-way-skill")).toContainText("Your coding agent");
    await expect(page.getByTestId("ai-way-chatbot")).toContainText("Any chatbot");
    const top = async (id: string) => (await page.getByTestId(id).boundingBox())?.y ?? 0;
    expect(await top("ai-way-browser")).toBeLessThan(await top("ai-way-skill"));
    expect(await top("ai-way-skill")).toBeLessThan(await top("ai-way-chatbot"));
  });

  test("Copy example request copies a request naming a real node", async ({ page }) => {
    await page.getByTestId("ai-copy-example").click();
    await expect(page.getByTestId("ai-copy-example")).toContainText("Copied");
    const text = await clipboard(page);
    expect(text).toBe("Add a dead-letter queue after Inventory service");
    await expect(page.getByTestId("ai-example-request")).toHaveText(text);
    await expect(page.getByTestId("node-inventory")).toContainText("Inventory service");
    // The diagram's own description names it too: the request works as it is.
    expect((await callTool(page, "describe_diagram")).text).toContain("Inventory service");
  });

  test("What agents can do here is collapsed, and lists the seven tools", async ({ page }) => {
    const list = page.getByTestId("ai-tools-list");
    await expect(page.getByTestId("ai-tools")).not.toHaveAttribute("open");
    await expect(list).toBeHidden();
    await page.getByTestId("ai-tools-toggle").click();
    await expect(list).toBeVisible();
    for (const name of TOOLS) await expect(page.getByTestId(`ai-tool-${name}`)).toContainText(name);
    await expect(list.getByRole("listitem")).toHaveCount(7);
  });

  test("in live view the status and the list say only reading, checking and sharing are offered", async ({ page }) => {
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("ai-agent-status-text")).toHaveText(
      "This page publishes 3 tools for AI agents in this browser (WebMCP).",
    );
    await expect(page.getByTestId("ai-example-request")).toHaveText(
      "Explain what happens to a message when it reaches Inventory service",
    );
    await page.getByTestId("ai-tools-toggle").click();
    await expect(page.getByTestId("ai-tools-list").getByRole("listitem")).toHaveCount(3);
  });

  test("with a conversation, the how-to folds to one link", async ({ page }) => {
    await expect.poll(() => toolNames(page)).toContain("edit_diagram");
    await callTool(page, "edit_diagram", {
      ops: [{ op: "update", target: "shopper", props: { sublabel: "Web and mobile" } }],
      layout: "none",
    });
    await expect(page.getByTestId("ai-turn-0")).toBeVisible();
    await expect(page.getByTestId("ai-howto")).toHaveCount(0);
    const link = page.getByTestId("ai-howto-link");
    await expect(link).toHaveText("How to use AI here");
    await expect(link).toHaveAttribute("aria-expanded", "false");
    await link.click();
    await expect(link).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("ai-way-browser")).toBeVisible();
    await link.click();
    await expect(page.getByTestId("ai-howto")).toHaveCount(0);
  });
});

test.describe("without WebMCP", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("node-payments")).toBeVisible();
    await openAiPanel(page);
  });

  test("a short note with llms.txt, and no browser-assistant way or tools list", async ({ page, consoleErrors }) => {
    const status = page.getByTestId("ai-agent-status");
    await expect(status).toHaveAttribute("data-available", "0");
    await expect(status).toContainText("No WebMCP in this browser");
    await expect(page.getByTestId("ai-llms-link")).toHaveAttribute("href", /llms\.txt$/);
    await expect(page.getByTestId("ai-agent-status-hint")).toHaveCount(0);
    await expect(page.getByTestId("ai-way-browser")).toHaveCount(0);
    await expect(page.getByTestId("ai-tools")).toHaveCount(0);
    await expect(page.getByTestId("ai-way-skill")).toBeVisible();
    await expect(page.getByTestId("ai-way-chatbot")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("Open Advanced opens the copy-and-paste flow, ready to type", async ({ page }) => {
    await expect(page.getByTestId("ai-request")).toHaveCount(0);
    await page.getByTestId("ai-open-advanced").click();
    await expect(page.getByTestId("ai-request")).toBeFocused();
    await expect(page.getByTestId("ai-advanced-toggle")).toHaveAttribute("aria-expanded", "true");
  });

  test("Install the skill opens the install page with copyable commands", async ({ page, context }) => {
    const link = page.getByTestId("ai-skill-link");
    await expect(link).toHaveAttribute("target", "_blank");
    const [skill] = await Promise.all([context.waitForEvent("page"), link.click()]);
    await skill.waitForLoadState();
    expect(new URL(skill.url()).pathname).toBe("/skill/");
    await expect(skill.getByTestId("skill-title")).toHaveText("Use Live Diagrams with your AI agent");
    // What the skill hands back, the private file first.
    await expect(skill.getByTestId("skill-outputs")).toContainText("Interactive HTML file");
    await expect(skill.getByTestId("skill-outputs")).toContainText("anyone who has the link can open the diagram");
    await expect(skill.getByTestId("skill-cmd-marketplace")).toHaveText("/plugin marketplace add latchkostov/diagrams");
    await expect(skill.getByTestId("skill-cmd-install")).toHaveText("/plugin install livediagrams@livediagrams");
    await skill.getByTestId("skill-copy-install").click();
    await expect(skill.getByTestId("skill-copy-install")).toHaveText("Copied");
    expect(await clipboard(skill)).toBe("/plugin install livediagrams@livediagrams");
    // Its relative links reach the skill and its zip.
    const href = await skill.getByTestId("skill-md").evaluate((a) => (a as HTMLAnchorElement).href);
    expect((await skill.request.get(href)).status(), href).toBe(200);
    // Dev builds the archive on demand. Observe the real download through completion.
    await downloadSkill(skill);
  });
});

import AxeBuilder from "@axe-core/playwright";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import {
  SLUG,
  MOD,
  must,
  openAskAi,
  nodeCount,
  installFakeModelContext,
  toolNames,
  installFakeSpeech,
  speech,
  speechState,
} from "./ai-helpers";

test("failed block 2 never commits block 1", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  const before = await nodeCount(page);
  await openAskAi(page);
  for (const bad of ['[{"label":"missing op"}]', '[{"op":"connect",']) {
    await page
      .getByTestId("ai-reply")
      .fill('```json\n[{"op":"remove","targets":["payments"]}]\n```\n```json\n' + bad + "\n```");
    await page.getByTestId("ai-apply").click();
    await expect(page.getByTestId("ai-error-message")).toContainText("Block 2");
    expect(await nodeCount(page)).toBe(before);
  }
});

test("typing defers parsing and immediate Apply validates the latest reply", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await openAskAi(page);
  await page.evaluate(() => {
    const original = JSON.parse;
    const state = { reads: 0 };
    (window as unknown as { typingParse: typeof state }).typingParse = state;
    JSON.parse = (text: string) => {
      if (text.includes("TYPING_PARSE_FIXTURE")) state.reads++;
      return original(text) as unknown;
    };
  });
  const earlyReads = await page.getByTestId("ai-reply").evaluate((el) => {
    const input = el as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing textarea setter");
    setter.call(input, '[{"op":"set_meta","title":"TYPING_PARSE_FIXTURE"}]');
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return (window as unknown as { typingParse: { reads: number } }).typingParse.reads;
  });
  expect(earlyReads).toBe(0);
  await page.getByTestId("ai-reply").fill('[{"op":"set_meta","title":"Newest reply"}]');
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-turn-0")).toBeVisible();
  await expect(page.getByTestId("ai-error")).toHaveCount(0);
});

test("layout-only replies apply and undo", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await openAskAi(page);
  await page.getByTestId("ai-reply").fill('{"ops":[],"layout":"full"}');
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-error")).toHaveCount(0);
  await expect(page.getByTestId("ai-turn-0-summary")).toContainText("layout");
  await page.getByTestId("ai-toast-undo").click();
  await expect(page.getByTestId("node-payments")).toBeVisible();
});

test("the dock sits beside the inspector, never over it, and Esc hands the keyboard back", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await page.getByTestId("node-payments").click();
  await openAskAi(page);
  const panel = must(await page.getByTestId("ai-dock").boundingBox(), "AI dock");
  const inspector = must(await page.getByTestId("inspector").boundingBox(), "inspector");
  const canvas = must(await page.getByTestId("canvas-wrap").boundingBox(), "canvas");
  expect(inspector.x + inspector.width).toBeLessThanOrEqual(panel.x);
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(inspector.x);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-wrap")).toBeFocused();
  await page.getByTestId("ai-request").focus();
  await page.getByTestId("ai-collapse").click();
  await expect(page.getByTestId("ai-rail-open")).toBeFocused();
});

test("applied feedback and confidence warnings meet light-theme contrast", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await openAskAi(page);
  await page.getByTestId("ai-reply").fill('[{"op":"add_node","kind":"gizmo","label":"Synthetic worker"}]');
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-turn-0")).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="ai-panel"]')
    .withTags(["wcag2aa", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
});

test("synthetic local example is excluded from tools and copied prompts, including after a switch @dev", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installFakeModelContext(page);
  // Replace only the registry module with a synthetic fixture; no local diagram files are accessed.
  await page.route(/\/src\/examples\/index\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import publicDiagram from "/src/examples/kafka-order-pipeline.json?import";
    import { exampleMetadata } from "/src/examples/metadata.ts";
    export const examples = [
      { ...exampleMetadata["kafka-order-pipeline"], slug: "kafka-order-pipeline", diagram: publicDiagram },
      { slug: "synthetic-local", localOnly: true, diagram: { format: "diagrams/v1", title: "Synthetic local", nodes: [{ id: "secret-fixture", label: "SYNTHETIC_SENSITIVE_CONTENT", stencil: "generic.service", x: 0, y: 0 }], edges: [] } }
    ];
    export const getLoadedExample = (slug) => examples.find((e) => e.slug === slug)?.diagram;
    export const loadExample = async (slug) => getLoadedExample(slug);
  `,
    }),
  );
  await gotoCanvas(page, SLUG);
  await expect.poll(() => toolNames(page)).toHaveLength(6);
  await openAskAi(page);
  await page.evaluate(() => {
    history.pushState({}, "", "?view=canvas&example=synthetic-local");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByTestId("node-secret-fixture")).toBeVisible();
  await expect.poll(() => toolNames(page)).toEqual([]);
  await expect(page.getByTestId("ai-privacy-note")).toContainText("Local-only");
  await page.getByTestId("ai-copy-prompt").click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("Local-only");
  expect(prompt).not.toContain("SYNTHETIC_SENSITIVE_CONTENT");
  expect(prompt).not.toContain("secret-fixture");
  await page.getByTestId("ai-reply").fill('[{"op":"remove","targets":["secret-fixture"]}]');
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-error-message")).toContainText("Local-only");
  await expect(page.getByTestId("node-secret-fixture")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("stop and restart during availability opens only the latest dictation session", async ({ page }) => {
  await installFakeSpeech(page, { deferredAvailability: true });
  await gotoCanvas(page, SLUG);
  await openAskAi(page);
  const mic = page.getByTestId("ai-mic");
  await mic.click();
  await mic.click();
  await mic.click();
  await speech(page, "resolveAvailability");
  await expect.poll(async () => (await speechState(page)).starts).toBe(1);
  await expect.poll(async () => (await speechState(page)).active).toBe(1);
  await page.getByTestId("ai-collapse").click();
  await expect.poll(async () => (await speechState(page)).active).toBe(0);
});

test("undo invalidates stencil choices and a changed node refuses an old choice", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await openAskAi(page);
  await page.getByTestId("ai-reply").fill('[{"op":"add_node","kind":"function","label":"Synthetic function"}]');
  await page.getByTestId("ai-apply").click();
  const chip = page.getByTestId(/^ai-swap-.*-azure\.functions$/).first();
  await expect(chip).toBeEnabled();
  await page.getByTestId("ai-toast-undo").click();
  await expect(chip).toBeDisabled();
  await expect(page.getByTestId(/^ai-choice-stale-/).first()).toContainText("Ask for a new turn");
  await page.getByTestId("ai-reply").fill('[{"op":"add_node","kind":"function","label":"Replacement function"}]');
  await page.keyboard.press(`${MOD}+Enter`);
  await expect(page.getByTestId("ai-turn-1")).toBeVisible();
  await expect(chip).toBeDisabled();
});

test("a choice remains usable for another swap within its own turn", async ({ page }) => {
  await gotoCanvas(page, SLUG);
  await openAskAi(page);
  await page.getByTestId("ai-reply").fill('[{"op":"add_node","kind":"function","label":"Synthetic function"}]');
  await page.getByTestId("ai-apply").click();
  const azure = page.getByTestId(/^ai-swap-.*-azure\.functions$/).first();
  await azure.click();
  const previous = page.getByTestId(/^ai-swap-.*-aws\.lambda$/).first();
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(page.getByTestId("toast")).toContainText("Synthetic function is now AWS Lambda");
});

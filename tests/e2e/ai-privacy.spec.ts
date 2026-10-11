import type { Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { localOnlyFixture } from "../../src/lab/localOnlyFixture";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import { SLUG, installFakeModelContext, toolNames, openAiFromFileMenu } from "./ai-helpers";

async function installSyntheticRegistry(page: Page) {
  await installFakeModelContext(page);
  await page.route("**/src/examples/index.ts", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `import publicDiagram from "/src/examples/kafka-order-pipeline.json?import";
      export const examples = [
        { slug: "${SLUG}", diagram: publicDiagram },
        { slug: "synthetic-local", localOnly: true, diagram: ${JSON.stringify(localOnlyFixture)} }
      ];`,
    }),
  );
}

async function expectBlocked(page: Page) {
  await expect.poll(() => toolNames(page)).toEqual([]);
  await openAiFromFileMenu(page);
  await expect(page.getByTestId("ai-privacy-note")).toContainText("Local-only");
  await page.getByTestId("ai-copy-prompt").click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("Local-only");
  for (const node of localOnlyFixture.nodes) {
    expect(prompt).not.toContain(node.id);
    expect(prompt).not.toContain(node.label);
  }
}

test("Save a copy keeps a fingerprint-detected shared diagram local-only", async ({ page, context, consoleErrors }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installSyntheticRegistry(page);
  const payload = deflateRawSync(Buffer.from(JSON.stringify(localOnlyFixture))).toString("base64url");
  await page.goto(`./?view=canvas&example=${SLUG}#d=${payload}`);
  await expect(page.getByTestId("shared-keep")).toBeVisible();
  await expectBlocked(page);
  await page.getByTestId("ai-dialog-close").click();
  await page.getByTestId("shared-keep").click();
  await expect(page.getByTestId("shared-keep")).toHaveCount(0);
  const slug = await page.getByTestId("example-picker").inputValue();
  expect(slug).toMatch(/^my-/);
  const entry = await page.evaluate(
    (slug) => JSON.parse(localStorage.getItem(`diagrams.library-entry.v1:${slug}`) ?? "null"),
    slug,
  );
  expect(entry.localOnly).toBe(true);
  await expectBlocked(page);
  expectNoErrors(consoleErrors);
});

test("import and Duplicate persist local-only metadata and stay blocked after reload", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installSyntheticRegistry(page);
  await gotoCanvas(page, SLUG);
  await expect.poll(() => toolNames(page)).toHaveLength(6);
  await page.getByTestId("import-input").setInputFiles({
    name: "synthetic.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(localOnlyFixture)),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(localOnlyFixture.title);
  const source = await page.getByTestId("example-picker").inputValue();
  await expectBlocked(page);
  await page.getByTestId("ai-dialog-close").click();
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
  await page.getByTestId(`library-duplicate-${source}`).click();
  await page.getByTestId("duplicate-open").click();
  await expect(page.getByTestId("diagram-title")).toHaveText(`${localOnlyFixture.title} (copy)`);
  const copy = await page.getByTestId("example-picker").inputValue();
  expect(copy).not.toBe(source);
  const record = await page.evaluate(
    (slug) => JSON.parse(localStorage.getItem(`diagrams.library-entry.v1:${slug}`) ?? "null"),
    copy,
  );
  expect(record.localOnly).toBe(true);
  await page.reload();
  await expectBlocked(page);
  expectNoErrors(consoleErrors);
});

test("paste with regenerated ids is caught by content, while an unrelated import stays allowed", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installSyntheticRegistry(page);
  await gotoCanvas(page, SLUG);
  const pasted = {
    ...localOnlyFixture,
    nodes: localOnlyFixture.nodes.map((node, i) => ({ ...node, id: `pasted-${i}` })),
    edges: [],
  };
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-import-from").hover();
  await page.getByTestId("import-paste").click();
  await page.getByTestId("paste-input").fill(JSON.stringify(pasted));
  await page.getByTestId("paste-submit").click();
  await expect(page.getByTestId("node-pasted-0")).toBeVisible();
  await expectBlocked(page);
  await page.getByTestId("ai-dialog-close").click();
  const unrelated = {
    ...pasted,
    title: "Unrelated synthetic diagram",
    nodes: pasted.nodes.map((node, i) => ({ ...node, label: `Unrelated node ${i}`, sublabel: "Service" })),
  };
  await page.getByTestId("import-input").setInputFiles({
    name: "unrelated.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(unrelated)),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(unrelated.title);
  await expect.poll(() => toolNames(page)).toHaveLength(6);
  await openAiFromFileMenu(page);
  await expect(page.getByTestId("ai-privacy-note")).toHaveCount(0);
  await page.getByTestId("ai-copy-prompt").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(unrelated.title);
  expectNoErrors(consoleErrors);
});

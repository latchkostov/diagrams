import { currentDiagram } from "./fixtures";
import { openExample } from "./fixtures";
// Runs on the dev server (see DEV_ONLY in playwright.config.ts): local-only examples and the content
// fingerprint exist only in development builds, by design.
import type { Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { localOnlyFixture, localOnlySimulationFixture } from "../../src/lab/localOnlyFixture";
import { test, expect, gotoCanvas, expectNoErrors, openShareChooser } from "./fixtures";
import {
  SLUG,
  fakeModel,
  installFakeLanguageModel,
  installFakeModelContext,
  modelReply,
  releaseModel,
  toolNames,
  openAdvanced,
  openAiPanel,
} from "./ai-helpers";

async function installSyntheticRegistry(page: Page, diagram = localOnlyFixture) {
  await installFakeModelContext(page);
  await page.route(/\/src\/examples\/index\.ts(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `import publicDiagram from "/src/examples/kafka-order-pipeline.json?import";
    import { exampleMetadata } from "/src/examples/metadata.ts";
    import { diagramThumb } from "/src/lib/thumbnail.ts";
    const localDiagram = ${JSON.stringify(diagram)};
      export const examples = [
        { ...exampleMetadata["kafka-order-pipeline"], slug: "${SLUG}", diagram: publicDiagram },
        { slug: "synthetic-local", localOnly: true, title: localDiagram.title, thumb: diagramThumb(localDiagram), simulation: localDiagram.simulations?.[0]?.id, diagram: localDiagram }
      ];
      export const exampleSummary = (example) =>
        (typeof example.summary === "function" ? example.summary() : example.summary) ?? example.description;
      export const getLoadedExample = (slug) => examples.find((e) => e.slug === slug)?.diagram;
      export const loadExample = async (slug) => getLoadedExample(slug);`,
    }),
  );
}

test("gallery runs a local-only example without writing its simulation id to history", async ({
  page,
  consoleErrors,
}) => {
  await installSyntheticRegistry(page, localOnlySimulationFixture);
  await gotoCanvas(page, SLUG);
  await page.evaluate(() => {
    const urls: string[] = [];
    Object.assign(window, { galleryHistoryUrls: urls });
    for (const method of ["pushState", "replaceState"] as const) {
      const update = history[method].bind(history);
      history[method] = (data, unused, url) => {
        urls.push(String(url));
        update(data, unused, url);
      };
    }
  });
  await page.getByTestId("example-picker").click();
  await page.getByTestId("picker-browse-examples").click();
  await page.getByTestId("examples-search").fill("synthetic-local");
  await page.getByTestId("example-run-synthetic-local").click();
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("synthetic-local-run");
  expect(new URL(page.url()).searchParams.has("sim")).toBe(false);
  const urls = await page.evaluate(() => Reflect.get(window, "galleryHistoryUrls") as string[]);
  expect(urls.some((url) => url.includes("synthetic-local-run"))).toBe(false);
  expectNoErrors(consoleErrors);
});

async function expectBlocked(page: Page) {
  await expect.poll(() => toolNames(page)).toEqual([]);
  await openAdvanced(page);
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
  await page.getByTestId("ai-collapse").click();
  await page.getByTestId("shared-keep").click();
  await expect(page.getByTestId("shared-keep")).toHaveCount(0);
  const slug = await currentDiagram(page);
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
  await expect.poll(() => toolNames(page)).toHaveLength(7);
  await page.getByTestId("import-input").setInputFiles({
    name: "synthetic.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(localOnlyFixture)),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(localOnlyFixture.title);
  const source = await currentDiagram(page);
  await expectBlocked(page);
  await page.getByTestId("ai-collapse").click();
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-library").click();
  await page.getByTestId(`library-duplicate-${source}`).click();
  await page.getByTestId("duplicate-open").click();
  await expect(page.getByTestId("diagram-title")).toHaveText(`${localOnlyFixture.title} (copy)`);
  const copy = await currentDiagram(page);
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
  await page.getByTestId("ai-collapse").click();
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
  await expect.poll(() => toolNames(page)).toHaveLength(7);
  await openAdvanced(page);
  await expect(page.getByTestId("ai-privacy-note")).toHaveCount(0);
  await page.getByTestId("ai-copy-prompt").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(unrelated.title);
  expectNoErrors(consoleErrors);
});

test("on a local-only diagram the AI panel says so, and Copy for AI copies nothing", async ({
  page,
  context,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installSyntheticRegistry(page);
  await gotoCanvas(page, "synthetic-local");
  await page.evaluate(() => navigator.clipboard.writeText("before"));
  await openAiPanel(page);
  await expect(page.getByTestId("ai-privacy-note")).toContainText("Local-only");
  await expect(page.getByTestId("ai-empty")).toContainText("AI is off for this diagram");
  await expect(page.getByTestId("ai-agent-status")).toContainText("off for this local-only diagram");
  await expect.poll(() => toolNames(page)).toEqual([]);
  const node = localOnlyFixture.nodes[0];
  await page.getByTestId(`node-${node.id}`).click({ button: "right" });
  await page.getByTestId("context-menu-item-item.copy-for-ai").click();
  await expect(page.getByTestId("toast")).toContainText("AI is off");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("before");
  expectNoErrors(consoleErrors);
});

test("a local-only diagram never reaches the on-device model: its box is off", async ({ page }) => {
  await installSyntheticRegistry(page);
  await installFakeLanguageModel(page);
  await page.addInitScript(() => localStorage.setItem("diagrams.ai-ondevice.v1", "1"));
  await gotoCanvas(page, "synthetic-local");
  await openAiPanel(page);
  await expect(page.getByTestId("ai-privacy-note")).toContainText("Local-only");
  const input = page.getByTestId("ai-ondevice-input");
  await expect(input).toBeDisabled();
  await expect(input).toHaveAttribute("placeholder", "AI is off for this local-only diagram");
  await expect(page.getByTestId("ai-ondevice-send")).toBeDisabled();
  expect((await fakeModel(page)).prompts).toEqual([]);
});

test("a request in flight when the diagram switches to a local-only one never commits", async ({ page }) => {
  const reply = modelReply("Added a queue", [
    { op: "add", kind: "queue", label: "late-queue" },
    { op: "connect", from: "Inventory service", to: "late-queue", flow: "message" },
  ]);
  await installSyntheticRegistry(page);
  await installFakeLanguageModel(page, { replies: [`hold:${reply}`] });
  await page.addInitScript(() => localStorage.setItem("diagrams.ai-ondevice.v1", "1"));
  await gotoCanvas(page, SLUG);
  await openAiPanel(page);
  await page.getByTestId("ai-ondevice-input").fill("Add a queue after Inventory service");
  await page.getByTestId("ai-ondevice-input").press("Enter");
  await expect(page.getByTestId("ai-ondevice-status")).toHaveText("Thinking…");
  await openExample(page, "synthetic-local");
  await expect(page.getByTestId("ai-privacy-note")).toContainText("Local-only");
  await expect.poll(async () => (await fakeModel(page)).aborted).toBe(1);
  await releaseModel(page);
  await page.waitForTimeout(300);
  await expect(page.getByTestId("ai-turn-0")).toHaveCount(0);
  await expect(page.getByTestId("node-late-queue")).toHaveCount(0);
  await openExample(page, SLUG);
  await expect(page.getByTestId("node-inventory")).toBeVisible();
  await expect(page.getByTestId("ai-turn-0")).toHaveCount(0);
  expect((await fakeModel(page)).prompts).toHaveLength(1);
});

test("a local-only diagram gets no link: plain or with a password; its embed is the private kind", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installSyntheticRegistry(page);
  await gotoCanvas(page, "synthetic-local");
  // Share… lists no link rows and no public section, and says why (it can't be changed: always private).
  await openShareChooser(page);
  for (const item of ["share-option-password", "share-public-toggle", "share-make-not-private"])
    await expect(page.getByTestId(item)).toHaveCount(0);
  await expect(page.getByTestId("share-private-note")).toContainText("always private");
  // The embed whose diagram the host's page supplies puts nothing of it in a URL.
  await page.getByTestId("share-option-embed").click();
  await expect(page.getByTestId("embed-host-note")).toBeVisible();
  await expect(page.getByTestId("embed-source-inline")).toHaveCount(0);
  await page.getByTestId("embed-copy").click();
  expect(await page.evaluate(() => navigator.clipboard.readText().catch(() => ""))).toContain("<live-diagram ");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => navigator.clipboard.readText().catch(() => ""))).not.toMatch(/#[de]=/);
});

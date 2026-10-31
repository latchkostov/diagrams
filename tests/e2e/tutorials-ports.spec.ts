import type { Page } from "@playwright/test";
import { test, expect, pageLoadTimeout, expectNoErrors, openShareChooser } from "./fixtures";
import { openAdvanced, openAiPanel } from "./ai-helpers";
import { emulateTracker } from "./collab-tracker";
import type { ProductObservations } from "../../src/lib/observations";
import { chunk, holdChunk, releaseAndEvaluate } from "./chunk";

async function begin(page: Page, port: keyof ProductObservations) {
  await page.goto(`./?tutorial=lab-tutorial-port-${port}`);
  await expect(page.getByTestId("tutorial-start")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("tutorial-start").click();
  await expect(page.getByTestId("tutorial-intro")).toHaveCount(0);
}
const latest = (page: Page) =>
  page.evaluate(() => {
    if (!window.__observationLab) throw new Error("Missing observation fixture");
    return window.__observationLab.latest();
  });
const finished = (page: Page) => expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-phase", "finished");
async function normalCanvas(page: Page) {
  await page.getByTestId("tutorial-exit").click();
  await page.getByTestId("view-canvas").click();
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  await page.evaluate(() => window.__observationLab?.clear());
}
async function importDialog(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-import-from").click();
  await page.getByTestId("import-paste").click();
}

const fake: Record<keyof ProductObservations, Record<string, unknown>> = {
  dock: { tab: "checks", snap: "half", live: false, presenting: false },
  checks: { status: "done", result: { findings: [{ rule: "no-reader" }], ignored: [], off: [], ran: [] } },
  exports: { format: "native", bytes: 100 },
  imports: { format: "native" },
  ai: { kind: "change", changed: ["source"] },
  collaboration: { status: "joined", role: "joiner" },
};
for (const port of Object.keys(fake) as (keyof ProductObservations)[])
  test(`${port}: fake publication reaches the real runner`, async ({ page }) => {
    await begin(page, port);
    await page.evaluate(({ port, event }) => window.__observationLab?.publish(port, event), {
      port,
      event: fake[port],
    });
    await finished(page);
  });

test("dock/view: opening Checks publishes the actual dock state", async ({ page, consoleErrors }) => {
  await begin(page, "dock");
  await page.getByTestId("checks-count").click();
  await finished(page);
  expect((await latest(page)).dock).toMatchObject({ tab: "checks", live: false, presenting: false });
  await page.getByTestId("tutorial-handoff-dismiss").click();
  await page.getByTestId("node-source").click();
  await page.getByTestId("view-focus").click();
  await expect.poll(async () => (await latest(page)).dock?.view).toBe("focus");
  expectNoErrors(consoleErrors);
});

test("Checks: a real worker job publishes findings", async ({ page, consoleErrors }) => {
  await begin(page, "checks");
  await page.getByTestId("checks-count").click();
  await page.evaluate(() => window.__checks?.flush());
  await finished(page);
  const result = (await latest(page)).checks;
  expect(result?.status).toBe("done");
  expect(result?.result?.findings.some((finding) => finding.rule === "no-reader")).toBe(true);
  expectNoErrors(consoleErrors);
});

test("exports: closing options cannot complete; the native writer produces real bytes", async ({
  page,
  consoleErrors,
}) => {
  await begin(page, "exports");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("export image");
  await page.getByTestId("command-item-action:export:image").click();
  await expect(page.getByTestId("image-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("image-dialog")).toHaveCount(0);
  expect((await latest(page)).exports).toBeUndefined();
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-phase", "step");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("diagram file");
  const download = page.waitForEvent("download");
  await page.getByTestId("command-item-action:export:json").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.diagram\.json$/);
  const stream = await file.createReadStream();
  let text = "";
  if (!stream) throw new Error("Missing exported bytes");
  for await (const chunk of stream) text += chunk.toString();
  expect(JSON.parse(text).nodes).toHaveLength(2);
  await finished(page);
  expect((await latest(page)).exports).toMatchObject({ format: "native", bytes: Buffer.byteLength(text) });
  expectNoErrors(consoleErrors);
});

test("imports: close and failure publish nothing; normal Open publishes only after accepting the real parser result", async ({
  page,
  consoleErrors,
}) => {
  await begin(page, "imports");
  await importDialog(page);
  await page.keyboard.press("Escape");
  expect((await latest(page)).imports).toBeUndefined();
  await importDialog(page);
  await page.getByTestId("paste-input").fill("not a diagram");
  await page.getByTestId("paste-submit").click();
  expect((await latest(page)).imports).toBeUndefined();
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-phase", "step");
  await page.getByTestId("paste-input").fill(
    JSON.stringify({
      format: "diagrams/v1",
      title: "Public import",
      nodes: [{ id: "imported", stencil: "generic.service", label: "Imported API", x: 0, y: 0 }],
      edges: [],
    }),
  );
  await page.getByTestId("paste-submit").click();
  await expect(page.getByTestId("node-imported")).toBeVisible();
  expect((await latest(page)).imports?.format).toBe("native");
  // The pending owner policy is explicit: normal Open still leaves the sandbox.
  await expect(page.getByTestId("tutorial-app")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("AI: a deterministic Advanced reply publishes the applied turn", async ({ page, consoleErrors }) => {
  await begin(page, "ai");
  await normalCanvas(page);
  await openAiPanel(page);
  await openAdvanced(page);
  await page
    .getByTestId("ai-reply")
    .fill(JSON.stringify([{ op: "add_node", kind: "Kafka topic", label: "Public events" }]));
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-turn-0-summary")).toBeVisible();
  const event = (await latest(page)).ai;
  expect(event?.kind).toBe("change");
  expect(event?.changed.length).toBeGreaterThan(0);
  expectNoErrors(consoleErrors);
});

test("collaboration: cancelling consent publishes nothing; a real room publishes joined and left", async ({
  browser,
  baseURL,
  page,
  context,
  consoleErrors,
}) => {
  const other = await browser.newContext({ baseURL });
  try {
    await emulateTracker([context, other]);
    await begin(page, "collaboration");
    await normalCanvas(page);
    await openShareChooser(page);
    await page.getByTestId("share-option-edit-together").click();
    await expect(page.getByTestId("room-start-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    expect((await latest(page)).collaboration).toBeUndefined();
    await openShareChooser(page);
    await page.getByTestId("share-option-edit-together").click();
    await page.getByTestId("room-start-confirm").click();
    await expect(page.getByTestId("room-started-dialog")).toBeVisible();
    const link = await page.getByTestId("room-link").inputValue();
    expect((await latest(page)).collaboration).toMatchObject({ status: "joined", role: "creator" });
    await page.getByTestId("room-started-done").click();
    const guest = await other.newPage();
    await begin(guest, "collaboration");
    await normalCanvas(guest);
    const invite = () =>
      guest.evaluate((hash) => {
        location.hash = hash;
      }, new URL(link).hash);
    await invite();
    await expect(guest.getByTestId("room-join-dialog")).toBeVisible();
    await guest.keyboard.press("Escape");
    await expect(guest.getByTestId("room-join-dialog")).toHaveCount(0);
    expect((await latest(guest)).collaboration).toBeUndefined();
    await invite();
    await guest.getByTestId("room-join-accept").click();
    await expect(guest.getByTestId("room-connecting")).toHaveAttribute("data-knocking", "true");
    expect((await latest(guest)).collaboration).toBeUndefined();
    await page.getByTestId("room-knock-admit").first().click();
    await expect(guest.getByTestId("room-chip")).toHaveAttribute("data-peers", "1");
    expect((await latest(guest)).collaboration).toMatchObject({ status: "joined", role: "joiner" });
    await page.getByTestId("room-chip").click();
    await page.getByTestId("room-leave").click();
    await expect.poll(async () => (await latest(page)).collaboration?.status).toBe("left");
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

const replacement = {
  format: "diagrams/v1",
  title: "Public replacement",
  nodes: [{ id: "replacement", stencil: "generic.service", label: "Replacement", x: 0, y: 0 }],
  edges: [],
};

for (const lifecycle of ["Restart", "Exit", "replacement"] as const) {
  async function interrupt(page: Page) {
    if (lifecycle === "replacement") {
      await page.getByTestId("import-input").setInputFiles({
        name: "public.diagram.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(replacement)),
      });
      await expect(page.getByTestId("node-replacement")).toBeVisible();
    } else {
      await page.getByTestId(lifecycle === "Restart" ? "tutorial-restart" : "tutorial-exit").click();
      if (lifecycle === "Exit") await expect(page.getByTestId("tutorial-app")).toHaveCount(0);
    }
    await page.evaluate(() => window.__observationLab?.clear());
  }

  test(`exports: ${lifecycle} cancels a held real writer`, async ({ page, consoleErrors }) => {
    const writer = chunk("write", "src/interop/drawio/write.ts");
    const held = await holdChunk(page, writer);
    const downloads: string[] = [];
    page.on("download", (file) => downloads.push(file.suggestedFilename()));
    await begin(page, "exports");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-input").fill("draw.io");
    await page.getByTestId("command-item-action:export:drawio").click();
    await expect.poll(held.requested).toBe(true);
    await interrupt(page);
    await releaseAndEvaluate(page, writer, held.release);
    expect(downloads).toEqual([]);
    expect((await latest(page)).exports).toBeUndefined();
    expectNoErrors(consoleErrors);
  });

  test(`imports: ${lifecycle} cancels a held real parser`, async ({ page, consoleErrors }) => {
    const reader = chunk("import", "src/interop/mermaid/import.ts");
    const held = await holdChunk(page, reader);
    await begin(page, "imports");
    await page.getByTestId("import-input").setInputFiles({
      name: "public.mmd",
      mimeType: "text/plain",
      buffer: Buffer.from('flowchart LR\n a["Public first"] --> b["Public second"]'),
    });
    await expect.poll(held.requested).toBe(true);
    await interrupt(page);
    await releaseAndEvaluate(page, reader, held.release);
    expect((await latest(page)).imports).toBeUndefined();
    await expect(page.getByTestId("node-a")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });
}

import {
  test,
  expect,
  gotoCanvas,
  waitForCameraIdle,
  waitForHistoryIdle,
  waitForAutosave,
  waitForChecks,
  pauseClock,
  TEXT_END,
  waitForStableBox,
} from "./fixtures";
import { typingFixture } from "../../src/lab/typingFixture";
import { kedaFixture } from "../../src/lab/kedaFixture";
import { cloudFixture } from "../../src/lab/cloudFixture";
import { RENDER_HOOK } from "../bench/ui/instrument";
import { median, typingWork } from "./typing-work";

const cases = [
  ...(["label", "sublabel", "node-description"] as const).map((field) => ({
    field,
    name: field,
    diagram: typingFixture,
    nodeId: "api",
    binding: undefined,
  })),
  ...(["label", "sublabel", "node-description"] as const).map((field) => ({
    field,
    name: `${field} with KEDA`,
    diagram: kedaFixture(),
    nodeId: "worker",
    binding: JSON.stringify(["uploads", "renders"]),
  })),
  ...(["ecs-alb", "aca-event"] as const).map((preset) => ({
    field: "label",
    name: `label with ${preset}`,
    diagram: cloudFixture(preset),
    nodeId: "worker",
    binding: preset === "ecs-alb" ? "lb" : JSON.stringify(["queue", undefined]),
  })),
];

for (const { field, name, diagram, nodeId, binding } of cases) {
  test(`typing ${name} renders only the affected parts`, async ({ page }, info) => {
    await page.clock.install();
    await page.addInitScript(RENDER_HOOK);
    await gotoCanvas(page, "kafka-order-pipeline");
    await page.getByTestId("import-input").setInputFiles({
      name: "typing.diagram.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(diagram)),
    });
    await expect(page.getByTestId("diagram-title")).toHaveText(diagram.title);
    await page.getByTestId(`node-${nodeId}`).dblclick();
    const input = page.getByTestId(`inspector-field-${field}`);
    await expect(input).toBeVisible();
    if (binding) {
      await page.getByTestId("inspector-section-node-simulation").click();
      await page.getByTestId("autoscaling-advanced-toggle").click();
    }
    const source = page.getByTestId("autoscaling-source-select");
    const hint = page.getByTestId("autoscaling-binding-hint");
    const readouts = binding
      ? {
          hint: await hint.innerText(),
          target: await page.getByTestId("autoscaling-target").inputValue(),
          min: await page.getByTestId("autoscaling-min").inputValue(),
          max: await page.getByTestId("autoscaling-max").inputValue(),
        }
      : undefined;
    const checkBinding = async () => {
      if (!binding || !readouts) return;
      await expect(source).toBeEnabled();
      await expect(source).toHaveValue(binding);
      await expect(hint).toHaveText(readouts.hint);
      for (const key of ["target", "min", "max"] as const)
        await expect(page.getByTestId(`autoscaling-${key}`)).toHaveValue(readouts[key]);
    };
    await checkBinding();
    // Warm lazy fields, focus and the documentation badge before counting steady-state input.
    await input.fill("An existing value wider than the card's maximum label width");
    await expect(input).toBeFocused();
    await checkBinding();
    await input.press(TEXT_END);
    await waitForCameraIdle(page);
    await waitForChecks(page);
    await waitForHistoryIdle(page);
    await waitForAutosave(page);
    await expect(page.getByTestId("undo-button")).toBeEnabled();
    await pauseClock(page);
    const work = await typingWork(page, false, () => page.clock.runFor(32));
    const samples = [];
    for (const ch of "xyz123") {
      await page.evaluate((explain) => window.__benchRenders?.start(explain), process.env.TYPING_PROFILE === "1");
      await work.key(ch);
      const sample = await page.evaluate(() => window.__benchRenders?.stop());
      if (!sample) throw new Error("React render hook was not installed");
      samples.push(sample);
      await checkBinding();
    }
    await work.close();
    info.annotations.push({ type: "typing-renders", description: JSON.stringify({ field, samples }) });
    const renders = median(samples.map((s) => s.total));
    const commits = median(samples.map((s) => s.commits));
    expect(renders, `${name} observed renders`).toBeGreaterThan(0);
    expect(commits, `${name} observed commits`).toBeGreaterThan(0);
    expect(renders, `${name} renders per key`).toBeLessThanOrEqual(15);
    expect(commits, `${name} commits per key`).toBeLessThanOrEqual(2);
    await expect(input).toHaveValue("An existing value wider than the card's maximum label widthxyz123");
    await page.clock.resume();
    await input.blur();
    await waitForHistoryIdle(page);
    await page.getByTestId("undo-button").click();
    await expect(input).not.toHaveValue("An existing value wider than the card's maximum label widthxyz123");
    await expect(page.getByTestId("redo-button")).toBeEnabled();
    await page.getByTestId("redo-button").click();
    await expect(input).toHaveValue("An existing value wider than the card's maximum label widthxyz123");
  });
}

test("renaming a growing card keeps the add-node chip clear", async ({ page }) => {
  await gotoCanvas(page, "kafka-order-pipeline");
  await page.getByTestId("import-input").setInputFiles({
    name: "typing.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(typingFixture)),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Typing");
  const node = page.getByTestId("node-api");
  await node.dblclick();
  const label = page.getByTestId("inspector-field-label");
  const chip = page.getByTestId("grow-chip-api");
  await expect(chip).toHaveAttribute("data-side", "right");
  await waitForCameraIdle(page);
  await waitForHistoryIdle(page);
  await waitForAutosave(page);
  await waitForStableBox(node);
  const before = await node.boundingBox();
  if (!before) throw new Error("Expected the API card");
  await label.fill("A much wider label that grows the API card");
  await expect.poll(async () => (await node.boundingBox())?.width ?? 0).toBeGreaterThan(before.width);
  await expect(chip).toHaveAttribute("data-side", "bottom");
  await waitForStableBox(node);
  await label.fill("API");
  await expect(chip).toHaveAttribute("data-side", "right");
});

import type { DiagramFile } from "../../src/model/types";
import { test, expect, expectNoErrors } from "./fixtures";

test("retrying an unchanged degraded selection restores scaling", async ({ page, consoleErrors }) => {
  await page.goto("./?view=lab&preset=import-retry");
  await expect(page.getByTestId("import-report-pick")).toBeVisible();
  const originalText = await page.getByTestId("import-retry-original").textContent();
  if (!originalText) throw new Error("Original import was not rendered");
  const original: DiagramFile = JSON.parse(originalText);
  expect(original.nodes.map((n) => n.label).sort()).toEqual(["Topic", "Worker"]);
  expect(original.nodes.find((n) => n.label === "Worker")?.props?.autoscaling).toMatchObject({ mode: "unsupported" });
  await expect(page.getByTestId("import-report-pick-0")).toBeChecked();
  await expect(page.getByTestId("import-report-pick-1")).not.toBeChecked();
  // Click the real report action without touching either checkbox.
  await page.getByTestId("import-report-pick-draw").click();
  await expect(page.getByTestId("import-report")).toHaveCount(0);
  await expect(page.getByTestId("import-retry-new")).not.toBeEmpty();
  const replayedText = await page.getByTestId("import-retry-new").textContent();
  if (!replayedText) throw new Error("Retried import was not rendered");
  const replayed: DiagramFile = JSON.parse(replayedText);
  expect(replayed.title).not.toBe(original.title);
  expect(replayed.nodes.map((n) => n.label).sort()).toEqual(["Reader", "Topic", "Worker"]);
  const topic = replayed.nodes.find((n) => n.label === "Topic");
  const reader = replayed.nodes.find((n) => n.label === "Reader");
  if (!topic || !reader) throw new Error("Scaling dependencies were not restored");
  expect(replayed.nodes.find((n) => n.label === "Worker")?.props?.autoscaling).toMatchObject({
    mode: "on",
    controller: { triggers: [{ source: { node: topic.id, group: "readers" } }] },
  });
  expect(replayed.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ from: topic.id, to: reader.id, props: expect.objectContaining({ group: "readers" }) }),
    ]),
  );
  await expect(page.getByTestId("import-retry-original")).toHaveText(originalText);
  expectNoErrors(consoleErrors);
});

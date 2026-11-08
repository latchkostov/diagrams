import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";
import { waitForBackgroundChecks } from "./checks-readiness";
import { chunk, holdChunk, releaseAndEvaluate } from "./chunk";

test("Properties recovers a finding omitted from the whole worker reply, with a verified fix", async ({
  page,
  consoleErrors,
}) => {
  const checksUi = chunk("ChecksCard", "src/checks/ui/ChecksCard.tsx");
  const held = await holdChunk(page, checksUi);
  // Exercise the protocol boundary with a small real graph: emulate a truncated whole-diagram reply.
  // Target replies and fix verification still come from the real production worker.
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name !== "checks") return;
        this.addEventListener("message", (event: MessageEvent) => {
          const data = event.data;
          if (!data.result || !data.requests) return;
          const omitted = {
            id: "call-timeout:*omitted",
            scope: "diagram",
            rule: "call-timeout",
            target: "",
            elements: [],
            title: "",
            message: "",
            rationale: "",
            severity: "suggestion",
            omitted: 1,
          };
          event.stopImmediatePropagation();
          this.onmessage?.(
            new MessageEvent("message", {
              data: {
                ...data,
                requests: [...data.requests.filter((f: { rule: string }) => f.rule !== "call-timeout"), omitted],
                result: {
                  ...data.result,
                  findings: data.result.findings.filter((f: { rule: string }) => f.rule !== "call-timeout"),
                  omitted: [{ rule: "call-timeout", count: 1 }],
                },
              },
            }),
          );
        });
      }
    };
  });
  await gotoCanvas(page, "slow-payment-provider");
  await waitForBackgroundChecks(page);
  await page.getByTestId("node-checkout").dblclick();
  const label = page.getByTestId("inspector-field-label");
  await expect(label).toBeFocused();
  await expect.poll(held.requested).toBe(true);
  const cursor = await label.evaluate((el) => getComputedStyle(el).cursor);
  await label.evaluate((el: HTMLInputElement) => el.setSelectionRange(1, 4));
  // Model export stays available while the selected finding's presentation is still downloading.
  const download = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+s");
  expect(await (await download).failure()).toBeNull();
  await releaseAndEvaluate(page, checksUi, held.release);
  const finding = page.getByTestId("inspector-check-row-call-timeout:pay");
  await expect(finding).toBeVisible();
  await expect(label).toBeFocused();
  await expect(label).toHaveCSS("cursor", cursor);
  expect(await label.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([1, 4]);
  await expect(page.getByTestId("inspector-check-fix-call-timeout:pay")).toBeEnabled();
  await page
    .getByTestId("inspector-check-fix-call-timeout:pay")
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.getByTestId("inspector-check-fix-call-timeout:pay").click();
  await expect(finding).toHaveCount(0);
  await expect(page.getByTestId("check-fix-undo")).toBeVisible();
  expectNoErrors(consoleErrors);
});

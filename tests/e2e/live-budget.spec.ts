import { test, expect, gotoLab, waitForLiveSession, expectNoErrors } from "./fixtures";

test("a refused build shows its recovery notice and disables Play", async ({ page, consoleErrors }) => {
  await gotoLab(page, "custom-json");
  await page.getByTestId("lab-json-toggle").click();
  await page.getByTestId("lab-json-input").fill(
    JSON.stringify({
      format: "diagrams/v1",
      title: "Budget recovery",
      nodes: [
        { id: "source", stencil: "client.browser", label: "Source", x: 0, y: 0 },
        { id: "store", stencil: "db.postgresql", label: "Store", x: 300, y: 0 },
      ],
      edges: [{ id: "flow", from: "source", to: "store" }],
      simulations: [
        {
          id: "budget",
          title: "Budget",
          scale: 10,
          traffic: [{ id: "rate", node: "source", shape: { kind: "constant", ratePerSec: 300_000, durationMs: 1000 } }],
        },
      ],
    }),
  );
  await page.getByTestId("lab-json-apply").click();
  await expect(page.getByTestId("lab-json-error")).toHaveCount(0);
  await page.getByTestId("lab-open-editor").click();
  await page.getByTestId("live-toggle").click();
  await waitForLiveSession(page);
  await page.getByTestId("live-sim-picker").selectOption("budget");
  await page.getByTestId("live-play").click();
  await page.getByTestId("live-capacity").click();
  await page.getByTestId("scale-override").selectOption("1");
  await expect(page.getByTestId("live-notice")).toContainText("restart with more messages per dot");
  await expect(page.getByTestId("live-play")).toBeDisabled();
  await page.getByTestId("live-sim-picker").selectOption("");
  await expect(page.getByTestId("live-play")).toBeEnabled();
  expectNoErrors(consoleErrors);
});

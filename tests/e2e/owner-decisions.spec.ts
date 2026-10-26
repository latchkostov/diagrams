import {
  test,
  expect,
  gotoLive,
  gotoCanvas,
  waitForStableViewport,
  savedDiagram,
  interactionJournal,
  openEditProperties,
} from "./fixtures";

for (const live of [false, true]) {
  test(`node double-click opens Properties ${live ? "in Live without naming" : "in editing with the name selected"}`, async ({
    page,
  }) => {
    if (live) await gotoLive(page, "./?view=canvas&example=blocking-call&live=1");
    else await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    await page.getByTestId("node-caller").dblclick();
    if (live) await openEditProperties(page);
    const label = page.getByTestId("inspector-field-label");
    await expect(label).toBeVisible();
    if (live) {
      await expect(label).not.toBeFocused();
      expect(await label.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBe(0);
      expect((await interactionJournal(page)).some((entry) => entry.event === "rename.hold")).toBe(false);
      await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    } else {
      await expect(label).toBeFocused();
      expect(await label.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBe(
        (await label.inputValue()).length,
      );
      await page.keyboard.type("Renamed caller");
      await expect(label).toHaveValue("Renamed caller");
    }
  });
}

test("editing rename still selects the name after opening Live Properties", async ({ page }) => {
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  const node = page.getByTestId("node-caller");
  const label = page.getByTestId("inspector-field-label");
  await node.dblclick();
  await expect(label).toBeFocused();
  await label.press("Enter");
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-play")).toBeVisible();
  await waitForStableViewport(page);
  await node.dblclick();
  await expect(label).toBeVisible();
  await expect(label).not.toBeFocused();
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-play")).toHaveCount(0);
  await waitForStableViewport(page);
  await node.dblclick();
  await expect(label).toBeFocused();
  expect(await label.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBe(
    (await label.inputValue()).length,
  );
});

test("inline Rate limit edits its quota, validates numbers and undoes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("diagrams.inspector.open.v1", "{}"));
  await gotoCanvas(page, "inline-rate-limit");
  await waitForStableViewport(page);
  await page.getByTestId("node-limiter").dblclick();
  await page.getByTestId("inspector-section-node-simulation").click();
  const field = page.getByTestId("inspector-field-rate-limit");
  await expect(field).toHaveValue("10");
  await expect(field).toHaveAccessibleName("Rate limit");
  await field.fill("20");
  await field.press("Tab");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "limiter")?.props?.api)
    .toEqual({
      quotas: [
        { id: "local-rate", unit: "requests", amount: 20, windowMs: 1000, algorithm: "token-bucket", burst: 20 },
      ],
    });
  await expect(field).toBeVisible();
  await page.getByTestId("inspector").screenshot({ path: test.info().outputPath("rate-limit-inspector.png") });
  await field.fill("-1");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.press("Tab");
  await expect(field).toHaveValue("20");
  await page.getByTestId("undo-button").click();
  await expect(field).toHaveValue("10");
  await field.fill("");
  await field.press("Tab");
  await expect
    .poll(async () => (await savedDiagram(page)).nodes.find((n) => n.id === "limiter")?.props?.api)
    .toEqual({ quotas: [] });
});

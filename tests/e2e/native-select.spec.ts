import { test, expect, gotoLive } from "./fixtures";
import { chooseNativeSelect } from "./native-select";

test("successive native typeahead choices start independent searches", async ({ page }) => {
  await page.setContent(
    '<select data-testid="choice"><option value="a">Alpha</option><option value="b">Beta</option><option value="c">Charlie</option></select><button data-testid="after">After</button>',
  );
  await page.keyboard.press("Tab");
  await chooseNativeSelect(page, "choice", "b", "typeahead");
  await expect(page.getByTestId("choice")).toHaveValue("b");
  await chooseNativeSelect(page, "choice", "c", "typeahead");
  await expect(page.getByTestId("choice")).toHaveValue("c");
  await expect(page.getByTestId("choice")).toBeFocused();
});

for (const [language, busy, waiting] of [
  ["English", "threads busy", "threads waiting"],
  ["Arabic", "الخيوط المشغولة", "الخيوط المنتظرة"],
] as const) {
  test(`native printable typeahead selects the exact ${language} metric`, async ({ page }) => {
    await page.setContent(
      `<select data-testid="metric"><option value="threadsBusy">${busy}</option><option value="threadsWaiting">${waiting}</option></select>`,
    );
    await page.getByTestId("metric").focus();
    await chooseNativeSelect(page, "metric", "threadsWaiting", "typeahead");
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("metric")).toHaveValue("threadsWaiting");
  });
}

test("native typeahead adds one timeline note through a resetting action select", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-edit-sims").click();
  await page.getByTestId("sim-panel-new").click();
  await page.getByTestId("sim-panel-section-timeline-toggle").click();
  const rows = page.getByTestId(/^sim-panel-step-\d+$/);
  const before = await rows.count();
  await page.getByTestId("sim-panel-add-step").focus();
  await chooseNativeSelect(page, "sim-panel-add-step", "note", "typeahead");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("sim-panel-add-step")).toHaveValue("");
  await expect(rows).toHaveCount(before + 1);
  await expect(page.getByTestId(`sim-panel-step-${before}-action`)).toHaveValue("note");
});

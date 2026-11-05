import { test, expect, gotoCanvas, savedDiagram, STORAGE_KEYS, waitForSelectionSettled } from "./fixtures";
import { cacheAsideFixture } from "../../src/lab/cacheAsideFixture";
import { waitForBackgroundChecks } from "./checks-readiness";

for (const locale of ["en", "ar"]) {
  test(`cache-aside keeps When in request details, names the cache and is undoable (${locale})`, async ({ page }) => {
    const diagram = cacheAsideFixture();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(
      ({ diagram, locale, key }) => {
        localStorage.setItem(key, JSON.stringify(diagram));
        localStorage.setItem("diagrams.locale", locale);
        localStorage.setItem("diagrams.inspector.open.v1", "{}");
      },
      { diagram, locale, key: STORAGE_KEYS.autosavePrefix + "blocking-call" },
    );
    await gotoCanvas(page, "blocking-call");
    await waitForBackgroundChecks(page);
    await page.getByTestId("edge-fetch").dblclick();
    await waitForSelectionSettled(page);
    await page.getByTestId("inspector-section-edge-simulation").click();
    const details = page.getByTestId("inspector-section-call-advanced");
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("inspector-summary-call-advanced")).toContainText("\u2068Product cache\u2069");
    await expect(page.getByTestId("inspector-field-onMiss")).toHaveCount(0);
    await details.click();
    const when = page.getByTestId("inspector-field-onMiss");
    await expect(when).toHaveAccessibleName(locale === "en" ? "When" : "متى");
    await expect(when).toHaveValue("lookup");
    await expect(when).toContainText("\u2068Product cache\u2069");
    const full = await page.getByTestId("inspector-unit-onMiss").boundingBox();
    const control = await when.boundingBox();
    expect(full).not.toBeNull();
    expect(control?.width).toBeGreaterThan((full?.width ?? Infinity) * 0.9);
    await page.screenshot({ path: test.info().outputPath(`cache-aside-${locale}.png`) });
    await when.selectOption("");
    await expect
      .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "fetch")?.props?.caller)
      .toEqual({ wait: "blocking" });
    await page.getByTestId("undo-button").click();
    await expect(when).toHaveValue("lookup");
  });
}

import type { Page } from "@playwright/test";
import type { Bench, AppHooks } from "./harness";

/** A fulfilled evidence promise can still omit simulations. Accept only the complete UI result. */
export async function runSurveySimulations(page: Page, count: number) {
  const before = await page.evaluate(() => (window as AppHooks).__simulations?.finished ?? 0);
  await page.getByTestId("context-menu-item-canvas.run-simulations").click();
  await page.waitForFunction(
    (was) =>
      ((window as AppHooks).__simulations?.finished ?? 0) > was &&
      document.querySelector('[data-testid="checks-simulations"]')?.getAttribute("data-status") === "done",
    before,
    { timeout: 300_000 },
  );
  const status = await page.getByTestId("checks-simulations-status").textContent();
  const notes = await page.getByTestId("checks-simulations-notes").allTextContents();
  const complete = `Played ${count} simulations`;
  if (
    !(status === complete || status?.startsWith(`${complete} ·`)) ||
    /not counted|out of time|too big/i.test(notes.join(" "))
  )
    throw new Error(`Incomplete survey simulation run: ${status}; ${notes.join(" ")}`);
}

/** Discard probe-owned timing history before GC, including the warmed baseline. */
export async function surveyMemory(b: Pick<Bench, "mark" | "heap" | "domCounters">) {
  await b.mark();
  return { heap: await b.heap(), ...(await b.domCounters()) };
}

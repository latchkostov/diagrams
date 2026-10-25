import type { Page } from "@playwright/test";
import { animationFrames, expect } from "./fixtures";

/** A chunk's production file, or its source module on the dev server. */
export const chunk = (name: string, source: string) =>
  new RegExp(String.raw`/(?:assets/${name}-[A-Za-z0-9_-]+\.js|${source.replace(/\./g, "\\.")})(?:\?.*)?$`);

/** Holds requests until release; setting fail before release also fails an already held request. */
export async function holdChunk(page: Page, pattern: RegExp) {
  let requested = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const control = { fail: false, requested: () => requested, release };
  await page.route(pattern, async (route) => {
    requested = true;
    if (!control.fail) await held;
    if (control.fail) await route.abort("failed");
    else await route.continue();
  });
  return control;
}

/** Network completion alone can precede evaluation, lazy subscribers and React's next commit. */
export async function releaseAndEvaluate(page: Page, pattern: RegExp, release: () => void) {
  const response = page.waitForResponse((r) => pattern.test(r.url()));
  release();
  const module = await response;
  expect(await module.finished()).toBeNull();
  await page.evaluate(async (url) => {
    await import(url);
  }, module.url());
  await animationFrames(page);
}

import type { Download, Page } from "@playwright/test";
import { expect } from "./fixtures";

/** Archive generation is server work; the whole-test backstop owns completion, not a click deadline. */
export async function downloadSkill(page: Page): Promise<Download> {
  let receive!: (download: Download) => void;
  const pending = new Promise<Download>((resolve) => (receive = resolve));
  page.once("download", receive);
  try {
    await page.getByTestId("skill-zip").click({ noWaitAfter: true });
    const download = await pending;
    expect(download.suggestedFilename()).toBe("livediagrams-skill.zip");
    expect(await download.failure()).toBeNull();
    return download;
  } finally {
    page.off("download", receive);
  }
}

// Each public example as the canvas draws it (measured node sizes, routed edges, placed labels, the fitted view),
// then after Auto-layout and after Tidy up of everything (both with measured sizes, which the Node tier can't see).
import { test } from "./fixtures";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expectGolden, ROOT } from "../lib/golden";
import { checksChrome, command, openExample, restoreOpening, settledCanvas, tidyAll } from "./canvas";

const slugs = readdirSync(join(ROOT, "src/examples"), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".json"))
  .map((e) => e.name.slice(0, -".json".length))
  .sort();
slugs.push("corpus-hand-shaped-lines");

for (const slug of slugs) {
  test(`canvas: ${slug}`, async ({ page }) => {
    expectGolden(`render/${slug}.json`, await openExample(page, slug));
  });

  test(`auto-layout and tidy: ${slug}`, async ({ page }) => {
    const opened = await openExample(page, slug);
    await checksChrome(page, slug);
    await command(page, "Auto-layout", "canvas.auto-layout");
    const laidOut = await settledCanvas(page);
    await restoreOpening(page, opened, laidOut);
    await tidyAll(page, opened);
    const tidied = await settledCanvas(page);
    expectGolden(`layout/${slug}.json`, { autoLayout: laidOut, tidy: tidied });
  });
}

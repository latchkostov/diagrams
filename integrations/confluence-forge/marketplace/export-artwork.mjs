import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const directory = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
try {
  for (const [source, exports] of [
    [
      "icon.svg",
      [
        [144, 144, "logo-144.png"],
        [288, 288, "logo-288.png"],
      ],
    ],
    [
      "banner.svg",
      [
        [1120, 548, "banner-1120.png"],
        [560, 274, "banner-560.png"],
      ],
    ],
  ]) {
    const svg = await readFile(join(directory, source), "utf8");
    for (const [width, height, name] of exports) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.setContent(
        `<body style="margin:0"><img width="${width}" height="${height}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body>`,
      );
      await page.locator("img").evaluate((image) => image.decode());
      await page.screenshot({ path: join(directory, name), omitBackground: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
}

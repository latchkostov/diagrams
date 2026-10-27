// Image-export PNGs use a capped raster tolerance; HTML viewer screenshots retain their existing comparison.
import type { Page } from "@playwright/test";
import { expectGoldenBinary } from "../lib/golden";
import { comparePngs } from "../../pngComparison";

/** Compares a PNG with its golden (stored downscaled); returns the full image's size, for a data golden. */
export async function expectGoldenPng(page: Page, name: string, png: Buffer): Promise<string> {
  const url = `data:image/png;base64,${png.toString("base64")}`;
  const first = await comparePngs(page, url, undefined, 4);
  await expectGoldenBinary(
    name,
    Buffer.from(first.reference.slice("data:image/png;base64,".length), "base64"),
    async (golden) => {
      const compared = await comparePngs(page, url, `data:image/png;base64,${golden.toString("base64")}`, 4);
      console.log(`${name}: ${compared.diff.join("; ")}`);
      return compared.equal ? undefined : compared.diff;
    },
  );
  return first.size;
}

// The tolerant PNG comparison (docs/PARITY.md, Browser tier): both images downscaled by 4 in the page, and at most
// 0.1% of the pixels may differ by more than 16 of 255 in a channel. Two runs in the pinned image are pixel-identical;
// the tolerance absorbs rasteriser differences between host CPUs (Windows against Linux differed by 1.2 to 1.5%). A
// moved node or a changed colour fails it; a single thin line may not, which is what the structural goldens are for.
import type { Page } from "@playwright/test";
import { expectGoldenBinary } from "../lib/golden";

const DOWNSCALE = 4;
const CHANNEL_TOLERANCE = 16;
const PIXEL_SHARE = 0.001;

/** Downscales the PNG in the page and, given a reference, counts the pixels that differ past the tolerance. */
async function pngCompare(page: Page, actual: Buffer, golden?: Buffer) {
  return page.evaluate(
    async ({ actual, golden, downscale, tolerance }) => {
      const load = (b64: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("not a PNG"));
          img.src = `data:image/png;base64,${b64}`;
        });
      const pixels = (img: HTMLImageElement, w: number, h: number) => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2D canvas");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        return { canvas, data: ctx.getImageData(0, 0, w, h).data };
      };
      const img = await load(actual);
      const w = Math.max(1, Math.round(img.naturalWidth / downscale));
      const h = Math.max(1, Math.round(img.naturalHeight / downscale));
      const small = pixels(img, w, h);
      const out = {
        size: `${img.naturalWidth}×${img.naturalHeight}`,
        reference: small.canvas.toDataURL("image/png").slice("data:image/png;base64,".length),
        diff: undefined as undefined | string[],
      };
      if (!golden) return out;
      const ref = await load(golden);
      if (ref.naturalWidth !== w || ref.naturalHeight !== h) {
        out.diff = [`size ${ref.naturalWidth}×${ref.naturalHeight} → ${w}×${h} (downscaled by ${downscale})`];
        return out;
      }
      const before = pixels(ref, w, h).data;
      let over = 0;
      let worst = 0;
      for (let i = 0; i < before.length; i += 4) {
        const delta = Math.max(
          Math.abs(before[i] - small.data[i]),
          Math.abs(before[i + 1] - small.data[i + 1]),
          Math.abs(before[i + 2] - small.data[i + 2]),
          Math.abs(before[i + 3] - small.data[i + 3]),
        );
        worst = Math.max(worst, delta);
        if (delta > tolerance) over++;
      }
      const share = over / (w * h);
      (out as { share?: number }).share = share;
      out.diff = [
        `${over} of ${w * h} pixels differ by more than ${tolerance} (${(share * 100).toFixed(3)}%), worst ${worst}`,
      ];
      return { ...out, share };
    },
    {
      actual: actual.toString("base64"),
      golden: golden?.toString("base64"),
      downscale: DOWNSCALE,
      tolerance: CHANNEL_TOLERANCE,
    },
  );
}

/** Compares a PNG with its golden (stored downscaled); returns the full image's size, for a data golden. */
export async function expectGoldenPng(page: Page, name: string, png: Buffer): Promise<string> {
  const first = await pngCompare(page, png);
  await expectGoldenBinary(name, Buffer.from(first.reference, "base64"), async (golden) => {
    const compared = await pngCompare(page, png, golden);
    const share = (compared as { share?: number }).share;
    return share !== undefined && share <= PIXEL_SHARE ? undefined : compared.diff;
  });
  return first.size;
}

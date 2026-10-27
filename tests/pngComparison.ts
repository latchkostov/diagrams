import type { Page } from "@playwright/test";

/** Only PNG raster comparisons use this allowance. SVG/HTML keep their existing exact comparisons. */
export const PNG_CHANNEL_DELTA = 16;
export const PNG_MAX_PIXELS = 600;
export const PNG_PIXEL_SHARE = 0.001;

/** Decode in the browser: compare full-size E2E exports or the parity tier's existing 4× smaller references. */
export async function comparePngs(page: Page, actual: string, golden?: string, downscale = 1) {
  return page.evaluate(
    async ({ actual, golden, downscale, channelDelta, maxPixels, pixelShare }) => {
      const load = (url: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("not a PNG"));
          img.src = url;
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
        reference: small.canvas.toDataURL("image/png"),
        equal: false,
        differing: 0,
        worst: 0,
        limit: Math.min(maxPixels, Math.floor(w * h * pixelShare)),
        diff: [] as string[],
      };
      if (!golden) return out;
      const ref = await load(golden);
      if (ref.naturalWidth !== w || ref.naturalHeight !== h) {
        out.diff = [`size ${ref.naturalWidth}×${ref.naturalHeight} → ${w}×${h}`];
        return out;
      }
      const before = pixels(ref, w, h).data;
      for (let i = 0; i < before.length; i += 4) {
        const delta = Math.max(
          Math.abs(before[i] - small.data[i]),
          Math.abs(before[i + 1] - small.data[i + 1]),
          Math.abs(before[i + 2] - small.data[i + 2]),
          Math.abs(before[i + 3] - small.data[i + 3]),
        );
        out.worst = Math.max(out.worst, delta);
        if (delta > channelDelta) out.differing++;
      }
      out.equal = out.differing <= out.limit;
      out.diff = [
        `${out.differing} of ${w * h} pixels differ by more than ${channelDelta}/255 per channel; limit ${out.limit}, worst ${out.worst}`,
      ];
      return out;
    },
    {
      actual,
      golden,
      downscale,
      channelDelta: PNG_CHANNEL_DELTA,
      maxPixels: PNG_MAX_PIXELS,
      pixelShare: PNG_PIXEL_SHARE,
    },
  );
}

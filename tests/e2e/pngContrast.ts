import type { Page } from "@playwright/test";

/** Sample the rendered PNG, including compositing and antialiasing, rather than reading token colours. */
export async function sampledContrast(
  page: Page,
  png: Buffer,
  regions: {
    x: number;
    y: number;
    width: number;
    height: number;
    ground?: { x: number; y: number };
    normal?: { x: number; y: number };
    edge?: string;
  }[],
) {
  return page.evaluate(
    async ({ data, regions }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Expected a PNG sampling context");
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
      const lum = (x: number, y: number) => {
        const at =
          (Math.max(0, Math.min(img.height - 1, Math.round(y))) * img.width +
            Math.max(0, Math.min(img.width - 1, Math.round(x)))) *
          4;
        const c = [pixels[at], pixels[at + 1], pixels[at + 2]].map((v) => {
          const n = v / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        });
        return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      };
      return regions.map((r) => {
        const ground = r.ground ? lum(r.ground.x, r.ground.y) : lum(r.x + 1, r.y + 1);
        if (r.normal) {
          let ink = 1;
          for (const offset of [-0.75, 0, 0.75]) {
            const value = lum(r.x + r.normal.x * offset, r.y + r.normal.y * offset);
            ink = Math.max(ink, (Math.max(value, ground) + 0.05) / (Math.min(value, ground) + 0.05));
          }
          return ink;
        }
        let peak = 1;
        for (let y = Math.ceil(r.y); y < r.y + r.height; y++)
          for (let x = Math.ceil(r.x); x < r.x + r.width; x++) {
            const ink = lum(x, y);
            peak = Math.max(peak, (Math.max(ink, ground) + 0.05) / (Math.min(ink, ground) + 0.05));
          }
        return peak;
      });
    },
    { data: png.toString("base64"), regions },
  );
}
